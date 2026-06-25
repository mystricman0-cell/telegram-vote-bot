<div align="center">

```
╔══════════════════════════════════════════════════════╗
║                                                      ║
║    ██████╗ ██████╗ ███████╗                          ║
║    ██╔══██╗██╔══██╗██╔════╝                          ║
║    ██║  ██║██████╔╝███████╗                          ║
║    ██║  ██║██╔══██╗╚════██║                          ║
║    ██████╔╝██║  ██║███████║                          ║
║    ╚═════╝ ╚═╝  ╚═╝╚══════╝                          ║
║                                                      ║
║    ✦  N  E  T  W  O  R  K  ✦                        ║
║    ─────────────────────────                         ║
║    🎁  GIVEAWAY & VOTE BOT  v3.0.6  🏆               ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
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

### 🗳️ &nbsp;Vote via Share Link *(NEW in v3.0.6)*
- Participants get a **dedicated vote link**: `https://t.me/bot?start=v_gId_userId`
- Anyone who clicks it → **must join the channel first**, then votes for that participant
- **Two separate links** shown in "Your Links" panel:
  - 🗳️ **Vote Link** — share to collect votes
  - 📋 **Join Link** — for new participants to register in the giveaway
- **Channel join enforced before voting** — "Join Channel → Verify → Vote" flow:
  1. Voter clicks vote link
  2. If not in channel → shown join button + "I Joined — Cast Vote" verify button
  3. Bot re-checks membership on verify tap
  4. Only after confirmed join → vote is registered
- Self-vote blocked with clear error message
- Vote toggle & switch supported (click again = remove vote, click another = switch)
- Channel vote card updates live after every vote
- All vote logic identical to channel button votes (velocity alerts, admin notify, etc.)

### 🗑️ &nbsp;Clear Channel Posts *(NEW in v3.0.5)*
- **Deletes ALL bot messages** from the giveaway channel in one tap
- Covers: giveaway announcement, every participant vote card, winner post
- **Confirmation step** before deleting — shows exact count of messages to be deleted
- Tracks announcement + winner message IDs automatically from creation
- Shows result: how many deleted, how many failed (already removed / not found)
- 50ms delay between deletes — respects Telegram rate limits
- Available via "🗑️ CLEAR CHANNEL POSTS" button in giveaway management

### 📡 &nbsp;Log Destination Control *(NEW in v3.0.5)*
- Route **all user logs, support messages, feedback & payment notifications** to any destination
- Supports **private user ID** or **any channel** (public or private)
- Bot tests access before saving — fails safely with an error if bot is not admin in the channel
- **`/setlogdest <user_id>`** — redirect logs to another user
- **`/setlogdest <channel_id>`** — redirect logs to a channel (bot must be admin)
- **`/setlogdest reset`** — restore logs back to your own admin ID
- Setting persists across restarts via MongoDB

### 🎁 &nbsp;Giveaway System
- Step-by-step wizard to create giveaways in DMs
- End by **countdown timer** or **manual control**
- **Participation open/close** toggle in real time
- Auto-expiry with scheduled reminders (30min · 10min · 5min before end)
- Free tier — limited giveaways for non-VIP users
- Wizard asks Stars paid voting option even when INR-only is selected

### 🗳️ &nbsp;Voting System
- Live vote cards posted directly to your channel
- **Paid votes** — INR/UPI or Telegram Stars
- Auto vote-deduction when a user leaves the channel *(VIP)*
- Only channel members can vote — enforced automatically

### 🚨 &nbsp;Anti-Panel / Anti-Cheat System *(NEW)*
- **Automatic vote panel detection** — if 15+ votes arrive within 90 seconds for one participant, giveaway owner + admin are instantly alerted
- One-tap action buttons sent to owner/admin:
  - **➖ Votes Minus** — deduct any number of votes
  - **🗑️ Remove Participant** — remove from giveaway + notify user
  - **🚫 Ban + Remove** — ban user from bot + remove from giveaway
  - **⚠️ Warn** — send a warning DM to the participant
  - **✅ Dismiss** — ignore alert (legitimate votes)
