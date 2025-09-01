// scripts/login.js
// 多账户登录逻辑：使用 Playwright (Chromium) 依次登录每个账户
// 支持多个账户的JSON格式：{"email1@example.com": "password1", "email2@example.com": "password2"}
// 环境变量（通过 GitHub Secrets 注入）：
//   USERNAME_AND_PASSWORD - 包含所有账户的JSON字符串
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { chromium } from '@playwright/test';
import fs from 'fs';

const LOGIN_URL = 'https://ctrl.lunes.host/auth/login';

// Telegram 通知
async function notifyTelegram({ ok, stage, msg, screenshotPath, username }) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      console.log('[WARN] TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID 未设置，跳过通知');
      return;
    }

    const text = [
      `🔔 Lunes 自动登录${username ? ` (${username})` : ''}：${ok ? '✅ 成功' : '❌ 失败'}`,
      `阶段：${stage}`,
      msg ? `信息：${msg}` : '',
      `时间：${new Date().toISOString()}`
    ].filter(Boolean).join('\n');

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    // 若有截图，再发一张
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const photoUrl = `https://api.telegram.org/bot${token}/sendPhoto`;
      const formData = new FormData();
      const imageBuffer = fs.readFileSync(screenshotPath);
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      formData.append('chat_id', chatId);
      formData.append('caption', `Lunes 自动登录截图（${stage}${username ? ` - ${username}` : ''}）`);
      formData.append('photo', blob, 'screenshot.png');
      
      await fetch(photoUrl, { 
        method: 'POST', 
        body: formData 
      });
    }
  } catch (e) {
    console.log('[WARN] Telegram 通知失败：', e.message);
  }
}

// 发送汇总通知
async function sendSummaryNotification(results) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      console.log('[WARN] TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID 未设置，跳过汇总通知');
      return;
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    const text = [
      `📊 Lunes 自动登录汇总报告`,
      `总账户数: ${totalCount}`,
      `成功: ${successCount}`,
      `失败: ${totalCount - successCount}`,
      `\n详细结果:`,
      ...results.map((r, index) => 
        `${index + 1}. ${r.username}: ${r.success ? '✅ 成功' : '❌ 失败'}${r.message ? ` (${r.message})` : ''}`
      ),
      `\n时间: ${new Date().toISOString()}`
    ].join('\n');

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.log('[WARN] Telegram 汇总通知失败：', e.message);
  }
}

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`环境变量 ${name} 未设置`);
  return v;
}

