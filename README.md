<div align="center">

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
          ██████╗ ██████╗ ███████╗
          ██╔══██╗██╔══██╗██╔════╝
          ██║  ██║██████╔╝███████╗
          ██║  ██║██╔══██╗╚════██║
          ██████╔╝██║  ██║███████║
          ╚═════╝ ╚═╝  ╚═╝╚══════╝
         GIVEAWAY & VOTE BOT  v3.0
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

[![Telegram](https://img.shields.io/badge/Live%20Bot-@Drsvotebot-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/Drsvotebot)
[![MongoDB](https://img.shields.io/badge/Database-MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](#)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js%2018+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](#)
[![License](https://img.shields.io/badge/License-MIT-gold?style=for-the-badge)](#)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/mystricman0-cell/telegram-vote-bot)
&nbsp;&nbsp;
[![Run on Replit](https://replit.com/badge/github/mystricman0-cell/telegram-vote-bot)](https://replit.com/new/github/mystricman0-cell/telegram-vote-bot)

</div>

---

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
                    OVERVIEW
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

**DRS Giveaway Bot** is a full-featured, production-ready Telegram bot for managing live giveaways, voting contests, and channel growth — built for the DRS Network.

> Real-time leaderboards · Paid voting (INR/UPI + Telegram Stars) · VIP memberships · Force-join gates · Animated UI · MongoDB persistence

---

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
                    FEATURES
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

### 🎁 &nbsp;Giveaway System
- Step-by-step wizard to create giveaways in DMs
- End by **countdown timer** or **manual control**
- **Participation open/close** toggle in real time
- Auto-expiry with scheduled reminders (30min · 10min · 5min before end)
- Free tier — limited giveaways for non-VIP users

### 🗳️ &nbsp;Voting System
- Live vote cards posted directly to your channel
- **Paid votes** — INR/UPI or Telegram Stars
- Auto vote-deduction when a user leaves the channel *(VIP)*
- Only channel members can vote — enforced automatically

### 🏆 &nbsp;Leaderboard & Results
- Live leaderboard viewable anytime during a giveaway
- Full post-giveaway leaderboard — all participants ranked 1st to last
- 🥇 🥈 🥉 Medal display for top 3
- Winner DMs sent automatically on giveaway end
- Results card posted to channel + private card to creator

### 💳 &nbsp;Payment System
- **INR / UPI** — user pays, uploads screenshot, admin approves
- **Telegram Stars** — fully automated payment flow
- Admin approval queue with one-tap approve/reject buttons
- Payment IDs for full audit trail

### 👑 &nbsp;VIP Membership
- **3 Plans** — 1 Day · 7 Days · 30 Days *(prices configurable)*
- Purchase via INR/UPI (QR code) or Telegram Stars
- Admin can grant / revoke / extend via commands
- Shows **exact start datetime + expiry datetime + time remaining** in IST

```
  ┌─────────────────────────────────────────────┐
  │  VIP PERKS                                  │
  │  ◈ Custom thumbnail on vote post image      │
  │  ◈ Auto vote-deduction on channel leave     │
  │  ◈ 1 extra Force-Join gate per giveaway     │
  │  ◈ Global Force-Join for all users (7D+)    │
  └─────────────────────────────────────────────┘
```

### 🔗 &nbsp;Force Join System
- Per-giveaway force join — voters must join a specific channel first
- Global force join — applies to all bot users (VIP 7D+)
- Private channel support via invite links

### 🎨 &nbsp;Animated UI
- Every button click: smooth **delete → animate → appear** flow
- Multiple styles: loading · leaderboard · payment · vote · success · cancel
- Premium `✦━━━` borders and blockquote formatting throughout

---

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
                    DEPLOY
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

### ▸ &nbsp;Railway &nbsp;*(Recommended)*

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/mystricman0-cell/telegram-vote-bot)

```
1. Click Deploy on Railway
2. Set: TELEGRAM_BOT_TOKEN  ·  ADMIN_ID  ·  MONGODB_URI
3. Done — Railway handles hosting automatically
```

### ▸ &nbsp;Replit

[![Run on Replit](https://replit.com/badge/github/mystricman0-cell/telegram-vote-bot)](https://replit.com/new/github/mystricman0-cell/telegram-vote-bot)

```
1. Click Run on Replit
2. Open Secrets tab → add TELEGRAM_BOT_TOKEN  ·  ADMIN_ID  ·  MONGODB_URI
3. Hit Run
```

### ▸ &nbsp;Manual / VPS

```bash
git clone https://github.com/mystricman0-cell/telegram-vote-bot.git
cd telegram-vote-bot
npm install
TELEGRAM_BOT_TOKEN=xxx ADMIN_ID=xxx MONGODB_URI=xxx npm start
```

---

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
               FIRST-TIME SETUP
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

After deploying, send these to your bot in DM:

```
/setmembershipqr       → Upload your UPI QR code image
/setplan 1d 5          → 1-day plan = ₹5
/setplan 7d 30         → 7-day plan = ₹30
/setplan 30d 150       → 30-day plan = ₹150
```

Then add the bot as **Admin** to your Telegram channel — it registers automatically.

---

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
               COMMAND REFERENCE
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

#### User Commands

| Command | Description |
|---|---|
| `/start` | Open main menu |
| `/membership` | View / purchase VIP membership |

#### Admin Commands

| Command | Usage | Description |
|---|---|---|
| `/stats` | `/stats` | Full bot statistics |
| `/broadcast` | `/broadcast` | Mass message — users · channels · groups |
| `/givemem` | `/givemem <id> <1d\|7d\|30d>` | Grant VIP membership |
| `/extendmem` | `/extendmem <id> <1d\|7d\|30d>` | Extend existing VIP |
| `/revokemem` | `/revokemem <id>` | Revoke VIP |
| `/setplan` | `/setplan <plan> <price>` | Update membership pricing |
| `/setmembershipqr` | `/setmembershipqr` | Upload UPI QR code |
| `/setglobal` | `/setglobal <channel_id>` | Set global force-join channel |
| `/removeglobal` | `/removeglobal` | Remove global force-join |
| `/setforcejoin` | `/setforcejoin <channel_id>` | Configure force-join system |
| `/setwelcomeimageurl` | `/setwelcomeimageurl <url>` | Set welcome spoiler image |
| `/cleandb` | `/cleandb` | Clean old giveaway + expired data |
| `/vip30` | `/vip30` | Grant yourself 30-day VIP (admin only) |
| `/listusers` | `/listusers` | List all registered bot users |
| `/listchannels` | `/listchannels` | List registered channels and groups |
| `/listmem` | `/listmem` | List all active VIP members |

---

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
                 ARCHITECTURE
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

```
vote-bot.mjs
│
├── 🗄️  Mongoose Schemas      Giveaway · Channel · Vip · Payment · BotConfig · BotUser
├── ⚡  In-Memory Maps         Fast access: giveaways · vipUsers · channels · payments
├── 🎞️  Animation Functions    animLoading · animFresh · animCreate · animVote
├── 🔧  Core Helpers           safeFormatDateTime · timeRemaining · getMembership
├── 📡  Bot Commands           /start · /membership · /stats · /broadcast · /givemem …
├── 🖱️  Callback Handlers      All inline button actions
├── 💬  Message Handlers       State machine for multi-step flows
└── ⏱️  Schedulers             Auto-end timers · heartbeat · reminders · VIP expiry
```

> **Data flow:** All writes go to both the in-memory Map *(instant)* and MongoDB *(persistent)*.  
> On startup, all data is loaded from MongoDB into memory. VIP expiry is synced every 30 minutes.

---

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
                  TECH STACK
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (ES Modules) |
| Bot Framework | node-telegram-bot-api |
| Database | MongoDB via Mongoose |
| Architecture | Single-file · long-polling |
| Deployment | Railway · Replit · VPS ready |

---

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
                FORK & CUSTOMIZE
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

```bash
# 1. Fork this repo on GitHub
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/telegram-vote-bot.git
cd telegram-vote-bot

# 3. Install dependencies
npm install

# 4. Set your secrets and run
npm start
```

All bot logic lives in a **single file** — `vote-bot.mjs` — making it easy to read and customize.

---

<div align="center">

```
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
         Built with ❤️  for the DRS Network
✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦
```

[![Telegram](https://img.shields.io/badge/Bot-@Drsvotebot-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/Drsvotebot)
[![GitHub](https://img.shields.io/badge/Owner-mystricman0--cell-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/mystricman0-cell)

</div>
