---
name: Image Spoiler Welcome
description: Welcome image is URL-based with Telegram spoiler effect; no file upload.
---

## Admin Command
- /setwelcomeimageurl → user sends HTTP URL → stored in welcomeImageUrl var + BotConfig
- /clearwelcomeimage → sets welcomeImageUrl = null

## Display
- sendPhoto(chatId, url, { has_spoiler: true, caption: ..., parse_mode: "HTML" })
- If URL fails, falls back to text-only welcome message

**Why:** User requested "URL se lo" (take from URL) and "spoilers type me fix karo".