- Detection window resets after 90 seconds (catches repeated panel bursts)

### 📡 &nbsp;Auto Leaderboard Broadcast *(NEW — v3.0.7)*
- **Auto-post live top-10 leaderboard** to the giveaway channel every X hours
- `/setlbbroadcast <gId> <hours>` — start auto-broadcast (0.5h to 24h interval)
- Sends one leaderboard card **immediately** on activation, then every X hours
- **Stops automatically** when giveaway ends — no cleanup needed
- `/stoplbbroadcast <gId>` — manually stop at any time
- `/listlbbroadcast` — see all active broadcasts with next post time (IST)
- Each card shows: giveaway title · participant count · top 10 ranked with medals · live timestamp

```
  ✦━━━━━━━━━━━━━━━━━━━━━✦
    🏆  LIVE LEADERBOARD
  ✦━━━━━━━━━━━━━━━━━━━━━✦

  📌 Summer Giveaway 2026
  👥 Participants: 48

  🥇 Rahul (@rahulxyz) — 312 votes
  🥈 Priya — 278 votes
  🥉 Amit (@amitdrs) — 201 votes
  4.  Sneha — 145 votes
  ...

  🕐 Updated: 25 Jun 2026 · 08:30 pm IST
```

### 🏆 &nbsp;Leaderboard & Results
- Live leaderboard viewable anytime during a giveaway
- Full post-giveaway leaderboard — all participants ranked 1st to last
- 🥇 🥈 🥉 Medal display for top 3
- Winner DMs sent automatically on giveaway end
- Results card posted to channel + private card to creator

### 💳 &nbsp;Payment System
- **INR / UPI** — user pays, uploads screenshot, giveaway owner OR admin approves
- **Telegram Stars** — fully automated payment flow
- Giveaway owner receives payment screenshot directly (not just admin)
- Approval/rejection available to giveaway owner and admin
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

### 📊 &nbsp;Giveaway Report
- `/giveawayreport <giveawayId>` — Downloads a `.txt` file with full giveaway data
- Includes: title, status, winner count, total votes, payment summary
- Full ranked leaderboard (all participants by vote count)
- Winner list if giveaway has ended
- Generated in IST timestamp

### 📢 &nbsp;Participant Announcement
- `/announce <gId> <text>` — Send a custom message to all participants of a specific giveaway
- Shows preview + confirmation step before sending
- Delivery report sent to admin (sent/failed counts)

### ⚙️ &nbsp;Change Winner Count
- `/setwinner <gId> <count>` — Update winner count of any giveaway (active or ended)
- Range: 1 to 100 winners
- Saves to MongoDB immediately

### 🌍 &nbsp;Global Vote Leaderboard
- `/voteleaderboard` — Top 20 voters across **all** giveaways combined
- Shows rank, name, username, user ID, total votes

### 🔔 &nbsp;Vote Reminder
- `/remindvote <gId>` — Send a push reminder to all participants of an active giveaway
- Includes the current top 3 leaderboard for motivation
- Delivery report sent to admin

### 🔁 &nbsp;Giveaway Clone
- `/clonegiveaway <giveawayId>` — Clone any giveaway with same settings
- New giveaway created in draft (inactive) state — zero participants
- Admin can activate it from My Giveaways menu

### ⏰ &nbsp;Scheduled Broadcasts
- `/schedule 22:00 Aaj ki update` — Auto-sends message to all users at the given IST time
- Time is in **24h IST format** (HH:MM)
- If the time has already passed today, message sends **tomorrow** at that time
- Each schedule gets a unique ID (e.g. `SC001`) for easy tracking/cancellation
- `/schedulelist` — View all pending scheduled broadcasts with ID + time + preview
- `/cancelschedule <ID>` — Cancel any pending schedule by its ID
- Admin gets a **delivery report** (sent/failed counts) after the message fires
- Multiple schedules can be queued at the same time

### 🔗 &nbsp;Force Join System
- Per-giveaway force join — voters must join a specific channel first
- Global force join — applies to all bot users (VIP 7D+)
- Private channel support via invite links

