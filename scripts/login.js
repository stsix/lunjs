// scripts/login.js
// 多账户登录逻辑：使用 Playwright (Chromium) 依次登录每个账户
// 支持多个账户的JSON格式：{"email1@example.com": "password1", "email2@example.com": "password2"}
// 环境变量（通过 GitHub Secrets 注入）：
//   USERNAME_AND_PASSWORD - 包含所有账户的JSON字符串
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { chromium } from '@playwright/test';
import fs from 'fs';

const LOGIN_URL = 'https://ctrl.lunes.host/auth/login';
const MAX_RETRIES = 2; // 每个账户的最大重试次数
const NAVIGATION_TIMEOUT = 60_000; // 导航超时时间（60秒）
const DEFAULT_WAIT_TIME = 5000; // 默认等待时间（5秒）

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
        `${index + 1}. ${r.username}: ${r.success ? '✅ 成功' : '❌ 失败'}${r.message ? ` (${r.message})` : ''}${r.retries > 0 ? ` [重试: ${r.retries}]` : ''}`
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

// 智能等待函数
async function smartWait(page, condition, timeout = 30000, checkInterval = 1000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const result = await condition();
      if (result) return result;
    } catch (e) {
      // 忽略检查过程中的错误，继续等待
    }
    await page.waitForTimeout(checkInterval);
  }
  return false;
}

