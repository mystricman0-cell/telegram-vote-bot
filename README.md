# 🏆 DRS Giveaway Bot — v3.0

> **A full-featured, production-ready Telegram bot for managing live giveaways, voting contests, and channel growth — built for the DRS Network.**

---

## ✦ Overview

DRS Giveaway Bot is a premium Telegram bot that lets channel owners run **live voting giveaways** with real-time leaderboards, paid voting (INR/UPI + Telegram Stars), force-join gates, VIP memberships, and a beautiful animated UI — all backed by MongoDB for persistent data.

---

## ⚡ Features

### 🎁 Giveaway System
- **Step-by-step wizard** to create giveaways in DMs
- **5-step creation flow** — Title → Channel → End Type → Time → Paid Votes
- End by **countdown timer** or **manual control**
- **Participation open/close** toggle in real time
- **Auto-expiry** with scheduled reminders (30min, 10min, 5min before end)
- **Free tier** — limited giveaways for non-VIP users, configurable by admin

### 🗳️ Voting System
- **Live vote cards** posted directly to your channel
- Real-time leaderboard updates as votes come in
- **Paid votes** — users pay per vote (INR/UPI or Telegram Stars)
- **Auto vote-deduction** when a user leaves the channel (VIP feature)
- Vote card shows participant count, total votes, and ranked positions
- Only channel members can vote (membership enforced)

### 🏆 Leaderboard & Results
- **Live leaderboard** viewable at any time during a giveaway
- **Full post-giveaway leaderboard** — all participants ranked 1st to last
- 🥇🥈🥉 Medal display for top 3, numbered for the rest
- Winner DMs sent automatically to top 3 on giveaway end
- Results card posted to channel with full participant breakdown
- Creator receives a private results card with complete data

### 💳 Payment System
- **INR / UPI payments** — user pays, uploads screenshot, admin approves
- **Telegram Stars** — fully automated payment flow
- Per-vote pricing, configurable by creator
- Admin approval queue with one-tap approve/reject buttons
- Payment IDs for full audit trail

### 👑 VIP Membership
- **3 plans** — 1 Day, 7 Days, 30 Days (prices configurable by admin)
- Purchase via **INR/UPI** (QR code) or **Telegram Stars**
- Admin can manually grant/revoke memberships via commands
- Membership shows **exact start date + expiry date** automatically
- **VIP Features:**
  - Custom thumbnail on vote post image
  - Auto vote-deduction on channel leave 🧿
  - 1 extra Force-Join channel before voting
  - 1 global Force-Join for all bot users *(requires 7-day plan)*

### 🔗 Force Join System
- **Per-giveaway force join** — voters must join a specific channel first
- **Global force join** — applies to all bot users across all giveaways (VIP 7D+)
- Private channel support via invite links
- Automatically enforced and checked before every vote

### 📢 Channel & Group Management
- Register unlimited channels/groups to the bot
- Bot auto-registers when added as admin to a channel
- **Create Post** — send text or photo directly to any registered channel from DMs
- Manage multiple channels from a single bot instance

### 🎨 Animated UI
- Every button click triggers a smooth **delete → animate → appear** flow
- Multiple animation styles: loading, leaderboard, payment, vote, success, cancel
- Premium styled messages with `✦━━━` borders and blockquote formatting
- Consistent DRS Network branding throughout

### 📊 Admin Panel
- `/stats` — full bot statistics (users, giveaways, VIPs, votes)
- `/broadcast` — send message to all users / channels / groups / everyone
- `/givemem` — manually grant VIP to any user
- `/revokemem` — revoke VIP from a user
- `/setplan` — change membership pricing
- `/setmembershipqr` — upload QR code for INR payments
- `/setglobal` — configure global force-join channel
- `/removeglobal` — remove global force-join
- `/cleandb` — remove old ended giveaways (30 days+)
- `/vip30` — grant yourself instant 30-day VIP (admin only)
- `/listusers` — list all registered bot users
- `/listchannels` — list all registered channels and groups

### 💡 Smart Features
- **Heartbeat** — 5-minute keep-alive ping for uptime
- **Auto-reminders** — countdown warnings posted to channel before giveaway ends
- **Welcome image** — configurable spoiler image on bot start (URL-based)
- **Persistent state** — MongoDB + in-memory Map hybrid for speed + durability
- **BOT_USERNAME** auto-detection on startup
- **Anti-409** protection — single polling instance design

---

## 🚀 Setup

### 1. Required Secrets

| Secret | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Your bot token from [@BotFather](https://t.me/BotFather) |
| `ADMIN_ID` | Your numeric Telegram user ID |
| `MONGODB_URI` | MongoDB Atlas connection string |

### 2. Install & Run

```bash
npm install
npm start
```

### 3. First-Time Configuration

```
/setmembershipqr     — Upload your UPI QR code image
/setplan 1d 5        — Set 1-day plan price to ₹5
/setplan 7d 30       — Set 7-day plan price to ₹30
/setplan 30d 150     — Set 30-day plan price to ₹150
```

Then add the bot as **Admin** to your channel — it registers automatically.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (ES Modules) |
| Bot Framework | node-telegram-bot-api |
| Database | MongoDB via Mongoose |
| Architecture | Single-file, long-polling |
| Deployment | Replit / Railway ready |

---

## 📋 Full Command Reference

### User Commands
| Command | Description |
|---|---|
| `/start` | Open main menu |
| `/membership` | View / purchase VIP membership |

### Admin Commands
| Command | Description |
|---|---|
| `/stats` | Bot usage statistics |
| `/broadcast` | Mass message to users / channels / groups |
| `/givemem <id> <1d\|7d\|30d>` | Grant VIP membership to a user |
| `/revokemem <id>` | Revoke VIP membership |
| `/setplan <plan> <price>` | Update membership pricing |
| `/setmembershipqr` | Upload UPI payment QR code |
| `/setglobal <channel_id>` | Set global force-join channel |
| `/removeglobal` | Remove global force-join |
| `/setforcejoin <channel_id>` | Configure force-join system |
| `/setwelcomeimageurl <url>` | Set welcome spoiler image URL |
| `/cleandb` | Remove giveaway data older than 30 days |
| `/vip30` | Grant yourself instant 30-day VIP |
| `/listusers` | List all bot users |
| `/listchannels` | List registered channels and groups |

---

## 🏗️ Architecture

```
vote-bot.mjs
├── Mongoose Schemas      — Giveaway, Channel, Vip, Payment, BotConfig, BotUser
├── In-Memory Maps        — Fast access: giveaways, vipUsers, channels, pendingPayments
├── Animation Functions   — animLoading, animFresh, animCreate, animVote, animLeaderboard
├── Core Helpers          — safeFormatDate, getMembership, formatLeaderboard, parseIST
├── Bot Commands          — /start, /membership, /stats, /broadcast, /givemem, etc.
├── Callback Handlers     — all inline button actions
├── Message Handlers      — state machine for multi-step flows
└── Schedulers            — auto-end timers, heartbeat, reminders
```

**Data flow:** All writes go to both the in-memory Map (instant) and MongoDB (persistent). On startup, all data is loaded from MongoDB into memory.

---

## ✦ DRS NETWORK

> Built with ❤️ for the DRS Network community.