### 🛡️ &nbsp;Auto Security Defaults *(NEW — v3.0.2)*
- **561 honeypot traps** pre-loaded on first startup — covers hacking, exploits, userbots, scams, adult, gambling, carding, tools and more
- **177 blocked words** — Hindi (Devanagari), Hinglish transliterated, and English abuses all blocked automatically
- Traps and words are seeded to MongoDB once and **treated like manually added ones** — `/removetrap` permanently removes them
- `/listtraps` shows all 561 active traps
- `/blockedwords` shows all 177 blocked words
- Any user who triggers a honeypot trap → **instant admin alert + automatic warning**
- Any user who types a blocked word → **warning logged + message blocked**

### 🎨 &nbsp;Animated UI
- Every button click: smooth **delete → animate → appear** flow
- Multiple styles: loading · leaderboard · payment · vote · success · cancel
- Premium `✦━━━` borders and blockquote formatting throughout

### 🎨 &nbsp;UI Text Customizer *(NEW — v3.0.1 · expanded v3.0.2)*
- **65+ customizable keys** — every visible text, emoji, button & link in the bot
- `/customize` — Paginated interactive menu (tap any key to edit it)
- `/settext <key> <value>` — Set any text directly, HTML supported
- `/resettext <key>` — Restore default instantly
- `/listtext` — See all keys with current values at a glance
- All changes saved to MongoDB — **survive restarts**

**Welcome Screen Keys** *(every element you see on /start)*

| Key | What it controls |
|-----|-----------------|
| `welcome.title` | Big bold title — "𝐃𝐑𝐒 𝐆𝐈𝐕𝐄𝐀𝐖𝐀𝐘 𝐁𝐎𝐓! 🎁" |
| `welcome.feature1` | Blockquote line 1 — "✨ FULLY AUTOMATED…" |
| `welcome.feature2` | Blockquote line 2 — "⚡ FAST & TRANSPARENT…" |
| `welcome.feature3` | Blockquote line 3 — "🛡 SECURE, RELIABLE…" |
| `welcome.feature4` | Blockquote line 4 — "🎊 HOST GIVEAWAYS…" |
| `welcome.tip1` | Instruction line 1 — "🔺 TAP 🎁 NEW GIVEAWAY…" |
| `welcome.tip2` | Instruction line 2 — "🔺 TAP 📂 MY GIVEAWAYS…" |
| `welcome.divider` | Divider text — "✈️━━━━━ 𝐃𝐑𝐒 ━━━━━✈️" |
| `welcome.divider_url` | Divider hyperlink URL |
| `welcome.powered_name` | Powered-by name inside link |
| `welcome.powered_url` | Powered-by URL |
| `welcome.support_name` | Support person name inside link |
| `welcome.support_url` | Support person URL |
| `welcome.btn_new_giveaway` | "🎁 NEW GIVEAWAY ✦" button |
| `welcome.btn_my_giveaways` | "✦ MY GIVEAWAYS 📂" button |
| `welcome.btn_add_channel` | "📢 ADD CHANNEL ⚡" button |
| `welcome.btn_add_group` | "⚡ ADD GROUP 👥" button |
| `welcome.btn_vip` | "👑 VIP MEMBERSHIP 💎" button |
| `welcome.btn_create_post` | "🚀 CREATE POST ✍️" button |
| `welcome.btn_guide` | "🌟 ─── GUIDE & HELP ─── 🌟" button |

```
  /settext welcome.title 🎉 MY BOT NAME 🎉
  /settext welcome.feature1 ✨ Custom feature line 1
  /settext welcome.powered_name MY NETWORK
  /settext welcome.powered_url https://t.me/mychannel
  /settext welcome.btn_new_giveaway 🎁 Start Giveaway
  /settext welcome.btn_guide ✦ Help & Support ✦
  /settext giveaway.btn_vote 🔥 Vote Karo!
  /settext pay.btn_inr 💰 UPI se Pay Karo
  /resettext welcome.title
```

