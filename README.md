# 🎁 DRS Giveaway Bot — @Drsvotebot

Full-featured Telegram Giveaway & Voting Bot built for DRS Network.
**Fair · Fast · Automated · MongoDB Persistent**

---

## ✨ Features Overview

### 🎁 Giveaway System
- Step-by-step giveaway creation wizard (VIP members only)
- Enter title, pick target channel, set end mode, configure paid votes
- **Auto End** — set exact IST date/time, bot ends giveaway and announces winner automatically
- **Manual End** — admin ends it whenever
- Auto-reminders posted to channel at 3h, 1h, and 30m before end
- Each participant gets their own vote-card post in the channel
- Live vote count updates on every vote (caption + button fallback)
- Winner announcement in channel + DM to top 3 + admin notification

### 🗳️ Voting
- Channel members tap the vote button on a participant's post
- Force-join check before voting (must be in required channels)
- Self-vote blocked with alert
- One vote per voter per participant (duplicate vote blocked)
- Vote count shown live on button: `🗳️ Vote · N`
- Vote success popup alert with voter name, new count, and participant name

### 💰 Paid Votes — INR / UPI
- Creator uploads UPI QR code during giveaway setup
- User taps "Pay via QR" → sees QR → pays → sends screenshot
- Admin reviews screenshot in DM → types vote count → approves
- Votes instantly credited on approval

### ⭐ Paid Votes — Telegram Stars
- Native Telegram Stars invoice (auto-approved by Telegram)
- Votes added instantly after payment, no admin action needed
- Admin can set Stars rate per giveaway: `/setstar <gId> <n>`

### 💳 Membership System (VIP)
- 3 Plans: 1 Day / 7 Days / 30 Days
- Purchase via INR (screenshot) or Telegram Stars
- Admin can grant, revoke, extend, or deduct membership days
- Membership required to create giveaways, manage posts, and use force-join per giveaway

### 👑 VIP Permissions
Fine-grained per-user permission control:
| Permission | What it controls |
|---|---|
| `createGiveaway` | Create giveaways |
| `voteFree` | Cast free votes |
| `buyVotes` | Buy votes (INR/Stars) |
| `createPost` | Post to channels |
| `forceJoin` | Set per-giveaway force join |
| `customPhoto` | Upload custom giveaway photo to channel |

### 📢 Force Join (Global)
- Up to 2 mandatory join channels configured by admin (`/setforcejoin`)
- Users must be members before they can vote or participate
- Invite link + label shown when join check fails

### 🔗 Per-Giveaway Force Join (VIP)
- VIP creators can set an extra force-join channel per giveaway
- Active only while creator has valid membership

### 📢 Create Post
- VIP users can post any message type (text, photo, video, document) to their registered channels
- Use `/createpost` or the main menu button

### 📩 Support System
- `/support` — puts user in support mode; any message (text/photo/video/document) forwarded to admin with full user details
- Unrecognized messages (outside any flow) are also forwarded to admin automatically

---

## 👑 Admin Commands

### 💳 Membership Management
```
/givemem <userId> <1d|7d|30d>       — Grant membership
/removemem <userId>                  — Revoke membership
/extendmem <userId> <1d|7d|30d>     — Extend (adds to current expiry)
/deductmem <userId> <days> [silent]  — Deduct days (optional silent)
/listmem                             — All active members with expiry
/meminfo <userId>                    — Full membership info
/setplan <1d|7d|30d> <price>        — Update plan price
```

### 🔐 Permissions
```
/perms <userId>                          — Interactive button toggle UI
/setperms <userId> <perm> <on|off>       — Set single permission
/viewperms <userId>                      — View all permissions
```

### 🎁 Giveaway Controls
```
/allgiveaways              — View all giveaways (active + ended)
/setstar <gId> <n>         — Set votes per 1 ⭐ Star
/setinr <gId> <n>          — Set votes per ₹1 INR
```

### 📢 Broadcast
```
/broadcast [text]    — Silent broadcast — choose: Users / Channels / Groups / All
/loud [text]         — LOUD broadcast (with notification sound)
```
> Tip: Reply to any message + `/broadcast` to forward that exact message.

### 📩 Direct Send & Pin
```
/send <chatId> <message>       — Send to a specific chat
/sendloud <chatId> <message>   — LOUD send to specific chat
/pin <chatId> <message>        — Send & pin in a channel
```

### 🖼️ Images & Config
```
/setwelcomeimageurl    — Set welcome banner image URL (sent with spoiler effect)
/clearwelcomeimage     — Remove welcome banner
/setmembershipqr       — Upload membership payment QR photo
/imageinfo             — Check current image status
```

### 📢 Force Join
```
/setforcejoin 1    — Configure force join channel 1
/setforcejoin 2    — Configure force join channel 2
/forcejoininfo     — View current force join config
```

### 📊 Info & Maintenance
```
/stats          — Full bot dashboard (users, channels, giveaways, votes)
/allchannels    — All registered channels
/topvoters      — Top participants in a giveaway
/cleandb        — Remove ended giveaways (30d+), old payments (7d+), expired VIPs
/adminhelp      — Admin command reference panel
```

---

## 📲 User Commands

| Command | Description |
|---------|-------------|
| `/start` | Open DRS Giveaway Bot |
| `/membership` | View plans and purchase VIP |
| `/myplan` | Check your current membership status |
| `/createpost` | Post to your registered channel |
| `/support` | Contact support (message forwarded to admin) |

---

## 🚀 Setup

### Requirements
- Node.js 18+
- MongoDB Atlas (or any MongoDB URI)
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### Install
```bash
git clone https://github.com/mystricman0-cell/telegram-vote-bot.git
cd telegram-vote-bot
npm install
```

### Environment Variables
Set the following secrets (in Replit Secrets or `.env`):
```
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_ID=your_telegram_user_id
MONGODB_URI=your_mongodb_connection_string
```

### Run
```bash
npm start
```

---

## ⚠️ Important Notes

- Bot must be **channel admin** with permissions: Post, Delete, Edit Messages
- For channel leave detection: bot needs **"Add New Admins"** permission
- Only **one instance** should run at a time — running two simultaneously causes 409 Conflict errors from Telegram
- Telegram Stars payments require billing enabled via [@BotFather](https://t.me/BotFather)
- All data is stored in MongoDB — restarts do not lose data

---

## 🏗️ Architecture

- **Single-file**: `vote-bot.mjs` (ES Modules)
- **Storage**: MongoDB (persistent) + in-memory Maps (fast access)
- **Polling**: Long-polling with auto-retry
- **State machine**: Per-user state via `userState` Map

---

## License
MIT — DRS Network