async function loginWithAccount(username, password, index) {
  console.log(`\n=== 开始处理账户 ${index + 1}: ${username} ===`);
  
  let retryCount = 0;
  let result = null;
  
  // 重试机制
  while (retryCount <= MAX_RETRIES && !(result?.success)) {
    if (retryCount > 0) {
      console.log(`[${username}] 🔄 第 ${retryCount} 次重试...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // 重试前等待5秒
    }
    
    result = await attemptLogin(username, password, index, retryCount);
    retryCount++;
  }
  
  return { ...result, retries: retryCount - 1 };
}

async function attemptLogin(username, password, index, retryCount) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });
  
  const page = await context.newPage();

  const screenshot = (name) => `./${name}-${index}-${username.replace(/[@.]/g, '_')}${retryCount > 0 ? `-retry${retryCount}` : ''}.png`;

  try {
    // 1) 打开登录页
    console.log(`[${username}] 打开登录页...`);
    await page.goto(LOGIN_URL, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60_000 
    });

    // 快速检测"人机验证"页面文案
    const humanCheckText = await page.locator('text=/Verify you are human|需要验证|安全检查|review the security|Cloudflare|Turnstile/i').first();
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
    console.log(`[${username}] 等待登录表单加载...`);
    const userInput = page.locator('input[name="username"], input[type="email"], input[type="text"]').first();
    const passInput = page.locator('input[name="password"], input[type="password"]').first();

    // 使用智能等待确保元素完全可交互
    await smartWait(page, async () => {
      return await userInput.isVisible() && await passInput.isVisible();
    }, 30000);

    // 填充账户信息
    console.log(`[${username}] 填写登录信息...`);
    
    // 清空并填写用户名
    await userInput.click({ timeout: 10_000 });
    await userInput.evaluate(el => el.value = ''); // 更可靠的清空方式
    await userInput.fill(username, { timeout: 10_000 });
    
    // 清空并填写密码
    await passInput.click({ timeout: 10_000 });
    await passInput.evaluate(el => el.value = ''); // 更可靠的清空方式
    await passInput.fill(password, { timeout: 10_000 });

    // 3) 点击登录按钮
    const loginBtn = page.locator('button[type="submit"], button:has-text("登录"), button:has-text("Sign in"), button:has-text("Log in")').first();
    await loginBtn.waitFor({ state: 'visible', timeout: 15_000 });
    
    const spBefore = screenshot('02-before-submit');
    await page.screenshot({ path: spBefore, fullPage: true });

    console.log(`[${username}] 提交登录...`);
    
    // 使用 Promise.all 同时等待导航和点击操作
    const navigationPromise = page.waitForNavigation({ 
      waitUntil: 'networkidle', 
      timeout: NAVIGATION_TIMEOUT 
    }).catch(e => {
      console.log(`[${username}] 导航等待可能超时: ${e.message}`);
      return null; // 不抛出异常，我们会通过其他方式检查状态
    });

    await loginBtn.click({ timeout: 10_000 });
    
    // 等待导航完成或超时
    await navigationPromise;
    
    // 额外等待确保页面完全稳定
    console.log(`[${username}] 等待页面完全稳定...`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // 4) 判定是否登录成功
    const spAfter = screenshot('03-after-submit');
    await page.screenshot({ path: spAfter, fullPage: true });

    const url = page.url();
    console.log(`[${username}] 当前URL: ${url}`);
    
    // 多种方式检测登录成功
    const successSelectors = [
      'text=/Dashboard|控制台|面板|仪表板/i',
      'text=/Logout|Sign out|退出|登出/i',
      'text=/Welcome|欢迎/i',
      'text=/Account|账户|账号/i',
      'text=/Profile|个人资料/i'
    ];
    
    let successHint = 0;
    for (const selector of successSelectors) {
      const element = page.locator(selector);
      const count = await element.count();
      successHint += count;
      if (count > 0) {
        console.log(`[${username}] 找到成功标识: ${selector}`);
        break;
      }
    }
    
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
    const errorSelectors = [
      'text=/Invalid|incorrect|错误|失败|无效|不正确/i',
      'text=/Error|异常|问题/i',
      '.error-message',
      '.alert-error',
      '.text-danger',
      '[class*="error"]',
      '[class*="alert"]',
      '[class*="danger"]'
    ];
    
    let errorMsg = '';
    for (const selector of errorSelectors) {
      const errorElement = page.locator(selector);
      if (await errorElement.count() > 0) {
        errorMsg = await errorElement.first().innerText().catch(() => '');
        if (errorMsg && errorMsg.length > 1) { // 确保不是空字符串或单个字符
          console.log(`[${username}] 找到错误信息: ${errorMsg}`);
          break;
        }
      }
    }

    if (!errorMsg) {
      // 如果没有找到明确的错误信息，检查页面标题或主要内容
      const pageTitle = await page.title();
      const mainContent = await page.locator('body').innerText().catch(() => '');
      
      if (pageTitle.includes('Error') || mainContent.includes('Error')) {
        errorMsg = '页面显示错误状态';
      }
    }

    console.log(`[${username}] ❌ 登录失败: ${errorMsg || '未知错误'}`);
    await notifyTelegram({
      ok: false,
      stage: '登录结果',
      msg: errorMsg ? `登录失败: ${errorMsg}` : '登录失败（原因未知）',
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
      console.log(`\n=== 开始处理账户 ${i + 1}/${accountEntries.length}: ${username} ===`);
      
      const result = await loginWithAccount(username, password, i);
      results.push(result);
      
      console.log(`=== 完成处理账户 ${i + 1}/${accountEntries.length}: ${username} ===`);
      
      // 在账户之间添加延迟，避免请求过于频繁
      if (i < accountEntries.length - 1) {
        const delay = 5000 + Math.random() * 5000; // 5-10秒随机延迟
        console.log(`等待 ${Math.round(delay/1000)} 秒后处理下一个账户...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // 发送汇总通知
    console.log('所有账户处理完成，发送汇总通知...');
    await sendSummaryNotification(results);

    // 检查是否有失败的登录
    const hasFailure = results.some(r => !r.success);
    if (hasFailure) {
      console.log('⚠️  有部分账户登录失败，请检查日志和通知');
      process.exitCode = 1;
    } else {
      console.log('✅ 所有账户登录成功');
      process.exitCode = 0;
    }

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
