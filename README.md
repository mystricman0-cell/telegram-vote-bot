# 🎰 DRS Giveaway Bot — @Drsvotebot

Full-featured Telegram Giveaway & Voting Bot with DRS Branding.
**Fair · Fast · Automated**

## ✨ Full Features

### When Bot is Added to Channel
- Bot automatically registers the channel
- Sends welcome message to the person who added it with channel name

### Giveaway Creation (Full Step-by-Step Flow)
1. **Enter Title** — or /skip for default
2. **Select Target Channel** — shows registered channels or manual entry
3. **Ending Mode** — Automatic (with timer) or Manual
4. **End Date & Time** — DD-MM-YYYY HH:MM format (IST)
5. **Paid Votes** — Enable or Disable
6. **Currency** — INR (UPI/QR), Telegram Stars, or Both
7. **Upload QR Code** — Photo of UPI QR
8. **Set Vote Rate** — How many votes per 1 INR / 1 Star

### Channel Participant Posts
- Each participant gets their own post in the channel
- Post shows: Name, User-ID, Username
- **Vote (n) button** on the post — live vote count updates

### Voting Rules
- Only channel members can vote
- Cannot vote for yourself
- Channel leave = vote automatically removed
- Vote deduction alert sent to participant
- Channel announcement on voter leave

### Management Panel
- Leaderboard
- Stop/Start Paid Votes
- Stop/Open Participation
- End Giveaway (posts final results to channel)
- Clear Channel Posts

### Payment — INR/UPI
- Creator uploads QR code during setup
- User scans QR → pays → sends screenshot
- Admin reviews → approves with vote count → votes added

### Payment — Telegram Stars
- Native Stars invoice via Telegram
- Auto-approved on payment

### Admin Commands (Main Admin Only)
```
/broadcast <message>   — Send to all registered channels
/allchannels           — List all registered channels
/allgiveaways          — All giveaways overview
/adminhelp             — Admin help
```

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

## How It Works

1. Add bot to your channel as **Admin**
2. Bot sends you a welcome message with the channel name
3. Go to bot PM → New Giveaway → follow steps
4. Share participation link — users join channel first, then participate
5. Each participant gets their own vote post in channel
6. Members vote using the button on channel posts
7. If someone leaves, their vote is auto-removed + alert sent

## Notes
- Bot must be **channel admin** (can post messages)
- For `chat_member` events (leave detection): bot needs **"Add New Admins"** permission
- Currently uses **in-memory storage** — add DB for production

## License
MIT — DRS Network