# 🎰 Telegram Giveaway Vote Bot

VTH-style Telegram Giveaway & Voting Bot — Inline buttons, Paid voting with Telegram Stars, Channel/Group support.

## Features
- 🎰 Giveaway Creation — Multi-step inline keyboard UI
- 💰 Paid Voting — Telegram Stars per vote
- 👑 VIP Membership — Stars-based subscription (50 Stars / 30 days)
- 📢 Channel/Group Integration — Member-only voting
- ⚠️ Auto Vote Removal — Channel leave par vote hata + announcement
- 📊 Live Leaderboard — Har vote ke baad update
- 📢 Create Post — Sab channels ko ek saath post

## Setup

```bash
git clone https://github.com/mystricman0-cell/telegram-vote-bot.git
cd telegram-vote-bot
npm install
```

```.env
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_ID=your_telegram_user_id
```

```bash
node vote-bot.mjs
```

## Bot Buttons

| Button | Function |
|--------|----------|
| 🎰 New Giveaway | Naya giveaway banao |
| 📋 My Giveaways | Apne giveaways dekho |
| ❓ How to Use | Guide |
| ➕ Add Channel | Channel register karo |
| ➕ Add Group | Group register karo |
| 👑 VIP Membership | Stars se VIP lo |
| 📢 Create Post | Sab channels pe post |

## Admin Commands
- /broadcast — Sab chats ko message
- /allchannels — Registered channels list
- /allgiveaways — Sab giveaways
- /adminhelp — Admin help

## Note
- Bot ko channel/group ka admin banana zaroori hai
- In-memory storage — production mein DB add karo

## License
MIT