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
- Shows **exact start datetime + expiry datetime + time remaining** (IST, real-time)
- **Membership survives bot restarts** — MongoDB-backed, never lost

```
  ┌─────────────────────────────────────────────┐
  │  VIP PERKS                                  │
  │  ◈ Custom thumbnail on vote post image      │
  │  ◈ Auto vote-deduction on channel leave     │
  │  ◈ 1 extra Force-Join gate per giveaway     │
  │  ◈ Global Force-Join for all users (7D+)    │
  └─────────────────────────────────────────────┘
```

### 📋 &nbsp;/myplan Command
- Any user can check their own VIP status anytime
- Shows plan name, start date, expiry date, time remaining — all in IST
- Visual progress bar showing % of plan used
- Non-VIP users see a prompt to upgrade

```
  ✦━━━━━━━━━━━━━━━━━━━━━✦
     👑  MERA PLAN
  ✦━━━━━━━━━━━━━━━━━━━━━✦

  ✅ VIP Active Hai!
  ⭐ Plan  :  30 Days
  📅 Shuru :  20 Jun 2026 · 01:40 pm IST
  ⏳ Khatam:  20 Jul 2026 · 01:40 pm IST
  ⏱️ Baki  :  29d 22h 15m baki
  ░░░░░░░░░░ 3% used
```

### ⚠️ &nbsp;Auto Expiry Warning
- Bot automatically sends a **1-day-before warning** to every VIP member
- Message shows plan name, exact expiry time (IST), time remaining
- One-tap **Renew Membership** button included
- Warning sent only once (not spammy) — tracked in DB

```
  ✦━━━━━━━━━━━━━━━━━━━━━✦
    ⚠️  MEMBERSHIP EXPIRY
  ✦━━━━━━━━━━━━━━━━━━━━━✦

  🔔 Kal teri VIP membership khatam ho rahi hai!
  ⭐ Plan   ▸  30 Days
  ⏳ Khatam ▸  20 Jul 2026 · 01:40 pm IST
  ⏱️ Baki   ▸  23h 45m baki

  [ 👑 Renew Membership ]
```

### 📩 &nbsp;Support System
- Users can send support messages via `/support`
- Supports **all media types**: Text · Photo · Document · Video · Voice · Audio · Sticker · Video Note
- Admin receives an info card with user name, handle, ID, VIP status, media type
- Media files sent **directly** (not forwarded) with user info in caption
- Admin can mark ticket as ✅ Resolved or ❌ Not Resolved
- Admin can reply directly with `/reply <text>` (reply to forwarded support card)

```
  ✦━━━━━━━━━━━━━━━━━━━━━✦
    📩  SUPPORT REQUEST
  ✦━━━━━━━━━━━━━━━━━━━━━✦

  ◈ Name    ▸  Rahul 👑 VIP
  ◈ Handle  ▸  @rahulxyz
  ◈ User ID ▸  123456789
  ◈ Type    ▸  📄 Document / File

  [ ✅ Resolved ]  [ ❌ Not Resolved ]
```

### 📢 &nbsp;Advanced Broadcast System
- **3 broadcast modes** — Text-only · Reply-copy · Compose (new!)
- **Compose mode** — admin sends any media (photo/doc/video + caption) → picks target
- **4 targets** — Users only · Channels only · Groups only · All
- `/broadcast` = Silent · `/loud` = With sound notification
- Delivery report shows sent ✅ / failed ❌ count + mode used

```
  ◈━━━━━━━━━━━━━━━━━━━━━━◈
    📢  BROADCAST — 🔕 Silent
  ◈━━━━━━━━━━━━━━━━━━━━━━◈

  Mode: 📎 Composed — 📷 Photo
  Caption: Aaj ki update...

  [ 👥 Users ]  [ 📢 Channels ]
  [ 🏘️ Groups ]  [ 🌐 All ]
```

### 🚫 &nbsp;Ban System
- Admin can ban any user with `/ban <userId> [reason]`
- Banned users instantly blocked from all bot interactions
- User receives notification with the ban reason
- Admin can unban with `/unban <userId>`
- Ban list persists across restarts (MongoDB-backed)

### 🗳️ &nbsp;Admin Vote Control
- **`/addvotes <gId> <userId> <count>`** — Manually credit votes to any participant
- **`/removevotes <gId> <userId> <count>`** — Remove votes (cheating correction)
- Works even for users not yet in the giveaway (auto-adds them)
- Instantly saves to MongoDB — no data loss on restart

### 🔧 &nbsp;Maintenance Mode
- `/maintenance on` — Blocks all non-admin users instantly
- Users see a friendly "Bot update mein hai" message
- `/maintenance off` — Re-opens the bot to everyone
- State persists across restarts (MongoDB-backed)

### 📋 &nbsp;Custom Welcome Message
- `/setwelcomemsg` — Set a fully custom welcome text (HTML formatting supported)
- `/clearwelcomemsg` — Restore original default welcome
- Custom text shown instead of default when users run `/start`
- Survives bot restarts (MongoDB-backed)

### 📁 &nbsp;User Export
- `/exportusers` — Downloads a `.txt` file with all bot users
- Shows: User ID · Name · Username · VIP status · Ban status
- Ready for external use, marketing, or audit

