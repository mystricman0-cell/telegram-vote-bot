# 🎰 DRS Giveaway Bot — @Drsvotebot

Full-featured Telegram Giveaway & Voting Bot with DRS Branding.
**Fair · Fast · Automated**

## ✨ Complete Features

### 📩 Bot Added to Channel
- Bot auto-registers channel when made admin
- Sends welcome DM to person who added it with channel name
- Shows /start, /createpost instructions

### 🎰 Giveaway Creation (Step-by-Step)
1. **Enter Title** — or /skip for default
2. **Select Target Channel** — registered channels or manual entry
3. **Ending Mode** — Automatic (with timer) or Manual
4. **End Date & Time** — DD-MM-YYYY HH:MM format (IST)
5. **Paid Votes** — Enable or Disable
6. **Currency** — INR (UPI/QR), Telegram Stars, or Both
7. **Upload QR Code** — Photo of UPI QR (INR mode)
8. **Set Vote Rate** — Votes per 1 INR / 1 Star

### 📢 Channel Participant Posts
- Each participant gets their own post in the channel
- Post shows: Name, User-ID, Username
- **📦 Vote (n)** button with live vote count update

### 📲 Bot Commands (Visible in "/" menu)
| Command | Description |
|---------|-------------|
| /start | Start Creating professional giveaways |
| /membership | Get access to Premium Features |
| /support | Bot support |
| /createpost | Create post with buttons |

### ✅ Vote Success Popup
When someone votes, channel shows popup alert:
```
☑️ VOTE ADDED SUCCESSFULLY

▶ VOTE FROM : [voter name]
▶ NEW COUNT : [n]
▶ VOTED FOR : [participant name]
▶ BOT : @Drsvotebot
```

### ⚠️ Self-Vote Denied
```
⚠️ OPERATION DENIED

YOU CANNOT VOTE FOR YOURSELF!
```

### ♻️ Channel Leave → Auto-Resync
When voter leaves channel, channel message shows:
```
♻️ Auto-Resync: Vote Removed

👤 User: [name] left the channel.
🏅 Participant: [name]
🗳 Updated Votes: [n]
```

Participant also gets DM: "⚠️ Vote Deduction Alert! New Count: n"

### ⚙️ Management Panel
- 🏆 Leaderboard
- 🔴/🟢 Stop/Start Paid Votes
- 🔴/🟢 Stop/Open Participation
- 🏁 End Giveaway (posts final results to channel)
- 🗑️ Clear Channel Posts

### 💰 Payment — INR/UPI
- Creator uploads QR during giveaway setup
- User: "Pay via QR" → scans QR → pays → sends screenshot
- Admin: Reviews screenshot → types vote count → approves

### ⭐ Payment — Telegram Stars
- Native Telegram Stars invoice
- Auto-approved on payment, votes added instantly

### 👑 VIP Membership
- 50 Stars for 30 days
- Unlimited giveaways, priority support

---

## 👑 Admin Commands (Main Admin Only)

### 📢 Broadcast
```
/broadcast <message>    — Silent broadcast to all channels
/loud <message>         — LOUD broadcast (with sound) to all channels
```

### 📩 Direct Send
```
/send <chatId> <message>       — Send to specific chat
/sendloud <chatId> <message>   — LOUD send to specific chat
```

### 📌 Pin
```
/pin <chatId> <message>    — Send & pin message in channel
```

### 📊 Info
```
/allchannels    — All registered channels list
/allgiveaways   — All giveaways overview
/adminhelp      — Admin help menu
```

---

## 🚀 Setup

```bash
git clone https://github.com/mystricman0-cell/telegram-vote-bot.git
cd telegram-vote-bot
npm install node-telegram-bot-api
```

```.env
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_ID=your_telegram_user_id
```

```bash
node vote-bot.mjs
```

## ⚠️ Important Notes
- Bot must be **channel admin** (can post & delete messages)
- For leave detection (chat_member events): bot needs **"Add New Admins"** permission in channel
- Currently uses **in-memory storage** — restart = data reset (add DB for production)
- Stars payments require bot to have @BotFather billing enabled

## License
MIT — DRS Network