async function loginWithAccount(username, password, index) {
  console.log(`\n=== 开始处理账户 ${index + 1}: ${username} ===`);
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 }
  });
  const page = await context.newPage();

  const screenshot = (name) => `./${name}-${index}-${username.replace(/[@.]/g, '_')}.png`;

  try {
    // 1) 打开登录页
    console.log(`[${username}] 打开登录页...`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // 快速检测"人机验证"页面文案
    const humanCheckText = await page.locator('text=/Verify you are human|需要验证|安全检查|review the security/i').first();
    if (await humanCheckText.count()) {
      const sp = screenshot('01-human-check');
      await page.screenshot({ path: sp, fullPage: true });
      await notifyTelegram({
        ok: false,
        stage: '打开登录页',
        msg: '检测到人机验证页面（Cloudflare/Turnstile），自动化已停止。',
        screenshotPath: sp,
        username
      });
      return { success: false, username, message: '人机验证页面' };
    }

    // 2) 等待输入框可见
    const userInput = page.locator('input[name="username"]');
    const passInput = page.locator('input[name="password"]');

    await userInput.waitFor({ state: 'visible', timeout: 30_000 });
    await passInput.waitFor({ state: 'visible', timeout: 30_000 });

    // 填充账户信息
    console.log(`[${username}] 填写登录信息...`);
    await userInput.click({ timeout: 10_000 });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await userInput.fill(username, { timeout: 10_000 });

    await passInput.click({ timeout: 10_000 });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await passInput.fill(password, { timeout: 10_000 });

    // 3) 点击登录按钮
    const loginBtn = page.locator('button[type="submit"]');
    await loginBtn.waitFor({ state: 'visible', timeout: 15_000 });
    const spBefore = screenshot('02-before-submit');
    await page.screenshot({ path: spBefore, fullPage: true });

    console.log(`[${username}] 提交登录...`);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
      loginBtn.click({ timeout: 10_000 })
    ]);

    // 4) 判定是否登录成功
    const spAfter = screenshot('03-after-submit');
    await page.screenshot({ path: spAfter, fullPage: true });

    const url = page.url();
    const successHint = await page.locator('text=/Dashboard|Logout|Sign out|控制台|面板/i').first().count();
    const stillOnLogin = /\/auth\/login/i.test(url);

    if (!stillOnLogin || successHint > 0) {
      console.log(`[${username}] ✅ 登录成功`);
      await notifyTelegram({
        ok: true,
        stage: '登录结果',
        msg: `判断为成功。当前 URL：${url}`,
        screenshotPath: spAfter,
        username
      });
      return { success: true, username, message: '登录成功' };
    }

    // 若还在登录页，进一步检测错误提示
    const errorMsgNode = page.locator('text=/Invalid|incorrect|错误|失败|无效/i');
    const hasError = await errorMsgNode.count();
    const errorMsg = hasError ? await errorMsgNode.first().innerText().catch(() => '') : '';

    console.log(`[${username}] ❌ 登录失败: ${errorMsg || '未知错误'}`);
    await notifyTelegram({
      ok: false,
      stage: '登录结果',
      msg: errorMsg ? `仍在登录页，疑似失败（${errorMsg}）` : '仍在登录页，疑似失败（未捕获到错误提示）',
      screenshotPath: spAfter,
      username
    });
    
    return { success: false, username, message: errorMsg || '登录失败' };
  } catch (e) {
    const sp = screenshot('99-error');
    try { await page.screenshot({ path: sp, fullPage: true }); } catch {}
    console.error(`[${username}] 💥 发生异常:`, e.message);
    await notifyTelegram({
      ok: false,
      stage: '异常',
      msg: e?.message || String(e),
      screenshotPath: fs.existsSync(sp) ? sp : undefined,
      username
    });
    return { success: false, username, message: `异常: ${e.message}` };
  } finally {
    await context.close();
    await browser.close();
    console.log(`=== 完成处理账户 ${index + 1}: ${username} ===\n`);
  }
}

async function main() {
  try {
    const usernameAndPasswordJson = envOrThrow('USERNAME_AND_PASSWORD');
    let accounts;
    
    try {
      accounts = JSON.parse(usernameAndPasswordJson);
    } catch (e) {
      throw new Error('USERNAME_AND_PASSWORD 格式错误，应为有效的 JSON 字符串');
    }

    if (typeof accounts !== 'object' || accounts === null) {
      throw new Error('USERNAME_AND_PASSWORD 应为对象格式');
    }

    const accountEntries = Object.entries(accounts);
    if (accountEntries.length === 0) {
      throw new Error('未找到有效的账户信息');
    }

    console.log(`找到 ${accountEntries.length} 个账户，开始依次处理...`);

    const results = [];
    for (let i = 0; i < accountEntries.length; i++) {
      const [username, password] = accountEntries[i];
      const result = await loginWithAccount(username, password, i);
      results.push(result);
      
      // 在账户之间添加短暂延迟，避免请求过于频繁
      if (i < accountEntries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // 发送汇总通知
    console.log('所有账户处理完成，发送汇总通知...');
    await sendSummaryNotification(results);

    // 检查是否有失败的登录
    const hasFailure = results.some(r => !r.success);
    process.exitCode = hasFailure ? 1 : 0;

  } catch (e) {
    console.error('[ERROR] 初始化失败:', e.message);
    await notifyTelegram({
      ok: false,
      stage: '初始化',
      msg: e.message,
      username: 'N/A'
    });
    process.exitCode = 1;
  }
}

await main();