### 🏥 &nbsp;Health Monitor *(NEW — v3.0.1)*
- `/health` — Real-time bot diagnostics in one command
- Shows: uptime · MongoDB status · active giveaways · users · VIP · memory · security mode · pending payments · scheduled broadcasts

### 🚀 &nbsp;GitHub Push from Telegram *(NEW — v3.0.1)*
- `/pushgithub [commit message]` — Push `vote-bot.mjs` to your GitHub repo directly from Telegram
- Requires `GITHUB_TOKEN` + `GITHUB_REPO_URL` set as environment variables
- All commits made as author **drs**

### 👑 &nbsp;Sub-Admin Management *(NEW — v3.0.2)*
- Add trusted sub-admins with specific permission sets — no need to share main admin access
- `/addadmin <userId> <perms>` — Grant sub-admin with selected permissions
- `/removeadmin <userId>` — Revoke sub-admin access instantly
- `/listadmins` — View all sub-admins and their permission sets
- `/editadminperms <userId>` — Edit permissions via interactive button UI
- **Available permissions:** `all` · `approve_payments` · `broadcast` · `ban_users` · `manage_giveaways`

### 🔄 &nbsp;Security Reset *(NEW — v3.0.2)*
- `/resetsecurity` — Full security state reset with one command
- Clears: bans · warnings · mutes · shadow bans · flags · honeypot hit history · audit log
- **Keeps safe:** honeypot traps · blocked words · security mode · max warnings setting · trusted users

### 👁️ &nbsp;Welcome Preview *(NEW — v3.0.2)*
- `/previewwelcome` — See exactly how your welcome screen looks right now (image + buttons)
- `/setwelcomemsg` — Set welcome text — **jo bhejo waisa hi dikhe** (exact text, emojis, symbols preserved)
- After setting, `/previewwelcome` instantly shows you the result

### 📊 &nbsp;Memory Stats Live Monitor *(NEW — v3.0.4)*
- `/memstats` — Real-time RAM breakdown in one command
  - Node.js heap used / total / RSS / external (in MB)
  - Count of every in-memory Map: giveaways (active vs ended), users, VIP, channels, payments, custom texts, sub-admins, warnings, muted, shadow-banned, honeypot hits, scheduled messages
  - Quick tip linking to `/autoclean` if memory is high

### 🧹 &nbsp;Auto Memory & DB Cleanup *(NEW — v3.0.4)*

**Memory Management (automatic — every 30 min):**
- Ended giveaways older than 7 days are automatically evicted from RAM
- They stay in MongoDB — history preserved, memory freed
- Prevents RAM from filling up on long-running bots

**MongoDB Auto-Cleanup (automatic — every 24 hours):**
- SecurityLog trimmed to last 500 entries (old logs deleted)
- Resolved pending payments older than 30 days deleted
- Ended giveaways older than 60 days compressed — participant/vote data wiped, metadata kept
- **👥 User data (BotUser, VIP), active giveaways — NEVER touched**

**`/autoclean` — Manual Trigger:**
```
/autoclean
→ Runs memory eviction + full DB cleanup instantly
→ Shows exactly what was freed: RAM, logs, payments, giveaways compressed
```

> Also runs automatically once 3 minutes after every bot restart.

### 🔄 &nbsp;ResetUI — Full UI Reset with Confirmation *(NEW — v3.0.3)*
- `/resetui` — Resets **all** custom UI texts back to default in one tap
- Shows a **confirmation step** before doing anything — accidental reset impossible
- Tells you exactly how many custom texts will be deleted before you confirm
- After reset, bot shows restore tip: `/cloneui import <json>` to bring settings back
- **Tip:** Always run `/cloneui export` first to save a backup before resetting

### 📦 &nbsp;CloneUI — Settings Backup & Transfer *(NEW — v3.0.3)*
- `/cloneui export` — Export **all** UI customizations as a single JSON snapshot
  - Includes: all custom texts/emojis/buttons · welcome message · welcome image URL · membership plans & pricing · free giveaway limits
  - Large exports (>3800 chars) are sent as a downloadable `.json` file automatically
