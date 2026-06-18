---
name: DRS Bot Architecture
description: Hybrid MongoDB + in-memory Map pattern; how state is persisted and loaded.
---

## Pattern
- All state kept in in-memory Maps (giveaways, registeredChannels, vipUsers, etc.) for fast access
- On every write (create/update), data is also saved to MongoDB via helper functions (saveGiveaway, saveChannel, saveVip, saveConfig)
- On startup, loadStateFromDB() restores all Maps from MongoDB collections

## Collections
- Giveaway — participants stored as plain objects (voters as array in Mongo, Set in memory)
- Channel — channelId as unique key
- Vip — userId as unique key
- PendingPayment, PendingMembership — cleaned up after processing
- BotConfig — key/value store for welcomeImageUrl, membershipQrFileId, forceJoinChannels

**Why:** Telegram bot needs fast in-memory lookups (every callback query), but data must survive restarts.

**How to apply:** After any state mutation, call the matching save* helper before returning.
