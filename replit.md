# DRS Giveaway Bot

A full-featured Telegram bot for managing giveaways and voting systems within channels. Features automated participant tracking, paid voting (INR/UPI and Telegram Stars), force-join requirements, and persistent MongoDB storage.

## Setup

Requires the following secrets to be set:
- `TELEGRAM_BOT_TOKEN` — Your Telegram bot token from @BotFather
- `ADMIN_ID` — Your Telegram user ID (numeric)
- `MONGODB_URI` — MongoDB connection string

## Running

```
npm start
```

## User preferences

- Project uses ES Modules (`.mjs`)
- Single-file bot architecture in `vote-bot.mjs`
