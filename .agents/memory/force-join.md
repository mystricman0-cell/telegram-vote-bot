---
name: Force Join System
description: How force-join channels work; why channel IDs must be configured separately.
---

## Setup
- Two force-join channels are hardcoded as DEFAULT_FORCE_CHANNELS with invite links but id: null
- Admin must run /setforcejoin 1 and /setforcejoin 2 with format: CHANNEL_ID INVITE_LINK LABEL
- Config saved to BotConfig collection under key "forceJoinChannels"

## Check Flow
- checkForceJoin(userId) called at start of /start handler
- Only checks channels where id is set (not null)
- If user fails, shows forceJoinKeyboard with invite link buttons + "I've Joined" button
- "check_force_join" callback re-runs the check

**Why:** Telegram API can only check membership by channel ID, not invite link. Private invite links don't expose channel usernames.
