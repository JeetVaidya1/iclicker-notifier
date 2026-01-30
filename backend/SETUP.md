# Backend Setup Guide

This guide walks you through deploying the iClicker Notifier backend to Cloudflare Workers (free tier).

## Prerequisites

- A Cloudflare account (free): https://dash.cloudflare.com/sign-up
- Node.js installed on your computer
- Your Telegram bot token from @BotFather

## Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
```

## Step 2: Login to Cloudflare

```bash
wrangler login
```

This opens a browser window to authenticate.

## Step 3: Create KV Namespace

The backend needs a KV (key-value) store to save user registrations.

```bash
cd backend
wrangler kv:namespace create USERS
```

This outputs something like:
```
{ binding = "USERS", id = "abc123..." }
```

Copy the `id` value and update `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "USERS"
id = "abc123..."  # <-- paste your ID here
```

## Step 4: Set Your Bot Token (Secret)

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
```

When prompted, paste your bot token from @BotFather.

## Step 5: Deploy

```bash
wrangler deploy
```

This outputs your worker URL, something like:
```
https://iclicker-notifier.your-subdomain.workers.dev
```

## Step 6: Set Up Telegram Webhook

Tell Telegram to send messages to your worker. Run this command (replace YOUR_BOT_TOKEN and YOUR_WORKER_URL):

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_WORKER_URL/webhook"
```

Example:
```bash
curl "https://api.telegram.org/bot123456:ABC.../setWebhook?url=https://iclicker-notifier.your-subdomain.workers.dev/webhook"
```

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

## Step 7: Update the Extension

Update these files with your worker URL:

**config.js:**
```js
const CONFIG = {
  BACKEND_URL: 'https://iclicker-notifier.your-subdomain.workers.dev',
  TELEGRAM_BOT_USERNAME: 'YourBotName'
};
```

**background.js:**
```js
const BACKEND_URL = 'https://iclicker-notifier.your-subdomain.workers.dev';
```

## Step 8: Test It

1. Load/reload the extension in Chrome
2. Enable Telegram notifications
3. Click "Open Bot in Telegram"
4. Send any message to the bot
5. You should receive a 6-digit code
6. Enter the code in the extension
7. Click "Send test" to verify

## Troubleshooting

### "Invalid or expired code"
- Codes expire after 10 minutes
- Make sure you message the bot BEFORE clicking Connect
- Try sending another message to get a fresh code

### Webhook not working
Check webhook status:
```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

### View worker logs
```bash
wrangler tail
```

## Costs

Cloudflare Workers free tier includes:
- 100,000 requests/day
- 10ms CPU time per request
- KV: 100,000 reads/day, 1,000 writes/day

This is more than enough for thousands of users.
