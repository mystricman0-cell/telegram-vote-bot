---
name: Telegram setMyCommands Limit
description: Telegram enforces a hard 100-command limit per scope; exceeding it throws BOT_COMMANDS_TOO_MUCH (400)
---

**Rule:** `bot.setMyCommands([...], { scope: { type: "chat", chat_id: adminId } })` accepts max 100 commands. Admin scopes with many security + user commands easily exceed this.

**Why:** Telegram API 400 Bad Request: BOT_COMMANDS_TOO_MUCH — hit when attempting 125+ commands in DRS bot admin scope.

**How to apply:**
- Count carefully before adding to setMyCommands — use a comment with counts per section
- Global user scope (no scope arg) uses a shorter list (~15 commands)
- Admin scope scoped to admin chat_id can hold all 100
- Commands NOT in setMyCommands still work — they just won't show in autocomplete
- Duplicate command names in the same list count twice and waste slots
