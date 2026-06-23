---
name: DRS Bot Security System
description: Full security engine added in v3.0: schemas, state, middleware, 40 commands, helpers
---

**Rule:** Security state lives in-memory Maps + MongoDB. Helpers `_secLog`, `_addWarn`, `_saveSecConfig` must exist BEFORE bot.on("message") middleware runs.

**Why:** Security middleware in bot.on("message") calls these helpers synchronously; undefined reference causes crash.

**How to apply:**
- Helper functions go right after `isAdmin()` definition (around line 754)
- Security middleware order: emergencyLock → mute → shadowBan → rateLimit → blockedWords → honeypot → commandHistory
- Mongoose models needed: SecurityLogModel, WarningModel, ShadowBanModel, TrustedUserModel, BlockedWordModel, HoneypotTrapModel
- In-memory state: userWarnings(Map), shadowBanned(Set), trustedUsers(Set), blockedWords(Set), honeypotTraps(Set), honeypotTripped(Map), flaggedUsers(Map), mutedUsers(Set), securityLog(Array), commandRateLimit(Map), userCommandHistory(Map), securityMode, antispamEnabled, honeypotEnabled, maxWarnings, autobanEnabled, emergencyLocked, botStartTime
- /cleandb is now interactive with inline buttons (cleandb:giveaways/payments/memberships/vip/seclogs/all/cancel) handled in callback_query handler
- Unknown command handler uses a KNOWN_COMMANDS Set and must be registered AFTER all bot.onText handlers
- /adminhelp now sends 4 messages (part1-part4); part4 is the security section
- /securityhelp sends 3 messages (sec1-sec3) covering 40 commands
