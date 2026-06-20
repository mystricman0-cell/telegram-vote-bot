
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

**Telegram bot for managing giveaways and voting contests inside Telegram channels.**
Built with Node.js ES Modules · MongoDB · node-telegram-bot-api

[![Node.js](https://img.shields.io/badge/Node.js-20+-brightgreen)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green)](https://mongodb.com)
[![Telegram](https://img.shields.io/badge/Telegram-Bot_API-blue)](https://core.telegram.org/bots)

</div>

---

## ✦ Overview

DRS Giveaway Bot brings live voting contests and giveaways directly to your Telegram channel. Each participant gets their own vote card posted in the channel, and anyone can vote by tapping a button — the count updates in real-time.

**Key capabilities:**
- 🎁 Multi-step giveaway creation wizard
- 🗳️ Live vote cards per participant in your channel (auto-updated on every vote)
- 💰 Paid votes via INR/UPI screenshot or Telegram Stars
- 🔒 Force-join gates — users must join your channel before voting
- 👑 VIP membership tiers with premium-only features
- 🏆 Leaderboard, auto winner announcement, scheduled end time
- ♻️ Auto vote-deduction when a voter leaves the channel
- 🆓 Free giveaway quota for non-VIP users (configurable by admin)

---

## ✦ Setup

### 1. Environment Secrets

| Secret | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Your bot token from [@BotFather](https://t.me/BotFather) |
| `ADMIN_ID` | Your Telegram user ID (numeric) |
| `MONGODB_URI` | MongoDB Atlas connection string |

### 2. Bot Permissions in Channel

The bot **must be an Administrator** of every channel it posts to, with:
- ✅ Post messages
- ✅ Edit messages
- ✅ Delete messages

### 3. Run

```bash
npm start
```

> ⚠️ **Run only one instance at a time.** Multiple instances cause 409 Conflict errors. Stop any Railway/Heroku/other instances before running here.

---

## ✦ Free Giveaway System

Non-VIP users get **up to 15 free giveaways** by default. After their quota is used, they see a prompt to upgrade to VIP.

### Admin Commands to Control the Quota

| Command | Effect |
|---|---|
| `/setfreelimit 15` | Set the free quota to 15 giveaways per user |
| `/setfreelimit unlimited` | All users can create unlimited giveaways for free |
| `/setfreelimit limited` | Re-enable the quota at the current number |

> These settings are saved to MongoDB and survive restarts.

---

## ✦ User Flow

### Creating a Giveaway
1. User opens bot DM → taps **New Giveaway**
2. Bot checks free quota (non-VIP) or VIP status
3. Wizard collects: Title → Description → Prize → End time → Participant limit
4. Giveaway goes live — users can join via the share link

### Joining & Voting
1. Voter opens the giveaway link (`t.me/YourBot?start=<id>`)
2. Force-join check — user must be in required channels
3. Participant registers, bot posts their vote card to the channel with a **Vote** button
4. Anyone taps **Vote** → count updates instantly on the channel post
5. Voters can switch their vote to a different participant at any time

### Giveaway End
- **Manual** — creator or admin taps "End Giveaway" in management panel
- **Scheduled** — set an end time in the wizard; bot announces winner automatically at that time
- Winner announcement sent to channel with final vote tally

---

## ✦ Membership Plans

| Plan | Default Price | Duration |
|---|---|---|
| 1 Day | ₹10 | 24 hours |
| 7 Days | ₹50 | 1 week |
| 30 Days | ₹350 | 1 month |

Prices can be changed via `/setplan`. Payments accepted via UPI screenshot (admin-approved) or Telegram Stars (instant, no approval needed).

### Feature Comparison

| Feature | Free User | VIP Member |
|---|---|---|
| Create giveaways (up to free limit) | ✅ | ✅ Unlimited |
| Join & vote in giveaways | ✅ | ✅ |
| View leaderboard | ✅ | ✅ |
| Custom vote card thumbnail | ❌ | ✅ |
| Per-giveaway extra force-join channel | ❌ | ✅ |
| Bypass global force-join check | ✅ | ✅ |
| Auto vote-deduction on voter leave | ❌ | ✅ |
| Set global force-join channel for all users | ❌ | ✅ (≥7 days membership) |

---

## ✦ Admin Commands

### Free Giveaway Control
```
/setfreelimit <n|unlimited|limited>   — Set or toggle free giveaway quota
```

### Membership Management
```
/addmem <userId> <days>               — Grant membership
/extendmem <userId> <days>            — Extend existing membership
/revokemem <userId>                   — Revoke membership immediately
/deductmem <userId> <days> [silent]   — Deduct days (add 'silent' to skip DM)
/checkmem <userId>                    — Check user membership status
/setplan <1d|7d|30d> <price>          — Update plan price
```

### Force Join Configuration
```
/setforcejoin <channelId>             — Set slot-1 force-join channel ID
/setforcejoin 2 <channelId>           — Set slot-2 force-join channel ID
```

### Bot Configuration
```
/setwelcomeimageurl                   — Set welcome screen image URL
/setmembershipqr                      — Upload UPI QR code image
/setstar <giveawayId> <price>         — Set Telegram Stars price for paid votes
/setinr <giveawayId> <price>          — Set INR price for paid votes
```

### Users & Channels
```
/users                                — Show all registered bot users
/listchannels                         — List all registered channels
/broadcast <message>                  — Broadcast message to all users
/setperms <userId> <perm> <on|off>    — Toggle per-user feature permission
```

### Giveaway Management
```
/giveaways                            — List all giveaways
/endgiveaway <id>                     — Force-end a giveaway
/deletegiveaway <id>                  — Delete a giveaway from DB
/topvoters <giveawayId>               — Top participants in a giveaway
```

---

## ✦ User Commands

| Command | Description |
|---|---|
| `/start` | Open main menu or join a giveaway via link |
| `/membership` | View membership status and available plans |
| `/topvoters` | Top participants in your active giveaway |
| `/support` | Send a support message to admin |
| `/help` | Full command guide |

---

## ✦ Paid Votes

### INR / UPI Flow
1. Voter taps **Buy Paid Votes** on the giveaway
2. Bot shows the price and UPI QR code
3. Voter sends a payment screenshot to the bot
4. Admin sees the pending payment and taps **Approve**
5. Votes credited instantly to the participant

### Telegram Stars Flow
1. Voter taps the Stars option
2. Telegram's native payment dialog opens
3. On success, votes credited automatically — no admin action needed

---

## ✦ Architecture

```
vote-bot.mjs           Single-file ES Module bot (~4600 lines)
package.json           Dependencies: mongoose, node-telegram-bot-api
Secrets                TELEGRAM_BOT_TOKEN, ADMIN_ID, MONGODB_URI
```

### MongoDB Collections

| Collection | Purpose |
|---|---|
| `giveaways` | All giveaway data (participants, votes, voterMap) |
| `channels` | Registered channels |
| `vipusers` | VIP membership records |
| `pendingpayments` | Pending INR vote payment approvals |
| `pendingmembershippayments` | Pending membership payments |
| `botusers` | All users (for broadcast) |
| `botconfigs` | Key-value config: plans, QR, force-join IDs, free limit |

### In-Memory State

All active data is held in Maps (`giveaways`, `vipUsers`, `registeredChannels`, etc.) and persisted to MongoDB on every write. On restart, state is fully restored from MongoDB automatically.

---

## ✦ Important Notes

1. **One instance only** — Running multiple instances causes Telegram 409 errors. The bot rate-limits this log to once per minute.
2. **Bot must be channel admin** — Without admin rights, vote card posts and edits will silently fail.
3. **Force-join channel IDs** — Private channel invite links require the channel ID to be configured via `/setforcejoin` for membership verification to work.
4. **Vote integrity** — When a voter leaves the channel, their vote is automatically removed and the channel post updated. If they rejoin, they can vote again freely.
5. **Free quota** — Default is 15 giveaways per non-VIP user. Adjust anytime with `/setfreelimit`.

---

<div align="center">

```
✦ ─────────────────── DRS NETWORK ─────────────────── ✦
```

*Built for Telegram channel creators who want a powerful,
self-hosted giveaway and voting system with zero monthly fees.*

</div>