### 💰 &nbsp;Payment Stats
- `/paystats` — Dashboard for pending vote payments and membership payments
- Breakdown by giveaway (for vote payments) and by plan (for memberships)
- Also shows: Active VIP count · Banned user count · Maintenance status

### 🔁 &nbsp;Giveaway Clone
- `/clonegiveaway <giveawayId>` — Clone any giveaway with same settings
- New giveaway created in draft (inactive) state — zero participants
- Admin can activate it from My Giveaways menu

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
| `/myplan` | Check your own VIP status, expiry & time remaining |
| `/support` | Send a support message to admin (text, photo, file, video, voice) |

#### Admin Commands — User Management

| Command | Usage | Description |
|---|---|---|
| `/userinfo` | `/userinfo <userId>` | Full user profile — VIP, giveaways, votes, perms, ban status |
| `/listusers` | `/listusers [page]` | Paginated list of all bot users (👑 VIP · 🚫 Banned shown) |
| `/ban` | `/ban <userId> [reason]` | Ban user — blocks bot + notifies user with reason |
| `/unban` | `/unban <userId>` | Remove ban from a user |
| `/dm` | `/dm <userId> <message>` | Send a direct message to any user |
| `/reply` | `/reply <text>` | Reply to a support ticket (reply to forwarded support card) |

#### Admin Commands — Membership

| Command | Usage | Description |
|---|---|---|
| `/givemem` | `/givemem <id> <1d\|7d\|30d>` | Grant VIP membership |
| `/extendmem` | `/extendmem <id> <1d\|7d\|30d>` | Add days to existing VIP |
| `/removemem` | `/removemem <id>` | Revoke VIP immediately |
| `/deductmem` | `/deductmem <id> <days> [silent]` | Deduct days from VIP |
| `/listmem` | `/listmem` | List all active VIP members |
| `/meminfo` | `/meminfo <id>` | Check any user's membership status |
| `/setplan` | `/setplan <1d\|7d\|30d> <price>` | Update plan pricing |

#### Admin Commands — Giveaways

| Command | Usage | Description |
|---|---|---|
| `/allgiveaways` | `/allgiveaways` | List all giveaways (active + past) |
| `/addvotes` | `/addvotes <gId> <userId> <count>` | Manually add votes to any participant |
| `/removevotes` | `/removevotes <gId> <userId> <count>` | Remove votes (cheating fix) |
| `/endgiveaway` | `/endgiveaway <giveawayId>` | Force-close any giveaway + announce winners |
| `/resetvotes` | `/resetvotes <giveawayId>` | Reset all votes in a giveaway to zero |
| `/clonegiveaway` | `/clonegiveaway <giveawayId>` | Clone giveaway with same settings |
| `/setstar` | `/setstar <giveawayId> <votes>` | Votes per Telegram ⭐ Star |
| `/setinr` | `/setinr <giveawayId> <votes>` | Votes per ₹1 INR paid |

#### Admin Commands — Broadcast & Messaging

| Command | Usage | Description |
|---|---|---|
| `/broadcast` | `/broadcast` | Compose photo/doc/video+text, pick target (silent) |
| `/broadcast` | `/broadcast <text>` | Image + styled text broadcast (silent) |
| `/loud` | `/loud` | Same as /broadcast with notification sound |
| `/send` | `/send <chatId> <text>` | Send to specific chat/channel |
| `/pin` | `/pin <chatId> <text>` | Send and pin a message |

#### Admin Commands — Config & Maintenance

| Command | Usage | Description |
|---|---|---|
| `/stats` | `/stats` | Full bot dashboard |
| `/paystats` | `/paystats` | Pending payments + VIP + ban + maintenance status |
| `/maintenance` | `/maintenance on\|off` | Block all non-admin users during updates |
| `/setwelcomemsg` | `/setwelcomemsg` | Set custom welcome message text (HTML supported) |
| `/clearwelcomemsg` | `/clearwelcomemsg` | Restore default welcome message |
| `/exportusers` | `/exportusers` | Download all bot users as .txt file |
| `/setmembershipqr` | `/setmembershipqr` | Upload UPI QR code photo |
| `/setwelcomeimageurl` | `/setwelcomeimageurl` | Set welcome spoiler image URL |
| `/setforcejoin` | `/setforcejoin <channelId>` | Configure force-join channel |
| `/setfreelimit` | `/setfreelimit <n\|unlimited>` | Set free giveaway quota |
| `/perms` | `/perms <userId>` | Toggle user permissions (button UI) |
| `/allchannels` | `/allchannels` | List all registered channels + groups |
| `/cleandb` | `/cleandb` | Clean expired data from MongoDB |
| `/adminhelp` | `/adminhelp` | Full admin command reference |

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
├── 📡  Bot Commands           /start · /membership · /myplan · /support · /stats …
├── 🖱️  Callback Handlers      All inline button actions
├── 💬  Message Handlers       State machine: giveaway wizard · support · payments
└── ⏱️  Schedulers             Auto-end timers · heartbeat · reminders · VIP expiry + warning
```

> **Data flow:** All writes go to both the in-memory Map *(instant)* and MongoDB *(persistent)*.  
> On startup, all data is loaded from MongoDB into memory. VIP expiry + 1-day warning runs every 30 minutes.

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
