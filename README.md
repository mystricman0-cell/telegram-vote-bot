# 🗳️ Telegram Vote Bot

Telegram channel ke liye powerful voting bot.

## Features
- Channel membership check — bina join kiye vote nahi
- Auto vote removal — channel chhodne par vote hat jaata hai + announcement
- Single main admin — sirf aap broadcast aur admin commands use kar sakte hain
- Live leaderboard — har vote ke baad update
- Participant bulk add via forwarded message

## Setup
```bash
git clone https://github.com/mystricman0-cell/telegram-vote-bot.git
cd telegram-vote-bot
npm install
```

## Environment Variables
```env
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_ID=your_telegram_user_id
```

## Run
```bash
node vote-bot.mjs
```

## Commands

### Channel Setup (Channel Admin)
- `/setvoting <channelId>` — Channel register karo
- `/addparticipant <channelId> <naam>` — Participant add karo
- `/removeparticipant <channelId> <naam>` — Participant hatao
- `/startpoll <channelId>` — Voting shuru karo
- `/stoppoll <channelId>` — Voting band karo
- `/resetpoll <channelId>` — Sab reset karo
- `/results <channelId>` — Results dekho

### Voting (Channel Members — PM mein)
- `/vote <channelId> <naam>` — Vote do

### Main Admin Only
- `/broadcast <message>` — Sab channels ko message
- `/allchannels` — Sab channels ki list
- `/adminhelp` — Admin help

## Participant Bulk Add
Bot ko PM mein bhejo:
```
VOTE: -1001234567890
Rahul Kumar
Priya Sharma
Amit Singh
```

## Channel ID Kaise Milega?
Channel mein @getidsbot add karo ya koi message forward karke @userinfobot pe bhejo.

## Note
- Bot ko channel ka admin banana zaroori hai
- Abhi in-memory storage hai, production mein database add karo

## License
MIT