- `/cloneui import <json>` — Paste the exported JSON to instantly restore all settings
  - Safe: only known UI keys are applied; unknown keys are silently skipped
  - Live confirmation showing how many texts were applied + what was restored
- **Use cases:** backup before a big change · transfer settings to a new bot instance · share your theme with someone else

```
  /cloneui export
  → Bot sends full JSON snapshot of all settings

  /cloneui import {"version":1,"ui":{...},"membershipPlans":{...},...}
  → All settings restored in one shot ✅
```

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
| `/start` | Open main menu — ding-dong animation + spoiler image |
| `/help` | Full user guide & all commands |
| `/membership` | View / purchase VIP membership |
| `/myplan` | Check your own VIP status, expiry & time remaining |
| `/leaderboard` | Live leaderboard of your active giveaway |
| `/mystats` | Your personal giveaway stats (total giveaways, participants, votes) |
| `/active` | List all live giveaways with participants, votes & time remaining |
| `/winners` | View winners of the last (or specified) ended giveaway |
| `/glink` | Get participation link for the active (or specified) giveaway |
| `/botstatus` | Quick bot health & stats (users, giveaways, channels, pending) |
| `/ping` | Check bot response time in ms |
| `/myid` | Show your Telegram user ID, username & language |
| `/createpost` | Create and send a post to your registered channel |
| `/topvoters` | View top participants in your active giveaway |
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
| `/setwinner` | `/setwinner <gId> <count>` | Change winner count of any giveaway (1–100) |
| `/endgiveaway` | `/endgiveaway <giveawayId>` | Force-close any giveaway + announce winners |
| `/cancelgiveaway` | `/cancelgiveaway <giveawayId>` | Cancel giveaway silently — no winners announced |
| `/resetvotes` | `/resetvotes <giveawayId>` | Reset all votes in a giveaway to zero |
| `/clonegiveaway` | `/clonegiveaway <giveawayId>` | Clone giveaway with same settings |
| `/giveawayreport` | `/giveawayreport <gId>` | Download full giveaway report as .txt file |
| `/announce` | `/announce <gId> <text>` | Send custom message to all giveaway participants |
| `/remindvote` | `/remindvote <gId>` | Send vote reminder + top 3 to all participants |
| `/voteleaderboard` | `/voteleaderboard` | Global top 20 voters across all giveaways |
| `/setstar` | `/setstar <giveawayId> <votes>` | Votes per Telegram ⭐ Star |
| `/setinr` | `/setinr <giveawayId> <votes>` | Votes per ₹1 INR paid |

#### Admin Commands — Broadcast & Messaging

| Command | Usage | Description |
|---|---|---|
| `/broadcast` | `/broadcast` | Compose photo/doc/video+text, pick target (silent) |
| `/broadcast` | `/broadcast <text>` | Image + styled text broadcast (silent) |
| `/loud` | `/loud` | Same as /broadcast with notification sound |
| `/schedule` | `/schedule <HH:MM> <text>` | Schedule a broadcast for a specific IST time |
| `/schedulelist` | `/schedulelist` | View all pending scheduled broadcasts |
| `/cancelschedule` | `/cancelschedule <ID>` | Cancel a pending scheduled broadcast |
| `/send` | `/send <chatId> <text>` | Send to specific chat/channel |
| `/pin` | `/pin <chatId> <text>` | Send and pin a message |

#### Admin Commands — Config & Maintenance

