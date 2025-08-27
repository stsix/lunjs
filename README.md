# Lunes 多账户保机（GitHub Actions + Telegram 通知）

本项目通过 **GitHub Actions** 自动登录 [Lunes 控制台](https://ctrl.lunes.host/auth/login)，并将结果通过 **Telegram Bot** 通知。

---

## ✅ 快速使用

### 1. Fork 本仓库
点击右上角 **Fork**，将本项目复制到你的 GitHub 账户。

---

### 2. 配置 GitHub Secrets
进入仓库 **Settings → Secrets and variables → Actions → New repository secret**，依次添加如以下Secret：

| Secret 名称             | 值示例                        |
|-------------------------|--------------------------------|
| `USERNAME_AND_PASSWORD`        | `{"your_account1@example.com": "your_password1","your_account2@example.com": "your_password2"}`      |
| `TELEGRAM_BOT_TOKEN`    | `123456789:ABC-XYZ...`        |
| `TELEGRAM_CHAT_ID`      | `123456789`                   |

#### USERNAME_AND_PASSWORD
```
// 格式如下：
{
  "your_account1@example.com": "your_password1",
  "your_account2@example.com": "your_password2"
}
```
> **获取 Telegram 参数方法：**  
> - `TELEGRAM_BOT_TOKEN`：在 Telegram 搜索 @BotFather，创建 Bot 获取 Token。  
> - `TELEGRAM_CHAT_ID`：在 Telegram 搜索 @userinfobot，获取你的 Chat ID。

---

### 3. 触发 Workflow
有两种方式运行：

- **手动执行：**  
  打开仓库 → `Actions` → `Lunes Auto Login` → `Run workflow` → 点击绿色按钮运行。

- **自动执行：**  
  Workflow 默认每14天运行一次，时间在 `login.yml` 中配置（UTC 时区）。

---

### 4. 查看运行结果
- **Telegram 通知：**  
  登录成功、失败或出现验证，会通过 Bot 发送消息和截图到你的 Telegram。
- **GitHub Artifact：**  
  登录过程截图保存在 Actions 的 `Artifacts`，可以下载查看。

---

## ⚠️ 注意事项
- 不要把账号密码写在代码里，请务必使用 GitHub Secrets。
- 如果站点出现 **人机验证（Verify you are human）**，脚本会停止并通知。
- 如需修改运行频率，编辑 `.github/workflows/login.yml` 的 `cron` 表达式。

## 鸣谢
本项目基于
https://github.com/gansweet/BetaDash-lunes-host-autoLogin-Sweet-
二次修改

---

## ✅ 完成
配置完成后，你可以立即手动运行工作流，或等待定时任务自动运行。
