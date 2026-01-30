# iClicker Poll Notifier

Never miss an iClicker poll again. Get instant desktop and phone notifications when your instructor starts a question.

> **Disclaimer:** This is an unofficial, community-built extension. It is not affiliated with iClicker or Macmillan Learning.

---

## Features

### Desktop Notifications
Get an instant popup notification on your computer the moment a poll starts. Works even if you're in a different tab or window.

### Sound Alerts
A clear audio alert plays when polls start so you'll hear it even if you're not looking at your screen. Sound can be toggled on/off.

### Phone Notifications via Telegram
Connect your Telegram account to receive notifications on your phone. Perfect for when you:
- Step away from your laptop
- Close your laptop lid
- Want a backup notification method

### Collaborative Detection
This is where it gets powerful. When **anyone** in your class using the extension detects a poll, **everyone** in that class gets notified.

- More classmates using it = more reliable detection
- If your internet lags but your classmate's doesn't, you still get notified
- Share the extension with your class for best results

### "LIVE" Badge
A red "LIVE" badge appears on the extension icon when a poll is currently active, giving you a visual indicator at a glance.

### Smart Detection
The extension uses multiple detection methods to catch polls:
- URL monitoring (detects `/poll` and `/question/` in the URL)
- WebSocket interception (catches real-time poll events from the server)
- DOM observation (watches for poll-related elements appearing)
- Text pattern matching (looks for phrases like "answer now", "time remaining")

### Works While Viewing Old Questions
Even if you're reviewing a previous question's results, the extension will still detect and notify you when a new poll starts.

### Auto-Join Sessions
Automatically registers you with the current class session when you visit an iClicker page. No manual setup needed.

### Session Heartbeat
Keeps your session alive in the background so you stay connected for collaborative notifications.

---

## Installation

### Option 1: Chrome Web Store (Recommended)
*Coming soon — currently under review*

1. Click the Chrome Web Store link
2. Click "Add to Chrome"
3. Done!

### Option 2: Manual Install

#### Step 1: Download
- Click the green **Code** button at the top of this page
- Click **Download ZIP**
- Find the downloaded file and unzip it

#### Step 2: Open Chrome Extensions
- Open Google Chrome
- Type `chrome://extensions` in the address bar
- Press Enter

#### Step 3: Enable Developer Mode
- Look at the top right corner of the page
- Find the switch that says **Developer mode**
- Click it to turn it ON (it should turn blue)

#### Step 4: Load the Extension
- Click the **Load unpacked** button (top left area)
- Navigate to the folder you unzipped
- Select the folder and click **Open**

#### Step 5: Verify Installation
- You should see "iClicker Poll Notifier" in your extensions list
- A bell icon 🔔 should appear in your Chrome toolbar
- If you don't see it, click the puzzle piece icon and pin it

---

## Setup

### Basic Setup (Desktop Notifications Only)

1. Go to your iClicker class page (e.g., `student.iclicker.com`)
2. Click the extension icon in your toolbar
3. Make sure "Desktop notifications" is enabled
4. That's it! Keep the tab open and you'll be notified when polls start

### Phone Notifications Setup (Optional)

Want to get notifications on your phone? Follow these steps:

#### Step 1: Enable Telegram in the Extension
- Click the extension icon
- Toggle ON "Send to Telegram"
- A setup panel will appear

#### Step 2: Open the Telegram Bot
- Click the "Open Bot in Telegram" button
- This opens our bot: @IclickerNotificationBot
- (Or search for it manually in Telegram)

#### Step 3: Get Your Code
- Send any message to the bot (like "hi" or "start")
- The bot will reply with a 6-digit code
- This code expires in 10 minutes

#### Step 4: Connect
- Go back to the extension popup
- Enter the 6-digit code
- Click "Connect"
- You should see a green "Connected!" message

#### Step 5: Test It
- Click "Send test" to verify it's working
- You should receive a test notification on Telegram

---

## How It Works

### Poll Detection
When you have an iClicker page open, the extension constantly monitors for signs that a poll has started:

1. **URL Changes** — iClicker changes the URL to include `/poll` or `/question/` when a poll is active
2. **WebSocket Messages** — The extension intercepts real-time messages from iClicker's servers
3. **Page Elements** — Looks for timers, submit buttons, and answer options appearing
4. **Text Patterns** — Scans for phrases like "Answer now" or "Time remaining"

### Collaborative Notifications
When you connect to Telegram, you join a shared notification network:

1. You visit an iClicker class page
2. The extension automatically detects your course/activity ID
3. You're registered in that session with other users
4. When ANY user detects a poll, the server broadcasts to ALL users in that session
5. Everyone gets a Telegram notification within seconds

This means even if your detection fails (slow internet, tab in background too long), you'll still get notified if a classmate's extension catches it.