| Command | Usage | Description |
|---|---|---|
| `/stats` | `/stats` | Full bot dashboard |
| `/paystats` | `/paystats` | Pending payments (with payIds) + VIP + ban + maintenance status |
| `/removepay` | `/removepay <payId>` | Remove any pending payment (vote or membership) by ID — notifies user |
| `/clearallpending` | `/clearallpending` | Clear ALL pending payments at once (vote + membership) — notifies all users |
| `/setstartimage` | `/setstartimage <url>` | Set start/welcome image in one line — no wizard needed |
| `/clearstates` | `/clearstates` | Clear all stuck user conversation states |
| `/gcount` | `/gcount` | Quick giveaway count breakdown — active, ended, totals, participants, votes |
| `/topusers` | `/topusers` | Top 10 users ranked by number of giveaways created |
| `/maintenance` | `/maintenance on\|off` | Block all non-admin users during updates |
| `/health` | `/health` | Real-time bot diagnostics — uptime, DB, memory, giveaways, VIP, security, payments |
| `/previewwelcome` | `/previewwelcome` | Preview the current welcome screen exactly as users see it (image + buttons) |
| `/setwelcomemsg` | `/setwelcomemsg` | Set custom welcome message — jo bhejo waisa hi dikhe (exact text preserved) |
| `/clearwelcomemsg` | `/clearwelcomemsg` | Restore default welcome message |
| `/exportusers` | `/exportusers` | Download all bot users as .txt file |
| `/setmembershipqr` | `/setmembershipqr` | Upload UPI QR code photo |
| `/setwelcomeimageurl` | `/setwelcomeimageurl` | Set welcome spoiler image URL |
| `/setforcejoin` | `/setforcejoin <channelId>` | Configure force-join channel |
| `/setfreelimit` | `/setfreelimit <n\|unlimited>` | Set free giveaway quota |
| `/perms` | `/perms <userId>` | Toggle user permissions (button UI) |
| `/allchannels` | `/allchannels` | List all registered channels + groups |
| `/cleandb` | `/cleandb` | Interactive selective cleanup — choose giveaways/payments/memberships/VIP/seclogs |
| `/adminhelp` | `/adminhelp` | Full admin command reference (4 parts including security) |
| `/pushgithub` | `/pushgithub [message]` | Push vote-bot.mjs to GitHub directly from Telegram |
| `/setownerid` | `/setownerid <userId>` | Transfer bot ownership to a new admin ID — saved to DB, persists across restarts |

#### Admin Commands — UI Customizer

| Command | Usage | Description |
|---|---|---|
| `/customize` | `/customize` | Paginated interactive UI text customizer — tap any key to edit |
| `/settext` | `/settext <key> <value>` | Set any UI text, emoji, or button label directly |
| `/resettext` | `/resettext <key>` | Reset one UI text to its default value |
| `/listtext` | `/listtext` | List all UI text keys with current values |
| `/preview` | `/preview <key>` | Preview exactly how any UI key looks with premium emojis |
| `/cloneui` | `/cloneui export` · `/cloneui import <json>` | Export all UI settings as JSON backup · Import to restore or transfer to another bot |
| `/resetui` | `/resetui` | Reset ALL custom UI texts to default in one tap (confirmation step included) |
| `/autoclean` | `/autoclean` | Manually trigger RAM eviction + MongoDB cleanup — shows exact bytes freed |
| `/memstats` | `/memstats` | Live RAM breakdown — heap used/total/RSS + size of every in-memory Map |

#### Admin Commands — Sub-Admin Management

| Command | Usage | Description |
|---|---|---|
| `/addadmin` | `/addadmin <userId> <perms>` | Add sub-admin with permissions — `all` or `approve_payments,broadcast,ban_users,manage_giveaways` |
| `/removeadmin` | `/removeadmin <userId>` | Remove sub-admin access |
| `/listadmins` | `/listadmins` | List all sub-admins and their permission sets |
| `/editadminperms` | `/editadminperms <userId>` | Edit sub-admin permissions via interactive button UI |

#### Security & Protection Commands *(NEW — v3.0)*

