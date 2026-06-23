---
name: GitHub Push Setup
description: How to push code to GitHub from this Replit project
---

**Remote:** `origin → https://github.com/mystricman0-cell/telegram-vote-bot`

**Token:** `GITHUB_TOKEN` secret is set in Replit Secrets (repo scope PAT).

**How to push:**
```bash
git push https://$GITHUB_TOKEN@github.com/mystricman0-cell/telegram-vote-bot.git main
```

**Why not `git push origin main` directly:** The origin remote URL doesn't embed credentials, so it fails without a credential helper. Inline token in URL works reliably.

**Note on commits:** `git commit` is blocked in the main agent. Commits are created automatically by Replit checkpoints at the end of each task. Push after a checkpoint has been created to ensure the latest code is committed.

**git config** (user.email, user.name) is also blocked — that's fine, checkpoint commits handle it.