---

## Settings

Click the extension icon to access these settings:

| Setting | Description |
|---------|-------------|
| Desktop notifications | Toggle desktop popup notifications on/off |
| Play sound | Toggle the audio alert on/off |
| Send to Telegram | Enable/disable phone notifications |
| Test notification & sound | Send a test to verify desktop alerts work |
| Send test (Telegram) | Send a test notification to your phone |
| Disconnect | Unlink your Telegram account |
| Scan Page for Poll Elements | Debug tool to see what the extension detects |

---

## Troubleshooting

### Desktop notifications not appearing

1. **Check Chrome's notification permissions**
   - Go to `chrome://settings/content/notifications`
   - Make sure notifications are allowed

2. **Check your system notification settings**
   - On Mac: System Preferences → Notifications → Google Chrome
   - On Windows: Settings → System → Notifications → Google Chrome

3. **Make sure the extension is enabled**
   - Click the extension icon
   - Verify "Desktop notifications" is toggled on

4. **Try the test button**
   - Click "Test notification & sound" in the popup
   - If this works but real polls don't, the detection might need adjustment

### Sound not playing

1. **Check the sound toggle**
   - Click the extension icon
   - Make sure "Play sound" is enabled

2. **Check your system volume**
   - Make sure your computer isn't muted

3. **Chrome autoplay policy**
   - Chrome sometimes blocks audio
   - Try clicking anywhere on the iClicker page first

### Telegram not working

1. **Code expired**
   - Codes expire after 10 minutes
   - Send a new message to the bot to get a fresh code

2. **Wrong code**
   - Make sure you're copying the full 6-digit code
   - Don't include any spaces

3. **Already connected**
   - If you were previously connected, click "Disconnect" first
   - Then reconnect with a new code

4. **Bot not responding**
   - Make sure you're messaging @IclickerNotificationBot
   - Try sending `/start` to the bot

### Extension not detecting polls

1. **Keep the tab open**
   - The extension needs the iClicker tab to be open
   - It can be in the background, but don't close it

2. **Refresh the page**
   - Sometimes a fresh page load helps
   - Press F5 or Cmd+R / Ctrl+R

3. **Check you're on the right page**
   - Make sure you're on `student.iclicker.com` or similar
   - The extension only runs on iClicker domains

4. **Use the debug scanner**
   - Click "Scan Page for Poll Elements" in the popup
   - This shows what the extension sees on the page

---

## Privacy

We take your privacy seriously. Here's exactly what we do and don't collect:

### What We DON'T Collect
- Your iClicker username or password
- Your poll answers or responses
- Your grades or scores
- Your browsing history
- Any personal information

### What We DO Collect (only if you enable Telegram)
- **Telegram Chat ID** — A number that lets us send you messages
- **Course/Activity IDs** — Anonymous identifiers from the iClicker URL so we know which class session you're in

### Where Data Is Stored
- **Locally** — Your settings (sound on/off, etc.) are stored in your browser
- **Server** — If you use Telegram, your chat ID and session info are stored on Cloudflare Workers

### Data Retention
- Session data expires automatically after 6-10 hours
- You can delete your data anytime by clicking "Disconnect"
- Uninstalling the extension removes all local data

See our full [Privacy Policy](PRIVACY.md) for complete details.

---

## For Developers

### Project Structure
```
iclicker-notifier/
├── manifest.json       # Chrome extension manifest (MV3)
├── content.js          # Runs on iClicker pages, detects polls
├── background.js       # Service worker, handles notifications
├── popup.html/js       # Extension popup UI
├── offscreen.html/js   # Audio playback (MV3 requirement)
├── config.js           # Backend URL configuration
├── icons/              # Extension icons
├── sounds/             # Notification audio
└── backend/
    ├── worker.js       # Cloudflare Worker (API + Telegram)
    ├── wrangler.toml   # Cloudflare configuration
    └── SETUP.md        # Backend deployment guide
```

### Tech Stack
- **Extension**: Vanilla JavaScript, Chrome Extension Manifest V3
- **Backend**: Cloudflare Workers + KV storage
- **Notifications**: Telegram Bot API

### Running Locally
1. Clone this repo
2. Go to `chrome://extensions`
3. Enable Developer Mode
4. Click "Load unpacked" and select the repo folder

### Deploying Backend
See [backend/SETUP.md](backend/SETUP.md) for Cloudflare Workers deployment instructions.

---

## Support

Having issues or want to suggest a feature?

- **Telegram**: Message the bot with `/feedback your message`
- **GitHub**: [Open an issue](https://github.com/JeetVaidya1/iclicker-notifier/issues)

---

## Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

---

## License

MIT License — feel free to use, modify, and distribute.

---

Made with ❤️ by students, for students.