| Command | Usage | Description |
|---|---|---|
| `/securityhelp` | `/securityhelp` | Full 40-command security reference (600+ words, 3 parts) |
| `/honeypot` | `/honeypot on\|off` | Enable/disable honeypot trap system |
| `/honeytrap` | `/honeytrap <cmd>` | Add a fake command as honeypot trap |
| `/removetrap` | `/removetrap <cmd>` | Remove a honeypot trap |
| `/listtraps` | `/listtraps` | List all active honeypot traps |
| `/honeypotlist` | `/honeypotlist` | Users who triggered traps + timestamps |
| `/cleanhoneypot` | `/cleanhoneypot` | Clear honeypot triggered-users list |
| `/warnuser` | `/warnuser <id> [reason]` | Manually warn a user |
| `/warnings` | `/warnings <id>` | Check user's warning count + reasons |
| `/clearwarnings` | `/clearwarnings <id>` | Clear all warnings for a user |
| `/setmaxwarns` | `/setmaxwarns <n>` | Set auto-ban threshold (1–20, default 3) |
| `/autoban` | `/autoban on\|off` | Toggle auto-ban when max warnings reached |
| `/muteuser` | `/muteuser <id>` | Mute a user (bot ignores their messages) |
| `/unmuteuser` | `/unmuteuser <id>` | Unmute a user |
| `/mutedlist` | `/mutedlist` | List all muted users |
| `/shadowban` | `/shadowban <id>` | Ghost ban — user gets no response, doesn't know they're banned |
| `/unshadowban` | `/unshadowban <id>` | Remove shadow ban |
| `/shadowlist` | `/shadowlist` | List all shadow-banned users |
| `/trustuser` | `/trustuser <id>` | Whitelist user (bypasses rate limit + honeypot) |
| `/untrustuser` | `/untrustuser <id>` | Remove from trusted list |
| `/trustedlist` | `/trustedlist` | View all trusted users |
| `/flaguser` | `/flaguser <id> [reason]` | Flag suspicious user for monitoring |
| `/unflaguser` | `/unflaguser <id>` | Remove flag |
| `/flaggedlist` | `/flaggedlist` | List all flagged users |
| `/securitymode` | `/securitymode strict\|normal\|off` | Set rate-limit mode |
| `/antispam` | `/antispam on\|off` | Toggle flood/spam protection |
| `/emergencylock` | `/emergencylock` | Block ALL non-admin users instantly |
| `/emergencyunlock` | `/emergencyunlock` | Restore normal access |
| `/securitystats` | `/securitystats` | Full security dashboard |
| `/suspicious` | `/suspicious` | Last 20 security log events |
| `/auditlog` | `/auditlog` | Last 30 detailed audit log entries |
| `/clearaudit` | `/clearaudit` | Clear security + audit log |
| `/resetsecurity` | `/resetsecurity` | Reset ALL security state (bans, warnings, mutes, shadow bans, flags, honeypot hits) — keeps traps & config |
| `/userhistory` | `/userhistory <id>` | Last 30 commands sent by a user |
| `/blockword` | `/blockword <word>` | Block a word/phrase from all messages |
| `/unblockword` | `/unblockword <word>` | Unblock a word/phrase |
| `/blockedwords` | `/blockedwords` | List all blocked words/phrases |
| `/ratelimitreset` | `/ratelimitreset <id>` | Reset user's rate limit counter |
| `/securityreport` | `/securityreport` | Download full security report as .txt — includes summary, banned/muted/shadow/flagged/warned/trusted users, honeypot hits, blocked words, and last 100 security log events |

#### New User Commands *(NEW — v3.0)*

| Command | Description |
|---|---|
| `/about` | About this bot (DRS Network info, features, version) |
| `/version` | Bot version, uptime, runtime info |
| `/uptime` | Bot uptime in days/hours/minutes/seconds |
| `/rules` | Bot usage rules (7 rules — fair play, no spam, payments, etc.) |
| `/faq` | 7 frequently asked questions with answers |
| `/terms` | Terms of service |
| `/countdown` | Timer countdown for your active auto-end giveaways |
| `/rank` | Your global rank by number of giveaways created |
| `/invite` | Step-by-step guide to invite bot to channel |
| `/notify` | Info about bot notification events |
| `/refer` | Your personal referral link |
| `/feedback` | Send feedback/suggestions to admin |

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
[![Developer](https://img.shields.io/badge/Developer-@rchiex-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/rchiex)
[![GitHub](https://img.shields.io/badge/Owner-mystricman0--cell-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/mystricman0-cell)

</div>
