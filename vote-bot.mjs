/**
 * 🎁 DRS GIVEAWAY BOT v3.0
 * Full-featured Telegram Giveaway & Voting System
 * DRS Branding — Fair · Fast · Automated
 * MongoDB Persistent Storage | Force Join | Stylish Animations
 */

import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAIN_ADMIN_ID = Number(process.env.ADMIN_ID);
const MONGODB_URI = process.env.MONGODB_URI;

if (!BOT_TOKEN) { console.error("❌ TELEGRAM_BOT_TOKEN not set!"); process.exit(1); }
if (!MAIN_ADMIN_ID) { console.error("❌ ADMIN_ID not set!"); process.exit(1); }
if (!MONGODB_URI) { console.error("❌ MONGODB_URI not set!"); process.exit(1); }

// ============================================================
// MONGODB SCHEMAS
// ============================================================

const giveawaySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: String,
  creatorId: Number,
  channelId: String,
  channelUsername: String,
  participants: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  voterMap: { type: Map, of: Number, default: {} },
  active: { type: Boolean, default: true },
  participationOpen: { type: Boolean, default: true },
  paidVotesActive: { type: Boolean, default: false },
  autoEnd: { type: Boolean, default: false },
  endTime: Date,
  paymentMode: { type: String, default: "none" },
  qrFileId: String,
  upiId: { type: String, default: null },
  votesPerInr: { type: Number, default: 10 },
  votesPerStar: { type: Number, default: 5 },
  extraForceJoin: { type: mongoose.Schema.Types.Mixed, default: null },
  customPhotoId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

const channelSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true },
  title: String,
  type: String,
  addedBy: Number,
  username: String
});

const vipSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  vip: Boolean,
  plan: String,
  expiry: Date,
  startedAt: { type: Date, default: null },
  days: Number
});

const pendingPaymentSchema = new mongoose.Schema({
  payId: { type: String, required: true, unique: true },
  userId: Number,
  giveawayId: String,
  creatorId: Number,
  screenshotFileId: String,
  timestamp: { type: Date, default: Date.now }
});

const pendingMembershipSchema = new mongoose.Schema({
  payId: { type: String, required: true, unique: true },
  userId: Number,
  planKey: String,
  screenshotFileId: String,
  timestamp: { type: Date, default: Date.now }
});

const botConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const botUserSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  firstName: String,
  username: String,
  lastSeen: { type: Date, default: Date.now }
});

const GiveawayModel = mongoose.model("Giveaway", giveawaySchema);
const ChannelModel = mongoose.model("Channel", channelSchema);
const VipModel = mongoose.model("Vip", vipSchema);
const PendingPaymentModel = mongoose.model("PendingPayment", pendingPaymentSchema);
const PendingMembershipModel = mongoose.model("PendingMembership", pendingMembershipSchema);
const BotConfigModel = mongoose.model("BotConfig", botConfigSchema);
const BotUserModel = mongoose.model("BotUser", botUserSchema);

// ============================================================
// IN-MEMORY STATE (fast access, synced to Mongo)
// ============================================================

const giveaways = new Map();
const registeredChannels = new Map();
const remindersSent = new Map(); // key: `${gId}:${label}`, tracks sent reminders
const userState = new Map();
const vipUsers = new Map();
const pendingPayments = new Map();
const pendingMembershipPayments = new Map();
const botUsers = new Map();
const bannedUsers = new Set();
let maintenanceMode = false;
let customWelcomeText = null;
const scheduledMessages = new Map(); // id → { id, timeStr, text, timerId, createdAt }
let scheduleCounter = 1;
let paymentCounter = 1;
let membershipPayCounter = 1;
let welcomeImageUrl = null;
const voteVelocity = new Map(); // "gId:partId" → { count, windowStart, alerted }
let membershipQrFileId = null;
let forceJoinChannels = [];
let membershipPlans = {
  "1d": { label: "1 Day", days: 1, price: 10 },
  "7d": { label: "7 Days", days: 7, price: 50 },
  "30d": { label: "30 Days", days: 30, price: 350 }
};

// Free giveaway quota for non-VIP users
let freeGiveawayLimit = 15;   // max giveaways a free user can create
let freeUnlimited = false;     // if true, all users can create unlimited giveaways

// Default giveaway / channel post image (attached to all channel posts)
const GIVEAWAY_IMAGE_URL = "https://files.catbox.moe/72s3dg.jpg";

// Force join default channels — hardcoded by admin
// IDs can be updated via /setforcejoin; links/labels always come from defaults
const DEFAULT_FORCE_CHANNELS = [
  { id: null, link: "https://t.me/+aMvgXc_nnNAzNThl", label: "🎁 Free Contents" },
  { id: "-1003984623458", link: "https://t.me/+uv1o-BJg3mE3ZmQ1", label: "📢 Updates" }
];

// ============================================================
// CONNECT MONGODB + LOAD STATE
// ============================================================

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
    });
    console.log("✅ MongoDB Connected!");
    await loadStateFromDB();
  } catch (e) {
    console.error("❌ MongoDB connection error:", e.message);
  }

  // Auto-reconnect on unexpected disconnect (Railway network hiccups)
  mongoose.connection.on("disconnected", () => {
    console.error("⚠️ MongoDB disconnected. Reconnecting in 5s...");
    setTimeout(() => {
      mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000, heartbeatFrequencyMS: 10000 })
        .catch(e => console.error("MongoDB reconnect failed:", e.message));
    }, 5000);
  });
  mongoose.connection.on("reconnected", () => console.log("✅ MongoDB reconnected!"));
  mongoose.connection.on("error", e => console.error("MongoDB error:", e.message));
}

async function loadStateFromDB() {
  // Load giveaways
  const allGiveaways = await GiveawayModel.find({});
  for (const g of allGiveaways) {
    const obj = g.toObject();
    obj.participants = new Map(
      Object.entries(obj.participants || {}).map(([k, v]) => {
        if (v.voters && !Array.isArray(v.voters)) v.voters = [];
        v.voters = new Set(Array.isArray(v.voters) ? v.voters : []);
        return [Number(k), v];
      })
    );
    obj.voterMap = new Map(
      Object.entries(obj.voterMap || {}).map(([k, v]) => [Number(k), Number(v)])
    );
    giveaways.set(obj.id, obj);

    // Re-arm auto-end timers
    if (obj.autoEnd && obj.endTime && obj.active) {
      const ms = new Date(obj.endTime).getTime() - Date.now();
      if (ms > 0) {
        setTimeout(async () => {
          const giveaway = getGiveaway(obj.id);
          if (!giveaway || !giveaway.active) return;
          giveaway.active = false;
          giveaway.participationOpen = false;
          giveaway.paidVotesActive = false;
          await saveGiveaway(giveaway);
          await announceWinners(giveaway, obj.id, giveaway.creatorId);
        }, ms);
      }
    }
  }

  // Load channels
  const allChannels = await ChannelModel.find({});
  for (const c of allChannels) {
    registeredChannels.set(c.channelId, {
      title: c.title, type: c.type, addedBy: c.addedBy, username: c.username
    });
  }

  // Load VIP users
  const allVip = await VipModel.find({});
  for (const v of allVip) {
    vipUsers.set(v.userId, { vip: v.vip, plan: v.plan, expiry: v.expiry, startedAt: v.startedAt || null, days: v.days });
  }

  // Load pending payments
  const allPending = await PendingPaymentModel.find({});
  for (const p of allPending) {
    pendingPayments.set(p.payId, {
      userId: p.userId, giveawayId: p.giveawayId,
      creatorId: p.creatorId || null,
      screenshotFileId: p.screenshotFileId, timestamp: p.timestamp
    });
  }
  // Use max existing ID + 1 to avoid duplicate key errors on restart
  paymentCounter = allPending.length > 0
    ? Math.max(...allPending.map(p => parseInt(p.payId, 10) || 0)) + 1
    : 1;

  // Load pending membership
  const allMemPending = await PendingMembershipModel.find({});
  for (const m of allMemPending) {
    pendingMembershipPayments.set(m.payId, {
      userId: m.userId, planKey: m.planKey, screenshotFileId: m.screenshotFileId || null, timestamp: m.timestamp
    });
  }
  membershipPayCounter = allMemPending.length > 0
    ? Math.max(...allMemPending.map(m => parseInt(m.payId, 10) || 0)) + 1
    : 1;

  // Load config
  const imgConfig = await BotConfigModel.findOne({ key: "welcomeImageUrl" });
  if (imgConfig) welcomeImageUrl = imgConfig.value;

  const qrConfig = await BotConfigModel.findOne({ key: "membershipQrFileId" });
  if (qrConfig) membershipQrFileId = qrConfig.value;

  const plansConfig = await BotConfigModel.findOne({ key: "membershipPlans" });
  if (plansConfig?.value) {
    // Merge MongoDB prices into defaults — never lose label/days from code defaults
    const defaults = {
      "1d":  { label: "1 Day",   days: 1,  price: 10  },
      "7d":  { label: "7 Days",  days: 7,  price: 50  },
      "30d": { label: "30 Days", days: 30, price: 350 }
    };
    for (const key of ["1d", "7d", "30d"]) {
      if (plansConfig.value[key]) {
        membershipPlans[key] = { ...defaults[key], ...plansConfig.value[key], label: defaults[key].label, days: defaults[key].days };
      }
    }
    // Resave corrected plans so future restarts also get full data
    await saveConfig("membershipPlans", membershipPlans);
  }

  const freeLimitConfig = await BotConfigModel.findOne({ key: "freeGiveawayLimit" });
  if (freeLimitConfig?.value != null) freeGiveawayLimit = Number(freeLimitConfig.value);

  const freeUnlimitedConfig = await BotConfigModel.findOne({ key: "freeUnlimited" });
  if (freeUnlimitedConfig) freeUnlimited = !!freeUnlimitedConfig.value;

  // Always base force join on hardcoded defaults (links/labels from code)
  // Only IDs are persisted in MongoDB (via /setforcejoin)
  const fjConfig = await BotConfigModel.findOne({ key: "forceJoinChannels" });
  forceJoinChannels = DEFAULT_FORCE_CHANNELS.map((def, i) => ({
    ...def,
    id: fjConfig?.value?.[i]?.id ?? def.id
  }));
  await saveConfig("forceJoinChannels", forceJoinChannels);

  // Load bot users (for broadcast)
  const allBotUsers = await BotUserModel.find({});
  for (const u of allBotUsers) {
    botUsers.set(u.userId, { firstName: u.firstName, username: u.username });
  }

  // Load banned users
  const bannedCfg = await BotConfigModel.findOne({ key: "bannedUsers" });
  if (bannedCfg?.value && Array.isArray(bannedCfg.value)) {
    for (const uid of bannedCfg.value) bannedUsers.add(uid);
  }

  // Load maintenance mode & custom welcome text
  const maintCfg = await BotConfigModel.findOne({ key: "maintenanceMode" });
  if (maintCfg?.value) maintenanceMode = true;
  const cwCfg = await BotConfigModel.findOne({ key: "customWelcomeText" });
  if (cwCfg?.value) customWelcomeText = cwCfg.value;

  console.log(`📦 Loaded: ${giveaways.size} giveaways, ${registeredChannels.size} channels, ${vipUsers.size} VIP users, ${botUsers.size} bot users`);
}

async function saveGiveaway(g) {
  try {
    const obj = { ...g };
    const participantsObj = {};
    for (const [k, v] of (g.participants || new Map())) {
      participantsObj[String(k)] = { ...v, voters: [...v.voters] };
    }
    const voterMapObj = {};
    for (const [k, v] of (g.voterMap || new Map())) {
      voterMapObj[String(k)] = v;
    }
    await GiveawayModel.findOneAndUpdate(
      { id: g.id },
      { ...obj, participants: participantsObj, voterMap: voterMapObj },
      { upsert: true, new: true }
    );
  } catch (e) { console.error("saveGiveaway error:", e.message); }
}

async function saveChannel(id, data) {
  try {
    await ChannelModel.findOneAndUpdate({ channelId: id }, { channelId: id, ...data }, { upsert: true });
  } catch (e) { console.error("saveChannel error:", e.message); }
}

async function saveVip(userId, data) {
  try {
    await VipModel.findOneAndUpdate({ userId }, { userId, ...data }, { upsert: true });
  } catch (e) { console.error("saveVip error:", e.message); }
}

async function saveConfig(key, value) {
  try {
    await BotConfigModel.findOneAndUpdate({ key }, { key, value }, { upsert: true });
  } catch (e) { console.error("saveConfig error:", e.message); }
}

async function trackUser(from) {
  if (!from || from.is_bot) return;
  const uid = from.id;
  botUsers.set(uid, { firstName: from.first_name || "", username: from.username || "" });
  try {
    await BotUserModel.findOneAndUpdate(
      { userId: uid },
      { userId: uid, firstName: from.first_name || "", username: from.username || "", lastSeen: new Date() },
      { upsert: true }
    );
  } catch (e) { console.error("trackUser error:", e.message); }
}

// ============================================================
// BOT INIT
// ============================================================

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    params: {
      allowed_updates: [
        "message",
        "callback_query",
        "my_chat_member",
        "chat_member",
        "pre_checkout_query",
        "inline_query"
      ]
    }
  }
});
let BOT_USERNAME = "";

// ============================================================
// SLEEP HELPER
// ============================================================

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================
// ADMIN NOTIFIER — sends every key event to admin
// ============================================================
async function notifyAdmin(text) {
  try {
    await bot.sendMessage(MAIN_ADMIN_ID,
      `<b>📡 EVENT</b>\n\n${text}`,
      { parse_mode: "HTML" }
    );
  } catch {}
}

// ============================================================
// ✨ UNIQUE ANIMATIONS PER CONTEXT ✨
// ============================================================

// 🌟 Welcome animation — sleek DRS reveal
async function animWelcome(chatId) {
  const frames = [
    `·  ·  ·`,
    `◈  ·  ·  ◈`,
    `◈ · <b>DRS</b> · ◈`,
    `⚡ <b>DRS GIVEAWAY</b> ⚡`,
    `🎁 <b>DRS GIVEAWAY BOT</b> 🎁`,
  ];
  const delays = [130, 160, 200, 250];
  let msg;
  try { msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "HTML" }); } catch { return null; }
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1] || 150);
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }); } catch {}
  }
  await sleep(300);
  return msg;
}

// 🎁 Welcome animation played on a photo caption (spoiler image stays, caption animates)
async function animWelcomePhoto(chatId, msgId) {
  const frames = [
    `·  ·  ·`,
    `◈  ·  ·  ◈`,
    `◈ · <b>DRS</b> · ◈`,
    `⚡ <b>DRS GIVEAWAY</b> ⚡`,
    `🎁 <b>DRS GIVEAWAY BOT</b> 🎁`,
  ];
  const delays = [130, 160, 200, 250];
  for (let i = 0; i < frames.length; i++) {
    try {
      await bot.editMessageCaption(frames[i], {
        chat_id: chatId, message_id: msgId, parse_mode: "HTML"
      });
    } catch {}
    if (i < frames.length - 1) await sleep(delays[i] || 150);
  }
  await sleep(300);
}

// 🔔 Ding-dong animation — plays before welcome photo, then deletes itself
async function animDingDong(chatId) {
  const frames = [
    `🔔 <b>ᴅɪɴɢ ᴅᴏɴɢ</b>  ·`,
    `🔔 <b>ᴅɪɴɢ ᴅᴏɴɢ</b>  · ·`,
    `🔔 <b>ᴅɪɴɢ ᴅᴏɴɢ</b>  · · ·`,
    `🎁 <b>𝐃𝐑𝐒</b>`,
    `🎁 <b>𝐃𝐑𝐒 ɢɪᴠᴇ</b>`,
    `🎁 <b>𝐃𝐑𝐒 ɢɪᴠᴇᴀᴡᴀʏ</b>`,
    `🎁 <b>𝐃𝐑𝐒 ɢɪᴠᴇᴀᴡᴀʏ ʙᴏᴛ !</b> 🎊`,
  ];
  const delays = [280, 280, 280, 160, 160, 160];
  let msg;
  try { msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "HTML" }); } catch { return null; }
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1] || 200);
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }); } catch {}
  }
  await sleep(500);
  try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
}

// 🔄 Loading animation — minimal spinner
async function animLoading(chatId, msgId) {
  if (!msgId) { try { await bot.sendChatAction(chatId, "typing"); } catch {} return; }
  const frames = ["⏳", "🔄", "⚙️ <i>Loading...</i>", "✦ <i>Please wait...</i>"];
  const delays = [100, 130, 160];
  for (let i = 0; i < frames.length; i++) {
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); } catch {}
    if (i < frames.length - 1) await sleep(delays[i]);
  }
  await sleep(150);
}

// 🌟 Fresh menu — deletes old message, plays animation, shows new menu
async function animFresh(chatId, msgId, finalText, opts = {}) {
  try { await bot.deleteMessage(chatId, msgId); } catch {}
  const frames = ["✦", "✦ ─── ✦", "⚡ <b>DRS</b> ⚡", "🔥 <i>Loading...</i>"];
  const delays = [90, 120, 150];
  let msg;
  try { msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "HTML" }); } catch { return null; }
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1]);
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }); } catch {}
  }
  await sleep(160);
  try {
    await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts });
  } catch {
    try { await bot.sendMessage(chatId, finalText, { parse_mode: "HTML", ...opts }); } catch {}
  }
  return msg;
}

// 🔀 Edit existing message OR send fresh — used when source was a photo (msgId=null)
// Falls back to sendMessage if edit fails, so user always gets a response
async function replyToCallback(chatId, msgId, text, opts = {}) {
  if (msgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", ...opts });
    } catch {
      try { await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...opts }); } catch {}
    }
  } else {
    try { await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...opts }); } catch {}
  }
}

// 🎯 Action animation — for button responses (new message)
async function animAction(chatId, finalText, opts = {}) {
  try { await bot.sendChatAction(chatId, "typing"); } catch {}
  const frames = ["💫", "💫 ─ 💫", "⚡ <b>DRS</b> ⚡", "🔥 <i>Processing...</i>"];
  const delays = [100, 130, 160];
  let msg;
  try { msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "HTML" }); } catch { return null; }
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1]);
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }); } catch {}
  }
  await sleep(200);
  try {
    await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts });
  } catch {
    try { await bot.sendMessage(chatId, finalText, { parse_mode: "HTML", ...opts }); } catch {}
  }
  return msg;
}

// Success animation — clean flash
async function animSuccess(chatId, msgId, finalText, opts = {}) {
  const frames = ["◈", "◈ ─── ◈", "◆ <b>Done.</b>", "✦ <i>Generating your card...</i>"];
  const delays = [120, 150, 180];
  for (let i = 0; i < frames.length; i++) {
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); } catch {}
    if (i < frames.length - 1) await sleep(delays[i]);
  }
  await sleep(200);
  try {
    await bot.editMessageText(finalText, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", ...opts });
  } catch {
    try { await bot.sendMessage(chatId, finalText, { parse_mode: "HTML", ...opts }); } catch {}
  }
}

// 🗳️ Vote animation — quick pulse
async function animVote(chatId, finalText, opts = {}) {
  try { await bot.sendChatAction(chatId, "typing"); } catch {}
  const frames = ["🗳️", "🗳️ ─── 📊", "📊 <b>Counting votes...</b>"];
  const delays = [90, 120];
  let msg;
  try { msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "HTML" }); } catch { return null; }
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1]);
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }); } catch {}
  }
  await sleep(150);
  try {
    await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts });
  } catch {
    try { await bot.sendMessage(chatId, finalText, { parse_mode: "HTML", ...opts }); } catch {}
  }
  return msg;
}

// 🎁 Giveaway creation animation
async function animCreate(chatId, finalText, opts = {}) {
  try { await bot.sendChatAction(chatId, "typing"); } catch {}
  const frames = ["🎁", "🎁 ═══ 🎁", "✦ <b>Creating Giveaway...</b>", "🚀 <i>Almost ready!</i>"];
  const delays = [110, 140, 170];
  let msg;
  try { msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "HTML" }); } catch { return null; }
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1]);
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }); } catch {}
  }
  await sleep(200);
  try {
    await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts });
  } catch {
    try { await bot.sendMessage(chatId, finalText, { parse_mode: "HTML", ...opts }); } catch {}
  }
  return msg;
}

// 🔴 Error/Cancel animation
async function animCancel(chatId, msgId, finalText, opts = {}) {
  const frames = ["⚠️", "❌ ─── ⚠️", "🚫 <b>Cancelling...</b>"];
  const delays = [100, 130];
  for (let i = 0; i < frames.length; i++) {
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); } catch {}
    if (i < frames.length - 1) await sleep(delays[i]);
  }
  await sleep(160);
  try {
    await bot.editMessageText(finalText, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", ...opts });
  } catch {
    try { await bot.sendMessage(chatId, finalText, { parse_mode: "HTML", ...opts }); } catch {}
  }
}

// 💎 Payment/VIP animation
async function animPayment(chatId, finalText, opts = {}) {
  try { await bot.sendChatAction(chatId, "typing"); } catch {}
  const frames = ["💎", "💎 ─── 💰", "💰 <b>Processing Payment...</b>", "🏦 <i>Verifying...</i>"];
  const delays = [100, 130, 160];
  let msg;
  try { msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "HTML" }); } catch { return null; }
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1]);
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }); } catch {}
  }
  await sleep(200);
  try {
    await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts });
  } catch {
    try { await bot.sendMessage(chatId, finalText, { parse_mode: "HTML", ...opts }); } catch {}
  }
  return msg;
}

// 🏆 Leaderboard animation
async function animLeaderboard(chatId, msgId, finalText, opts = {}) {
  const frames = ["🏆", "🏅 ─── 🏆 ─── 🏅", "📊 <b>Fetching Rankings...</b>"];
  const delays = [110, 140];
  for (let i = 0; i < frames.length; i++) {
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); } catch {}
    if (i < frames.length - 1) await sleep(delays[i]);
  }
  await sleep(180);
  try {
    await bot.editMessageText(finalText, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", ...opts });
  } catch {
    try { await bot.sendMessage(chatId, finalText, { parse_mode: "HTML", ...opts }); } catch {}
  }
}

// ============================================================
// MEMBERSHIP PLANS — loaded from DB, editable via /setplan
// ============================================================

function getMembershipPlan(key) { return membershipPlans[key] || null; }

function buildPlanButtons() {
  return [
    [
      { text: `1D - ₹${membershipPlans["1d"].price}`, callback_data: "buy_mem:1d" },
      { text: `7D - ₹${membershipPlans["7d"].price}`, callback_data: "buy_mem:7d" }
    ],
    [{ text: `30D - ₹${membershipPlans["30d"].price}`, callback_data: "buy_mem:30d" }],
    [{ text: "◀️ Back", callback_data: "main_menu" }]
  ];
}

function buildPlansText() {
  return (
    `💳 1 Day   ▸  ₹${membershipPlans["1d"].price}\n` +
    `💳 7 Days  ▸  ₹${membershipPlans["7d"].price}\n` +
    `💎 30 Days ▸  ₹${membershipPlans["30d"].price}`
  );
}

// ============================================================
// HELPERS
// ============================================================

function genId(len = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function h(t) {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getGiveaway(id) { return giveaways.get(String(id)); }
function isAdmin(uid) { return uid === MAIN_ADMIN_ID; }

function getMembership(uid) {
  const d = vipUsers.get(uid);
  if (!d?.vip) return null;
  if (d.expiry && new Date() > new Date(d.expiry)) return null; // check only — never mutate in-memory state
  return d;
}

function isVip(uid) { return getMembership(uid) !== null; }

function safeFormatDate(d) {
  if (!d) return "∞";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "∞";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function safeFormatDateTime(d) {
  if (!d) return "∞";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "∞";
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
    timeZone: "Asia/Kolkata"
  }).replace(",", " ·") + " IST";
}

function timeRemaining(expiry) {
  if (!expiry) return "";
  const ms = new Date(expiry).getTime() - Date.now();
  if (isNaN(ms) || ms <= 0) return "⛔ Expired";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h ${mins}m baki`;
  if (hours > 0) return `${hours}h ${mins}m baki`;
  return `${mins}m baki`;
}

function membershipBadge(uid) {
  const m = getMembership(uid);
  if (!m) return "❌ Inactive";
  const rem = timeRemaining(m.expiry);
  return `◈ Active (${m.plan || "VIP"} · ⏱️ ${rem})`;
}

async function isMember(chatId, userId) {
  try {
    const m = await bot.getChatMember(chatId, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch { return false; }
}

async function isChannelAdmin(chatId, userId) {
  try {
    const m = await bot.getChatMember(chatId, userId);
    return ["administrator", "creator"].includes(m.status);
  } catch { return false; }
}

function formatLeaderboard(g, max = 15) {
  const parts = [...g.participants.values()].sort((a, b) => b.votes - a.votes).slice(0, max);
  if (!parts.length) return `<i>▸ No votes yet — be the first! 🗳️</i>`;
  const medals = ["🥇", "🥈", "🥉"];
  return parts.map((p, i) => {
    const rank = medals[i] ?? `  <b>${i + 1}.</b>`;
    const name = h(p.name).slice(0, 18);
    const pad = "·".repeat(Math.max(2, 20 - name.length));
    return `${rank} ${name} ${pad} <code>${p.votes}</code> 🗳️`;
  }).join("\n");
}

function parseIST(str) {
  const [datePart, timePart] = str.trim().split(" ");
  if (!datePart || !timePart) return null;
  const [dd, mm, yyyy] = datePart.split("-");
  const [hh, min] = timePart.split(":");
  if (!dd || !mm || !yyyy || !hh || !min) return null;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh - 5, +min - 30));
  return isNaN(d.getTime()) ? null : d;
}

function nowIST() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }).replace(",", "");
}

// ============================================================
// FORCE JOIN CHECK
// ============================================================

async function checkForceJoin(userId) {
  // VIP members bypass force join entirely
  if (isVip(userId)) return { passed: true, missing: [] };

  const allWithLink = forceJoinChannels.filter(c => c.link);
  if (!allWithLink.length) return { passed: true, missing: [] };

  const missing = [];
  for (const ch of allWithLink) {
    if (ch.id) {
      // Can verify membership properly
      try {
        const member = await isMember(ch.id, userId);
        if (!member) missing.push(ch);
      } catch { missing.push(ch); }
    }
    // No ID = can't verify, trust the user (they still see join buttons)
  }
  return { passed: missing.length === 0, missing };
}

function shouldShowForceJoin(userId) {
  if (isVip(userId)) return false;
  return forceJoinChannels.some(c => c.link);
}

function forceJoinKeyboard(channels) {
  const btns = channels.map(ch => ([{
    text: `📢 ${ch.label} — Join Now`,
    url: ch.link
  }]));
  btns.push([{ text: "✅ Joined — Verify & Continue", callback_data: "check_force_join" }]);
  return { inline_keyboard: btns };
}

// ============================================================
// KEYBOARDS
// ============================================================

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🎁 ɴᴇᴡ ɢɪᴠᴇᴀᴡᴀʏ ✦", callback_data: "new_giveaway" },
        { text: "✦ ᴍʏ ɢɪᴠᴇᴀᴡᴀʏꜱ 📂", callback_data: "my_giveaways" }
      ],
      [
        { text: "📢 ᴀᴅᴅ ᴄʜᴀɴɴᴇʟ ⚡", callback_data: "add_channel" },
        { text: "⚡ ᴀᴅᴅ ɢʀᴏᴜᴘ 👥", callback_data: "add_group" }
      ],
      [
        { text: "👑 ᴠɪᴘ ᴍᴇᴍʙᴇʀꜱʜɪᴘ 💎", callback_data: "vip_membership" },
        { text: "🚀 ᴄʀᴇᴀᴛᴇ ᴘᴏꜱᴛ ✍️", callback_data: "create_post" }
      ],
      [{ text: "🌟 ─── ɢᴜɪᴅᴇ & ʜᴇʟᴘ ─── 🌟", callback_data: "how_to_use" }]
    ]
  };
}

function cpComposePrompt(title, username, chId) {
  const link = username ? `@${username}` : `<code>${chId}</code>`;
  return (
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  ◆  <b>CREATE POST</b>  ◆\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `◈ Channel  ▸  <b>${title}</b>\n` +
    `◈ Target   ▸  ${link}\n\n` +
    `Type your message or send a photo —\n` +
    `it will be posted directly to the channel.</blockquote>\n\n` +
    `✦ ─── <b>DRS NETWORK</b> ─── ✦`
  );
}

function cancelKeyboard() {
  return { inline_keyboard: [[{ text: "✖️ ᴄᴀɴᴄᴇʟ", callback_data: "cancel_flow" }]] };
}

function backKeyboard(cb = "main_menu") {
  return { inline_keyboard: [[{ text: "◀️ ʙᴀᴄᴋ", callback_data: cb }]] };
}

function mgmtKeyboard(gId, g, showVipControls = false) {
  const rows = [
    [{ text: "🏆 ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ", callback_data: `lb:${gId}` }, { text: "📊 ᴛᴏᴘ ᴘᴀʀᴛɪᴄɪᴘᴀɴᴛꜱ", callback_data: `topvoters:${gId}` }],
    [{ text: `${g.paidVotesActive ? "⏹ ꜱᴛᴏᴘ ᴘᴀɪᴅ ᴠᴏᴛᴇꜱ" : "▶️ ꜱᴛᴀʀᴛ ᴘᴀɪᴅ ᴠᴏᴛᴇꜱ"}`, callback_data: `toggle_paid:${gId}` }],
    [{ text: `${g.participationOpen ? "⏹ ꜱᴛᴏᴘ ᴘᴀʀᴛɪᴄɪᴘᴀᴛɪᴏɴ" : "▶️ ᴏᴘᴇɴ ᴘᴀʀᴛɪᴄɪᴘᴀᴛɪᴏɴ"}`, callback_data: `toggle_part:${gId}` }],
  ];
  if (showVipControls) {
    rows.push([{
      text: g.extraForceJoin
        ? `🔗 ꜰᴏʀᴄᴇ ᴊᴏɪɴ: ${g.extraForceJoin.channelUsername ? "@" + g.extraForceJoin.channelUsername : "ꜱᴇᴛ ✅"} — ᴄʜᴀɴɢᴇ`
        : "🔗 ꜱᴇᴛ ꜰᴏʀᴄᴇ ᴊᴏɪɴ ᴄʜᴀɴɴᴇʟ (ᴠɪᴘ)",
      callback_data: `set_gj:${gId}`
    }]);
    if (g.extraForceJoin) {
      rows.push([{ text: "✖️ ʀᴇᴍᴏᴠᴇ ꜰᴏʀᴄᴇ ᴊᴏɪɴ", callback_data: `clear_gj:${gId}` }]);
    }
  }
  rows.push([{ text: "🏁 ᴇɴᴅ ɢɪᴠᴇᴀᴡᴀʏ", callback_data: `end_giveaway:${gId}` }]);
  rows.push([{ text: "🗑️ ᴄʟᴇᴀʀ ᴄʜᴀɴɴᴇʟ ᴘᴏꜱᴛꜱ", callback_data: `clear_posts:${gId}` }]);
  rows.push([{ text: "◀️ ʙᴀᴄᴋ", callback_data: "my_giveaways" }]);
  return { inline_keyboard: rows };
}

// ============================================================
// SEND WELCOME (DRS Branding)
// ============================================================

const userLastWelcomeMsg = new Map();

async function sendWelcome(chatId, userId) {
  const prev = userLastWelcomeMsg.get(userId);
  if (prev) {
    try { await bot.deleteMessage(prev.chatId, prev.msgId); } catch {}
    userLastWelcomeMsg.delete(userId);
  }

  // Ding-dong animation before welcome photo
  await animDingDong(chatId);

  try { await bot.sendChatAction(chatId, "typing"); } catch {}

  const welcomeText = customWelcomeText ||
    `<b>𝐃𝐑𝐒 𝐆𝐈𝐕𝐄𝐀𝐖𝐀𝐘 𝐁𝐎𝐓! 🎁</b>\n\n` +
    `<blockquote>` +
    `✨ ꜰᴜʟʟʏ ᴀᴜᴛᴏᴍᴀᴛᴇᴅ &amp; ꜰᴀɪʀ ɢɪᴠᴇᴀᴡᴀʏ ꜱʏꜱᴛᴇᴍ ✔️\n` +
    `⚡️ ꜰᴀꜱᴛ &amp; ᴛʀᴀɴꜱᴘᴀʀᴇɴᴛ ᴡɪɴɴᴇʀ ꜱᴇʟᴇᴄᴛɪᴏɴ ✔️\n` +
    `🛡 ꜱᴇᴄᴜʀᴇ, ʀᴇʟɪᴀʙʟᴇ &amp; ᴇᴀꜱʏ ᴛᴏ ᴜꜱᴇ ✔️\n` +
    `🎊 ʜᴏꜱᴛ ɢɪᴠᴇᴀᴡᴀʏꜱ ᴡɪᴛʜ ᴀ ᴘʀᴇᴍɪᴜᴍ ᴇxᴘᴇʀɪᴇɴᴄᴇ ✔️` +
    `</blockquote>\n\n` +
    `🔺 ᴛᴀᴘ 🎁 ɴᴇᴡ ɢɪᴠᴇᴀᴡᴀʏ ʙᴜᴛᴛᴏɴ ᴛᴏ ᴄʀᴇᴀᴛᴇ ᴀ ɢɪᴠᴇᴀᴡᴀʏ ⭐\n` +
    `🔺 ᴛᴀᴘ 📂 ᴍʏ ɢɪᴠᴇᴀᴡᴀʏꜱ ʙᴜᴛᴛᴏɴ ᴛᴏ ᴠɪᴇᴡ ʏᴏᴜʀ ɢɪᴠᴇᴀᴡᴀʏꜱ ⭐️\n\n` +
    `✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️\n` +
    `<blockquote>` +
    `⚡️ ᴘᴏᴡᴇʀᴇᴅ : <a href="https://t.me/rchiex">𝐃𝐑𝐒 ɴᴇᴛᴡᴏʀᴋ</a> ❤️‍🔥\n` +
    `❤️ ꜱᴜᴘᴘᴏʀᴛ :— <a href="https://t.me/drssupport">𝐀𝐁𝐇𝐈𝐒𝐇𝐄𝐊</a> ❤️‍🔥` +
    `</blockquote>`;

  // Send photo first with spoiler + first animation frame as caption
  const imgUrl = welcomeImageUrl || GIVEAWAY_IMAGE_URL;
  let finalMsg;
  try {
    finalMsg = await bot.sendPhoto(chatId, imgUrl, {
      caption: `·  ·  ·`,
      parse_mode: "HTML",
      has_spoiler: true
    });
    // Animate the caption on the photo (image stays as spoiler, caption animates)
    await animWelcomePhoto(chatId, finalMsg.message_id);
    // Set final welcome caption + menu buttons
    await bot.editMessageCaption(welcomeText, {
      chat_id: chatId,
      message_id: finalMsg.message_id,
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard()
    });
  } catch {
    // Fallback to text-only if photo fails
    finalMsg = await bot.sendMessage(chatId, welcomeText, {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard()
    });
  }

  const msgId = finalMsg?.message_id;
  if (msgId) userLastWelcomeMsg.set(userId, { chatId, msgId });
}

// ============================================================
// /start HANDLER
// ============================================================

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const param = match[1]?.trim();

  userState.delete(userId);
  const isNewUser = !botUsers.has(userId);
  trackUser(msg.from);

  if (isNewUser) {
    const nu = msg.from;
    const nuName = h(nu.first_name || "");
    const nuHandle = nu.username ? `@${nu.username}` : `ID: ${userId}`;
    await notifyAdmin(
      `👋 <b>New User Started Bot</b>\n` +
      `<blockquote>` +
      `◈ Name    ▸  <b>${nuName}</b> (${nuHandle})\n` +
      `◈ User ID ▸  <code>${userId}</code>` +
      `</blockquote>`
    );
  }

  // ── Force Join Check ──
  // Show force join if any channels are configured with links (VIP bypasses)
  if (shouldShowForceJoin(userId)) {
    const { passed, missing } = await checkForceJoin(userId);
    const allChannels = forceJoinChannels.filter(c => c.link);
    if (!passed) {
      // Show all channels with join buttons, highlight missing ones
      const missingIds = new Set(missing.map(c => c.link));
      const displayList = allChannels.map(c =>
        `${missingIds.has(c.link) ? "❌" : "✅"} ${c.label}`
      ).join("\n");
      await bot.sendMessage(chatId,
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
        `  📢  <b>JOIN REQUIRED</b>  📢\n` +
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
        `<blockquote>` +
        `🔒 To use the bot, please join these channels first:\n\n` +
        `${displayList}\n\n` +
        `After joining, press ✅ <b>Verify</b> below.</blockquote>\n\n` +
        `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
        { parse_mode: "HTML", reply_markup: forceJoinKeyboard(allChannels) }
      );
      return;
    }
  }

  // Deep link: /start <giveawayId>
  if (param) {
    const g = getGiveaway(param);
    if (!g) {
      return bot.sendMessage(chatId, "❌ Giveaway not found. Please check your link.", { parse_mode: "HTML" });
    }
    if (!g.participationOpen) {
      return bot.sendMessage(chatId,
        `<b>❌ Participation Closed</b>\n\n<b>${h(g.title)}</b> is not accepting new participants at this time.`,
        { parse_mode: "HTML" }
      );
    }
    if (g.channelId) {
      const member = await isMember(g.channelId, userId);
      if (!member) {
        // Try to get a join link — public channels use @username, private use invite link
        let channelUrl = g.channelUsername ? `https://t.me/${g.channelUsername}` : null;
        if (!channelUrl) {
          try { channelUrl = await bot.exportChatInviteLink(g.channelId); } catch {}
        }
        return bot.sendMessage(chatId,
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `  🔒  <b>CHANNEL REQUIRED</b>\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `<blockquote>` +
          `To participate in <b>${h(g.title)}</b>, you must first join the channel.\n\n` +
          (channelUrl ? `👉 Tap the button below to join.\n\n` : ``) +
          `After joining, tap your link again to continue.` +
          `</blockquote>`,
          {
            parse_mode: "HTML",
            reply_markup: channelUrl ? {
              inline_keyboard: [[{ text: "📢 Join Channel", url: channelUrl }]]
            } : undefined
          }
        );
      }
    }

    // ── VIP extra force join check (only enforced while creator's membership is active) ──
    if (g.extraForceJoin && (isVip(g.creatorId) || isAdmin(g.creatorId))) {
      const fj = g.extraForceJoin;
      let fjMember = false;
      try { fjMember = await isMember(fj.channelId, userId); } catch {}
      if (!fjMember) {
        let fjUrl = fj.channelUsername ? `https://t.me/${fj.channelUsername}` : null;
        if (!fjUrl) {
          try { fjUrl = await bot.exportChatInviteLink(fj.channelId); } catch {}
        }
        return bot.sendMessage(chatId,
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `  🔗  <b>JOIN REQUIRED</b>\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `<blockquote>` +
          `To participate in this giveaway, you must first join the required channel.\n\n` +
          (fjUrl ? `👉 Tap the button below to join.\n\n` : ``) +
          `After joining, tap your link again to continue.` +
          `</blockquote>`,
          {
            parse_mode: "HTML",
            reply_markup: fjUrl ? {
              inline_keyboard: [[{ text: "📢 Join Channel", url: fjUrl }]]
            } : undefined
          }
        );
      }
    }
    const existing = g.participants.get(userId);
    const userName = (msg.from.first_name || "") + (msg.from.last_name ? ` ${msg.from.last_name}` : "");

    if (existing) {
      return bot.sendMessage(chatId,
        `<b>◆ Already a Participant</b>\n\n` +
        `📌 <b>${h(g.title)}</b>\n` +
        `🗳️ Current Votes: <b>${existing.votes}</b>\n\n` +
        (existing.channelMsgId && g.channelId
          ? `<a href="https://t.me/c/${String(g.channelId).replace("-100", "")}/${existing.channelMsgId}">📋 My Vote Post</a>\n`
          : "") +
        `🔗 Vote Link: https://t.me/${BOT_USERNAME}?start=${g.id}`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💰 Buy Paid Votes", callback_data: `buy_votes:${g.id}` }],
              [{ text: "🏆 Leaderboard", callback_data: `lb:${g.id}` }],
              [{ text: "🔄 Get Links Again", callback_data: `my_links:${g.id}` }]
            ]
          }
        }
      );
    }

    await bot.sendMessage(chatId,
      `<b>💎 Verification Successful</b>\n\n` +
      `Event: <b>${h(g.title)}</b>\n\n` +
      `Ready to generate your personal vote post in the target channel?`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔥 Confirm & Participate", callback_data: `confirm_join:${g.id}` },
              { text: "❌ Cancel", callback_data: "main_menu" }
            ]
          ]
        }
      }
    );
    return;
  }

  await sendWelcome(chatId, userId);
});

// ============================================================
// BOT ADDED TO CHANNEL
// ============================================================

bot.on("my_chat_member", async (update) => {
  const { chat, new_chat_member, from } = update;
  if (!["channel", "supergroup", "group"].includes(chat.type)) return;

  const isNowAdmin = ["administrator", "creator"].includes(new_chat_member?.status);
  const wasAdmin = ["administrator", "creator"].includes(update.old_chat_member?.status);

  if (isNowAdmin && !wasAdmin) {
    const key = String(chat.id);
    const data = { title: chat.title || "Unknown", type: chat.type, addedBy: from.id, username: chat.username || null };
    registeredChannels.set(key, data);
    await saveChannel(key, data);

    try {
      await bot.sendMessage(from.id,
        `◆ <b>DRS GIVEAWAY BOT</b> ◆\n` +
        `<i>· Fair · Fast · Automated ·</i>\n\n` +
        `◆ ─────────────────── ◆\n\n` +
        `<blockquote>◈ Bot is now Admin in:\n<b>${h(chat.title)}</b></blockquote>\n\n` +
        `<blockquote>◈ /start → Create &amp; manage giveaways\n◈ /createpost → Post to this channel\n◈ /membership → Unlock premium</blockquote>\n\n` +
        `✦ ─────── <b>DRS NETWORK</b> ─────── ✦`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: `📢 Go to Channel`, url: chat.username ? `https://t.me/${chat.username}` : `https://t.me/c/${key.replace("-100", "")}` }]
            ]
          }
        }
      );
    } catch (e) { console.error("Welcome DM error:", e.message); }
  }
});

// ============================================================
// CALLBACK QUERY HANDLER
// ============================================================

bot.on("callback_query", async (query) => {
  // Inline-mode callbacks have no .message (null) — guard before any access
  if (!query.message) {
    await bot.answerCallbackQuery(query.id).catch(() => {});
    return;
  }
  try {
  const chatId = query.message.chat.id;
  let msgId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data;

  // Only delete welcome photo in PRIVATE chats (not channel vote cards)
  const isPhoto = !!(query.message.photo?.length);
  if (isPhoto && query.message.chat.type === "private") {
    try { await bot.deleteMessage(chatId, msgId); } catch {}
    msgId = null;
  }

  // ─── Force join re-check (Verify button) ───
  if (data === "check_force_join") {
    const { passed, missing } = await checkForceJoin(userId);
    if (!passed) {
      const allChannels = forceJoinChannels.filter(c => c.link);
      const missingLinks = new Set(missing.map(c => c.link));
      const displayList = allChannels.map(c =>
        `${missingLinks.has(c.link) ? "❌" : "✅"} ${c.label}`
      ).join("\n");
      await bot.editMessageText(
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
        `  📢  <b>JOIN REQUIRED</b>  📢\n` +
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
        `<blockquote>⚠️ You haven't joined all required channels yet:\n\n` +
        `${displayList}\n\n` +
        `❌ Join the channels above, then tap ✅ Verify &amp; Continue.</blockquote>\n\n` +
        `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: forceJoinKeyboard(allChannels) }
      ).catch(() => {});
    } else {
      try { await bot.deleteMessage(chatId, msgId); } catch {}
      await sendWelcome(chatId, userId);
    }
    return;
  }

  // ─── Main Menu ───
  if (data === "main_menu") {
    userState.delete(userId);
    try { await bot.deleteMessage(chatId, msgId); } catch {}
    await sendWelcome(chatId, userId);
    return;
  }

  // ─── Cancel flow ───
  if (data === "cancel_flow") {
    userState.delete(userId);
    await animCancel(chatId, msgId,
      `✦━━━━━━━━━━━━━━━━━━━✦\n` +
      `      ❌  <b>CANCELLED</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>Action has been cancelled.\nReturn to the main menu to start again.</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
    );
    return;
  }

  // ─── Broadcast target selection ───
  if (data.startsWith("bc_target:")) {
    const target = data.split(":")[1];
    if (target === "cancel") {
      userState.delete(userId);
      try { await bot.deleteMessage(chatId, msgId); } catch {}
      await bot.sendMessage(chatId, `❌ <b>Broadcast cancelled.</b>`, { parse_mode: "HTML" });
      return;
    }
    const state = userState.get(userId);
    if (!state || state.step !== "broadcast_pending") {
      await bot.answerCallbackQuery(query.id, { text: "❌ Broadcast session expired. Use /broadcast again.", show_alert: true }).catch(() => {});
      return;
    }
    userState.delete(userId);
    try { await bot.deleteMessage(chatId, msgId); } catch {}
    const targetLabel = { users: "👥 Users", channels: "📢 Channels", groups: "🏘️ Groups", all: "🌐 All" }[target];
    const progressMsg = await bot.sendMessage(chatId,
      `╔══════════════════════╗\n` +
      `║  📢  <b>BROADCASTING</b>  ║\n` +
      `╠══════════════════════╣\n` +
      `<blockquote>` +
      `🎯 Target  » ${targetLabel}\n` +
      `📊 Progress » <code>[░░░░░░░░░░]  0%</code>\n` +
      `✅ Sent     » 0\n` +
      `❌ Failed   » 0` +
      `</blockquote>\n` +
      `╚══════════════════════╝`,
      { parse_mode: "HTML" }
    );
    await doBroadcast(chatId, state.adminMsg, state.text, state.silent, target, state.composeMsg || null, progressMsg.message_id);
    return;
  }

  // ─── New Giveaway ───
  if (data === "new_giveaway") {
    if (!isVip(userId) && !isAdmin(userId)) {
      // Count giveaways this free user has already created
      const userGiveawayCount = [...giveaways.values()].filter(g => g.creatorId === userId).length;
      const canCreate = freeUnlimited || userGiveawayCount < freeGiveawayLimit;

      if (!canCreate) {
        await bot.sendMessage(chatId,
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `   ⛔  <b>FREE LIMIT REACHED</b>\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `<blockquote>` +
          `Aapne apne <b>${freeGiveawayLimit} free giveaways</b> use kar liye hain!\n\n` +
          `Aur giveaways create karne ke liye:\n` +
          `▸ 👑 VIP Membership upgrade karein\n` +
          `▸ Unlimited giveaways banao\n` +
          `▸ Paid votes &amp; premium features unlock karein` +
          `</blockquote>\n\n` +
          `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "👑 Get VIP Membership", callback_data: "vip_membership" }],
                [{ text: "◀️ Back to Menu", callback_data: "main_menu" }]
              ]
            }
          }
        );
        return;
      }

      // Within free quota — proceed to creation
      const remaining = freeUnlimited ? "∞" : (freeGiveawayLimit - userGiveawayCount - 1);
      userState.set(userId, { step: "title", msgId, freeMode: true, remaining });
    } else {
      userState.set(userId, { step: "title", msgId });
    }
    await animLoading(chatId, msgId);
    await replyToCallback(chatId, msgId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   🎁  <b>CREATE GIVEAWAY</b>  🎁\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `━━━◈ <b>STEP 1 of 5</b> ◈━━━\n` +
      `<i>Giveaway Title</i>\n\n` +
      `<blockquote>` +
      `📝 Enter a catchy title for your giveaway.\n\n` +
      `▸ iPhone 16 Giveaway Contest\n` +
      `▸ Best Creator Vote 2026\n` +
      `▸ Monthly Star Award` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { reply_markup: cancelKeyboard() }
    );
    return;
  }

  // ─── My Giveaways ───
  if (data === "my_giveaways") {
    const kb = {
      inline_keyboard: [
        [
          { text: "✍️ Created (Active)", callback_data: "mglist:created_active" },
          { text: "📋 Created (Past)", callback_data: "mglist:created_past" }
        ],
        [
          { text: "🤝 Joined (Active)", callback_data: "mglist:joined_active" },
          { text: "📂 Joined (Past)", callback_data: "mglist:joined_past" }
        ],
        [{ text: "◀️ Back", callback_data: "main_menu" }]
      ]
    };
    const caption =
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   📂  <b>MY GIVEAWAYS</b>  📂\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `▸ Select a category below\n` +
      `▸ Manage, track &amp; share your events\n` +
      `▸ View live vote counts &amp; leaderboard` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`;
    await animFresh(chatId, msgId, caption, { reply_markup: kb });
    return;
  }

  // ─── My Giveaways sub-lists ───
  if (data.startsWith("mglist:")) {
    const cat = data.split(":")[1];
    let list = [];
    if (cat === "created_active") list = [...giveaways.values()].filter(g => g.creatorId === userId && g.active);
    else if (cat === "created_past") list = [...giveaways.values()].filter(g => g.creatorId === userId && !g.active);
    else if (cat === "joined_active") list = [...giveaways.values()].filter(g => g.participants.has(userId) && g.active);
    else if (cat === "joined_past") list = [...giveaways.values()].filter(g => g.participants.has(userId) && !g.active);

    const label = { created_active: "✍️ Created (Active)", created_past: "📋 Created (Past)", joined_active: "🤝 Joined (Active)", joined_past: "📂 Joined (Past)" }[cat];
    const icon = { created_active: "✍️", created_past: "📋", joined_active: "🤝", joined_past: "📂" }[cat];

    if (!list.length) {
      await animAction(chatId,
        `${icon} <b>${label}</b>\n\n` +
        `◆ ─────────────────── ◆\n\n` +
        `<blockquote>No giveaways in this category yet.\nCreate one or join an active giveaway!</blockquote>`,
        { reply_markup: backKeyboard("my_giveaways") }
      );
      return;
    }
    const btns = list.map(g => ([{
      text: `${g.active ? "🟢" : "🔴"} ${g.title}  ·  ${g.participants.size} 👥  ·  ${[...g.participants.values()].reduce((s, p) => s + p.votes, 0)} 🗳️`,
      callback_data: `mgmt:${g.id}`
    }]));
    btns.push([{ text: "◀️ Back", callback_data: "my_giveaways" }]);
    await animAction(chatId,
      `${icon} <b>${label}</b>\n\n` +
      `◆ ─────────────────── ◆\n` +
      `<i>${list.length} giveaway${list.length !== 1 ? "s" : ""} found</i>`,
      { reply_markup: { inline_keyboard: btns } }
    );
    return;
  }

  // ─── Management Panel ───
  if (data.startsWith("mgmt:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    await animLoading(chatId, msgId);
    const totalVotes = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
    const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;
    await bot.editMessageText(
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   ⚙️  <b>MANAGEMENT PANEL</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `📌 <b>${h(g.title)}</b>\n\n` +
      `<blockquote>` +
      `◈ Status        ▸  ${g.active ? "🟢 ACTIVE" : "🔴 ENDED"}\n` +
      `◈ Participants  ▸  <b>${g.participants.size}</b> 👥\n` +
      `◈ Total Votes   ▸  <b>${totalVotes}</b> 🗳️\n` +
      `◈ Paid Votes    ▸  ${g.paidVotesActive ? "🟢 ON" : "🔴 OFF"}\n` +
      `◈ Participation ▸  ${g.participationOpen ? "🟢 OPEN" : "🔴 CLOSED"}\n` +
      `◈ ID            ▸  <code>${gId}</code>` +
      `</blockquote>\n\n` +
      `🔗 <a href="${link}">▸ Participation Link</a>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: mgmtKeyboard(gId, g, (isVip(userId) || isAdmin(userId)) && g.creatorId === userId) }
    ).catch(() => {});
    return;
  }

  // ─── VIP: Set per-giveaway force join ───
  if (data.startsWith("set_gj:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g || g.creatorId !== userId) return;
    if (!isVip(userId) && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "👑 VIP Membership required for this feature!", show_alert: true }).catch(() => {});
      return;
    }
    userState.set(userId, { step: "set_giveaway_fj", gId, msgId });
    await bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  🔗  <b>SET FORCE JOIN</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `Users must join a specific channel before participating in this giveaway.\n\n` +
      `📝 Send the channel username or ID:\n` +
      `▸ <code>@YourChannel</code>\n` +
      `▸ <code>-1001234567890</code>` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML", reply_markup: backKeyboard(`mgmt:${gId}`) }
    );
    return;
  }

  // ─── VIP: Clear per-giveaway force join ───
  if (data.startsWith("clear_gj:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g || g.creatorId !== userId) return;
    g.extraForceJoin = null;
    await saveGiveaway(g);
    await bot.answerCallbackQuery(query.id, { text: "✅ Force join channel remove ho gaya!" }).catch(() => {});
    await bot.editMessageReplyMarkup(mgmtKeyboard(gId, g, true), { chat_id: chatId, message_id: msgId }).catch(() => {});
    return;
  }

  // ─── Leaderboard ───
  if (data.startsWith("lb:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    const totalVotesLb = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
    await animLeaderboard(chatId, msgId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   🏆  <b>LEADERBOARD</b>  🏆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `📌 <b>${h(g.title)}</b>\n` +
      `<i>👥 ${g.participants.size} participants  ·  🗳️ ${totalVotesLb} total votes</i>\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━◈━━━\n\n` +
      `${formatLeaderboard(g)}\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━◈━━━\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { reply_markup: backKeyboard(`mgmt:${gId}`) }
    );
    return;
  }

  // ─── Top Voters Result ───
  if (data.startsWith("topvoters:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) { await bot.answerCallbackQuery(query.id, { text: "❌ Giveaway not found!", show_alert: true }).catch(() => {}); return; }
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Only the giveaway creator can view this!", show_alert: true }).catch(() => {});
      return;
    }
    const parts = [...g.participants.values()].sort((a, b) => b.votes - a.votes);
    const totalVotes = parts.reduce((s, p) => s + p.votes, 0);
    const medals = ["🥇", "🥈", "🥉"];
    const rows = parts.slice(0, 15).map((p, i) => {
      const medal = i < 3 ? medals[i] : `${i + 1}.`;
      const name = h(p.name).slice(0, 16);
      const pad = "·".repeat(Math.max(2, 18 - name.length));
      return `${medal}  <b>${name}</b>  ${pad}  <code>${p.votes}</code> 🗳️`;
    });
    const text =
      `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ◆  <b>TOP PARTICIPANTS</b>  ◆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `📌 <b>${h(g.title)}</b>\n` +
      `<i>👥 ${g.participants.size} participants  ·  🗳️ ${totalVotes} total votes</i>\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━━◈━━━\n\n` +
      (rows.length ? rows.join("\n") : `<i>▸ No participants yet — share the link to get started!</i>`) +
      `\n\n━━━◈━━━━━━━━━━━━━━━━━◈━━━\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`;
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: `mgmt:${gId}` }]] }
    }).catch(() => {});
    return;
  }

  // ─── Toggle Paid Votes ───
  if (data.startsWith("toggle_paid:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true }).catch(() => {});
      return;
    }
    g.paidVotesActive = !g.paidVotesActive;
    await saveGiveaway(g);
    await bot.editMessageReplyMarkup(mgmtKeyboard(gId, g), { chat_id: chatId, message_id: msgId }).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: `Paid votes ${g.paidVotesActive ? "ON" : "OFF"}!` }).catch(() => {});
    return;
  }

  // ─── Toggle Participation ───
  if (data.startsWith("toggle_part:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true }).catch(() => {});
      return;
    }
    g.participationOpen = !g.participationOpen;
    await saveGiveaway(g);
    await bot.editMessageReplyMarkup(mgmtKeyboard(gId, g), { chat_id: chatId, message_id: msgId }).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: `Participation ${g.participationOpen ? "OPEN" : "CLOSED"}!` }).catch(() => {});
    return;
  }

  // ─── End Giveaway ───
  if (data.startsWith("end_giveaway:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true }).catch(() => {});
      return;
    }
    g.active = false; g.participationOpen = false; g.paidVotesActive = false;
    await saveGiveaway(g);

    await animLoading(chatId, msgId);
    await announceWinners(g, gId, g.creatorId);

    const parts = [...g.participants.values()].sort((a, b) => b.votes - a.votes);
    const totalVotes = parts.reduce((s, p) => s + p.votes, 0);
    const top3lines = parts.slice(0, 3).map((p, i) => {
      const medals = ["🥇", "🥈", "🥉"];
      return `${medals[i]}  <b>${h(p.name)}</b>  ·  <code>${p.votes}</code> 🗳️`;
    }).join("\n") || `<i>▸ No votes yet</i>`;

    await bot.editMessageText(
      `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  🏁  <b>GIVEAWAY ENDED!</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `📌 <b>${h(g.title)}</b>\n\n` +
      `<blockquote>` +
      `◈ Status       ▸  🔴 ENDED\n` +
      `◈ Participants ▸  <b>${g.participants.size}</b> 👥\n` +
      `◈ Total Votes  ▸  <b>${totalVotes}</b> 🗳️` +
      `</blockquote>\n\n` +
      `━━━◈ 🏆 TOP WINNERS ◈━━━\n\n` +
      `${top3lines}\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━━◈━━━\n` +
      `✅ <i>Winner cards sent to channel &amp; DMs!</i>\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🏆 Full Leaderboard", callback_data: `lb:${gId}` }],
            [{ text: "◀️ My Giveaways", callback_data: "my_giveaways" }]
          ]
        }
      }
    ).catch(() => {});
    return;
  }

  // ─── Clear Channel Posts ───
  if (data.startsWith("clear_posts:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g || !g.channelId) return;
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true }).catch(() => {});
      return;
    }
    let cleared = 0;
    for (const p of g.participants.values()) {
      if (p.channelMsgId) {
        try { await bot.deleteMessage(g.channelId, p.channelMsgId); cleared++; } catch {}
        p.channelMsgId = null;
      }
    }
    await saveGiveaway(g);
    await bot.answerCallbackQuery(query.id, { text: `${cleared} posts delete kiye!`, show_alert: true }).catch(() => {});
    return;
  }

  // ─── Confirm Join (participant) ───
  if (data.startsWith("confirm_join:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (!g.participationOpen) {
      await bot.answerCallbackQuery(query.id, { text: "Participation band hai!", show_alert: true }).catch(() => {});
      return;
    }

    // ── Duplicate join guard ──
    if (g.participants.has(userId)) {
      const existing = g.participants.get(userId);
      const chLink = existing.channelMsgId && g.channelId
        ? `https://t.me/c/${String(g.channelId).replace("-100", "")}/${existing.channelMsgId}`
        : null;
      await bot.answerCallbackQuery(query.id, { text: "You are already a participant in this giveaway!", show_alert: true }).catch(() => {});
      await bot.editMessageText(
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
        `  ◆  <b>ALREADY JOINED</b>  ◆\n` +
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
        `📌 <b>${h(g.title)}</b>\n\n` +
        `<blockquote>` +
        `◈ Votes Now  ▸  <b>${existing.votes}</b>\n` +
        (chLink ? `◈ Vote Card  ▸  <a href="${chLink}">View in Channel</a>\n` : "") +
        `◈ Status     ▸  🟢 Active` +
        `</blockquote>\n\n` +
        `◈ <i>Share your link to collect more votes!</i>\n` +
        `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
        {
          chat_id: chatId, message_id: msgId, parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }],
              [{ text: "🔄 Get Links Again", callback_data: `my_links:${gId}` }]
            ]
          }
        }
      ).catch(() => {});
      return;
    }

    const userName = (query.from.first_name || "") + (query.from.last_name ? ` ${query.from.last_name}` : "");
    const userHandle = query.from.username ? `@${query.from.username}` : "@NoUser";

    const participant = {
      id: userId, name: userName, handle: userHandle,
      votes: 0, voters: new Set(), channelMsgId: null
    };
    g.participants.set(userId, participant);

    let channelMsgId = null;
    if (g.channelId) {
      try {
        const sentMsg = await bot.sendPhoto(
          g.channelId,
          GIVEAWAY_IMAGE_URL,
          {
            caption: participantChannelText(participant, g),
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{
                text: `🗳️ Vote  ·  0`,
                callback_data: `ch_vote:${gId}:${userId}`
              }]]
            }
          }
        );
        channelMsgId = sentMsg.message_id;
        participant.channelMsgId = channelMsgId;
        participant.channelMsgIsPhoto = true;
        await notifyAdmin(
          `👤 <b>New Participant</b>\n` +
          `User: <b>${h(userName)}</b> (<code>${userId}</code>)\n` +
          `Giveaway: <b>${h(g.title)}</b>`
        );
      } catch (e) { console.error("Channel post error:", e.message); }
    }

    await saveGiveaway(g);

    const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;
    const chLink = g.channelId && channelMsgId
      ? `https://t.me/c/${String(g.channelId).replace("-100", "")}/${channelMsgId}`
      : null;

    // Build channel open URL — public: @username, private: t.me/c/ID
    const chOpenUrl = g.channelId
      ? (g.channelUsername ? `https://t.me/${g.channelUsername}` : `https://t.me/c/${String(g.channelId).replace("-100", "")}`)
      : null;

    // Build keyboard — channel open button always shows if channel is set
    const joinKb = [];
    if (chOpenUrl) joinKb.push([{ text: "📢 Open Channel", url: chOpenUrl }]);
    joinKb.push([{ text: "📋 Copy Vote Link", switch_inline_query: link }]);
    joinKb.push([{ text: "💰 Buy Paid Votes", callback_data: `buy_votes:${gId}` }]);
    joinKb.push([{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }]);
    joinKb.push([{ text: "🔄 Get Links Again", callback_data: `my_links:${gId}` }]);

    await animSuccess(chatId, msgId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ◆  <b>YOU'RE IN</b>  ◆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `📌 <b>${h(g.title)}</b>\n\n` +
      `<blockquote>` +
      (chLink ? `🃏 Vote Card ▸  <a href="${chLink}">View My Card</a>\n` : "") +
      `🗳️ Votes     ▸  <b>0</b> <i>(grow by sharing!)</i>\n` +
      `⚡ Status    ▸  🟢 Active` +
      `</blockquote>\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━◈━━━\n` +
      `◈ <i>Share your link to collect more votes!</i>\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { reply_markup: { inline_keyboard: joinKb } }
    );
    return;
  }

  // ─── Channel Vote Button ───
  if (data.startsWith("ch_vote:")) {
    const parts = data.split(":");
    const gId = parts[1];
    const participantUserId = Number(parts[2]);
    const g = getGiveaway(gId);

    if (!g || !g.active) {
      await bot.answerCallbackQuery(query.id, { text: "⛔ Voting is not active for this giveaway!", show_alert: true }).catch(() => {});
      return;
    }
    if (g.channelId) {
      const member = await isMember(g.channelId, userId);
      if (!member) {
        await bot.answerCallbackQuery(query.id, { text: "⚠️ You must join the channel before voting!", show_alert: true }).catch(() => {});
        return;
      }
    }
    if (userId === participantUserId) {
      await bot.answerCallbackQuery(query.id, {
        text: "⛔ DENIED — You cannot vote for yourself!",
        show_alert: true
      }).catch(() => {});
      // Big photo warning — same style as welcome screen
      try {
        const denyPhoto = await bot.sendPhoto(userId, GIVEAWAY_IMAGE_URL, {
          caption: `◈`,
          parse_mode: "HTML",
          has_spoiler: true
        });
        const dmid = denyPhoto.message_id;
        await sleep(250);
        await bot.editMessageCaption(`⛔ ─── ◆`, { chat_id: userId, message_id: dmid, parse_mode: "HTML" }).catch(() => {});
        await sleep(220);
        await bot.editMessageCaption(`◆  <b>VOTE DENIED</b>  ◆`, { chat_id: userId, message_id: dmid, parse_mode: "HTML" }).catch(() => {});
        await sleep(350);
        await bot.editMessageCaption(
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `   ⛔  <b>VOTE DENIED</b>  ⛔\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `<blockquote>` +
          `<b>You cannot vote for yourself.</b>\n\n` +
          `Share your vote link with friends and ask\n` +
          `them to tap the Vote button on your post.\n\n` +
          `◈ Votes ▸  <b>${g.participants.get(participantUserId)?.votes ?? 0}</b>` +
          `</blockquote>\n\n` +
          `✦ ─── <b>@${BOT_USERNAME}</b> ─── ✦`,
          {
            chat_id: userId, message_id: dmid, parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "📋 Share My Vote Link", switch_inline_query: `https://t.me/${BOT_USERNAME}?start=${g.id}` }
              ]]
            }
          }
        ).catch(() => {});
      } catch {}
      return;
    }

    const participant = g.participants.get(participantUserId);
    if (!participant) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Participant not found!", show_alert: true }).catch(() => {});
      return;
    }

    const voterName = (query.from.first_name || "") + (query.from.last_name ? ` ${query.from.last_name}` : "");
    const existingVote = g.voterMap?.get(userId);

    // ── TOGGLE: same participant clicked again → remove vote ──
    if (existingVote === participantUserId) {
      participant.votes = Math.max(0, participant.votes - 1);
      participant.voters.delete(userId);
      g.voterMap.delete(userId);
      await saveGiveaway(g);
      await updateChannelPost(g, participant);
      await bot.answerCallbackQuery(query.id, {
        text:
          `◈ VOTE REMOVED ◈\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `FOR    ▸ ${participant.name}\n` +
          `TOTAL  ▸ ${participant.votes} votes\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `Tap again to re-vote. ⚡ @${BOT_USERNAME}`,
        show_alert: true
      }).catch(() => {});
      return;
    }

    // ── SWITCH: voted for someone else → remove old vote first ──
    if (existingVote) {
      const oldP = g.participants.get(existingVote);
      if (oldP) {
        oldP.votes = Math.max(0, oldP.votes - 1);
        oldP.voters.delete(userId);
        await updateChannelPost(g, oldP);
      }
    }

    // ── CAST new vote ──
    if (!g.voterMap) g.voterMap = new Map();
    participant.votes += 1;
    participant.voters.add(userId);
    g.voterMap.set(userId, participantUserId);

    // Save and update channel post BEFORE answerCallbackQuery
    await saveGiveaway(g);
    await updateChannelPost(g, participant);

    await notifyAdmin(
      `🗳️ <b>Vote Cast</b>\n` +
      `From: <b>${h(voterName)}</b> (<code>${userId}</code>)\n` +
      `For: <b>${h(participant.name)}</b>\n` +
      `Giveaway: <b>${h(g.title)}</b>\n` +
      `Total votes: <b>${participant.votes}</b>`
    );

    // ── Vote panel / rapid-vote detection ──
    {
      const velKey = `${gId}:${participantUserId}`;
      const PANEL_THRESHOLD = 15;  // votes within window
      const PANEL_WINDOW_MS = 90 * 1000; // 90 seconds
      const now = Date.now();
      let vel = voteVelocity.get(velKey) || { count: 0, windowStart: now, alerted: false };
      if (now - vel.windowStart > PANEL_WINDOW_MS) {
        vel = { count: 1, windowStart: now, alerted: false };
      } else {
        vel.count += 1;
      }
      voteVelocity.set(velKey, vel);

      if (vel.count >= PANEL_THRESHOLD && !vel.alerted) {
        vel.alerted = true;
        voteVelocity.set(velKey, vel);

        const alertText =
          `🚨 <b>VOTE PANEL DETECTED!</b>\n\n` +
          `<blockquote>` +
          `◈ Giveaway   ▸  <b>${h(g.title)}</b> (<code>${gId}</code>)\n` +
          `◈ Participant ▸  <b>${h(participant.name)}</b> (<code>${participantUserId}</code>)\n` +
          `◈ Votes Now  ▸  <b>${participant.votes}</b>\n` +
          `◈ Last 90s   ▸  +<b>${vel.count} votes</b> (suspicious spike!)\n\n` +
          `Koi vote panel/service use kar raha hai. Action lo:` +
          `</blockquote>`;

        const alertMarkup = {
          inline_keyboard: [
            [
              { text: "➖ Votes Minus Karo", callback_data: `panel_minus:${gId}:${participantUserId}` },
              { text: "🗑️ Hatao Participant", callback_data: `panel_remove:${gId}:${participantUserId}` }
            ],
            [
              { text: "🚫 Ban + Remove", callback_data: `panel_ban:${gId}:${participantUserId}` },
              { text: "⚠️ Warn Karo", callback_data: `panel_warn:${gId}:${participantUserId}` }
            ],
            [{ text: "✅ Dismiss (Ignore)", callback_data: `panel_dismiss:${gId}:${participantUserId}` }]
          ]
        };

        const notifySet = new Set([MAIN_ADMIN_ID]);
        if (g.creatorId) notifySet.add(g.creatorId);
        for (const target of notifySet) {
          try {
            await bot.sendMessage(target, alertText, { parse_mode: "HTML", reply_markup: alertMarkup });
          } catch (e) { console.error(`Panel alert to ${target}:`, e.message); }
        }
      }
    }

    await bot.answerCallbackQuery(query.id, {
      text:
        `◈ VOTE CAST ◈\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `FROM   ▸ ${voterName}\n` +
        `FOR    ▸ ${participant.name}\n` +
        `TOTAL  ▸ ${participant.votes} votes\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `⚡ @${BOT_USERNAME}`,
      show_alert: true
    }).catch(() => {});
    return;
  }

  // ─── Buy Paid Votes ───
  if (data.startsWith("buy_votes:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (!g.paidVotesActive) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Paid votes are not available for this giveaway.", show_alert: true }).catch(() => {});
      return;
    }

    const btns = [];
    if (g.paymentMode === "inr" || g.paymentMode === "both")
      btns.push([{ text: "🇮🇳 Pay via INR/UPI (QR)", callback_data: `pay_inr:${gId}` }]);
    if (g.paymentMode === "stars" || g.paymentMode === "both")
      btns.push([{ text: "⭐ Pay via Telegram Stars", callback_data: `pay_stars:${gId}` }]);
    btns.push([{ text: "◀️ Back", callback_data: `my_links:${gId}` }]);

    await animLoading(chatId, msgId);
    await bot.editMessageText(
      `💰 <b>BUY PAID VOTES</b>\n` +
      `<i>${h(g.title)}</i>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<blockquote>` +
      (g.paymentMode === "inr" || g.paymentMode === "both" ? `🇮🇳 INR Rate  :  ${g.votesPerInr} votes / ₹1\n` : "") +
      (g.paymentMode === "stars" || g.paymentMode === "both" ? `⭐ Stars Rate :  ${g.votesPerStar} votes / 1 ⭐` : "") +
      `</blockquote>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Choose your payment method:`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: btns } }
    ).catch(() => {});
    return;
  }

  // ─── Pay INR ───
  if (data.startsWith("pay_inr:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g?.qrFileId) {
      await bot.answerCallbackQuery(query.id, { text: "❌ INR payment is not set up for this giveaway!", show_alert: true }).catch(() => {});
      return;
    }
    userState.set(userId, { step: "awaiting_inr_screenshot", giveawayId: gId });
    try {
      await bot.sendPhoto(chatId, g.qrFileId, {
        caption:
          `🇮🇳 <b>PAY VIA UPI/QR</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `<blockquote>◈ Rate: <b>${g.votesPerInr} Votes</b> per ₹1\n` +
          (g.upiId ? `◈ UPI ID: <code>${h(g.upiId)}</code>\n` : "") +
          `\nSteps:\n1️⃣ Scan the QR code above\n2️⃣ Pay your desired amount\n` +
          (g.upiId ? `   (or send directly to UPI ID above)\n` : "") +
          `3️⃣ Take screenshot of payment\n4️⃣ Send screenshot here ↓</blockquote>\n` +
          `━━━━━━━━━━━━━━━━━━━━`,
        parse_mode: "HTML"
      });
    } catch (e) { console.error("QR send error:", e.message); }
    await bot.sendMessage(chatId,
      `📸 <b>Send your payment screenshot</b> (as a photo, not a file):`,
      { parse_mode: "HTML", reply_markup: backKeyboard(`buy_votes:${gId}`) }
    );
    return;
  }

  // ─── Pay Stars ───
  if (data.startsWith("pay_stars:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    const participant = g.participants.get(userId);
    if (!participant) {
      await bot.answerCallbackQuery(query.id, { text: "❌ You must join the giveaway first!", show_alert: true }).catch(() => {});
      return;
    }
    userState.set(userId, { step: "awaiting_stars_quantity", giveawayId: gId });
    await bot.answerCallbackQuery(query.id).catch(() => {});
    await bot.sendMessage(chatId,
      `⭐ <b>BUY VOTES WITH STARS</b>\n` +
      `<i>${h(g.title)}</i>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<blockquote>◈ Rate: <b>${g.votesPerStar} votes</b> per 1 ⭐ Star\n\n` +
      `How many Stars do you want to spend?\n\nExample: <code>5</code> → 5 ⭐ = ${g.votesPerStar * 5} votes</blockquote>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📝 <b>Type the number of Stars below:</b>`,
      { parse_mode: "HTML", reply_markup: backKeyboard(`buy_votes:${gId}`) }
    );
    return;
  }

  // ─── My Links ───
  if (data.startsWith("my_links:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    const participant = g.participants.get(userId);
    const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;
    const chLink = participant?.channelMsgId && g.channelId
      ? `https://t.me/c/${String(g.channelId).replace("-100", "")}/${participant.channelMsgId}`
      : null;
    await bot.editMessageText(
      `🔗 <b>YOUR LINKS</b>\n` +
      `<i>${h(g.title)}</i>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<blockquote>◈ Votes Now  :  <b>${participant?.votes ?? 0}</b> 🗳️\n` +
      (chLink ? `◈ Vote Card  :  <a href="${chLink}">View in Channel</a>\n` : "") +
      `\n📌 Share this link:\n<code>${link}</code></blockquote>\n` +
      `━━━━━━━━━━━━━━━━━━━━`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Copy Vote Link", switch_inline_query: link }],
            [{ text: "💰 Buy Paid Votes", callback_data: `buy_votes:${gId}` }],
            [{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }]
          ]
        }
      }
    ).catch(() => {});
    return;
  }

  // ─── How to Use ───
  if (data === "how_to_use") {
    await animFresh(chatId, msgId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   ❓  <b>GUIDE &amp; HELP</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `1️⃣  <b>Make the Bot a Channel Admin</b>\n` +
      `     Add bot ▸ Grant admin rights\n\n` +
      `2️⃣  <b>Create a Giveaway</b>\n` +
      `     Title ▸ Channel ▸ End Type ▸ Time\n` +
      `     Paid Votes ▸ Currency ▸ QR ▸ Rates\n\n` +
      `3️⃣  <b>Participants Join via Link</b>\n` +
      `     Share the link ▸ User clicks it\n` +
      `     Joins channel ▸ Confirms entry\n` +
      `     Auto: Vote card is posted on channel!\n\n` +
      `4️⃣  <b>Voting (on the Channel Card)</b>\n` +
      `     Press the "🗳️ Vote" button\n` +
      `     ⚠️ Only channel members can vote\n\n` +
      `5️⃣  <b>Auto Vote Deduction</b>\n` +
      `     Leave channel ▸ votes auto-removed\n` +
      `     Participant receives an alert too` +
      `</blockquote>\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━◈━━━\n` +
      `💡 <i>To get a Channel ID, use: @getidsbot</i>\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { reply_markup: backKeyboard() }
    );
    return;
  }

  // ─── Add Channel / Group ───
  if (data === "add_channel" || data === "add_group") {
    const type = data === "add_channel" ? "channel" : "group";
    userState.set(userId, { step: "reg_chat", type });
    await animFresh(chatId, msgId,
      `<b>➕ Add ${type === "channel" ? "Channel" : "Group"}</b>\n\n` +
      `Send the ${type === "channel" ? "channel" : "group"} ID:\n<i>Example: -1001234567890</i>\n\n` +
      `<b>Note:</b> First make the bot an admin in the ${type === "channel" ? "channel" : "group"}.\n` +
      `Or simply add the bot — it registers automatically.`,
      { reply_markup: backKeyboard() }
    );
    return;
  }

  // ─── VIP Membership ───
  if (data === "vip_membership") {
    const badge = membershipBadge(userId);
    const m = getMembership(userId);
    const featuresText =
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   👑  <b>VIP MEMBERSHIP</b>\n` +
      `   ${badge}\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      (m
        ? `<blockquote>✅ <b>You are a VIP Member!</b>\n\n📅 <b>Shuru:</b>  ${safeFormatDateTime(m.startedAt)}\n⏳ <b>Khatam:</b> ${safeFormatDateTime(m.expiry)}\n⏱️ <b>Baki:</b>   ${timeRemaining(m.expiry)}</blockquote>\n\n`
        : `<blockquote>🔓 Upgrade now to unlock full power of DRS Bot!</blockquote>\n\n`) +
      `━━━◈ <b>PREMIUM FEATURES</b> ◈━━━\n\n` +
      `<blockquote>` +
      `▸ Custom thumbnail on vote post image\n\n` +
      `▸ Auto vote-deduction on channel leave 🧿\n\n` +
      `▸ 1 extra Force-Join channel before voting\n\n` +
      `▸ 1 global Force-Join for all bot users\n  <i>(Requires minimum 7-day membership)</i>` +
      `</blockquote>\n\n` +
      `━━━◈ <b>PLANS</b> ◈━━━\n\n` +
      `<blockquote>` +
      buildPlansText() +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`;

    const kb = m
      ? { inline_keyboard: [[{ text: "◀️ Back", callback_data: "main_menu" }]] }
      : { inline_keyboard: buildPlanButtons() };

    await animFresh(chatId, msgId, featuresText, { reply_markup: kb });
    return;
  }

  // ─── Buy Membership (INR plan) ───
  if (data.startsWith("buy_mem:")) {
    const planKey = data.split(":")[1];
    const plan = getMembershipPlan(planKey);
    if (!plan) return;

    if (!membershipQrFileId) {
      await bot.answerCallbackQuery(query.id, {
        text: "❌ Payment QR is not configured yet. Please contact admin.",
        show_alert: true
      }).catch(() => {});
      return;
    }

    const payId = String(membershipPayCounter++);
    const memData = { userId, planKey, timestamp: new Date() };
    pendingMembershipPayments.set(payId, memData);
    try {
      await PendingMembershipModel.create({ payId, ...memData });
    } catch (e) {
      console.error("PendingMembership create error:", e.message);
      pendingMembershipPayments.delete(payId);
      await bot.answerCallbackQuery(query.id, { text: "❌ Server error. Please try again.", show_alert: true }).catch(() => {});
      return;
    }

    try {
      await bot.sendPhoto(chatId, membershipQrFileId, {
        caption:
          `💳 <b>Purchase ${plan.label} Membership</b>\n\n` +
          `🧾 <b>Amount: ₹${plan.price}</b>\n\n` +
          `Scan and pay exactly this amount.\n\n` +
          `Payment ID: <code>${payId}</code>`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ I've Paid", callback_data: `mem_paid:${payId}` },
              { text: "Cancel", callback_data: "vip_membership" }
            ]
          ]
        }
      });
    } catch (e) {
      console.error("Membership QR send error:", e.message);
      await bot.sendMessage(chatId, "❌ Failed to send QR code. Please contact admin.", { parse_mode: "HTML" });
    }
    return;
  }

  // ─── I've Paid (Membership) — ask for screenshot ───
  if (data.startsWith("mem_paid:")) {
    const payId = data.split(":")[1];
    const pending = pendingMembershipPayments.get(payId);
    if (!pending) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Payment session expired. Please try again.", show_alert: true }).catch(() => {});
      return;
    }
    const plan = getMembershipPlan(pending.planKey);
    await bot.answerCallbackQuery(query.id, { text: "✅ Now send your screenshot!" }).catch(() => {});
    // Remove the buttons from the QR message
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: msgId }
    ).catch(() => {});
    // Set state BEFORE sending the prompt message
    userState.set(userId, { step: "awaiting_membership_screenshot", payId });
    // Send a clear new message asking for screenshot
    await bot.sendMessage(chatId,
      `📸 <b>Send Screenshot</b>\n\n` +
      `<blockquote>` +
      `◈ Plan    ▸  <b>${plan?.label || pending.planKey}</b>\n` +
      `◈ Amount  ▸  <b>₹${plan?.price || "?"}</b>\n` +
      `◈ Pay ID  ▸  <code>${payId}</code>` +
      `</blockquote>\n\n` +
      `Send your payment screenshot <b>as a photo</b> (not a file).\n` +
      `Admin will verify and activate your membership. ✅`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ─── Admin: Support Ticket — Resolved / Not Resolved ───
  if (data.startsWith("sup_resolve:") || data.startsWith("sup_pending:")) {
    if (!isAdmin(userId)) return;
    const isResolved = data.startsWith("sup_resolve:");
    const targetUserId = Number(data.split(":")[1]);

    if (isResolved) {
      // Edit the admin's message to remove buttons and mark resolved
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: "✅ RESOLVED", callback_data: "noop" }]] },
        { chat_id: chatId, message_id: msgId }
      ).catch(() => {});
      await bot.answerCallbackQuery(query.id, { text: "✅ Marked as Resolved", show_alert: false }).catch(() => {});

      // Notify the user
      try {
        await bot.sendMessage(targetUserId,
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `  ✅  <b>ISSUE RESOLVED</b>\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `<blockquote>` +
          `Aapka support request <b>resolve kar diya gaya hai</b>.\n\n` +
          `Agar aur koi problem ho toh /support pe dubara message karein. 🙏` +
          `</blockquote>\n\n` +
          `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
        );
      } catch (e) { console.error("Support resolve notify:", e.message); }
    } else {
      // Not resolved — just acknowledge admin and keep buttons
      await bot.answerCallbackQuery(query.id, { text: "❌ Marked as Not Resolved", show_alert: false }).catch(() => {});
      // Optionally notify user that we're still working on it
      try {
        await bot.sendMessage(targetUserId,
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `  ⏳  <b>WORKING ON IT</b>\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `<blockquote>` +
          `Aapka issue abhi bhi review mein hai.\n\n` +
          `Admin se directly contact karein:\n` +
          `📩 <b>@drssupport</b>` +
          `</blockquote>\n\n` +
          `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
          { parse_mode: "HTML" }
        );
      } catch (e) { console.error("Support pending notify:", e.message); }
    }
    return;
  }

  // ─── Admin: Approve Membership ───
  if (data.startsWith("approve_mem:")) {
    if (!isAdmin(userId)) return;
    const payId = data.split(":")[1];
    const pending = pendingMembershipPayments.get(payId);
    if (!pending) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Payment not found or already processed.", show_alert: true }).catch(() => {});
      return;
    }
    const plan = getMembershipPlan(pending.planKey);
    if (!plan) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Plan configuration not found. Contact admin.", show_alert: true }).catch(() => {});
      return;
    }
    pendingMembershipPayments.delete(payId);
    await PendingMembershipModel.deleteOne({ payId });

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + plan.days);
    const vipData = { vip: true, plan: plan.label, expiry, startedAt: new Date(), days: plan.days };
    vipUsers.set(pending.userId, vipData);
    await saveVip(pending.userId, vipData);

    await bot.answerCallbackQuery(query.id, { text: `✅ Membership approved — ${plan.label}!` }).catch(() => {});
    await bot.editMessageText(
      `✅ <b>Membership Approved!</b>\nPayment ID: <code>${payId}</code> | Plan: ${plan.label} | User: <code>${pending.userId}</code>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});
    const appu = botUsers.get(pending.userId);
    await notifyAdmin(
      `✅ <b>Membership Approved</b>\n` +
      `<blockquote>` +
      `◈ User    ▸  <b>${appu?.firstName ? h(appu.firstName) : "Unknown"}</b>${appu?.username ? ` (@${appu.username})` : ""}\n` +
      `◈ User ID ▸  <code>${pending.userId}</code>\n` +
      `◈ Plan    ▸  <b>${plan.label}</b>\n` +
      `◈ Shuru  ▸  ${safeFormatDateTime(new Date())}\n` +
      `◈ Khatam ▸  ${safeFormatDateTime(expiry)}` +
      `</blockquote>`
    );
    try {
      await bot.sendMessage(pending.userId,
        `<b>🎊 Membership Activated!</b>\n\n` +
        `⭐ Plan: <b>${plan.label}</b>\n` +
        `📅 Shuru:  <b>${safeFormatDateTime(new Date())}</b>\n` +
        `⏳ Khatam: <b>${safeFormatDateTime(expiry)}</b>\n` +
        `⏱️ Baki:   <b>${timeRemaining(expiry)}</b>\n\n` +
        `Premium features ab available hain!`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "👑 My Membership", callback_data: "vip_membership" }]] } }
      );
    } catch {}
    return;
  }

  // ─── Admin: Reject Membership ───
  if (data.startsWith("reject_mem:")) {
    if (!isAdmin(userId)) return;
    const payId = data.split(":")[1];
    const pending = pendingMembershipPayments.get(payId);
    if (!pending) return;
    pendingMembershipPayments.delete(payId);
    await PendingMembershipModel.deleteOne({ payId });
    await bot.answerCallbackQuery(query.id, { text: "Payment rejected." }).catch(() => {});
    await bot.editMessageText(
      `❌ <b>Membership Rejected</b>\nPayment ID: <code>${payId}</code>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});
    const rjpu = botUsers.get(pending.userId);
    await notifyAdmin(
      `❌ <b>Membership Rejected</b>\n` +
      `<blockquote>` +
      `◈ User    ▸  <b>${rjpu?.firstName ? h(rjpu.firstName) : "Unknown"}</b>${rjpu?.username ? ` (@${rjpu.username})` : ""}\n` +
      `◈ User ID ▸  <code>${pending.userId}</code>\n` +
      `◈ Pay ID  ▸  <code>${payId}</code>` +
      `</blockquote>`
    );
    try {
      await bot.sendMessage(pending.userId,
        `<b>❌ Membership Payment Rejected</b>\n\nPayment ID: <code>${payId}</code>\n\nYour payment could not be verified. Please try again or contact @drssupport.`,
        { parse_mode: "HTML" }
      );
    } catch {}
    return;
  }

  // ─── Skip custom photo → finish giveaway creation ───
  if (data === "skip_custom_photo") {
    const st = userState.get(userId);
    if (st?.step === "giveaway_custom_photo") {
      await bot.answerCallbackQuery(query.id, { text: "Default image use hogi." }).catch(() => {});
      await finishGiveawayCreation(userId, chatId, st.qrFileId);
    }
    return;
  }

  // ─── Toggle membership permission (button UI) ───
  if (data.startsWith("toggle_perm:")) {
    if (!isAdmin(userId)) return;
    const parts = data.split(":");
    const targetId = Number(parts[1]);
    const perm = parts[2];
    if (!VALID_PERMS[perm]) return;
    const v = vipUsers.get(targetId);
    if (!v) {
      await bot.answerCallbackQuery(query.id, { text: "❌ VIP record not found for this user.", show_alert: true }).catch(() => {});
      return;
    }
    const current = getUserPerm(targetId, perm);
    const newVal = !current;
    const newPerms = { ...(v.perms || {}), [perm]: newVal };
    const updated = { ...v, perms: newPerms };
    vipUsers.set(targetId, updated);
    await saveVip(targetId, updated);
    await bot.answerCallbackQuery(query.id, { text: `${VALID_PERMS[perm]}: ${newVal ? "✅ ON" : "❌ OFF"}` }).catch(() => {});

    // Rebuild the permissions keyboard and update message
    const bu = botUsers.get(targetId);
    const buName = bu?.firstName ? h(bu.firstName) : `User ${targetId}`;
    const buHandle = bu?.username ? `@${bu.username}` : `ID: ${targetId}`;
    const permKeys = Object.keys(VALID_PERMS);
    const permButtons = permKeys.map(key => {
      const allowed = getUserPerm(targetId, key);
      return [{ text: `${allowed ? "✅" : "❌"} ${VALID_PERMS[key]}`, callback_data: `toggle_perm:${targetId}:${key}` }];
    });
    permButtons.push([{ text: "🔄 Reset All (Enable All)", callback_data: `reset_perms:${targetId}` }]);
    permButtons.push([{ text: "◀️ Done", callback_data: "main_menu" }]);
    const caption =
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `  🔐  <b>PERMISSIONS</b>\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
      `👤 <b>${buName}</b> (${buHandle})\n` +
      `◈ User ID ▸  <code>${targetId}</code>\n` +
      `◈ Plan    ▸  ${v.plan || "VIP"}\n\n` +
      `<i>Tap a button to toggle that permission:</i>`;
    await bot.editMessageText(caption, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: permButtons }
    }).catch(() => {});
    return;
  }

  // ─── Reset all permissions for user ───
  if (data.startsWith("reset_perms:")) {
    if (!isAdmin(userId)) return;
    const targetId = Number(data.split(":")[1]);
    const v = vipUsers.get(targetId);
    if (!v) return;
    const updated = { ...v, perms: {} };
    vipUsers.set(targetId, updated);
    await saveVip(targetId, updated);
    await bot.answerCallbackQuery(query.id, { text: "✅ All permissions reset (all enabled)." }).catch(() => {});

    const bu = botUsers.get(targetId);
    const buName = bu?.firstName ? h(bu.firstName) : `User ${targetId}`;
    const buHandle = bu?.username ? `@${bu.username}` : `ID: ${targetId}`;
    const permKeys = Object.keys(VALID_PERMS);
    const permButtons = permKeys.map(key => ([{ text: `✅ ${VALID_PERMS[key]}`, callback_data: `toggle_perm:${targetId}:${key}` }]));
    permButtons.push([{ text: "🔄 Reset All (Enable All)", callback_data: `reset_perms:${targetId}` }]);
    permButtons.push([{ text: "◀️ Done", callback_data: "main_menu" }]);
    const caption =
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `  🔐  <b>PERMISSIONS</b>\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
      `👤 <b>${buName}</b> (${buHandle})\n` +
      `◈ User ID ▸  <code>${targetId}</code>\n` +
      `◈ Plan    ▸  ${v.plan || "VIP"}\n\n` +
      `<i>✅ All permissions reset to enabled.</i>`;
    await bot.editMessageText(caption, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: permButtons }
    }).catch(() => {});
    return;
  }

  // ─── Create Post ───
  if (data === "create_post") {
    await animLoading(chatId, msgId);
    const myChannels = [...registeredChannels.entries()].filter(([, c]) => c.addedBy === userId || isAdmin(userId));
    if (!myChannels.length) {
      await replyToCallback(chatId, msgId,
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
        `  ◆  <b>CREATE POST</b>  ◆\n` +
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
        `<blockquote>◈ No registered channels found.\n\n` +
        `Add the bot as <b>Admin</b> to your channel first —\n` +
        `it will be automatically registered.</blockquote>\n\n` +
        `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
        { reply_markup: backKeyboard() }
      );
      return;
    }
    if (myChannels.length === 1) {
      const [[chId, ch]] = myChannels;
      userState.set(userId, { step: "cp_compose", channelId: chId, channelTitle: ch.title, channelUsername: ch.username || null });
      await replyToCallback(chatId, msgId, cpComposePrompt(ch.title, ch.username, chId), { reply_markup: cancelKeyboard() });
      return;
    }
    // Multiple channels — show selection
    const chButtons = myChannels.map(([chId, ch]) => [{
      text: `${ch.type === "channel" ? "📢" : "🏘️"}  ${ch.title.slice(0, 28)}`,
      callback_data: `cp_ch:${chId}`
    }]);
    chButtons.push([{ text: "❌ Cancel", callback_data: "cancel_flow" }]);
    await replyToCallback(chatId, msgId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ◆  <b>CREATE POST</b>  ◆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>Which channel do you want to post to?\nSelect one below:</blockquote>`,
      { reply_markup: { inline_keyboard: chButtons } }
    );
    return;
  }

  // ─── Create Post — Channel Selected ───
  if (data.startsWith("cp_ch:")) {
    const chId = data.split(":")[1];
    const ch = registeredChannels.get(chId);
    if (!ch) return;
    if (ch.addedBy !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Access denied!", show_alert: true }).catch(() => {});
      return;
    }
    userState.set(userId, { step: "cp_compose", channelId: chId, channelTitle: ch.title, channelUsername: ch.username || null });
    await bot.editMessageText(cpComposePrompt(ch.title, ch.username, chId), {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: cancelKeyboard()
    }).catch(() => {});
    return;
  }

  // ─── Channel select from registered list ───
  if (data.startsWith("sel_ch:")) {
    const chId = data.split(":")[1];
    const state = userState.get(userId);
    if (!state || state.step !== "pick_channel") return;
    const ch = registeredChannels.get(chId);
    state.channelId = chId;
    state.channelTitle = ch?.title;
    state.channelUsername = ch?.username || null;
    state.step = "end_type";
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `<b>⏳ Giveaway Ending Configuration</b>\n\n` +
      `🤖 <b>Automatic:</b> Ends automatically at a specific time.\n` +
      `✋ <b>Manual:</b> You stop it manually using the panel.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🤖 Automatic End", callback_data: "end_auto" },
              { text: "✋ Manual End", callback_data: "end_manual" }
            ],
            [{ text: "◀️ Back", callback_data: "cancel_flow" }]
          ]
        }
      }
    );
    return;
  }

  if (data === "ch_manual") {
    const state = userState.get(userId);
    if (!state) return;
    state.channelId = null;
    state.step = "end_type";
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `<b>⏳ Giveaway Ending Configuration</b>\n\n🤖 Automatic or ✋ Manual?`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🤖 Automatic End", callback_data: "end_auto" },
              { text: "✋ Manual End", callback_data: "end_manual" }
            ]
          ]
        }
      }
    );
    return;
  }

  if (data === "end_auto" || data === "end_manual") {
    const state = userState.get(userId);
    if (!state) return;
    state.autoEnd = data === "end_auto";
    if (state.autoEnd) {
      state.step = "end_time";
      userState.set(userId, state);
      const now = nowIST();
      await bot.sendMessage(chatId,
        `📅 <b>SET END DATE &amp; TIME</b>\n` +
        `<i>Step 3 of 5 — Auto End Config</i>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>⏰ Current IST: <b>${h(now)}</b>\n\n` +
        `Format: <code>DD-MM-YYYY HH:MM</code>\n` +
        `Example: <code>25-12-2026 18:00</code></blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    } else {
      state.step = "paid_votes";
      state.endTime = null;
      userState.set(userId, state);
      await askPaidVotes(chatId);
    }
    return;
  }

  if (data === "paid_yes" || data === "paid_no") {
    const state = userState.get(userId);
    if (!state) return;
    state.paidVotes = data === "paid_yes";
    if (state.paidVotes) {
      state.step = "currency";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `💱 <b>SELECT PAYMENT METHOD</b>\n` +
        `<i>Step 5 of 5 — Currency</i>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>Choose how users will pay for extra votes:</blockquote>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🇮🇳 INR via UPI/QR", callback_data: "cur_inr" }],
              [{ text: "⭐ Telegram Stars", callback_data: "cur_stars" }],
              [{ text: "🔄 Both (INR + Stars)", callback_data: "cur_both" }],
              [{ text: "◀️ Back", callback_data: "cancel_flow" }]
            ]
          }
        }
      );
    } else {
      await askCustomPhotoOrFinish(userId, chatId, null);
    }
    return;
  }

  if (["cur_inr", "cur_stars", "cur_both"].includes(data)) {
    const state = userState.get(userId);
    if (!state) return;
    state.currency = data.replace("cur_", "");
    if (state.currency === "inr" || state.currency === "both") {
      state.step = "qr_upload";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `📸 <b>UPLOAD PAYMENT QR CODE</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>Send a photo of your UPI/Google Pay QR code.\nUsers will make payments to this QR.</blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    } else {
      state.step = "stars_rate";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `⭐ <b>SET STARS RATE</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>How many votes per 1 Telegram Star?\n\nExample: <code>10</code> → 1 Star = 10 votes</blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    }
    return;
  }

  // ─── Stars optional after INR-only wizard ───
  if (data === "add_stars_yes" || data === "add_stars_no") {
    const state = userState.get(userId);
    if (!state || state.step !== "ask_stars_paid") return;
    await bot.answerCallbackQuery(query.id).catch(() => {});
    if (data === "add_stars_yes") {
      state.currency = "both";
      state.step = "stars_rate";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `⭐ <b>SET STARS VOTE RATE</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>How many votes per 1 Telegram Star?\n\nExample: <code>5</code> → 1 ⭐ = 5 votes</blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    } else {
      await bot.sendMessage(chatId, "✅ <b>Rates recorded!</b>", { parse_mode: "HTML" });
      await askCustomPhotoOrFinish(userId, chatId, state.qrFileId);
    }
    return;
  }

  // ─── Panel anti-cheat actions ───
  if (data.startsWith("panel_")) {
    const [action, gId, partIdStr] = data.split(":");
    const partId = Number(partIdStr);
    const g = getGiveaway(gId);
    const isOwner = g?.creatorId === userId;
    if (!isAdmin(userId) && !isOwner) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Permission denied!", show_alert: true }).catch(() => {});
    }
    await bot.answerCallbackQuery(query.id).catch(() => {});

    if (action === "panel_dismiss") {
      await bot.editMessageText(
        `✅ <b>Alert dismissed.</b>\n\nGiveaway: <code>${gId}</code> | Participant: <code>${partId}</code>`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
      ).catch(() => {});
      return;
    }

    if (action === "panel_warn") {
      try {
        await bot.sendMessage(partId,
          `⚠️ <b>Vote Panel Alert</b>\n\n` +
          `<blockquote>Hum ne notice kiya ki tumhare giveaway mein suspicious vote activity aayi hai.\n\n` +
          `Agar vote panel/service use ki gayi hai toh tumhara participation <b>cancel</b> kiya ja sakta hai.\n\n` +
          `Fair play follow karo! 🙏</blockquote>`,
          { parse_mode: "HTML" }
        );
        await bot.editMessageText(
          `✅ <b>Warning sent</b> to user <code>${partId}</code>.`,
          { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
        ).catch(() => {});
      } catch {
        await bot.sendMessage(chatId, `❌ Warning bhej nahi paya — user ne bot block kiya hoga.`);
      }
      return;
    }

    if (action === "panel_minus") {
      userState.set(userId, { step: "panel_minus_votes", giveawayId: gId, partId, approverChatId: chatId });
      await bot.sendMessage(chatId,
        `➖ <b>Votes Deduct</b>\n\n` +
        `<blockquote>Participant: <code>${partId}</code>\nGiveaway: <code>${gId}</code>\n\nKitne votes deduct karein? (number bhejo)</blockquote>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!g) {
      await bot.sendMessage(chatId, "❌ Giveaway not found."); return;
    }

    if (action === "panel_remove") {
      const participant = g.participants.get(partId);
      const name = participant?.name || String(partId);
      g.participants.delete(partId);
      if (g.voterMap) {
        for (const [vId, vPartId] of g.voterMap.entries()) {
          if (vPartId === partId) g.voterMap.delete(vId);
        }
      }
      await saveGiveaway(g);
      await bot.editMessageText(
        `🗑️ <b>Participant Removed</b>\n\n<blockquote><b>${h(name)}</b> (<code>${partId}</code>) ko giveaway se hata diya gaya.</blockquote>`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
      ).catch(() => {});
      try {
        await bot.sendMessage(partId,
          `⛔ <b>Giveaway Se Hataya Gaya</b>\n\n` +
          `<blockquote>Suspicious vote activity ke karan aapko <b>${h(g.title)}</b> giveaway se remove kar diya gaya hai.\n\nKoi sawaal ho toh support se contact karein.</blockquote>`,
          { parse_mode: "HTML" }
        );
      } catch {}
      return;
    }

    if (action === "panel_ban") {
      bannedUsers.add(partId);
      await saveConfig("bannedUsers", [...bannedUsers]);
      const participant = g.participants.get(partId);
      const name = participant?.name || String(partId);
      g.participants.delete(partId);
      if (g.voterMap) {
        for (const [vId, vPartId] of g.voterMap.entries()) {
          if (vPartId === partId) g.voterMap.delete(vId);
        }
      }
      await saveGiveaway(g);
      await bot.editMessageText(
        `🚫 <b>User Banned + Removed</b>\n\n<blockquote><b>${h(name)}</b> (<code>${partId}</code>) ko bot se ban kar diya gaya aur giveaway se remove kar diya gaya.</blockquote>`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
      ).catch(() => {});
      try {
        await bot.sendMessage(partId,
          `🚫 <b>Bot Se Ban Kiya Gaya</b>\n\n` +
          `<blockquote>Vote panel/cheating ke karan aapko is bot se permanently ban kar diya gaya hai.</blockquote>`,
          { parse_mode: "HTML" }
        );
      } catch {}
      return;
    }
    return;
  }

  // ─── Giveaway Owner / Admin: Approve INR payment ───
  if (data.startsWith("approve_pay:")) {
    const payId = data.split(":")[1];
    const payment = pendingPayments.get(payId);
    if (!payment) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Payment record not found!", show_alert: true }).catch(() => {});
    }
    const isOwner = payment.creatorId && userId === payment.creatorId;
    if (!isAdmin(userId) && !isOwner) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Sirf giveaway owner ya admin approve kar sakta hai!", show_alert: true }).catch(() => {});
    }
    userState.set(userId, { step: "approve_votes", paymentId: payId, approverChatId: chatId });
    await bot.answerCallbackQuery(query.id).catch(() => {});
    await bot.sendMessage(chatId,
      `✅ <b>Approve Payment</b>\n\n<blockquote>Giveaway: <b>${payment.giveawayId}</b>\nUser ID: <code>${payment.userId}</code>\n\nKitne votes add karein? (number type karo)</blockquote>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ─── Giveaway Owner / Admin: Reject INR payment ───
  if (data.startsWith("reject_pay:")) {
    const payId = data.split(":")[1];
    const payment = pendingPayments.get(payId);
    if (!payment) return;
    const isOwner = payment.creatorId && userId === payment.creatorId;
    if (!isAdmin(userId) && !isOwner) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Sirf giveaway owner ya admin reject kar sakta hai!", show_alert: true }).catch(() => {});
    }
    pendingPayments.delete(payId);
    await PendingPaymentModel.deleteOne({ payId });
    await bot.answerCallbackQuery(query.id, { text: "Payment rejected!" }).catch(() => {});
    await bot.editMessageCaption(
      `❌ Payment Rejected — ID: ${payId}`,
      { chat_id: chatId, message_id: msgId }
    ).catch(() => {});
    try {
      await bot.sendMessage(payment.userId,
        `<b>❌ Payment Rejected</b>\n\nYour payment could not be verified.\nPayment ID: <code>${payId}</code>\n\nPlease try again or contact support.`,
        { parse_mode: "HTML" }
      );
    } catch {}
    return;
  }
  } catch (e) { console.error("⚠️ callback_query handler error:", e.message, "| data:", query?.data); }
});

// ============================================================
// HELPER: askPaidVotes
// ============================================================
async function askPaidVotes(chatId) {
  await bot.sendMessage(chatId,
    `💰 <b>PAID VOTES CONFIG</b>\n` +
    `<i>Step 4 of 5 — Revenue Settings</i>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<blockquote>Allow users to buy extra votes with real money or Telegram Stars?\n\n` +
    `✅ Enable  → More votes, more revenue\n` +
    `❌ Disable → Free voting only</blockquote>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Enable Paid Votes", callback_data: "paid_yes" }],
          [
            { text: "❌ Free Voting Only", callback_data: "paid_no" },
            { text: "◀️ Back", callback_data: "cancel_flow" }
          ]
        ]
      }
    }
  );
}

// ============================================================
// HELPER: updateChannelPost
// ============================================================
async function updateChannelPost(g, participant) {
  if (!g.channelId || !participant.channelMsgId) return;
  const markup = {
    inline_keyboard: [[{
      text: `🗳️ Vote  ·  ${participant.votes}`,
      callback_data: `ch_vote:${g.id}:${participant.id}`
    }]]
  };
  try {
    try {
      await bot.editMessageCaption(participantChannelText(participant, g), {
        chat_id: g.channelId, message_id: participant.channelMsgId,
        parse_mode: "HTML", reply_markup: markup
      });
      return;
    } catch (captionErr) {
      if (captionErr?.message?.includes("message is not modified")) return;
    }
    try {
      await bot.editMessageText(participantChannelText(participant, g), {
        chat_id: g.channelId, message_id: participant.channelMsgId,
        parse_mode: "HTML", reply_markup: markup
      });
      return;
    } catch {}
    // Final fallback — at least update the vote button
    await bot.editMessageReplyMarkup(markup, {
      chat_id: g.channelId, message_id: participant.channelMsgId
    });
  } catch (e) { console.error("Update post error:", e.message); }
}

// ============================================================
// HELPER: announceWinners
// ============================================================
async function announceWinners(g, gId, creatorId) {
  const parts = [...g.participants.values()].sort((a, b) => b.votes - a.votes);
  const totalVotes = parts.reduce((s, p) => s + p.votes, 0);
  const medals = ["🥇", "🥈", "🥉"];
  const rankNames = ["1st 🥇", "2nd 🥈", "3rd 🥉"];
  const top3 = parts.slice(0, 3);
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }).replace(",", "");

  const podiumText = top3.length
    ? top3.map((p, i) => {
        const name = h(p.name).slice(0, 18);
        const pad = "·".repeat(Math.max(2, 20 - name.length));
        return `${medals[i]}  <b>${name}</b>  ${pad}  <code>${p.votes}</code> 🗳️`;
      }).join("\n")
    : `<i>▸ No votes yet</i>`;

  const fullBoard = parts.map((p, i) => {
    const rank = i < 3 ? medals[i] : `  <b>${i + 1}.</b>`;
    const name = h(p.name).slice(0, 18);
    const pad = "·".repeat(Math.max(2, 20 - name.length));
    return `${rank} ${name} ${pad} <code>${p.votes}</code> 🗳️`;
  }).join("\n") || `<i>▸ No votes yet</i>`;

  const channelCard =
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  ◆  <b>GIVEAWAY ENDED</b>  ◆\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `📌 <b>${h(g.title)}</b>\n\n` +
    `━━━◈  🏆 WINNERS  ◈━━━\n\n` +
    `${podiumText}\n\n` +
    `━━━◈━━━━━━━━━━━━━━━━━◈━━━\n` +
    `<blockquote>` +
    `👥 Participants  ▸  <b>${g.participants.size}</b>\n` +
    `🗳️ Total Votes   ▸  <b>${totalVotes}</b>\n` +
    `📅 Ended At      ▸  ${now}` +
    `</blockquote>\n\n` +
    (parts.length > 3
      ? `━━━◈ 📊 FULL LEADERBOARD ◈━━━\n\n${fullBoard}\n\n`
      : ``) +
    `✦ <i>Sabko participation ke liye shukriya.</i>\n` +
    `✦ ─── <b>@${BOT_USERNAME}</b> ─── ✦`;

  const creatorCard =
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🏁  <b>GIVEAWAY RESULTS</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `📌 <b>${h(g.title)}</b>\n` +
    `🆔 <code>${gId}</code>\n\n` +
    `━━━◈ 🏆 FINAL WINNERS ◈━━━\n\n` +
    `${podiumText}\n\n` +
    `━━━◈━━━━━━━━━━━━━━━━━◈━━━\n` +
    `<blockquote>` +
    `👥 Participants  ▸  <b>${g.participants.size}</b>\n` +
    `🗳️ Total Votes   ▸  <b>${totalVotes}</b>\n` +
    `📅 Ended At      ▸  ${now}` +
    `</blockquote>\n\n` +
    `━━━◈ 📊 FULL LEADERBOARD ◈━━━\n\n${fullBoard}\n\n` +
    `✦ ─── <b>DRS NETWORK</b> ─── ✦`;

  if (g.channelId) {
    try { await bot.sendMessage(g.channelId, channelCard, { parse_mode: "HTML" }); } catch {}
  }
  try { await bot.sendMessage(creatorId, creatorCard, { parse_mode: "HTML" }); } catch {}

  await notifyAdmin(
    `🏁 <b>Giveaway Ended</b>\n` +
    `<blockquote>` +
    `◈ Title        ▸  <b>${h(g.title)}</b>\n` +
    `◈ Giveaway ID  ▸  <code>${gId}</code>\n` +
    `◈ Participants ▸  <b>${g.participants.size}</b>\n` +
    `◈ Total Votes  ▸  <b>${[...g.participants.values()].reduce((s,p)=>s+p.votes,0)}</b>\n` +
    (top3[0] ? `◈ 🥇 Winner    ▸  <b>${h(top3[0].name)}</b> (${top3[0].votes} votes)` : `◈ Winner      ▸  No participants`) +
    `</blockquote>`
  );

  for (let i = 0; i < top3.length; i++) {
    const winner = top3[i];
    if (winner.id === creatorId) continue;
    const winnerDM =
      `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ◆  <b>CONGRATULATIONS</b>  ◆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `◈ <b>You Won ${rankNames[i]} Place!</b>\n\n` +
      `📌 <b>${h(g.title)}</b>\n\n` +
      `<blockquote>` +
      `🏆 Rank    ▸  <b>${rankNames[i]}</b>\n` +
      `🗳️ Votes   ▸  <b>${winner.votes}</b>\n` +
      `👥 Players ▸  ${g.participants.size} total` +
      `</blockquote>\n\n` +
      `✦ <i>DRS Network ki taraf se dil se badhai.</i>\n` +
      `✦ ─── <b>@${BOT_USERNAME}</b> ─── ✦`;
    try { await bot.sendMessage(winner.id, winnerDM, { parse_mode: "HTML" }); } catch {}
  }
}

// ============================================================
// HELPER: participantChannelText
// ============================================================
function participantChannelText(participant, g) {
  return (
    `✦━━━━━━ 🎁 DRS GIVEAWAY ━━━━━━✦\n\n` +
    `👤 <b>${h(participant.name)}</b>\n` +
    `🔖 <i>${h(participant.handle)}</i>  ·  🆔 <code>${participant.id}</code>\n\n` +
    `━━━◈━━━━━━━━━━━━━━━━◈━━━\n` +
    `<blockquote>` +
    `📌 <b>${h(g.title)}</b>\n` +
    `🗳️ Votes  ▸  <b>${participant.votes}</b>\n` +
    `⚡ Status ▸  🟢 Active` +
    `</blockquote>\n` +
    `━━━◈━━━━━━━━━━━━━━━━◈━━━\n\n` +
    `🔒 <i>Channel members only can vote</i>\n` +
    `✦ ─── <b>@${BOT_USERNAME}</b> ─── ✦`
  );
}

// ============================================================
// HELPER: askCustomPhotoOrFinish — ask VIP user for custom photo before finishing
// ============================================================
async function askCustomPhotoOrFinish(userId, chatId, qrFileId) {
  const state = userState.get(userId);
  if (!state) return;
  if (getUserPerm(userId, "customPhoto") && (isVip(userId) || isAdmin(userId))) {
    state.step = "giveaway_custom_photo";
    state.qrFileId = qrFileId || state.qrFileId || null;
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  🖼️  <b>CUSTOM GIVEAWAY PHOTO</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `◈ Upload a <b>custom photo</b> that will be posted with your giveaway announcement on the channel.\n\n` +
      `◈ Skip to use the default DRS image.` +
      `</blockquote>\n\n` +
      `📸 <b>Send your photo</b> or skip:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "⏭️ Skip — Use Default Image", callback_data: "skip_custom_photo" }
          ]]
        }
      }
    );
  } else {
    await finishGiveawayCreation(userId, chatId, qrFileId);
  }
}

// ============================================================
// HELPER: finishGiveawayCreation
// ============================================================
async function finishGiveawayCreation(userId, chatId, qrFileId) {
  const state = userState.get(userId);
  if (!state) return;

  const gId = genId(8);
  const g = {
    id: gId,
    title: state.title,
    creatorId: userId,
    channelId: state.channelId || null,
    channelUsername: state.channelUsername || null,
    participants: new Map(),
    voterMap: new Map(),
    active: true,
    participationOpen: true,
    paidVotesActive: state.paidVotes || false,
    autoEnd: state.autoEnd || false,
    endTime: state.endTime || null,
    paymentMode: state.currency || "none",
    qrFileId: qrFileId || state.qrFileId || null,
    upiId: state.upiId || null,
    votesPerInr: state.votesPerInr || 10,
    votesPerStar: state.votesPerStar || 5,
    customPhotoId: state.customPhotoId || null,
    createdAt: new Date()
  };

  giveaways.set(gId, g);
  await saveGiveaway(g);
  userState.delete(userId);

  if (g.autoEnd && g.endTime) {
    const ms = g.endTime.getTime() - Date.now();
    if (ms > 0) {
      setTimeout(async () => {
        const giveaway = getGiveaway(gId);
        if (!giveaway || !giveaway.active) return;
        giveaway.active = false;
        giveaway.participationOpen = false;
        giveaway.paidVotesActive = false;
        await saveGiveaway(giveaway);
        await announceWinners(giveaway, gId, userId);
      }, ms);
    }
  }

  const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;

  // ── Send announcement to linked channel ──
  if (g.channelId) {
    const endStr = g.endTime
      ? new Date(g.endTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
      : "Manual (Admin controlled)";
    const channelAnnouncement =
      `✦━━━━━━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `◆   <b>GIVEAWAY NOW LIVE</b>   ◆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `📌  <b>${h(g.title)}</b>\n\n` +
      `◈─────────────────────────◈\n` +
      `◈ Status    ▸  🟢 <b>ACTIVE</b>\n` +
      `◈ Voting    ▸  ${g.paidVotesActive ? "🆓 Free  +  💰 Paid" : "🆓 Free Only"}\n` +
      `◈ Ends At   ▸  <b>${h(endStr)}</b>\n` +
      `◈─────────────────────────◈\n\n` +
      `━━━◈  <b>HOW TO JOIN?</b>  ◈━━━\n\n` +
      `<blockquote>` +
      `▸ <b>1</b>  Tap the button below\n` +
      `▸ <b>2</b>  Register — your vote card will be posted in the channel\n` +
      `▸ <b>3</b>  Share your link — more votes = better rank\n` +
      `▸ <b>4</b>  Most votes <b>WINS</b>! 🏆` +
      `</blockquote>\n\n` +
      `✦ ─────  <b>@${BOT_USERNAME}</b>  ───── ✦`;
    const photoSrc = g.customPhotoId || GIVEAWAY_IMAGE_URL;
    try {
      if (g.customPhotoId) {
        await bot.sendPhoto(g.channelId, g.customPhotoId, {
          caption: channelAnnouncement,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "⚡ JOIN GIVEAWAY — TAP NOW!", url: link }]] }
        });
      } else {
        await bot.sendPhoto(g.channelId, GIVEAWAY_IMAGE_URL, {
          caption: channelAnnouncement,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "⚡ JOIN GIVEAWAY — TAP NOW!", url: link }]] }
        });
      }
    } catch (e) { console.error("Channel giveaway announcement error:", e.message); }
    await notifyAdmin(
      `🎁 <b>Giveaway Created</b>\n` +
      `Title: <b>${h(g.title)}</b>\n` +
      `ID: <code>${gId}</code>\n` +
      `Creator: <code>${userId}</code>`
    );
  }

  await animCreate(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  ◆  <b>GIVEAWAY CREATED</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `📌 Title   ▸  <b>${h(g.title)}</b>\n` +
    `🆔 ID      ▸  <code>${gId}</code>\n` +
    `⚡ Status  ▸  🟢 ACTIVE\n` +
    `💰 Paid    ▸  ${g.paidVotesActive ? "◈ Enabled" : "◆ Disabled"}\n` +
    (g.endTime ? `⏳ Ends    ▸  ${g.endTime.toLocaleString("en-IN")}` : `⏳ Ends    ▸  Manual`) +
    `</blockquote>\n\n` +
    `━━━◈ <b>SHARE LINK</b> ◈━━━\n` +
    `<code>${link}</code>\n\n` +
    `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚙️ Manage Giveaway", callback_data: `mgmt:${gId}` }],
          [{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }],
          [{ text: "📋 Copy Link", switch_inline_query: link }]
        ]
      }
    }
  );
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

bot.on("message", async (msg) => {
  try {
  if (msg.chat.type !== "private") return;
  if (msg.successful_payment) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // ─── Banned user check ───
  if (bannedUsers.has(userId) && !isAdmin(userId)) {
    await bot.sendMessage(chatId,
      `🚫 <b>Aapko is bot se ban kar diya gaya hai.</b>\n<i>Agar yeh galti se hua hai toh admin se contact karein.</i>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
    return;
  }

  // ─── Maintenance mode check ───
  if (maintenanceMode && !isAdmin(userId)) {
    await bot.sendMessage(chatId,
      `🔧 <b>Bot Maintenance Mode Mein Hai</b>\n\n` +
      `<blockquote>Abhi bot update ho raha hai.\nThodi der mein wapas aayein. 🙏</blockquote>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
    return;
  }
  const text = msg.text?.trim() || "";
  const state = userState.get(userId);

  // ─── Giveaway custom photo upload ───
  if (state?.step === "giveaway_custom_photo") {
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      state.customPhotoId = fileId;
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `✅ <b>Custom photo set!</b>\nThis photo will appear with your giveaway announcement on the channel.`,
        { parse_mode: "HTML" }
      );
      await finishGiveawayCreation(userId, chatId, state.qrFileId);
    } else if (text === "/skip") {
      await finishGiveawayCreation(userId, chatId, state.qrFileId);
    } else {
      await bot.sendMessage(chatId, `📸 <b>Send a photo</b> or press the Skip button below.`, { parse_mode: "HTML" });
    }
    return;
  }

  // ─── Broadcast compose — admin sends content to broadcast ───
  if (state?.step === "broadcast_compose") {
    userState.delete(userId);
    await showBroadcastMenu(chatId, userId, null, "", state.silent, msg);
    return;
  }

  // ─── Support message (text, photo, document, video, voice, audio, sticker, file) ───
  if (state?.step === "awaiting_support_message") {
    userState.delete(userId);
    const pu = botUsers.get(userId) || {};
    const puName  = h(msg.from.first_name || pu.firstName || "Unknown");
    const puHandle = msg.from.username ? `@${msg.from.username}` : (pu.username ? `@${pu.username}` : `ID: ${userId}`);
    const vipTag   = getMembership(userId) ? " 👑 VIP" : "";

    // Detect media type
    let mediaType = "Text";
    if      (msg.photo)    mediaType = "📷 Photo";
    else if (msg.document) mediaType = "📄 Document / File";
    else if (msg.video)    mediaType = "🎥 Video";
    else if (msg.voice)    mediaType = "🎙️ Voice";
    else if (msg.audio)    mediaType = "🎵 Audio";
    else if (msg.sticker)  mediaType = "🎭 Sticker";
    else if (msg.video_note) mediaType = "📹 Video Note";

    const userCaption =
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  📩  <b>SUPPORT REQUEST</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `◈ Name    ▸  <b>${puName}</b>${vipTag}\n` +
      `◈ Handle  ▸  ${puHandle}\n` +
      `◈ User ID ▸  <code>${userId}</code>\n` +
      `◈ Type    ▸  ${mediaType}` +
      (msg.caption ? `\n◈ Caption ▸  ${h(msg.caption)}` : "") +
      (msg.text    ? `\n◈ Message ▸  ${h(msg.text)}`    : "") +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`;

    const resolveKb = { inline_keyboard: [[
      { text: "✅ Resolved",     callback_data: `sup_resolve:${userId}` },
      { text: "❌ Not Resolved", callback_data: `sup_pending:${userId}` }
    ]]};

    try {
      // Step 1: Send info card to admin
      await bot.sendMessage(MAIN_ADMIN_ID, userCaption, { parse_mode: "HTML", reply_markup: resolveKb });

      // Step 2: Send the actual media file directly (photo/doc/video/voice/audio/sticker/video_note)
      const mediaCaption = `📩 Support | ${puName} (${puHandle}) | ID: ${userId}`;
      if (msg.photo) {
        await bot.sendPhoto(MAIN_ADMIN_ID, msg.photo[msg.photo.length - 1].file_id, { caption: mediaCaption });
      } else if (msg.document) {
        await bot.sendDocument(MAIN_ADMIN_ID, msg.document.file_id, { caption: mediaCaption });
      } else if (msg.video) {
        await bot.sendVideo(MAIN_ADMIN_ID, msg.video.file_id, { caption: mediaCaption });
      } else if (msg.voice) {
        await bot.sendVoice(MAIN_ADMIN_ID, msg.voice.file_id, { caption: mediaCaption });
      } else if (msg.audio) {
        await bot.sendAudio(MAIN_ADMIN_ID, msg.audio.file_id, { caption: mediaCaption });
      } else if (msg.sticker) {
        await bot.sendSticker(MAIN_ADMIN_ID, msg.sticker.file_id);
      } else if (msg.video_note) {
        await bot.sendVideoNote(MAIN_ADMIN_ID, msg.video_note.file_id);
      }
    } catch (e) { console.error("Support forward error:", e.message); }

    await bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ✅  <b>MESSAGE SENT!</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>Aapka message admin ko bhej diya gaya hai.\nJald hi reply milega. 🙏</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
    );
    return;
  }

  // ─── Create Post — unified handler (any msg type, exact formatting) ───
  if (state?.step === "cp_compose") {
    const chId = state.channelId;
    const chTitle = state.channelTitle || chId;
    userState.delete(userId);
    let sent = false;
    let msgType = "Text";
    if (msg.photo) msgType = "Photo";
    else if (msg.video) msgType = "Video";
    else if (msg.document) msgType = "Document";
    else if (msg.audio) msgType = "Audio";
    else if (msg.sticker) msgType = "Sticker";
    try {
      await bot._request("copyMessage", {
        chat_id: chId,
        from_chat_id: chatId,
        message_id: msg.message_id
      });
      sent = true;
    } catch (e) { console.error("Create post copyMessage error:", e.message); }
    await bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ◆  <b>POST ${sent ? "SENT" : "FAILED"}</b>  ◆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `◈ Channel  ▸  <b>${h(chTitle)}</b>\n` +
      `◈ Type     ▸  ${msgType}\n` +
      `◈ Status   ▸  ${sent ? "🟢 Published" : "🔴 Failed (bot may lack post permission)"}` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Main Menu", callback_data: "main_menu" }]] } }
    );
    return;
  }

  // ─── Photo handler ───
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;

    if (state?.step === "set_membership_qr" && isAdmin(userId)) {
      membershipQrFileId = fileId;
      await saveConfig("membershipQrFileId", fileId);
      userState.delete(userId);
      await bot.sendMessage(chatId, "✅ <b>Membership QR code set ho gaya!</b>\nAb users membership purchase kar sakte hain.", { parse_mode: "HTML" });
      return;
    }

    if (!state) return;

    if (state.step === "qr_upload") {
      state.qrFileId = fileId;
      state.step = "upi_id";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `🇮🇳 <b>SET UPI ID</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>Apna UPI ID enter karein jahan users payment karenge.\n\nExample: <code>yourname@upi</code> ya <code>9876543210@paytm</code></blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
      return;
    }

    if (state.step === "awaiting_membership_screenshot") {
      const payId = state.payId;
      const pending = pendingMembershipPayments.get(payId);
      if (!pending) {
        userState.delete(userId);
        await bot.sendMessage(chatId, "❌ Payment session expired. Please try again.", { parse_mode: "HTML" });
        return;
      }
      pending.screenshotFileId = fileId;
      await PendingMembershipModel.findOneAndUpdate({ payId }, { screenshotFileId: fileId });
      userState.delete(userId);

      await bot.sendMessage(chatId,
        `✅ <b>Screenshot Received!</b>\n\nAdmin will verify it. Your membership will be activated once approved.\n\nPayment ID: <code>${payId}</code>`,
        { parse_mode: "HTML" }
      );

      try {
        const plan = getMembershipPlan(pending.planKey);
        const pu = botUsers.get(userId);
        const puName = pu?.firstName ? h(pu.firstName) : "Unknown";
        const puHandle = pu?.username ? `@${pu.username}` : `ID: ${userId}`;
        await bot.sendPhoto(MAIN_ADMIN_ID, fileId, {
          caption:
            `<b>💳 New Membership Payment Claim</b>\n\n` +
            `<blockquote>` +
            `◈ Name     ▸  <b>${puName}</b> (${puHandle})\n` +
            `◈ User ID  ▸  <code>${userId}</code>\n` +
            `◈ Plan     ▸  <b>${plan?.label} — ₹${plan?.price}</b>\n` +
            `◈ Pay ID   ▸  <code>${payId}</code>` +
            `</blockquote>\n\nApprove karein?`,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `approve_mem:${payId}` },
                { text: "❌ Reject", callback_data: `reject_mem:${payId}` }
              ]
            ]
          }
        });
      } catch (e) { console.error("Admin mem screenshot notify:", e.message); }
      return;
    }

    if (state.step === "awaiting_inr_screenshot") {
      const gId = state.giveawayId;
      const g = getGiveaway(gId);
      if (!g) return;

      const payId = String(paymentCounter++);
      const payData = { userId, giveawayId: gId, creatorId: g.creatorId || null, screenshotFileId: fileId, timestamp: new Date() };
      pendingPayments.set(payId, payData);
      try {
        await PendingPaymentModel.create({ payId, ...payData });
      } catch (e) {
        console.error("PendingPayment create error:", e.message);
        pendingPayments.delete(payId);
        await bot.sendMessage(chatId, "❌ Server error. Please try again.", { parse_mode: "HTML" });
        return;
      }
      userState.delete(userId);

      await bot.sendMessage(chatId,
        `<b>✅ Screenshot Received!</b>\n\n` +
        `Admin is verifying your payment. Votes will be added once approved.\n\n` +
        `Payment ID: <code>${payId}</code>`,
        { parse_mode: "HTML" }
      );

      // Send screenshot proof to giveaway owner (and main admin if different)
      const notifyTargets = new Set([g.creatorId]);
      if (isAdmin(g.creatorId)) notifyTargets.add(MAIN_ADMIN_ID);
      else notifyTargets.add(MAIN_ADMIN_ID);

      const pu = botUsers.get(userId);
      const puName = pu?.firstName ? h(pu.firstName) : "Unknown";
      const puHandle = pu?.username ? `@${pu.username}` : `ID: ${userId}`;
      const notifCaption =
        `<b>💰 New INR Payment Request</b>\n\n` +
        `<blockquote>` +
        `◈ Name     ▸  <b>${puName}</b> (${puHandle})\n` +
        `◈ User ID  ▸  <code>${userId}</code>\n` +
        `◈ Giveaway ▸  <b>${h(g.title)}</b> (<code>${gId}</code>)\n` +
        `◈ Pay ID   ▸  <code>${payId}</code>` +
        `</blockquote>\n\n` +
        `Kitne votes approve karein?`;
      const notifMarkup = {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve_pay:${payId}` },
          { text: "❌ Reject", callback_data: `reject_pay:${payId}` }
        ]]
      };

      for (const target of notifyTargets) {
        try {
          await bot.sendPhoto(target, fileId, {
            caption: notifCaption,
            parse_mode: "HTML",
            reply_markup: notifMarkup
          });
        } catch (e) { console.error(`Notify ${target} error:`, e.message); }
      }
      return;
    }
    return;
  }

  if (!text || text.startsWith("/")) return;

  if (!state) {
    const pu = botUsers.get(userId) || {};
    const puName = h(msg.from.first_name || pu.firstName || "Unknown");
    const puHandle = msg.from.username ? `@${msg.from.username}` : `ID: ${userId}`;
    try {
      await bot.sendMessage(MAIN_ADMIN_ID,
        `💬 <b>User Message (No Context)</b>\n\n` +
        `<blockquote>◈ Name    ▸  <b>${puName}</b>\n◈ Handle  ▸  ${puHandle}\n◈ User ID ▸  <code>${userId}</code></blockquote>`,
        { parse_mode: "HTML" }
      );
      await bot._request("forwardMessage", {
        chat_id: MAIN_ADMIN_ID,
        from_chat_id: chatId,
        message_id: msg.message_id
      });
    } catch {}
    await bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  📩  <b>DRS BOT SUPPORT</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `Aapka message admin ko bhej diya gaya! 📨\n\n` +
      `Direct support ke liye:\n` +
      `📩 <b>@drssupport</b>\n\n` +
      `⚡ Powered by <b>DRS NETWORK</b>` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
    );
    return;
  }

  // ─── Admin approving vote count ───
  // ─── Panel: deduct votes from participant ───
  if (state.step === "panel_minus_votes" && (isAdmin(userId) || state.approverChatId === chatId)) {
    const deduct = parseInt(text, 10);
    if (isNaN(deduct) || deduct < 1) {
      await bot.sendMessage(chatId, "❌ Valid number bhejo (minimum 1).");
      return;
    }
    const g = getGiveaway(state.giveawayId);
    if (!g) { userState.delete(userId); return bot.sendMessage(chatId, "❌ Giveaway nahi mila."); }
    const participant = g.participants.get(state.partId);
    if (!participant) { userState.delete(userId); return bot.sendMessage(chatId, "❌ Participant nahi mila."); }
    const before = participant.votes;
    participant.votes = Math.max(0, participant.votes - deduct);
    await saveGiveaway(g);
    await updateChannelPost(g, participant);
    userState.delete(userId);
    await bot.sendMessage(chatId,
      `✅ <b>Votes Deducted!</b>\n\n` +
      `<blockquote>◈ Participant  ▸  <b>${h(participant.name)}</b>\n` +
      `◈ Before       ▸  <b>${before}</b>\n` +
      `◈ Deducted     ▸  -<b>${deduct}</b>\n` +
      `◈ After        ▸  <b>${participant.votes}</b></blockquote>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (state.step === "approve_votes" && (isAdmin(userId) || (pendingPayments.get(state.paymentId)?.creatorId === userId))) {
    const votes = parseInt(text, 10);
    if (isNaN(votes) || votes < 1) {
      await bot.sendMessage(chatId, "❌ Please enter a valid number.");
      return;
    }
    const payId = state.paymentId;
    const payment = pendingPayments.get(payId);
    if (!payment) {
      userState.delete(userId);
      return bot.sendMessage(chatId, "❌ Payment record not found!");
    }
    userState.delete(userId);
    pendingPayments.delete(payId);
    await PendingPaymentModel.deleteOne({ payId });

    const g = getGiveaway(payment.giveawayId);
    if (!g) return;

    let participant = g.participants.get(payment.userId);
    if (!participant) {
      const user = await bot.getChat(payment.userId).catch(() => null);
      const name = user ? ((user.first_name || "") + (user.last_name ? ` ${user.last_name}` : "")) : String(payment.userId);
      participant = { id: payment.userId, name, handle: `@${user?.username || "NoUser"}`, votes: 0, voters: new Set(), channelMsgId: null };
      g.participants.set(payment.userId, participant);
    }
    participant.votes += votes;
    await saveGiveaway(g);
    await updateChannelPost(g, participant);

    await bot.sendMessage(chatId, `✅ <b>${votes} votes</b> add ho gaye user <code>${payment.userId}</code> ke liye!`, { parse_mode: "HTML" });
    try {
      await bot.sendMessage(payment.userId,
        `<b>✅ Payment Approved!</b>\n\n` +
        `<b>${votes} votes</b> have been added to your account!\n` +
        `<b>${h(g.title)}</b>\n\n` +
        `Current Votes: <b>${participant.votes}</b>`,
        { parse_mode: "HTML" }
      );
    } catch {}
    // Channel notification for paid votes approved
    if (g.channelId) {
      try {
        await bot.sendMessage(g.channelId,
          `💰 <b>Paid Votes Purchased!</b>\n\n` +
          `<blockquote>` +
          `◈ Participant  ▸  <b>${h(participant.name)}</b>\n` +
          `◈ Votes Added  ▸  +<b>${votes}</b> 🗳️\n` +
          `◈ Method       ▸  🇮🇳 INR/UPI\n` +
          `◈ Giveaway     ▸  <b>${h(g.title)}</b>` +
          `</blockquote>`,
          { parse_mode: "HTML" }
        );
      } catch {}
    }
    return;
  }

  // ─── VIP: Per-giveaway force join channel setup ───
  if (state.step === "set_giveaway_fj") {
    const gId = state.gId;
    const g = getGiveaway(gId);
    if (!g) { userState.delete(userId); return; }
    try {
      const chatInfo = await bot.getChat(text.trim());
      g.extraForceJoin = {
        channelId: String(chatInfo.id),
        channelUsername: chatInfo.username || null,
        channelTitle: chatInfo.title || text.trim()
      };
      await saveGiveaway(g);
      userState.delete(userId);
      await bot.sendMessage(chatId,
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
        `  ✅  <b>FORCE JOIN SET!</b>\n` +
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
        `<blockquote>` +
        `🔗 Channel: <b>${h(chatInfo.title || text)}</b>\n` +
        `${chatInfo.username ? `👤 @${h(chatInfo.username)}\n` : ""}` +
        `📋 ID: <code>${chatInfo.id}</code>\n\n` +
        `Users must join this channel before participating in the giveaway — enforced while your membership is active.` +
        `</blockquote>\n\n` +
        `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
        { parse_mode: "HTML", reply_markup: backKeyboard(`mgmt:${gId}`) }
      );
    } catch {
      await bot.sendMessage(chatId,
        `❌ <b>Channel Not Found!</b>\n\n` +
        `<blockquote>` +
        `Please note:\n` +
        `▸ The bot must be an admin in that channel\n` +
        `▸ Format: <code>@username</code> or <code>-1001234567890</code>` +
        `</blockquote>`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  // ─── GIVEAWAY CREATION STEPS ───

  if (state.step === "title") {
    const title = text === "/skip" ? "Vote for your favorite!" : text;
    state.title = title;
    state.step = "pick_channel";
    userState.set(userId, state);

    const myChans = [...registeredChannels.entries()].filter(([, c]) => c.addedBy === userId || isAdmin(userId));
    const btns = myChans.map(([id, c]) => ([{ text: `📢 ${c.title}`, callback_data: `sel_ch:${id}` }]));
    btns.push([{ text: "✏️ Enter Manually", callback_data: "ch_manual" }]);
    btns.push([{ text: "◀️ Back", callback_data: "cancel_flow" }]);

    await bot.sendMessage(chatId,
      `<b>📢 Select Target Channel</b>\n\nChoose the channel where the giveaway will be posted.\n<i>Only channels where I am an Admin are shown below.</i>\n\n<b>Found: ${myChans.length} Channel${myChans.length !== 1 ? "s" : ""}</b>`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: btns } }
    );
    return;
  }

  if (state.step === "pick_channel" && text) {
    try {
      const chatInfo = await bot.getChat(text);
      state.channelId = String(chatInfo.id);
      state.channelTitle = chatInfo.title;
      state.channelUsername = chatInfo.username || null;
      registeredChannels.set(state.channelId, {
        title: chatInfo.title, type: chatInfo.type,
        addedBy: userId, username: chatInfo.username || null
      });
      await saveChannel(state.channelId, { title: chatInfo.title, type: chatInfo.type, addedBy: userId, username: chatInfo.username || null });
    } catch {
      state.channelId = text;
      state.channelTitle = text;
    }
    state.step = "end_type";
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `<b>⏳ Giveaway Ending Configuration</b>\n\n🤖 <b>Automatic:</b> Ends at a specific time.\n✋ <b>Manual:</b> You stop it manually.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🤖 Automatic End", callback_data: "end_auto" },
              { text: "✋ Manual End", callback_data: "end_manual" }
            ],
            [{ text: "◀️ Back", callback_data: "cancel_flow" }]
          ]
        }
      }
    );
    return;
  }

  if (state.step === "end_time") {
    const d = parseIST(text);
    if (!d || d < new Date()) {
      await bot.sendMessage(chatId, "❌ Invalid date/time ya past time. Format: DD-MM-YYYY HH:MM\nExample: 25-12-2026 18:00");
      return;
    }
    state.endTime = d;
    const formatted = d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
    state.step = "paid_votes";
    userState.set(userId, state);
    await bot.sendMessage(chatId, `✅ <b>Will end on: ${h(formatted)} IST</b>`, { parse_mode: "HTML" });
    await askPaidVotes(chatId);
    return;
  }

  if (state.step === "awaiting_stars_quantity") {
    const qty = parseInt(text, 10);
    if (isNaN(qty) || qty < 1) {
      await bot.sendMessage(chatId, "❌ Please enter a valid number of Stars (minimum 1).", { parse_mode: "HTML" });
      return;
    }
    const gId = state.giveawayId;
    const g = getGiveaway(gId);
    if (!g) { userState.delete(userId); return; }
    const participant = g.participants.get(userId);
    if (!participant) { userState.delete(userId); return; }
    userState.delete(userId);
    try {
      await bot.sendInvoice(
        chatId,
        `Vote Pack — ${h(g.title)}`,
        `${qty} Stars = ${qty * g.votesPerStar} votes for ${h(g.title)}`,
        `paid_vote_${gId}_${userId}`,
        "", "XTR",
        [{ label: `${qty * g.votesPerStar} Votes`, amount: qty }]
      );
    } catch (e) {
      console.error("Stars invoice error:", e.message);
      await bot.sendMessage(chatId, `❌ <b>Error sending invoice:</b> ${h(e.message)}`, { parse_mode: "HTML" });
    }
    return;
  }

  if (state.step === "upi_id") {
    const upiIdVal = text.trim();
    if (!upiIdVal || upiIdVal.length < 3) {
      await bot.sendMessage(chatId, "❌ Please enter a valid UPI ID (e.g. yourname@upi).");
      return;
    }
    state.upiId = upiIdVal;
    state.step = "inr_rate";
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `🇮🇳 <b>SET INR VOTE RATE</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<blockquote>How many votes per ₹1?\n\nExample: <code>45</code> → ₹1 = 45 votes</blockquote>`,
      { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
    );
    return;
  }

  if (state.step === "inr_rate") {
    const rate = parseInt(text, 10);
    if (isNaN(rate) || rate < 1) {
      await bot.sendMessage(chatId, "❌ Please enter a valid number (minimum 1).");
      return;
    }
    state.votesPerInr = rate;
    if (state.currency === "both") {
      state.step = "stars_rate";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `⭐ <b>SET STARS VOTE RATE</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>How many votes per 1 Star?\n\nExample: <code>5</code> → 1 ⭐ = 5 votes</blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    } else {
      // Ask if Stars voting should also be enabled
      state.step = "ask_stars_paid";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `✅ <b>INR Rate Set!</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>⭐ Kya aap <b>Telegram Stars</b> se bhi paid votes enable karna chahte ho?\n\n` +
        `Stars se voting fully automatic hoti hai — koi approval nahi chahiye.</blockquote>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "⭐ Haan, Stars bhi add karo", callback_data: "add_stars_yes" },
                { text: "❌ Nahi, skip karo", callback_data: "add_stars_no" }
              ]
            ]
          }
        }
      );
    }
    return;
  }

  if (state.step === "stars_rate") {
    const rate = parseInt(text, 10);
    if (isNaN(rate) || rate < 1) {
      await bot.sendMessage(chatId, "❌ Please enter a valid number (minimum 1).");
      return;
    }
    state.votesPerStar = rate;
    userState.set(userId, state);
    await bot.sendMessage(chatId, "✅ <b>Rates recorded!</b>", { parse_mode: "HTML" });
    await askCustomPhotoOrFinish(userId, chatId, state.qrFileId);
    return;
  }

  if (state.step === "reg_chat") {
    try {
      const chatInfo = await bot.getChat(text);
      const data = { title: chatInfo.title || text, type: chatInfo.type, addedBy: userId, username: chatInfo.username || null };
      registeredChannels.set(String(chatInfo.id), data);
      await saveChannel(String(chatInfo.id), data);
      userState.delete(userId);
      await bot.sendMessage(chatId,
        `<b>✅ ${h(state.type === "channel" ? "Channel" : "Group")} Registered!</b>\n\n` +
        `<b>${h(chatInfo.title || text)}</b>\n` +
        `ID: <code>${chatInfo.id}</code>`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
      );
    } catch {
      await bot.sendMessage(chatId, `❌ Chat not found. Make sure the bot is an admin in the channel, then try again.`, { parse_mode: "HTML" });
    }
    return;
  }

  // ─── Admin: set custom welcome text ───
  if (state?.step === "set_welcome_msg" && isAdmin(userId)) {
    userState.delete(userId);
    customWelcomeText = text || null;
    await saveConfig("customWelcomeText", customWelcomeText);
    await bot.sendMessage(chatId,
      `✅ <b>Custom welcome message set!</b>\n\n<blockquote>${h((text || "").slice(0, 200))}</blockquote>\n\n<i>Ab /start karo preview dekhne ke liye.</i>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ─── Admin: set welcome image URL ───
  if (state.step === "set_welcome_image_url" && isAdmin(userId)) {
    const url = text.trim();
    if (!url.startsWith("http")) {
      await bot.sendMessage(chatId, "❌ Please send a valid URL starting with http/https.");
      return;
    }
    welcomeImageUrl = url;
    await saveConfig("welcomeImageUrl", url);
    userState.delete(userId);
    await bot.sendMessage(chatId,
      `✅ <b>Welcome image URL updated!</b>\n\nURL: <code>${h(url)}</code>\n\nThis image will appear in <b>spoiler mode</b> when users run /start. 🎭`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ─── Admin: set force join channel ID ───
  if (state.step === "set_force_join" && isAdmin(userId)) {
    const chId = text.trim();
    if (!chId.startsWith("-")) {
      await bot.sendMessage(chatId, "❌ Please send a valid Channel ID.\nFormat: <code>-1001234567890</code>\n\n<i>Use @getidsbot to get a Channel ID.</i>", { parse_mode: "HTML" });
      return;
    }
    const idx = state.channelIndex;
    forceJoinChannels[idx] = { ...DEFAULT_FORCE_CHANNELS[idx], id: chId };
    await saveConfig("forceJoinChannels", forceJoinChannels);
    userState.delete(userId);
    await bot.sendMessage(chatId,
      `✅ <b>Force Join Channel ${idx + 1} ID set ho gaya!</b>\n\n` +
      `◈ Label  ▸ ${forceJoinChannels[idx].label}\n` +
      `◈ ID     ▸ <code>${chId}</code>\n` +
      `◈ Link   ▸ ${forceJoinChannels[idx].link}\n\n` +
      `Ab users join verify ho sakenge.`,
      { parse_mode: "HTML" }
    );
    return;
  }
  } catch (e) { console.error("⚠️ message handler error:", e.message); }
});

// ============================================================
// PAYMENT HANDLERS (Telegram Stars)
// ============================================================

bot.on("pre_checkout_query", async (q) => {
  await bot.answerPreCheckoutQuery(q.id, true).catch(e => console.error("pre_checkout:", e.message));
});

bot.on("message", async (msg) => {
  if (!msg.successful_payment) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const payload = msg.successful_payment.invoice_payload;
  const stars = msg.successful_payment.total_amount;

  if (payload.startsWith("vip_")) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    const vipData = { vip: true, plan: "30 Days", expiry, startedAt: new Date(), days: 30 };
    vipUsers.set(userId, vipData);
    await saveVip(userId, vipData);
    await bot.sendMessage(chatId,
      `<b>👑 VIP Activated!</b>\n\n📅 Shuru:  <b>${safeFormatDateTime(new Date())}</b>\n⏳ Khatam: <b>${safeFormatDateTime(expiry)}</b>\n⏱️ Baki:   <b>${timeRemaining(expiry)}</b>`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
    );
    return;
  }

  if (payload.startsWith("paid_vote_")) {
    const parts = payload.split("_");
    const gId = parts[2];
    const participantUserId = Number(parts[3]);
    const g = getGiveaway(gId);
    if (!g) return;
    const participant = g.participants.get(participantUserId);
    if (!participant) return;
    const votesToAdd = stars * g.votesPerStar;
    participant.votes += votesToAdd;
    await saveGiveaway(g);
    await updateChannelPost(g, participant);
    await bot.sendMessage(chatId,
      `⭐ <b>Stars Payment Successful!</b>\n\n` +
      `<blockquote>` +
      `◈ Stars Spent  ▸  <b>${stars} ⭐</b>\n` +
      `◈ Votes Added  ▸  +<b>${votesToAdd}</b> 🗳️\n` +
      `◈ Total Votes  ▸  <b>${participant.votes}</b>\n` +
      `◈ Giveaway     ▸  <b>${h(g.title)}</b>` +
      `</blockquote>`,
      { parse_mode: "HTML" }
    );
    const su = botUsers.get(userId);
    const suName = su?.firstName ? h(su.firstName) : "Unknown";
    const suHandle = su?.username ? `@${su.username}` : `ID: ${userId}`;
    await notifyAdmin(
      `⭐ <b>Stars Vote Purchase</b>\n` +
      `<blockquote>` +
      `◈ From     ▸  <b>${suName}</b> (${suHandle})\n` +
      `◈ User ID  ▸  <code>${userId}</code>\n` +
      `◈ Stars    ▸  <b>${stars} ⭐</b>\n` +
      `◈ Votes    ▸  +<b>${votesToAdd}</b>\n` +
      `◈ For      ▸  <b>${h(participant.name)}</b>\n` +
      `◈ Giveaway ▸  <b>${h(g.title)}</b>` +
      `</blockquote>`
    );
    // Channel notification for Stars paid votes
    if (g.channelId) {
      try {
        await bot.sendMessage(g.channelId,
          `⭐ <b>Stars Votes Purchased!</b>\n\n` +
          `<blockquote>` +
          `◈ Participant  ▸  <b>${h(participant.name)}</b>\n` +
          `◈ Stars Spent  ▸  <b>${stars} ⭐</b>\n` +
          `◈ Votes Added  ▸  +<b>${votesToAdd}</b> 🗳️\n` +
          `◈ Giveaway     ▸  <b>${h(g.title)}</b>` +
          `</blockquote>`,
          { parse_mode: "HTML" }
        );
      } catch {}
    }
    return;
  }
});

// ============================================================
// CHANNEL MEMBER LEFT — Vote Auto-Remove
// ============================================================

bot.on("chat_member", async (update) => {
  try {
  const { chat, new_chat_member, old_chat_member } = update;
  const wasActive = ["member", "administrator", "creator"].includes(old_chat_member?.status);
  const isGone = ["left", "kicked", "banned"].includes(new_chat_member?.status);
  if (!wasActive || !isGone) return;

  const channelId = String(chat.id);
  const leftUserId = new_chat_member.user.id;
  const leftName = new_chat_member.user.first_name + (new_chat_member.user.last_name ? ` ${new_chat_member.user.last_name}` : "");

  for (const [gId, g] of giveaways) {
    if (String(g.channelId) !== channelId || !g.active) continue;

    const votedFor = g.voterMap?.get(leftUserId);
    if (votedFor) {
      const p = g.participants.get(votedFor);
      if (p) {
        p.votes = Math.max(0, p.votes - 1);
        p.voters.delete(leftUserId);
        g.voterMap.delete(leftUserId);
        await saveGiveaway(g);
        await updateChannelPost(g, p);

        try {
          await bot.sendMessage(channelId,
            `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
            `  ♻️  <b>VOTE AUTO-REMOVED</b>  ♻️\n` +
            `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
            `<blockquote>` +
            `👤 <b>${h(leftName)}</b> has left the channel.\n` +
            `🏅 Affected Participant: <b>${h(p.name)}</b>\n` +
            `🗳️ Updated Vote Count: <b>${p.votes}</b>` +
            `</blockquote>\n\n` +
            `<i>✦ DRS Auto-Sync System — Vote integrity maintained.</i>`,
            { parse_mode: "HTML" }
          );
        } catch (e) { console.error("Leave channel announcement:", e.message); }

        try {
          await bot.sendMessage(p.id,
            `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
            `  ⚠️  <b>VOTE DEDUCTION ALERT</b>\n` +
            `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
            `<blockquote>` +
            `A voter (<b>${h(leftName)}</b>) has left the channel.\n\n` +
            `▸ 1 vote has been auto-removed from your count.\n` +
            `🗳️ New Vote Total: <b>${p.votes}</b>` +
            `</blockquote>\n\n` +
            `<i>Share your link to regain votes!</i>\n` +
            `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
            { parse_mode: "HTML" }
          );
        } catch {}
      }
    }

    const participantData = g.participants.get(leftUserId);
    if (participantData) {
      const theirVotedFor = g.voterMap?.get(leftUserId);
      if (theirVotedFor) {
        const theirP = g.participants.get(theirVotedFor);
        if (theirP) {
          theirP.votes = Math.max(0, theirP.votes - 1);
          theirP.voters.delete(leftUserId); // fix: also remove from voters Set so they can vote again on rejoin
          await updateChannelPost(g, theirP);
        }
        g.voterMap.delete(leftUserId);
        await saveGiveaway(g);
      }
      // Notify channel that a participant has left
      try {
        await bot.sendMessage(channelId,
          `◈━━━━━━━━━━━━━━━━━━━━━◈\n` +
          `  ⚠️  <b>PARTICIPANT LEFT</b>\n` +
          `◈━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
          `<blockquote>` +
          `👤 <b>${h(leftName)}</b> has left the channel.\n` +
          `🗳️ Their participation in <b>${h(g.title)}</b> has been affected.\n` +
          `📊 Votes auto-updated by DRS System.` +
          `</blockquote>\n\n` +
          `✦ ─── <b>@${BOT_USERNAME}</b> ─── ✦`,
          { parse_mode: "HTML" }
        );
      } catch (e) { console.error("Participant left announcement:", e.message); }
      await notifyAdmin(
        `🚪 <b>Participant Left Channel</b>\n` +
        `User: <b>${h(leftName)}</b> (<code>${leftUserId}</code>)\n` +
        `Giveaway: <b>${h(g.title)}</b>`
      );
    }
  }
  } catch (e) { console.error("⚠️ chat_member handler error:", e.message); }
});

// ============================================================
// USER COMMANDS
// ============================================================

bot.onText(/\/membership/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const badge = membershipBadge(userId);
  const m = getMembership(userId);
  const text =
    `⭐ <b>MEMBERSHIP — ${badge}</b>\n\n` +
    `🐉 <u>PREMIUM FEATURES</u> 🌀\n` +
    `──────────◈◈◈──────────\n\n` +
    `<blockquote>🐉 Add your own custom thumbnail / vote post image</blockquote>\n\n` +
    `<blockquote>🐉 Auto vote deduction if a user leaves after voting 🧿</blockquote>\n\n` +
    `<blockquote>🐉 Add 1 extra Force-Join channel/group before voting 🌀</blockquote>\n\n` +
    `<blockquote>🐉 Set 1 main Force-Join for all bot users\n✅ (Available only with minimum 1-week membership 🥹)</blockquote>\n\n` +
    `──────────◈◈◈──────────\n` +
    `Upgrade to unlock 🤌 <b>full control &amp; maximum reach</b> 👁️`;
  const kb = m
    ? { inline_keyboard: [[{ text: "◀️ Back", callback_data: "main_menu" }]] }
    : { inline_keyboard: buildPlanButtons() };
  await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: kb });
});

// /myplan — Any user: check own VIP membership status
bot.onText(/\/myplan/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const m = getMembership(userId);
  const now = new Date();

  if (!m) {
    return bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   👑  <b>MERA PLAN</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>❌ <b>Koi active membership nahi hai.</b>\n\nVIP lene ke liye /membership use karo.</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [
        [{ text: "👑 VIP Lena Hai", callback_data: "vip_membership" }],
        [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
      ]}}
    );
    return;
  }

  const startedAt = m.startedAt ? new Date(m.startedAt) : null;
  const expiry    = m.expiry    ? new Date(m.expiry)    : null;
  const msLeft    = expiry ? expiry.getTime() - now.getTime() : null;
  const daysLeft  = msLeft ? Math.ceil(msLeft / 86400000) : null;
  const hoursLeft = msLeft ? Math.floor((msLeft % 86400000) / 3600000) : null;
  const minsLeft  = msLeft ? Math.floor((msLeft % 3600000) / 60000) : null;

  let progressBar = "";
  if (startedAt && expiry && m.days) {
    const totalMs  = expiry.getTime() - startedAt.getTime();
    const usedMs   = now.getTime() - startedAt.getTime();
    const pct      = Math.max(0, Math.min(100, Math.round((usedMs / totalMs) * 100)));
    const filled   = Math.round(pct / 10);
    progressBar    = `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${pct}% used`;
  }

  const text =
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `   👑  <b>MERA PLAN</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `✅ <b>VIP Active Hai!</b>\n\n` +
    `⭐ <b>Plan  :</b>  ${m.plan || "VIP"}\n` +
    `📅 <b>Shuru :</b>  ${safeFormatDateTime(startedAt)}\n` +
    `⏳ <b>Khatam:</b>  ${safeFormatDateTime(expiry)}\n` +
    `⏱️ <b>Baki  :</b>  ${timeRemaining(expiry)}\n` +
    (daysLeft !== null ? `📆 <b>Days  :</b>  ${daysLeft}d ${hoursLeft}h ${minsLeft}m\n` : "") +
    (progressBar ? `\n<code>${progressBar}</code>` : "") +
    `</blockquote>\n\n` +
    `✦ ─── <b>DRS NETWORK</b> ─── ✦`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] }
  });
});

bot.onText(/\/stats/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(msg.chat.id, `<b>◆ Admin only command.</b>`, { parse_mode: "HTML" });
  }
  const chatId = msg.chat.id;
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }).replace(",", "");

  const totalUsers    = botUsers.size;
  const channels      = [...registeredChannels.values()].filter(c => c.type === "channel");
  const groups        = [...registeredChannels.values()].filter(c => c.type === "group" || c.type === "supergroup");
  const allGiveaways  = [...giveaways.values()];
  const activeG       = allGiveaways.filter(g => g.active);
  const endedG        = allGiveaways.filter(g => !g.active);
  const totalParts    = allGiveaways.reduce((s, g) => s + g.participants.size, 0);
  const totalVotes    = allGiveaways.reduce((s, g) =>
    s + [...g.participants.values()].reduce((sv, p) => sv + p.votes, 0), 0);
  const vipCount      = [...vipUsers.values()].filter(v => v.vip && (!v.expiry || new Date() < v.expiry)).length;

  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  ◆  <b>BOT STATISTICS</b>  ◆\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `👥 Total Users      ▸  <b>${totalUsers}</b>\n` +
    `📢 Channels         ▸  <b>${channels.length}</b>\n` +
    `🏘️ Groups            ▸  <b>${groups.length}</b>\n` +
    `💎 VIP Members      ▸  <b>${vipCount}</b>` +
    `</blockquote>\n\n` +
    `━━━◈ <b>GIVEAWAYS</b> ◈━━━\n\n` +
    `<blockquote>` +
    `◈ Active Giveaways  ▸  <b>${activeG.length}</b>\n` +
    `◈ Ended Giveaways   ▸  <b>${endedG.length}</b>\n` +
    `◈ Total Giveaways   ▸  <b>${allGiveaways.length}</b>\n` +
    `◈ Total Participants▸  <b>${totalParts}</b>\n` +
    `◈ Total Votes Cast  ▸  <b>${totalVotes}</b>` +
    `</blockquote>\n\n` +
    `━━━◈━━━━━━━━━━━━━━━━━◈━━━\n` +
    `<i>📅 ${now} IST</i>\n` +
    `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
    { parse_mode: "HTML" }
  );
});

bot.onText(/\/topvoters/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  const userGiveaways = [...giveaways.entries()].filter(([, g]) =>
    g.creatorId === userId || isAdmin(userId)
  );

  if (!userGiveaways.length) {
    return bot.sendMessage(chatId,
      `<b>◆ No giveaways found.</b>\n\nCreate a giveaway first.`,
      { parse_mode: "HTML" }
    );
  }

  const buttons = userGiveaways.map(([gId, g]) => [{
    text: `${g.active ? "🟢" : "🔴"} ${g.title.slice(0, 28)}  ·  ${g.participants.size} 👥`,
    callback_data: `topvoters:${gId}`
  }]);

  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  ◆  <b>TOP PARTICIPANTS</b>  ◆\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>Select a giveaway to see\nwho is leading in the vote count:</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
});

// ─── /help — Full user guide with all commands ───
bot.onText(/\/help/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `   📖  <b>𝐃𝐑𝐒 𝐁𝐎𝐓 — ᴜꜱᴇʀ ɢᴜɪᴅᴇ</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<b>🎯 ᴀʟʟ ᴄᴏᴍᴍᴀɴᴅꜱ</b>\n` +
    `<blockquote>` +
    `/start — ᴍᴀɪɴ ᴍᴇɴᴜ\n` +
    `/membership — ᴠɪᴘ ᴘʟᴀɴꜱ &amp; ᴘᴜʀᴄʜᴀꜱᴇ\n` +
    `/myplan — ʏᴏᴜʀ ᴠɪᴘ ꜱᴛᴀᴛᴜꜱ &amp; ᴇxᴘɪʀʏ\n` +
    `/leaderboard — ʟɪᴠᴇ ɢɪᴠᴇᴀᴡᴀʏ ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ\n` +
    `/mystats — ʏᴏᴜʀ ᴘᴇʀꜱᴏɴᴀʟ ꜱᴛᴀᴛꜱ\n` +
    `/createpost — ᴘᴏꜱᴛ ᴛᴏ ʏᴏᴜʀ ᴄʜᴀɴɴᴇʟ\n` +
    `/topvoters — ᴛᴏᴘ ᴘᴀʀᴛɪᴄɪᴘᴀɴᴛꜱ ʀᴀɴᴋɪɴɢ\n` +
    `/active — ᴀʟʟ ʟɪᴠᴇ ɢɪᴠᴇᴀᴡᴀʏꜱ\n` +
    `/winners — ʟᴀꜱᴛ ɢɪᴠᴇᴀᴡᴀʏ ᴡɪɴɴᴇʀꜱ\n` +
    `/glink — ɢᴇᴛ ɢɪᴠᴇᴀᴡᴀʏ ᴊᴏɪɴ ʟɪɴᴋ\n` +
    `/support — ᴄᴏɴᴛᴀᴄᴛ ꜱᴜᴘᴘᴏʀᴛ` +
    `</blockquote>\n\n` +
    `<b>🎁 ɢɪᴠᴇᴀᴡᴀʏ ʙᴀɴᴀɴᴇ ᴋᴀ ᴛᴀʀɪᴋᴀ</b>\n` +
    `<blockquote>` +
    `1️⃣ ʙᴏᴛ ᴋᴏ ᴄʜᴀɴɴᴇʟ ᴍᴇɪɴ <b>Admin</b> ʙᴀɴᴀᴏ\n` +
    `2️⃣ 🎁 <b>New Giveaway</b> ᴛᴀᴘ ᴋᴀʀᴏ\n` +
    `3️⃣ ᴡɪᴢᴀʀᴅ ꜰᴏʟʟᴏᴡ ᴋᴀʀᴏ — ᴛɪᴛʟᴇ → ᴄʜᴀɴɴᴇʟ → ᴇɴᴅ ᴛɪᴍᴇ\n` +
    `4️⃣ ᴘᴀʀᴛɪᴄɪᴘᴀᴛɪᴏɴ ʟɪɴᴋ ꜱʜᴀʀᴇ ᴋᴀʀᴏ\n` +
    `5️⃣ ʙᴏᴛ ᴀᴜᴛᴏ ᴠᴏᴛᴇ ᴄᴀʀᴅ ᴘᴏꜱᴛ ᴋᴀʀᴇɢᴀ!` +
    `</blockquote>\n\n` +
    `<b>🗳️ ᴠᴏᴛɪɴɢ ᴋᴀɪꜱᴇ ᴋᴀᴍ ᴋᴀʀᴛɪ ʜᴀɪ</b>\n` +
    `<blockquote>` +
    `▸ ᴜꜱᴇʀꜱ ʟɪɴᴋ ꜱᴇ ᴊᴏɪɴ ᴋᴀʀᴛᴇ ʜᴀɪɴ\n` +
    `▸ ᴠᴏᴛᴇ ᴄᴀʀᴅ ᴄʜᴀɴɴᴇʟ ᴘᴇ ᴀᴜᴛᴏ ᴘᴏꜱᴛ ʜᴏᴛᴀ ʜᴀɪ\n` +
    `▸ ꜱɪʀꜰ ᴄʜᴀɴɴᴇʟ ᴍᴇᴍʙᴇʀ ᴠᴏᴛᴇ ᴅᴇ ꜱᴀᴋᴛᴇ ʜᴀɪɴ ⚠️\n` +
    `▸ ᴄʜᴀɴɴᴇʟ ᴄʜᴏᴅᴏ = ᴠᴏᴛᴇꜱ ᴀᴜᴛᴏ ʀᴇᴍᴏᴠᴇ\n` +
    `▸ ᴇxᴛʀᴀ ᴠᴏᴛᴇꜱ: INR 🇮🇳 ʏᴀ ⭐ Stars ꜱᴇ ᴋʜᴀʀɪᴅᴏ` +
    `</blockquote>\n\n` +
    `<b>👑 ᴠɪᴘ ʙᴇɴᴇꜰɪᴛꜱ</b>\n` +
    `<blockquote>` +
    `▸ ᴄᴜꜱᴛᴏᴍ ᴛʜᴜᴍʙɴᴀɪʟ ᴏɴ ᴠᴏᴛᴇ ᴘᴏꜱᴛꜱ\n` +
    `▸ ᴀᴜᴛᴏ ᴠᴏᴛᴇ-ᴅᴇᴅᴜᴄᴛɪᴏɴ ᴏɴ ᴄʜᴀɴɴᴇʟ ʟᴇᴀᴠᴇ\n` +
    `▸ ᴇxᴛʀᴀ ꜰᴏʀᴄᴇ-ᴊᴏɪɴ ɢᴀᴛᴇ ᴘᴇʀ ɢɪᴠᴇᴀᴡᴀʏ\n` +
    `▸ ɢʟᴏʙᴀʟ ꜰᴏʀᴄᴇ-ᴊᴏɪɴ (7D+ ᴘʟᴀɴ)\n` +
    `▸ ᴜɴʟɪᴍɪᴛᴇᴅ ɢɪᴠᴇᴀᴡᴀʏꜱ` +
    `</blockquote>\n\n` +
    `✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️\n` +
    `<blockquote>⚡️ ᴘᴏᴡᴇʀᴇᴅ : <a href="https://t.me/rchiex">𝐃𝐑𝐒 ɴᴇᴛᴡᴏʀᴋ</a> ❤️‍🔥\n` +
    `❤️ ꜱᴜᴘᴘᴏʀᴛ :— <a href="https://t.me/drssupport">𝐀𝐁𝐇𝐈𝐒𝐇𝐄𝐊</a> ❤️‍🔥</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } }
  );
});

// ─── /leaderboard — Quick live leaderboard of user's active giveaway ───
bot.onText(/\/leaderboard/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const active = [...giveaways.entries()].filter(([, g]) =>
    g.active && (g.creatorId === userId || isAdmin(userId))
  );
  if (!active.length) {
    return bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  🏆  <b>ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>◈ Koi active giveaway nahi mila.\n\nPehle ek giveaway create karo!</blockquote>`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🎁 ɴᴇᴡ ɢɪᴠᴇᴀᴡᴀʏ", callback_data: "new_giveaway" }]] } }
    );
  }
  const buttons = active.map(([gId, g]) => [{
    text: `🟢 ${g.title.slice(0, 28)} · ${g.participants.size} 👥`,
    callback_data: `lb:${gId}`
  }]);
  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🏆  <b>ʟɪᴠᴇ ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>Apna active giveaway select karo:</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
});

// ─── /mystats — User's personal giveaway statistics ───
bot.onText(/\/mystats/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const myG = [...giveaways.values()].filter(g => g.creatorId === userId);
  const activeCount = myG.filter(g => g.active).length;
  const endedCount = myG.filter(g => !g.active).length;
  const totalPart = myG.reduce((s, g) => s + (g.participants?.size || 0), 0);
  const totalVotes = myG.reduce((s, g) => {
    if (!g.voterMap) return s;
    let v = 0; for (const c of g.voterMap.values()) v += c; return s + v;
  }, 0);
  const m = getMembership(userId);
  const vipLine = m ? `👑 VIP ᴀᴄᴛɪᴠᴇ — ${timeRemaining(m.expiry)} ʙᴀᴋɪ` : `❌ ꜰʀᴇᴇ ᴜꜱᴇʀ`;
  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  📊  <b>ᴍʏ ꜱᴛᴀᴛꜱ</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `◈ ꜱᴛᴀᴛᴜꜱ          ▸  ${vipLine}\n` +
    `◈ ᴛᴏᴛᴀʟ ɢɪᴠᴇᴀᴡᴀʏꜱ ▸  ${myG.length}\n` +
    `◈ ᴀᴄᴛɪᴠᴇ           ▸  ${activeCount}\n` +
    `◈ ᴇɴᴅᴇᴅ            ▸  ${endedCount}\n` +
    `◈ ᴛᴏᴛᴀʟ ᴘᴀʀᴛɪᴄɪᴘᴀɴᴛꜱ ▸  ${totalPart}\n` +
    `◈ ᴛᴏᴛᴀʟ ᴠᴏᴛᴇꜱ ᴄᴀꜱᴛ  ▸  ${totalVotes}` +
    `</blockquote>\n\n` +
    `✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } }
  );
});

// ─── /ping — Check bot response time ───
bot.onText(/\/ping/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const t = Date.now();
  const m = await bot.sendMessage(chatId, `🏓 <b>ᴘᴏɴɢ!</b>`, { parse_mode: "HTML" });
  const ms = Date.now() - t;
  await bot.editMessageText(
    `🏓 <b>ᴘᴏɴɢ!</b>\n\n<blockquote>◈ ʀᴇꜱᴘᴏɴꜱᴇ ᴛɪᴍᴇ ▸  <b>${ms}ms</b>\n◈ ꜱᴛᴀᴛᴜꜱ ▸  ✅ ᴏɴʟɪɴᴇ</blockquote>`,
    { chat_id: chatId, message_id: m.message_id, parse_mode: "HTML" }
  );
});

// ─── /myid — Show own Telegram user ID ───
bot.onText(/\/myid/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const u = msg.from;
  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🪪  <b>ʏᴏᴜʀ ɪᴅ ɪɴꜰᴏ</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `◈ ɴᴀᴍᴇ       ▸  <b>${h(u.first_name || "")}${u.last_name ? " " + h(u.last_name) : ""}</b>\n` +
    `◈ ᴜꜱᴇʀɴᴀᴍᴇ  ▸  ${u.username ? `@${u.username}` : "❌ ɴᴏɴᴇ"}\n` +
    `◈ ᴜꜱᴇʀ ɪᴅ   ▸  <code>${u.id}</code>\n` +
    `◈ ʟᴀɴɢ      ▸  ${u.language_code || "N/A"}` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /botstatus — Quick bot health overview ───
bot.onText(/\/botstatus/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const totalGiveaways = giveaways.size;
  const activeGiveaways = [...giveaways.values()].filter(g => g.active).length;
  const totalUsers = botUsers.size;
  const totalChannels = registeredChannels.size;
  const vipCount = [...botUsers.values()].filter(u => getMembership(u.id)).length;
  const pendingTotal = pendingPayments.size + pendingMembershipPayments.size;
  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🤖  <b>ʙᴏᴛ ꜱᴛᴀᴛᴜꜱ</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `◈ ꜱᴛᴀᴛᴜꜱ         ▸  ✅ ᴏɴʟɪɴᴇ\n` +
    `◈ ᴛᴏᴛᴀʟ ᴜꜱᴇʀꜱ    ▸  ${totalUsers}\n` +
    `◈ ᴠɪᴘ ᴜꜱᴇʀꜱ      ▸  ${vipCount}\n` +
    `◈ ᴛᴏᴛᴀʟ ɢɪᴠᴇᴀᴡᴀʏꜱ ▸  ${totalGiveaways}\n` +
    `◈ ᴀᴄᴛɪᴠᴇ ɢɪᴠᴇᴀᴡᴀʏꜱ ▸  ${activeGiveaways}\n` +
    `◈ ᴄʜᴀɴɴᴇʟꜱ       ▸  ${totalChannels}\n` +
    `◈ ᴘᴇɴᴅɪɴɢ ᴘᴀʏꜱ   ▸  ${pendingTotal}` +
    `</blockquote>\n\n` +
    `✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } }
  );
});

// ─── /setstartimage <url> — Admin: set welcome/start image in one line ───
bot.onText(/\/setstartimage(?:\s+(.+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const url = match[1]?.trim();
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return bot.sendMessage(chatId,
      `<b>🖼️ Set Start Image</b>\n\nUsage:\n<code>/setstartimage https://example.com/image.jpg</code>\n\n<i>Current: ${welcomeImageUrl ? `✅ Set` : "❌ Not set"}</i>`,
      { parse_mode: "HTML" }
    );
  }
  welcomeImageUrl = url;
  await saveConfig("welcomeImageUrl", url);
  await bot.sendMessage(chatId,
    `✅ <b>Start Image Updated!</b>\n\n` +
    `<blockquote>◈ URL ▸  <code>${h(url)}</code>\n\nUsers will see this new image on /start 🎁</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /clearstates — Admin: clear all stuck user states ───
bot.onText(/\/clearstates/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const count = userState.size;
  userState.clear();
  await bot.sendMessage(chatId,
    `✅ <b>User States Cleared</b>\n\n<blockquote>◈ Stuck states removed ▸  <b>${count}</b>\n\nSab users ab fresh state mein hain.</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /gcount — Admin: quick giveaway count breakdown ───
bot.onText(/\/gcount/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const all = [...giveaways.values()];
  const active = all.filter(g => g.active).length;
  const ended = all.filter(g => !g.active).length;
  const totalPart = all.reduce((s, g) => s + (g.participants?.size || 0), 0);
  const totalVotes = all.reduce((s, g) => {
    if (!g.voterMap) return s;
    let v = 0; for (const c of g.voterMap.values()) v += c; return s + v;
  }, 0);
  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🎁  <b>GIVEAWAY COUNT</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ Total Giveaways    ▸  ${all.length}\n` +
    `◈ Active             ▸  ${active}\n` +
    `◈ Ended              ▸  ${ended}\n` +
    `◈ Total Participants ▸  ${totalPart}\n` +
    `◈ Total Votes Cast   ▸  ${totalVotes}` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /topusers — Admin: top 10 users by giveaways created ───
bot.onText(/\/topusers/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const countMap = new Map();
  for (const g of giveaways.values()) {
    countMap.set(g.creatorId, (countMap.get(g.creatorId) || 0) + 1);
  }
  const sorted = [...countMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!sorted.length) {
    return bot.sendMessage(chatId, `<b>No giveaways found.</b>`, { parse_mode: "HTML" });
  }
  const medals = ["🥇", "🥈", "🥉"];
  let lines = "";
  for (let i = 0; i < sorted.length; i++) {
    const [uid, cnt] = sorted[i];
    const u = botUsers.get(uid);
    const name = u ? h(u.first_name || String(uid)) : String(uid);
    const handle = u?.username ? ` (@${u.username})` : "";
    lines += `${medals[i] || `${i + 1}.`}  <b>${name}</b>${handle}  ▸  ${cnt} giveaway${cnt > 1 ? "s" : ""}\n`;
  }
  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🏆  <b>TOP USERS (by Giveaways)</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>${lines.trim()}</blockquote>`,
    { parse_mode: "HTML" }
  );
});

bot.onText(/\/createpost/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const myChannels = [...registeredChannels.entries()].filter(([, c]) => c.addedBy === userId || isAdmin(userId));
  if (!myChannels.length) {
    return bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ◆  <b>CREATE POST</b>  ◆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>◈ No registered channels found.\n\n` +
      `Add the bot as <b>Admin</b> to your channel first —\n` +
      `it will be automatically registered.</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML" }
    );
  }
  if (myChannels.length === 1) {
    const [[chId, ch]] = myChannels;
    userState.set(userId, { step: "cp_compose", channelId: chId, channelTitle: ch.title, channelUsername: ch.username || null });
    return bot.sendMessage(chatId, cpComposePrompt(ch.title, ch.username, chId), { parse_mode: "HTML", reply_markup: cancelKeyboard() });
  }
  // Multiple channels — show selection
  const chButtons = myChannels.map(([chId, ch]) => [{
    text: `${ch.type === "channel" ? "📢" : "🏘️"}  ${ch.title.slice(0, 28)}`,
    callback_data: `cp_ch:${chId}`
  }]);
  chButtons.push([{ text: "❌ Cancel", callback_data: "cancel_flow" }]);
  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  ◆  <b>CREATE POST</b>  ◆\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>Which channel do you want to post to?\nSelect one below:</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: chButtons } }
  );
});

// ============================================================
// MAIN ADMIN COMMANDS
// ============================================================

// ── Broadcast progress bar helper ──
function buildProgressBar(pct) {
  const filled = Math.round(pct / 10);
  return `[${"█".repeat(filled)}${"░".repeat(10 - filled)}] ${pct}%`;
}

// ── Broadcast helper ──
// target: "users" | "channels" | "groups" | "all"
async function doBroadcast(adminChatId, adminMsg, textContent, silent, target = "all", composeMsg = null, progressMsgId = null) {
  const channelIds = [...registeredChannels.entries()]
    .filter(([, c]) => c.type === "channel")
    .map(([id]) => id);
  const groupIds = [...registeredChannels.entries()]
    .filter(([, c]) => c.type === "group" || c.type === "supergroup")
    .map(([id]) => id);
  const userIds = [...botUsers.keys()];

  let targets = [];
  if (target === "users")         targets = userIds;
  else if (target === "channels") targets = channelIds;
  else if (target === "groups")   targets = groupIds;
  else targets = [...new Set([...channelIds, ...groupIds, ...userIds])];

  const targetLabel = { users: "👥 Users", channels: "📢 Channels", groups: "🏘️ Groups", all: "🌐 All" }[target];
  const replyTo = adminMsg?.reply_to_message;
  let sent = 0, failed = 0;
  const total = targets.length;
  let lastPct = -1;

  const updateProgress = async (done) => {
    if (!progressMsgId) return;
    const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
    const rounded = Math.floor(pct / 10) * 10;
    if (rounded === lastPct) return;
    lastPct = rounded;
    try {
      await bot.editMessageText(
        `╔══════════════════════╗\n` +
        `║  📢  <b>BROADCASTING</b>  ║\n` +
        `╠══════════════════════╣\n` +
        `<blockquote>` +
        `🎯 Target  » ${targetLabel}\n` +
        `📊 Progress » <code>${buildProgressBar(rounded)}</code>\n` +
        `✅ Sent     » ${sent}\n` +
        `❌ Failed   » ${failed}` +
        `</blockquote>\n` +
        `╚══════════════════════╝`,
        { chat_id: adminChatId, message_id: progressMsgId, parse_mode: "HTML" }
      );
    } catch {}
  };

  for (let i = 0; i < targets.length; i++) {
    const id = targets[i];
    try {
      if (composeMsg) {
        await bot.copyMessage(id, composeMsg.chat.id, composeMsg.message_id, {
          disable_notification: silent
        });
      } else if (replyTo) {
        await bot.copyMessage(id, adminMsg.chat.id, replyTo.message_id, {
          disable_notification: silent
        });
      } else {
        const caption =
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `  📢  <b>DRS BROADCAST</b>\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `<blockquote>${h(textContent)}</blockquote>\n\n` +
          `✦ ─── <b>@${BOT_USERNAME || "DRS_GiveawayBot"}</b> ─── ✦`;
        await bot.sendPhoto(id, GIVEAWAY_IMAGE_URL, {
          caption, parse_mode: "HTML", disable_notification: silent
        });
      }
      sent++;
    } catch { failed++; }
    await sleep(50);
    await updateProgress(i + 1);
  }

  // Final progress update — 100%
  if (progressMsgId) {
    try {
      await bot.editMessageText(
        `╔══════════════════════╗\n` +
        `║  ✅  <b>BROADCAST DONE</b>  ║\n` +
        `╠══════════════════════╣\n` +
        `<blockquote>` +
        `🎯 Target  » ${targetLabel}\n` +
        `📊 Progress » <code>${buildProgressBar(100)}</code>\n` +
        `✅ Sent     » ${sent}\n` +
        `❌ Failed   » ${failed}\n` +
        `📦 Total    » ${total}` +
        `</blockquote>\n` +
        `╚══════════════════════╝`,
        { chat_id: adminChatId, message_id: progressMsgId, parse_mode: "HTML" }
      );
    } catch {}
  }

  const modeStr = composeMsg ? "📎 Composed" : replyTo ? "📋 Message-Copy" : "🖼️ Image+Text";
  const notif = silent ? "🔕 Silent" : "🔔 LOUD";
  await bot.sendMessage(adminChatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  ${silent ? "📢" : "🔔"}  <b>BROADCAST REPORT</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ Target   ▸  ${targetLabel}\n` +
    `◈ Mode     ▸  ${notif} ${modeStr}\n` +
    `◈ Total    ▸  ${total}\n` +
    `◈ Sent     ▸  ✅ ${sent}\n` +
    `◈ Failed   ▸  ❌ ${failed}` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
}

// ── Show broadcast target selection menu ──
async function showBroadcastMenu(chatId, userId, adminMsg, text, silent, composeMsg = null) {
  userState.set(userId, { step: "broadcast_pending", adminMsg, text, silent, composeMsg });
  const notif = silent ? "🔕 Silent" : "🔔 LOUD";
  let mode, preview;
  if (composeMsg) {
    const t = composeMsg.photo ? "📷 Photo" : composeMsg.document ? "📄 Document" : composeMsg.video ? "🎥 Video" : composeMsg.audio ? "🎵 Audio" : composeMsg.voice ? "🎙️ Voice" : "📝 Text";
    const cap = composeMsg.caption || composeMsg.text || "";
    mode = `📎 Composed — ${t}`;
    preview = cap ? `Caption: <i>${h(cap.slice(0, 60))}${cap.length > 60 ? "..." : ""}</i>` : `${t} ready ✅`;
  } else if (adminMsg?.reply_to_message) {
    mode = "📋 Message-Copy";
    preview = "Copied message selected ✅";
  } else {
    mode = "🖼️ Image+Text";
    preview = text ? `Message: <i>${h(text.slice(0, 60))}${text.length > 60 ? "..." : ""}</i>` : "";
  }
  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  📢  <b>BROADCAST — ${notif}</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `Mode: ${mode}\n${preview}` +
    `</blockquote>\n\n` +
    `<b>Kahan bhejni hai broadcast?</b>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "👥 Users only", callback_data: "bc_target:users" },
            { text: "📢 Channels only", callback_data: "bc_target:channels" }
          ],
          [
            { text: "🏘️ Groups only", callback_data: "bc_target:groups" },
            { text: "🌐 All", callback_data: "bc_target:all" }
          ],
          [{ text: "❌ Cancel", callback_data: "bc_target:cancel" }]
        ]
      }
    }
  );
}

// /broadcast — Silent broadcast with target selection
bot.onText(/\/broadcast(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const text = match[1]?.trim();
  if (text || msg.reply_to_message) {
    return showBroadcastMenu(msg.chat.id, msg.from.id, msg, text || "", true);
  }
  // No text, no reply — ask admin to compose content
  userState.set(msg.from.id, { step: "broadcast_compose", silent: true });
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  📢  <b>BROADCAST — COMPOSE</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `Ab jo bhejni hai woh send karo:\n\n` +
    `▸ 📝 Text message\n` +
    `▸ 📷 Photo + caption (text)\n` +
    `▸ 📄 Document + caption (text)\n` +
    `▸ 🎥 Video + caption (text)\n` +
    `▸ 🎵 Audio / Voice note\n\n` +
    `<i>Ya /broadcast &lt;text&gt; likho seedha text ke liye</i>` +
    `</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "bc_target:cancel" }]] } }
  );
});

// /loud — LOUD broadcast with target selection
bot.onText(/\/loud(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const text = match[1]?.trim();
  if (text || msg.reply_to_message) {
    return showBroadcastMenu(msg.chat.id, msg.from.id, msg, text || "", false);
  }
  // No text, no reply — ask admin to compose content
  userState.set(msg.from.id, { step: "broadcast_compose", silent: false });
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🔔  <b>LOUD BROADCAST — COMPOSE</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `Ab jo bhejni hai woh send karo:\n\n` +
    `▸ 📝 Text message\n` +
    `▸ 📷 Photo + caption (text)\n` +
    `▸ 📄 Document + caption (text)\n` +
    `▸ 🎥 Video + caption (text)\n` +
    `▸ 🎵 Audio / Voice note\n\n` +
    `<i>Ya /loud &lt;text&gt; likho seedha text ke liye</i>` +
    `</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "bc_target:cancel" }]] } }
  );
});

bot.onText(/\/pin\s+(-?\d+)\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  try {
    const sent = await bot.sendMessage(match[1], `📌 <b>${h(match[2])}</b>`, { parse_mode: "HTML" });
    await bot.pinChatMessage(match[1], sent.message_id, { disable_notification: false });
    await bot.sendMessage(chatId, `✅ Message pinned in <code>${match[1]}</code>!`, { parse_mode: "HTML" });
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Error: ${h(e.message)}`, { parse_mode: "HTML" });
  }
});

bot.onText(/\/send\s+(-?\d+)\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  try {
    await bot.sendMessage(match[1], `<b>📩 DRS Message</b>\n\n${h(match[2])}`, { parse_mode: "HTML" });
    await bot.sendMessage(msg.chat.id, `✅ Message sent to <code>${match[1]}</code>!`, { parse_mode: "HTML" });
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Error: ${h(e.message)}`, { parse_mode: "HTML" });
  }
});

bot.onText(/\/sendloud\s+(-?\d+)\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  try {
    await bot.sendMessage(match[1], `<b>🔔 DRS Message</b>\n\n${h(match[2])}`, { parse_mode: "HTML", disable_notification: false });
    await bot.sendMessage(msg.chat.id, `✅ LOUD message sent to <code>${match[1]}</code>!`, { parse_mode: "HTML" });
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Error: ${h(e.message)}`, { parse_mode: "HTML" });
  }
});

bot.onText(/\/allchannels/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  if (!registeredChannels.size) return bot.sendMessage(msg.chat.id, "No registered channels found.");
  let text = "<b>📋 Registered Channels:</b>\n\n";
  for (const [id, c] of registeredChannels) {
    text += `• <b>${h(c.title)}</b> (<code>${id}</code>) — ${c.type}\n`;
  }
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/allgiveaways/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  if (!giveaways.size) return bot.sendMessage(msg.chat.id, "No giveaways found.");
  let text = "<b>📋 All Giveaways:</b>\n\n";
  for (const [id, g] of giveaways) {
    const total = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
    text += `<b>${h(g.title)}</b> | ID: <code>${id}</code> | ${g.active ? "🟢" : "🔴"} | Votes: ${total}\n`;
  }
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// /setwelcomeimageurl — Set welcome image via URL (displayed with spoiler effect)
bot.onText(/\/setwelcomeimageurl/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  userState.set(msg.from.id, { step: "set_welcome_image_url" });
  await bot.sendMessage(msg.chat.id,
    `<b>🖼️ Set Welcome Image via URL</b>\n\nSend the direct image URL (http/https).\nThis image will appear in <b>Spoiler Mode</b> 🎭 when users run /start.\n\n<i>Current: ${welcomeImageUrl ? "✅ Set" : "❌ Not set"}</i>`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
});

// /clearwelcomeimage — Remove welcome banner
bot.onText(/\/clearwelcomeimage/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  welcomeImageUrl = null;
  await saveConfig("welcomeImageUrl", null);
  await bot.sendMessage(msg.chat.id, "✅ Welcome banner image has been removed.", { parse_mode: "HTML" });
});

// /setmembershipqr — Admin uploads membership payment QR
bot.onText(/\/setmembershipqr/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  userState.set(msg.from.id, { step: "set_membership_qr" });
  await bot.sendMessage(msg.chat.id,
    `<b>📸 Set Membership Payment QR</b>\n\nSend the <b>QR photo</b> that users will see when purchasing membership.\n\n<i>Current: ${membershipQrFileId ? "✅ Set" : "❌ Not set"}</i>`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
});

// /imageinfo — Show current image status
bot.onText(/\/imageinfo/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id,
    `<b>🖼️ Image Status</b>\n\n` +
    `Welcome Image URL: ${welcomeImageUrl ? `✅ Set\n<code>${h(welcomeImageUrl)}</code>` : "❌ Not set"}\n` +
    `Membership QR: ${membershipQrFileId ? "✅ Set" : "❌ Not set"}`,
    { parse_mode: "HTML" }
  );
});

// /setforcejoin <index 1 or 2> — Configure force join channel
bot.onText(/\/setforcejoin(?:\s+(\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const idx = Math.max(0, Math.min(1, (Number(match[1] || 1) - 1)));
  const current = forceJoinChannels[idx];
  userState.set(msg.from.id, { step: "set_force_join", channelIndex: idx });
  await bot.sendMessage(msg.chat.id,
    `<b>⚙️ Set Force Join Channel ${idx + 1}</b>\n\n` +
    `Current: ${current?.id ? `✅ ID: <code>${current.id}</code>` : "❌ Not configured"}\n\n` +
    `Send in this format:\n<code>CHANNEL_ID INVITE_LINK LABEL</code>\n\n` +
    `Example:\n<code>-1001234567890 https://t.me/+xxx Free Contents</code>\n\n` +
    `<i>To get the Channel ID: make the bot an admin in that channel, then use @getidsbot.</i>`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
});

// /forcejoininfo — Show current force join config
bot.onText(/\/forcejoininfo/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  let text = `<b>📢 Force Join Config</b>\n\n`;
  forceJoinChannels.forEach((ch, i) => {
    text += `Channel ${i + 1}:\n`;
    text += `  ID: ${ch?.id ? `<code>${ch.id}</code>` : "❌ Not set"}\n`;
    text += `  Link: ${ch?.link || "❌ Not set"}\n`;
    text += `  Label: ${ch?.label || "❌ Not set"}\n\n`;
  });
  text += `<i>Use /setforcejoin 1 or /setforcejoin 2 to configure.</i>`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// ============================================================
// MEMBERSHIP ADMIN COMMANDS
// ============================================================

// /givemem — Admin: Give membership to a user
bot.onText(/\/givemem\s+(\d+)\s+(1d|7d|30d)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const planKey = match[2];
  const plan = getMembershipPlan(planKey);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + plan.days);
  const vipData = { vip: true, plan: plan.label, expiry, startedAt: new Date(), days: plan.days };
  vipUsers.set(targetId, vipData);
  await saveVip(targetId, vipData);
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  ✅  <b>MEMBERSHIP GRANTED</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ User ID  ▸  <code>${targetId}</code>\n` +
    `◈ Plan     ▸  <b>${plan.label}</b>\n` +
    `◈ Shuru  ▸  ${safeFormatDateTime(new Date())}\n` +
    `◈ Khatam ▸  ${safeFormatDateTime(expiry)}\n` +
    `◈ Baki   ▸  ${timeRemaining(expiry)}\n` +
    `◈ Access   ▸  Giveaway + Channel Post + Force Join` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
  try {
    await bot.sendMessage(targetId,
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `  🎊  <b>MEMBERSHIP ACTIVATED!</b>\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
      `<blockquote>` +
      `◈ Plan    ▸  <b>${plan.label}</b>\n` +
      `◈ Shuru  ▸  <b>${safeFormatDateTime(new Date())}</b>\n` +
      `◈ Khatam ▸  <b>${safeFormatDateTime(expiry)}</b>\n` +
      `◈ Baki   ▸  <b>${timeRemaining(expiry)}</b>\n\n` +
      `━━━◈ <b>YOUR FEATURES</b> ◈━━━\n\n` +
      `🎁 Create giveaways\n` +
      `📢 Post giveaway image in your channel\n` +
      `🔗 Set per-giveaway Force Join\n` +
      `📊 Full giveaway management panel\n\n` +
      `Use /myplan to check your status anytime.` +
      `</blockquote>`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🎁 Go to Bot", callback_data: "main_menu" }]] } }
    );
  } catch {}
});

// /removemem — Admin: Remove/revoke membership from a user
bot.onText(/\/removemem\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const existing = vipUsers.get(targetId);
  if (!existing?.vip) {
    return bot.sendMessage(msg.chat.id, `❌ User <code>${targetId}</code> has no active membership.`, { parse_mode: "HTML" });
  }
  vipUsers.set(targetId, { ...existing, vip: false });
  await saveVip(targetId, { ...existing, vip: false });
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🚫  <b>MEMBERSHIP REVOKED</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>◈ User ID  ▸  <code>${targetId}</code>\n◈ Status   ▸  ❌ Inactive</blockquote>`,
    { parse_mode: "HTML" }
  );
  try {
    await bot.sendMessage(targetId,
      `⚠️ <b>Membership Revoked</b>\n\n` +
      `<blockquote>Aapki DRS Bot membership admin ne revoke kar di hai.\nPremium features band ho gaye hain.</blockquote>`,
      { parse_mode: "HTML" }
    );
  } catch {}
});

// /extendmem — Admin: show usage when called without args
bot.onText(/^\/extendmem$/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  ⏰  <b>EXTEND MEMBERSHIP</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>Usage:\n` +
    `<code>/extendmem &lt;userId&gt; &lt;plan&gt;</code>\n\n` +
    `Plans:\n` +
    `▸ <code>1d</code>  — Extend 1 day\n` +
    `▸ <code>7d</code>  — Extend 7 days\n` +
    `▸ <code>30d</code> — Extend 30 days\n\n` +
    `Example:\n` +
    `<code>/extendmem 123456789 7d</code></blockquote>`,
    { parse_mode: "HTML" }
  );
});

// /extendmem — Admin: Extend existing membership
bot.onText(/\/extendmem\s+(\d+)\s+(1d|7d|30d)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const planKey = match[2];
  const plan = getMembershipPlan(planKey);
  const existing = vipUsers.get(targetId);
  const base = existing?.vip && existing.expiry && new Date(existing.expiry) > new Date()
    ? new Date(existing.expiry)
    : new Date();
  const expiry = new Date(base);
  expiry.setDate(expiry.getDate() + plan.days);
  const vipData = { vip: true, plan: plan.label, expiry, days: plan.days };
  vipUsers.set(targetId, vipData);
  await saveVip(targetId, vipData);
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  ⏰  <b>MEMBERSHIP EXTENDED</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ User ID    ▸  <code>${targetId}</code>\n` +
    `◈ Added      ▸  +${plan.days} days\n` +
    `◈ Naya Khatam ▸  <b>${safeFormatDateTime(expiry)}</b>\n` +
    `◈ Baki        ▸  <b>${timeRemaining(expiry)}</b>` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
  try {
    await bot.sendMessage(targetId,
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `  ⏰  <b>MEMBERSHIP EXTENDED!</b>\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
      `<blockquote>◈ Badha    ▸  +${plan.days} days\n◈ Khatam   ▸  <b>${safeFormatDateTime(expiry)}</b>\n◈ Baki     ▸  <b>${timeRemaining(expiry)}</b></blockquote>`,
      { parse_mode: "HTML" }
    );
  } catch {}
});

// /listmem — Admin: List all active VIP members
bot.onText(/\/listmem/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const active = [...vipUsers.entries()].filter(([, v]) => {
    if (!v.vip) return false;
    if (v.expiry && new Date() > new Date(v.expiry)) return false;
    return true;
  });
  if (!active.length) {
    return bot.sendMessage(msg.chat.id,
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n  📋  <b>ACTIVE MEMBERS</b>\n◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n<blockquote>No active members at the moment.</blockquote>`,
      { parse_mode: "HTML" }
    );
  }
  const now = new Date();
  let text =
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  📋  <b>ACTIVE MEMBERS</b> (${active.length})\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n`;
  for (const [uid, v] of active) {
    const expiry = v.expiry ? new Date(v.expiry) : null;
    const daysLeft = expiry ? Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)) : "∞";
    const bu = botUsers.get(uid);
    const nameStr = bu?.firstName ? `<b>${h(bu.firstName)}</b>${bu.username ? ` (@${bu.username})` : ""}` : `<i>Unknown</i>`;
    const permsObj = v.perms || {};
    const permStr = Object.keys(permsObj).length
      ? Object.entries(permsObj).map(([k,val]) => `${val ? "✅" : "❌"} ${k}`).join("  ")
      : "✅ All Enabled";
    text += `<blockquote>` +
      `👤 ${nameStr}\n` +
      `◈ ID       ▸ <code>${uid}</code>\n` +
      `◈ Plan     ▸ ${v.plan || "VIP"}\n` +
      `◈ Expires  ▸ ${expiry ? expiry.toLocaleDateString("en-IN") : "∞"}\n` +
      `◈ Days Left▸ ${daysLeft} days\n` +
      `◈ Perms    ▸ ${permStr}` +
      `</blockquote>\n\n`;
  }
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// /meminfo — Admin: Check a specific user's membership
bot.onText(/\/meminfo\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const v = vipUsers.get(targetId);
  const m = getMembership(targetId);
  if (!v) {
    return bot.sendMessage(msg.chat.id, `❌ No membership record found for user <code>${targetId}</code>.`, { parse_mode: "HTML" });
  }
  const expiry = v.expiry ? new Date(v.expiry) : null;
  const now = new Date();
  const daysLeft = expiry ? Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))) : "∞";
  const mbu = botUsers.get(targetId);
  const mNameStr = mbu?.firstName ? `${h(mbu.firstName)}${mbu.username ? ` (@${mbu.username})` : ""}` : "Unknown";
  const permsObj = v.perms || {};
  const permLines = Object.keys(permsObj).length
    ? Object.entries(permsObj).map(([k, val]) => `  ${val ? "✅" : "❌"} ${k}`).join("\n")
    : "  ✅ All Enabled (default)";
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🔍  <b>MEMBER INFO</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ Name      ▸  <b>${mNameStr}</b>\n` +
    `◈ User ID   ▸  <code>${targetId}</code>\n` +
    `◈ Status    ▸  ${m ? "✅ ACTIVE" : "❌ EXPIRED / INACTIVE"}\n` +
    `◈ Plan      ▸  ${v.plan || "VIP"}\n` +
    `◈ Expiry    ▸  ${expiry ? expiry.toLocaleDateString("en-IN") : "∞"}\n` +
    `◈ Days Left ▸  ${m ? daysLeft + " days" : "0"}\n` +
    `◈ Permissions:\n${permLines}` +
    `</blockquote>\n\n` +
    `<b>Quick Actions:</b>\n` +
    `/extendmem ${targetId} 7d — Extend 7 days\n` +
    `/removemem ${targetId} — Revoke membership\n` +
    `/viewperms ${targetId} — Permissions\n` +
    `/setperms ${targetId} &lt;perm&gt; &lt;on|off&gt; — Change permission`,
    { parse_mode: "HTML" }
  );
});

// /setplan — Admin: Update membership plan price
// Usage: /setplan 1d 15   (set 1-day plan to ₹15)
bot.onText(/\/setplan\s+(1d|7d|30d)\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const planKey = match[1];
  const price = Number(match[2]);
  if (isNaN(price) || price < 1) {
    return bot.sendMessage(msg.chat.id, "❌ Please send a valid price (e.g. <code>/setplan 1d 15</code>)", { parse_mode: "HTML" });
  }
  membershipPlans[planKey].price = price;
  await saveConfig("membershipPlans", membershipPlans);
  await bot.sendMessage(msg.chat.id,
    `✅ <b>Plan Price Updated</b>\n\n` +
    `<blockquote>` +
    `◈ Plan  ▸  <b>${membershipPlans[planKey].label}</b>\n` +
    `◈ Price ▸  <b>₹${price}</b>\n\n` +
    `📋 <b>All Plans Now:</b>\n` +
    `1D  → ₹${membershipPlans["1d"].price}\n` +
    `7D  → ₹${membershipPlans["7d"].price}\n` +
    `30D → ₹${membershipPlans["30d"].price}` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// /setfreelimit — Admin: Set how many free giveaways non-VIP users can create
// Usage: /setfreelimit 15        → allow up to 15 free giveaways
// Usage: /setfreelimit unlimited → unlimited free giveaways for everyone
// Usage: /setfreelimit limited   → revert to the current limit
bot.onText(/\/setfreelimit\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const val = match[1].toLowerCase();
  if (val === "unlimited") {
    freeUnlimited = true;
    await saveConfig("freeUnlimited", true);
    return bot.sendMessage(msg.chat.id,
      `✅ <b>Free Giveaway Mode: UNLIMITED</b>\n\n` +
      `<blockquote>All users (VIP &amp; non-VIP) can now create <b>unlimited giveaways</b> for free.\n\n` +
      `Use <code>/setfreelimit limited</code> or <code>/setfreelimit &lt;number&gt;</code> to restore the limit.</blockquote>`,
      { parse_mode: "HTML" }
    );
  }
  if (val === "limited") {
    freeUnlimited = false;
    await saveConfig("freeUnlimited", false);
    return bot.sendMessage(msg.chat.id,
      `✅ <b>Free Giveaway Mode: LIMITED</b>\n\n` +
      `<blockquote>Non-VIP users can create up to <b>${freeGiveawayLimit} giveaways</b> for free.\n\n` +
      `Use <code>/setfreelimit &lt;number&gt;</code> to change the limit.</blockquote>`,
      { parse_mode: "HTML" }
    );
  }
  const n = Number(val);
  if (isNaN(n) || n < 1) {
    return bot.sendMessage(msg.chat.id,
      `❌ <b>Invalid value.</b>\n\nUsage:\n` +
      `<code>/setfreelimit 15</code>        — Set limit to 15\n` +
      `<code>/setfreelimit unlimited</code>  — Unlimited for all\n` +
      `<code>/setfreelimit limited</code>    — Re-enable limit`,
      { parse_mode: "HTML" }
    );
  }
  freeGiveawayLimit = n;
  freeUnlimited = false;
  await saveConfig("freeGiveawayLimit", n);
  await saveConfig("freeUnlimited", false);
  return bot.sendMessage(msg.chat.id,
    `✅ <b>Free Giveaway Limit Set</b>\n\n` +
    `<blockquote>◈ Non-VIP users can now create up to <b>${n} free giveaways</b>.\n\n` +
    `After that limit they'll see an upgrade prompt.\n\n` +
    `Use <code>/setfreelimit unlimited</code> to remove the limit anytime.</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// /deductmem — Admin: Deduct days from a user's membership
// Usage: /deductmem <userId> <days>          → deducts & notifies user
// Usage: /deductmem <userId> <days> silent   → deducts silently (no user notification)
bot.onText(/\/deductmem\s+(\d+)\s+(\d+)(\s+silent)?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const daysToDeduct = Number(match[2]);
  const silent = !!match[3];

  const existing = vipUsers.get(targetId);
  if (!existing?.vip || !existing.expiry) {
    return bot.sendMessage(msg.chat.id, `❌ User <code>${targetId}</code> has no active membership.`, { parse_mode: "HTML" });
  }

  const currentExpiry = new Date(existing.expiry);
  const now = new Date();
  if (currentExpiry <= now) {
    return bot.sendMessage(msg.chat.id, `❌ User <code>${targetId}</code>'s membership has already expired.`, { parse_mode: "HTML" });
  }

  const newExpiry = new Date(currentExpiry);
  newExpiry.setDate(newExpiry.getDate() - daysToDeduct);

  if (newExpiry <= now) {
    existing.vip = false;
    existing.expiry = newExpiry;
    vipUsers.set(targetId, existing);
    await saveVip(targetId, existing);
    await bot.sendMessage(msg.chat.id,
      `⚠️ <b>Membership Deducted &amp; Expired</b>\n\n` +
      `<blockquote>◈ User ID  ▸  <code>${targetId}</code>\n◈ Deducted ▸  ${daysToDeduct} days\n◈ Result   ▸  Membership expired</blockquote>`,
      { parse_mode: "HTML" }
    );
    if (!silent) {
      try {
        await bot.sendMessage(targetId,
          `⚠️ <b>Membership Update</b>\n\n<blockquote>Aapki membership expire ho gayi hai.</blockquote>`,
          { parse_mode: "HTML" }
        );
      } catch {}
    }
    return;
  }

  existing.expiry = newExpiry;
  vipUsers.set(targetId, existing);
  await saveVip(targetId, existing);

  await bot.sendMessage(msg.chat.id,
    `✅ <b>Days Deducted${silent ? " (Silent)" : ""}</b>\n\n` +
    `<blockquote>` +
    `◈ User ID    ▸  <code>${targetId}</code>\n` +
    `◈ Deducted   ▸  -${daysToDeduct} days\n` +
    `◈ New Expiry ▸  <b>${newExpiry.toLocaleDateString("en-IN")}</b>` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );

  if (!silent) {
    try {
      await bot.sendMessage(targetId,
        `📅 <b>Membership Updated</b>\n\n` +
        `<blockquote>◈ Change    ▸  -${daysToDeduct} days\n◈ New Expiry ▸  <b>${newExpiry.toLocaleDateString("en-IN")}</b></blockquote>`,
        { parse_mode: "HTML" }
      );
    } catch {}
  }
});

// ============================================================
// MEMBERSHIP PERMISSION SYSTEM
// ============================================================

// Available permissions (all true by default for active VIP members)
const VALID_PERMS = {
  createGiveaway: "Create Giveaways",
  voteFree:       "Cast Free Votes",
  buyVotes:       "Buy Paid Votes (INR/Stars)",
  createPost:     "Create Channel Posts",
  forceJoin:      "Set Force Join",
  customPhoto:    "Custom Giveaway Photo on Channel",
};

function getUserPerm(uid, perm) {
  const v = vipUsers.get(uid);
  if (!v?.perms) return true; // default: all allowed
  return v.perms[perm] !== false;
}

// /perms — Admin: Interactive button-based permission management
bot.onText(/\/perms\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const v = vipUsers.get(targetId);
  const bu = botUsers.get(targetId);
  const buName = bu?.firstName ? h(bu.firstName) : `User ${targetId}`;
  const buHandle = bu?.username ? `@${bu.username}` : `ID: ${targetId}`;

  const permKeys = Object.keys(VALID_PERMS);
  const permButtons = permKeys.map(key => {
    const allowed = getUserPerm(targetId, key);
    return [{ text: `${allowed ? "✅" : "❌"} ${VALID_PERMS[key]}`, callback_data: `toggle_perm:${targetId}:${key}` }];
  });
  permButtons.push([{ text: "🔄 Reset All (Enable All)", callback_data: `reset_perms:${targetId}` }]);
  permButtons.push([{ text: "◀️ Done", callback_data: "main_menu" }]);

  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🔐  <b>PERMISSIONS</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `👤 <b>${buName}</b> (${buHandle})\n` +
    `◈ User ID ▸  <code>${targetId}</code>\n` +
    `◈ Plan    ▸  ${v?.plan || (v ? "VIP" : "❌ No Membership")}\n\n` +
    `<i>Tap any permission below to toggle it on/off:</i>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: permButtons } }
  );
});

// /setperms — Admin: Set a permission for a user
// Usage: /setperms <userId> <perm> <on|off>
bot.onText(/\/setperms\s+(\d+)\s+(\w+)\s+(on|off)/i, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const perm = match[2];
  const value = match[3].toLowerCase() === "on";

  if (!VALID_PERMS[perm]) {
    const permList = Object.keys(VALID_PERMS).map(k => `  • <code>${k}</code> — ${VALID_PERMS[k]}`).join("\n");
    return bot.sendMessage(msg.chat.id,
      `❌ <b>Invalid permission:</b> <code>${h(perm)}</code>\n\n<b>Valid permissions:</b>\n${permList}`,
      { parse_mode: "HTML" }
    );
  }

  const v = vipUsers.get(targetId);
  if (!v) {
    return bot.sendMessage(msg.chat.id,
      `❌ User <code>${targetId}</code> has no VIP record. Use /givemem to grant membership first.`,
      { parse_mode: "HTML" }
    );
  }

  const newPerms = { ...(v.perms || {}), [perm]: value };
  const updated = { ...v, perms: newPerms };
  vipUsers.set(targetId, updated);
  await saveVip(targetId, updated);

  const bu = botUsers.get(targetId);
  const buName = bu?.firstName ? h(bu.firstName) : `User ${targetId}`;

  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🔧  <b>PERMISSION UPDATED</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ User   ▸  <b>${buName}</b> (<code>${targetId}</code>)\n` +
    `◈ Perm   ▸  <b>${VALID_PERMS[perm]}</b>\n` +
    `◈ Status ▸  ${value ? "✅ ON (Allowed)" : "❌ OFF (Blocked)"}` +
    `</blockquote>\n\n` +
    `/viewperms ${targetId} — See all permissions`,
    { parse_mode: "HTML" }
  );
});

// /viewperms — Admin: View all permissions for a user
bot.onText(/\/viewperms\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const v = vipUsers.get(targetId);
  const bu = botUsers.get(targetId);
  const buName = bu?.firstName ? h(bu.firstName) : `User ${targetId}`;
  const buHandle = bu?.username ? `@${bu.username}` : `ID: ${targetId}`;

  const permLines = Object.entries(VALID_PERMS).map(([key, label]) => {
    const allowed = getUserPerm(targetId, key);
    return `  ${allowed ? "✅" : "❌"} <b>${label}</b>  (<code>${key}</code>)`;
  }).join("\n");

  const setExamples = Object.keys(VALID_PERMS).slice(0, 2)
    .map(k => `/setperms ${targetId} ${k} off`).join("\n");

  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🔐  <b>USER PERMISSIONS</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `👤 <b>${buName}</b> (${buHandle})\n` +
    `◈ User ID ▸  <code>${targetId}</code>\n` +
    `◈ Plan    ▸  ${v?.plan || (v ? "VIP" : "❌ No Membership")}` +
    `</blockquote>\n\n` +
    `<b>━━◈ Permissions ◈━━</b>\n\n` +
    `${permLines}\n\n` +
    `<b>Change:</b>\n` +
    `<code>${setExamples}</code>`,
    { parse_mode: "HTML" }
  );
});

// /setstar — Admin: Set votes per ⭐ Star for a specific giveaway
bot.onText(/\/setstar\s+(\S+)\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const gId = match[1];
  const votesPerStar = Number(match[2]);
  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(msg.chat.id, `❌ Giveaway <code>${gId}</code> not found.`, { parse_mode: "HTML" });
  g.votesPerStar = votesPerStar;
  await saveGiveaway(g);
  await bot.sendMessage(msg.chat.id,
    `✅ <b>Stars Rate Updated</b>\n\n` +
    `◈ Giveaway: <b>${h(g.title)}</b>\n` +
    `◈ Rate: <b>${votesPerStar} votes per ⭐ Star</b>`,
    { parse_mode: "HTML" }
  );
});

// /setinr — Admin: Set votes per ₹1 INR for a specific giveaway
bot.onText(/\/setinr\s+(\S+)\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const gId = match[1];
  const votesPerInr = Number(match[2]);
  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(msg.chat.id, `❌ Giveaway <code>${gId}</code> not found.`, { parse_mode: "HTML" });
  g.votesPerInr = votesPerInr;
  await saveGiveaway(g);
  await bot.sendMessage(msg.chat.id,
    `✅ <b>INR Rate Updated</b>\n\n` +
    `◈ Giveaway: <b>${h(g.title)}</b>\n` +
    `◈ Rate: <b>${votesPerInr} votes per ₹1 INR</b>`,
    { parse_mode: "HTML" }
  );
});

// /cleandb — Admin: Remove old ended giveaways and expired data
bot.onText(/\/cleandb/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;

  try { await bot.sendChatAction(chatId, "typing"); } catch {}
  await bot.sendMessage(chatId, "🧹 <b>Cleaning database...</b>", { parse_mode: "HTML" });

  let removedGiveaways = 0;
  let removedPayments = 0;
  let removedMemberships = 0;
  let removedVip = 0;

  // Remove ended giveaways older than 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const [id, g] of giveaways) {
    if (!g.active && g.createdAt && new Date(g.createdAt) < cutoff) {
      giveaways.delete(id);
      await GiveawayModel.deleteOne({ id });
      removedGiveaways++;
    }
  }

  // Remove old pending payments (older than 7 days)
  const paymentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  for (const [payId, p] of pendingPayments) {
    if (new Date(p.timestamp) < paymentCutoff) {
      pendingPayments.delete(payId);
      await PendingPaymentModel.deleteOne({ payId });
      removedPayments++;
    }
  }

  // Remove old pending memberships (older than 3 days)
  const memCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  for (const [payId, m] of pendingMembershipPayments) {
    if (new Date(m.timestamp) < memCutoff) {
      pendingMembershipPayments.delete(payId);
      await PendingMembershipModel.deleteOne({ payId });
      removedMemberships++;
    }
  }

  // Mark expired VIP users as inactive (do NOT delete — preserves history and allows renewal)
  for (const [uid, v] of vipUsers) {
    if (v.vip && v.expiry && new Date(v.expiry) < new Date()) {
      v.vip = false;
      await VipModel.findOneAndUpdate({ userId: uid }, { vip: false });
      removedVip++;
    }
  }

  await bot.sendMessage(chatId,
    `✅ <b>Database Cleaned!</b>\n\n` +
    `<blockquote>` +
    `🗑️ Ended Giveaways (30d+)  ▸  <b>${removedGiveaways}</b> removed\n` +
    `💸 Old Pending Payments (7d+) ▸  <b>${removedPayments}</b> removed\n` +
    `💳 Old Membership Claims (3d+) ▸  <b>${removedMemberships}</b> removed\n` +
    `👑 Expired VIP Users  ▸  <b>${removedVip}</b> removed` +
    `</blockquote>\n\n` +
    `<i>Active data safe hai.</i>`,
    { parse_mode: "HTML" }
  );
});


// /support — Contact support
bot.onText(/\/support/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  trackUser(msg.from);
  userState.set(userId, { step: "awaiting_support_message" });
  await bot.sendMessage(msg.chat.id,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  📩  <b>DRS BOT SUPPORT</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `📝 Apna issue clearly describe karein.\n\n` +
    `Aap bhej sakte ho:\n` +
    `▸ Text message\n` +
    `▸ Screenshot / Photo\n` +
    `▸ Video ya Document\n\n` +
    `Admin se seedha contact:\n` +
    `📩 <b>@drssupport</b>` +
    `</blockquote>\n\n` +
    `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
});

// ─── /addvotes <giveawayId> <userId> <count> ───
bot.onText(/\/addvotes\s+(\S+)\s+(\d+)\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const targetId = Number(match[2]);
  const count = parseInt(match[3]);
  if (count <= 0 || count > 100000) return bot.sendMessage(chatId, `❌ Count 1-100000 ke beech hona chahiye.`, { parse_mode: "HTML" });
  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${h(gId)}</code> nahi mila.`, { parse_mode: "HTML" });
  let p = g.participants.get(targetId);
  if (!p) {
    const bu = botUsers.get(targetId);
    const name = bu?.firstName || `User ${targetId}`;
    p = { name, votes: 0, freeVoteDone: false, voters: [] };
    g.participants.set(targetId, p);
  }
  p.votes += count;
  g.participants.set(targetId, p);
  await saveGiveaway(g);
  const bu = botUsers.get(targetId);
  await bot.sendMessage(chatId,
    `✅ <b>Votes Added!</b>\n\n` +
    `<blockquote>` +
    `◈ Giveaway  ▸  <b>${h(g.title)}</b>\n` +
    `◈ User      ▸  <b>${h(bu?.firstName || String(targetId))}</b> (<code>${targetId}</code>)\n` +
    `◈ Added     ▸  +${count} votes\n` +
    `◈ New Total ▸  ${p.votes} votes` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /removevotes <giveawayId> <userId> <count> ───
bot.onText(/\/removevotes\s+(\S+)\s+(\d+)\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const targetId = Number(match[2]);
  const count = parseInt(match[3]);
  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${h(gId)}</code> nahi mila.`, { parse_mode: "HTML" });
  const p = g.participants.get(targetId);
  if (!p) return bot.sendMessage(chatId, `❌ Yeh user is giveaway mein nahi hai.`, { parse_mode: "HTML" });
  const oldVotes = p.votes;
  p.votes = Math.max(0, p.votes - count);
  g.participants.set(targetId, p);
  await saveGiveaway(g);
  const bu = botUsers.get(targetId);
  await bot.sendMessage(chatId,
    `✅ <b>Votes Removed!</b>\n\n` +
    `<blockquote>` +
    `◈ Giveaway  ▸  <b>${h(g.title)}</b>\n` +
    `◈ User      ▸  <b>${h(bu?.firstName || String(targetId))}</b> (<code>${targetId}</code>)\n` +
    `◈ Removed   ▸  -${Math.min(count, oldVotes)} votes\n` +
    `◈ New Total ▸  ${p.votes} votes` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /maintenance <on|off> ───
bot.onText(/\/maintenance\s+(on|off)/i, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const val = match[1].toLowerCase() === "on";
  maintenanceMode = val;
  await saveConfig("maintenanceMode", val || null);
  await bot.sendMessage(chatId,
    val
      ? `🔧 <b>Maintenance Mode ON</b>\n\n<blockquote>Non-admin users ko block kar diya gaya hai.\nBot update karne ke baad /maintenance off karo.</blockquote>`
      : `✅ <b>Maintenance Mode OFF</b>\n\n<blockquote>Bot ab sabke liye available hai.</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /setwelcomemsg — Set custom welcome text ───
bot.onText(/\/setwelcomemsg/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  userState.set(msg.from.id, { step: "set_welcome_msg" });
  await bot.sendMessage(chatId,
    `<b>📝 Custom Welcome Message</b>\n\n` +
    `<blockquote>Ab naya welcome message type karo.\nHTML formatting allowed hai (<b>bold</b>, <i>italic</i>, <code>code</code>).\n\n` +
    `Ya /clearwelcomemsg bhejo default restore karne ke liye.</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "bc_target:cancel" }]] } }
  );
});

bot.onText(/\/clearwelcomemsg/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  customWelcomeText = null;
  await saveConfig("customWelcomeText", null);
  await bot.sendMessage(msg.chat.id, `✅ <b>Welcome message default pe reset ho gaya.</b>`, { parse_mode: "HTML" });
});

// ─── /exportusers — Export all users as text file ───
bot.onText(/\/exportusers/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `⏳ <b>Exporting users...</b>`, { parse_mode: "HTML" });
  const lines = ["User ID | Name | Username | VIP | Banned"];
  lines.push("-".repeat(60));
  for (const [uid, u] of botUsers) {
    const vipTag = isVip(uid) ? "VIP" : "Free";
    const banTag = bannedUsers.has(uid) ? "BANNED" : "Active";
    const uname = u.username ? `@${u.username}` : "-";
    lines.push(`${uid} | ${u.firstName || "?"} | ${uname} | ${vipTag} | ${banTag}`);
  }
  const content = lines.join("\n");
  const buf = Buffer.from(content, "utf8");
  const now = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }).replace(/\//g, "-");
  try {
    await bot.sendDocument(chatId, buf, {
      caption: `📁 <b>User Export — ${botUsers.size} users</b>\n<i>${now} IST</i>`,
      parse_mode: "HTML"
    }, {
      filename: `drs-users-${now}.txt`,
      contentType: "text/plain"
    });
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Export failed: ${h(e.message)}`, { parse_mode: "HTML" });
  }
});

// ─── /paystats — Pending payments + revenue info ───
bot.onText(/\/paystats/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const pendVote = [...pendingPayments.values()];
  const pendMem = [...pendingMembershipPayments.values()];

  // Per-plan membership breakdown with payIds
  const planLines = pendMem.length
    ? pendMem.map(m => `  • <code>${m.payId}</code> — ${h(m.planKey)} — user <code>${m.userId}</code>`).join("\n")
    : "  None";

  // Vote payment breakdown with payIds
  const gLines = pendVote.length
    ? pendVote.map(p => {
        const g = getGiveaway(p.giveawayId);
        return `  • <code>${p.payId}</code> — ${g ? h(g.title).slice(0, 18) : p.giveawayId} — user <code>${p.userId}</code>`;
      }).join("\n")
    : "  None";

  const vipActive = [...vipUsers.values()].filter(v => v.vip && (!v.expiry || new Date() < new Date(v.expiry)));
  const bannedCount = bannedUsers.size;

  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  💰  <b>PAYMENT STATS</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<b>🗳️ Pending Vote Payments:</b>\n<blockquote>${gLines}</blockquote>\n\n` +
    `<b>👑 Pending Membership Payments:</b>\n<blockquote>${planLines}</blockquote>\n\n` +
    `<blockquote>` +
    `◈ Total Pending Votes ▸  ${pendVote.length}\n` +
    `◈ Total Pending Memberships ▸  ${pendMem.length}\n` +
    `◈ Active VIP Members ▸  ${vipActive.length}\n` +
    `◈ Banned Users ▸  ${bannedCount}\n` +
    `◈ Maintenance ▸  ${maintenanceMode ? "🔧 ON" : "✅ OFF"}` +
    `</blockquote>\n\n` +
    `💡 Use <code>/removepay &lt;payId&gt;</code> to remove any pending payment.`,
    { parse_mode: "HTML" }
  );
});

// ─── /clearallpending — Admin: remove ALL pending payments at once ───
bot.onText(/\/clearallpending/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const voteCount = pendingPayments.size;
  const memCount = pendingMembershipPayments.size;
  if (voteCount === 0 && memCount === 0) {
    return bot.sendMessage(chatId, `✅ Koi pending payment nahi hai — sab clear hai!`, { parse_mode: "HTML" });
  }
  const notified = new Set();
  for (const [payId, p] of pendingPayments) {
    if (!notified.has(p.userId)) {
      try {
        await bot.sendMessage(p.userId,
          `<b>❌ Payment Cleared</b>\n\nAdmin ne tumhara pending payment clear kar diya.\nPayment ID: <code>${payId}</code>\n\nKoi sawaal ho toh: <a href="https://t.me/drssupport">𝐀𝐁𝐇𝐈𝐒𝐇𝐄𝐊</a>`,
          { parse_mode: "HTML" }
        );
      } catch {}
      notified.add(p.userId);
    }
  }
  for (const [payId, p] of pendingMembershipPayments) {
    if (!notified.has(p.userId)) {
      try {
        await bot.sendMessage(p.userId,
          `<b>❌ Payment Cleared</b>\n\nAdmin ne tumhara pending membership payment clear kar diya.\nPayment ID: <code>${payId}</code>\n\nKoi sawaal ho toh: <a href="https://t.me/drssupport">𝐀𝐁𝐇𝐈𝐒𝐇𝐄𝐊</a>`,
          { parse_mode: "HTML" }
        );
      } catch {}
      notified.add(p.userId);
    }
  }
  pendingPayments.clear();
  pendingMembershipPayments.clear();
  await PendingPaymentModel.deleteMany({}).catch(() => {});
  await PendingMembershipModel.deleteMany({}).catch(() => {});
  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🗑️  <b>ALL PENDING CLEARED</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ Vote Payments Cleared      ▸  ${voteCount}\n` +
    `◈ Membership Payments Cleared ▸  ${memCount}\n` +
    `◈ Users Notified              ▸  ${notified.size}` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /removepay <payId> — Admin: remove any pending payment by ID ───
bot.onText(/\/removepay\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const payId = match[1].trim();

  const isVote = pendingPayments.has(payId);
  const isMem = pendingMembershipPayments.has(payId);

  if (!isVote && !isMem) {
    return bot.sendMessage(chatId,
      `❌ Payment ID <code>${h(payId)}</code> not found in pending payments.\n\nUse /paystats to see all pending IDs.`,
      { parse_mode: "HTML" }
    );
  }

  let userId, typeLabel;
  if (isVote) {
    const p = pendingPayments.get(payId);
    userId = p.userId;
    typeLabel = `🗳️ Vote Payment (Giveaway: <code>${h(p.giveawayId)}</code>)`;
    pendingPayments.delete(payId);
    await PendingPaymentModel.deleteOne({ payId }).catch(() => {});
  } else {
    const p = pendingMembershipPayments.get(payId);
    userId = p.userId;
    typeLabel = `👑 Membership Payment (Plan: ${h(p.planKey)})`;
    pendingMembershipPayments.delete(payId);
    await PendingMembershipModel.deleteOne({ payId }).catch(() => {});
  }

  // Notify the user
  try {
    await bot.sendMessage(userId,
      `<b>❌ Payment Removed</b>\n\n` +
      `Tumhara pending payment admin ne remove kar diya.\n` +
      `Payment ID: <code>${payId}</code>\n\n` +
      `Koi sawal ho toh support se contact karo: @drssupport`,
      { parse_mode: "HTML" }
    );
  } catch {}

  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🗑️  <b>PAYMENT REMOVED</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ Pay ID  ▸  <code>${payId}</code>\n` +
    `◈ Type    ▸  ${typeLabel}\n` +
    `◈ User    ▸  <code>${userId}</code>\n` +
    `◈ Status  ▸  ✅ Removed from pending` +
    `</blockquote>\n\n` +
    `User ko notification bhej di gayi hai.`,
    { parse_mode: "HTML" }
  );
});

// ─── /clonegiveaway <giveawayId> — Clone a giveaway ───
bot.onText(/\/clonegiveaway\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const src = getGiveaway(gId);
  if (!src) return bot.sendMessage(chatId, `❌ Giveaway <code>${h(gId)}</code> nahi mila.`, { parse_mode: "HTML" });

  const newId = Math.random().toString(36).slice(2, 10).toUpperCase();
  const now = new Date();
  const newG = {
    id: newId,
    title: `${src.title} (Clone)`,
    description: src.description || "",
    prize: src.prize || "",
    winnerCount: src.winnerCount || 1,
    durationMinutes: src.durationMinutes || 0,
    channelId: src.channelId || null,
    channelUsername: src.channelUsername || null,
    creatorId: msg.from.id,
    active: false,
    participationOpen: false,
    paidVotesActive: false,
    starsPerVote: src.starsPerVote || 1,
    inrPerVote: src.inrPerVote || 1,
    participants: new Map(),
    voterMap: new Map(),
    endTime: null,
    createdAt: now,
    photoId: src.photoId || null,
    extraForceJoin: src.extraForceJoin || null,
  };
  giveaways.set(newId, newG);
  await saveGiveaway(newG);

  await bot.sendMessage(chatId,
    `✅ <b>Giveaway Cloned!</b>\n\n` +
    `<blockquote>` +
    `◈ Original ▸  <b>${h(src.title)}</b>\n` +
    `◈ New ID   ▸  <code>${newId}</code>\n` +
    `◈ Title    ▸  <b>${h(newG.title)}</b>\n` +
    `◈ Status   ▸  Draft (inactive)\n\n` +
    `Use /start → My Giveaways to activate it.` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /schedule HH:MM <message> — Schedule a broadcast ───
bot.onText(/\/schedule\s+(\d{1,2}:\d{2})\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const timeStr = match[1].trim();   // e.g. "22:00"
  const text    = match[2].trim();

  // Parse HH:MM
  const [hh, mm] = timeStr.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm) || hh > 23 || mm > 59) {
    return bot.sendMessage(chatId,
      `❌ <b>Invalid time format.</b>\nUse HH:MM (24h) — e.g. <code>/schedule 22:00 Aaj ki update</code>`,
      { parse_mode: "HTML" });
  }

  // Calculate milliseconds until target time (IST = UTC+5:30)
  const nowUTC = new Date();
  const nowIST = new Date(nowUTC.getTime() + (5.5 * 60 * 60 * 1000));
  const targetIST = new Date(nowIST);
  targetIST.setHours(hh, mm, 0, 0);
  let msUntil = targetIST - nowIST;
  if (msUntil <= 0) msUntil += 24 * 60 * 60 * 1000; // next day if time already passed

  const schedId = `SC${String(scheduleCounter++).padStart(3, "0")}`;

  const timerId = setTimeout(async () => {
    scheduledMessages.delete(schedId);
    const allUsers = [...botUsers.keys()];
    let sent = 0, fail = 0;
    for (const uid of allUsers) {
      try {
        await bot.sendMessage(uid,
          `📢 <b>Scheduled Message</b>\n\n${text}`,
          { parse_mode: "HTML" });
        sent++;
      } catch { fail++; }
    }
    // Notify admin
    try {
      await bot.sendMessage(chatId,
        `✅ <b>Scheduled message sent!</b>\n\n` +
        `<blockquote>ID: <code>${schedId}</code>\n` +
        `Time: <b>${timeStr} IST</b>\n` +
        `Delivered: <b>${sent}</b> users | Failed: <b>${fail}</b></blockquote>`,
        { parse_mode: "HTML" });
    } catch {}
  }, msUntil);

  scheduledMessages.set(schedId, { id: schedId, timeStr, text, timerId, createdAt: new Date() });

  const mins = Math.round(msUntil / 60000);
  const hrsLeft = Math.floor(mins / 60);
  const minsLeft = mins % 60;
  const eta = hrsLeft > 0 ? `${hrsLeft}h ${minsLeft}m` : `${minsLeft}m`;

  await bot.sendMessage(chatId,
    `⏰ <b>Broadcast Scheduled!</b>\n\n` +
    `<blockquote>` +
    `ID      ▸  <code>${schedId}</code>\n` +
    `Time    ▸  <b>${timeStr} IST</b>\n` +
    `In      ▸  <b>${eta}</b>\n` +
    `Message ▸  ${h(text.slice(0, 80))}${text.length > 80 ? "…" : ""}` +
    `</blockquote>\n\n` +
    `Cancel karna ho to: <code>/cancelschedule ${schedId}</code>`,
    { parse_mode: "HTML" });
});

// ─── /schedule (no args) — usage hint ───
bot.onText(/^\/schedule$/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id,
    `⏰ <b>Schedule a Broadcast</b>\n\n` +
    `<b>Usage:</b>\n<code>/schedule HH:MM Message text</code>\n\n` +
    `<b>Examples:</b>\n` +
    `<code>/schedule 22:00 Aaj ki update aagyi!</code>\n` +
    `<code>/schedule 08:30 Good morning everyone 🌅</code>\n\n` +
    `• Time is in <b>IST (24h format)</b>\n` +
    `• Message goes to <b>all bot users</b>\n` +
    `• View pending: /schedulelist\n` +
    `• Cancel: /cancelschedule &lt;ID&gt;`,
    { parse_mode: "HTML" });
});

// ─── /schedulelist — Show all pending scheduled messages ───
bot.onText(/\/schedulelist/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  if (scheduledMessages.size === 0) {
    return bot.sendMessage(chatId,
      `📭 <b>No scheduled messages.</b>\n\nSchedule karne ke liye:\n<code>/schedule 22:00 Aaj ki update</code>`,
      { parse_mode: "HTML" });
  }
  let lines = `⏰ <b>Pending Scheduled Broadcasts (${scheduledMessages.size})</b>\n\n`;
  for (const s of scheduledMessages.values()) {
    lines +=
      `<blockquote>` +
      `🔖 <code>${s.id}</code>  ▸  <b>${s.timeStr} IST</b>\n` +
      `${h(s.text.slice(0, 60))}${s.text.length > 60 ? "…" : ""}` +
      `</blockquote>\n`;
  }
  lines += `\nCancel: <code>/cancelschedule &lt;ID&gt;</code>`;
  await bot.sendMessage(chatId, lines, { parse_mode: "HTML" });
});

// ─── /cancelschedule <id> — Cancel a scheduled message ───
bot.onText(/\/cancelschedule\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const schedId = match[1].trim().toUpperCase();
  const entry = scheduledMessages.get(schedId);
  if (!entry) {
    return bot.sendMessage(chatId,
      `❌ <b>Schedule not found:</b> <code>${schedId}</code>\n\nView list: /schedulelist`,
      { parse_mode: "HTML" });
  }
  clearTimeout(entry.timerId);
  scheduledMessages.delete(schedId);
  await bot.sendMessage(chatId,
    `🗑️ <b>Schedule Cancelled</b>\n\n` +
    `<blockquote>` +
    `ID      ▸  <code>${schedId}</code>\n` +
    `Was set ▸  <b>${entry.timeStr} IST</b>\n` +
    `Message ▸  ${h(entry.text.slice(0, 60))}${entry.text.length > 60 ? "…" : ""}` +
    `</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /giveawayreport <gId> — Full report of a giveaway ───
bot.onText(/\/giveawayreport\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const g = giveaways.get(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${gId}</code> nahi mila.`, { parse_mode: "HTML" });

  const participants = [...g.participants.entries()].sort((a, b) => b[1].votes - a[1].votes);
  const totalVotes = participants.reduce((s, [, p]) => s + (p.votes || 0), 0);

  // payments for this giveaway
  const gPayments = [...pendingPayments.values()].filter(p => p.giveawayId === gId);
  const pendingPay = gPayments.filter(p => p.status === "pending").length;
  const approvedPay = gPayments.filter(p => p.status === "approved").length;

  let lines = [];
  lines.push(`📊 GIVEAWAY REPORT — ${g.title}`);
  lines.push(`ID: ${gId}`);
  lines.push(`Status: ${g.active ? "🟢 Active" : "🔴 Ended"}`);
  lines.push(`Winners: ${g.winnersCount}`);
  lines.push(`Total Participants: ${participants.length}`);
  lines.push(`Total Votes Cast: ${totalVotes}`);
  lines.push(`Payments — Pending: ${pendingPay} | Approved: ${approvedPay}`);
  lines.push(`Created: ${g.createdAt ? new Date(g.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "N/A"}`);
  lines.push(``);
  lines.push(`LEADERBOARD:`);
  lines.push(`${"Rank".padEnd(5)} ${"Name".padEnd(20)} ${"UserID".padEnd(12)} Votes`);
  lines.push(`─`.repeat(55));
  participants.forEach(([uid, p], i) => {
    const bu = botUsers.get(uid);
    const name = (bu?.firstName || "Unknown").slice(0, 18);
    lines.push(`${String(i + 1).padEnd(5)} ${name.padEnd(20)} ${String(uid).padEnd(12)} ${p.votes || 0}`);
  });
  if (g.winners?.length) {
    lines.push(``);
    lines.push(`WINNERS:`);
    g.winners.forEach((uid, i) => {
      const bu = botUsers.get(uid);
      lines.push(`  ${i + 1}. ${bu?.firstName || "Unknown"} (ID: ${uid})`);
    });
  }
  lines.push(``);
  lines.push(`Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);

  const fileContent = lines.join("\n");
  const buf = Buffer.from(fileContent, "utf-8");
  await bot.sendDocument(chatId, buf, {
    caption: `📊 <b>Giveaway Report</b> — <code>${gId}</code>\n${participants.length} participants · ${totalVotes} total votes`,
    parse_mode: "HTML"
  }, { filename: `report_${gId}.txt`, contentType: "text/plain" });
});

// ─── /announce <gId> <text> — Send message to all giveaway participants ───
bot.onText(/\/announce\s+(\S+)\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const text = match[2].trim();
  const g = giveaways.get(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${gId}</code> nahi mila.`, { parse_mode: "HTML" });

  const participants = [...g.participants.keys()];
  if (participants.length === 0)
    return bot.sendMessage(chatId, `⚠️ Is giveaway mein koi participant nahi hai abhi.`, { parse_mode: "HTML" });

  const confirm = await bot.sendMessage(chatId,
    `📢 <b>Announce to ${participants.length} participants?</b>\n\n` +
    `<blockquote>${h(text.slice(0, 200))}${text.length > 200 ? "…" : ""}</blockquote>\n\n` +
    `Confirm karne ke liye: /announceconfirm_${gId}`,
    { parse_mode: "HTML" });

  // Store pending announce
  userState.set(chatId, { action: "announce_pending", gId, text });
});

bot.onText(/\/announceconfirm_(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const state = userState.get(chatId);
  if (!state || state.action !== "announce_pending" || state.gId !== gId) {
    return bot.sendMessage(chatId, `❌ Pehle /announce command chalaao.`, { parse_mode: "HTML" });
  }
  userState.delete(chatId);
  const g = giveaways.get(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway nahi mila.`, { parse_mode: "HTML" });
  const text = state.text;
  const participants = [...g.participants.keys()];
  let sent = 0, fail = 0;
  for (const uid of participants) {
    try {
      await bot.sendMessage(uid,
        `📢 <b>Announcement — ${h(g.title)}</b>\n\n${text}`,
        { parse_mode: "HTML" });
      sent++;
    } catch { fail++; }
  }
  await bot.sendMessage(chatId,
    `✅ <b>Announcement Sent!</b>\n\n` +
    `<blockquote>Giveaway  ▸  <b>${h(g.title)}</b>\nDelivered ▸  <b>${sent}</b>\nFailed    ▸  <b>${fail}</b></blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /setwinner <gId> <count> — Change winner count ───
bot.onText(/\/setwinner\s+(\S+)\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const count = Number(match[2]);
  const g = giveaways.get(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${gId}</code> nahi mila.`, { parse_mode: "HTML" });
  if (count < 1 || count > 100)
    return bot.sendMessage(chatId, `❌ Winner count 1–100 ke beech hona chahiye.`, { parse_mode: "HTML" });
  const old = g.winnersCount;
  g.winnersCount = count;
  await GiveawayModel.updateOne({ giveawayId: gId }, { winnersCount: count });
  await bot.sendMessage(chatId,
    `🏆 <b>Winner Count Updated</b>\n\n` +
    `<blockquote>Giveaway ▸  <b>${h(g.title)}</b> (<code>${gId}</code>)\n` +
    `Before   ▸  <b>${old}</b>\nAfter    ▸  <b>${count}</b></blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /voteleaderboard — Global top voters across all giveaways ───
bot.onText(/\/voteleaderboard/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const tally = new Map();
  for (const g of giveaways.values()) {
    for (const [uid, p] of g.participants) {
      tally.set(uid, (tally.get(uid) || 0) + (p.votes || 0));
    }
  }
  if (tally.size === 0)
    return bot.sendMessage(chatId, `📭 Koi votes nahi hain abhi.`, { parse_mode: "HTML" });
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const medals = ["🥇", "🥈", "🥉"];
  let text = `🏆 <b>Global Vote Leaderboard (Top ${sorted.length})</b>\n\n`;
  sorted.forEach(([uid, votes], i) => {
    const bu = botUsers.get(uid);
    const name = h(bu?.firstName || "Unknown");
    const uname = bu?.username ? ` @${bu.username}` : "";
    const medal = medals[i] || `${i + 1}.`;
    text += `${medal} <b>${name}</b>${uname}\n   ID: <code>${uid}</code> · <b>${votes}</b> votes\n`;
  });
  await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
});

// ─── /remindvote <gId> — Send reminder to all giveaway participants ───
bot.onText(/\/remindvote\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const g = giveaways.get(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${gId}</code> nahi mila.`, { parse_mode: "HTML" });
  if (!g.active)
    return bot.sendMessage(chatId, `⚠️ Yeh giveaway already end ho chuka hai.`, { parse_mode: "HTML" });
  const participants = [...g.participants.keys()];
  if (participants.length === 0)
    return bot.sendMessage(chatId, `⚠️ Koi participant nahi hai abhi.`, { parse_mode: "HTML" });

  // Leaderboard top 3 for motivation
  const top3 = [...g.participants.entries()]
    .sort((a, b) => b[1].votes - a[1].votes)
    .slice(0, 3)
    .map(([uid, p], i) => {
      const bu = botUsers.get(uid);
      const medal = ["🥇", "🥈", "🥉"][i];
      return `${medal} ${bu?.firstName || "User"} — ${p.votes} votes`;
    }).join("\n");

  let sent = 0, fail = 0;
  for (const uid of participants) {
    try {
      await bot.sendMessage(uid,
        `🔔 <b>Vote Reminder!</b>\n\n` +
        `<b>${h(g.title)}</b> giveaway chal raha hai!\n\n` +
        `📊 <b>Current Top 3:</b>\n${top3}\n\n` +
        `<b>Apni position improve karo — abhi vote karo!</b>\n` +
        `👉 /start dabao`,
        { parse_mode: "HTML" });
      sent++;
    } catch { fail++; }
  }
  await bot.sendMessage(chatId,
    `✅ <b>Reminder Sent!</b>\n\n` +
    `<blockquote>Giveaway  ▸  <b>${h(g.title)}</b>\nDelivered ▸  <b>${sent}</b>\nFailed    ▸  <b>${fail}</b></blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /userinfo <userId> ───
bot.onText(/\/userinfo\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const chatId = msg.chat.id;
  const bu = botUsers.get(targetId);
  const vip = vipUsers.get(targetId);
  const isVipNow = isVip(targetId);
  const userGiveaways = [...giveaways.values()].filter(g => g.creatorId === targetId);
  const joinedGiveaways = [...giveaways.values()].filter(g => g.participants.has(targetId));
  const totalVotesCast = joinedGiveaways.reduce((s, g) => {
    const p = g.participants.get(targetId);
    return s + (p?.votes || 0);
  }, 0);
  const isBanned = bannedUsers.has(targetId);
  const name = bu ? (bu.firstName || "Unknown") : "Not in DB";
  const uname = bu?.username ? `@${bu.username}` : "—";
  const vipLine = isVipNow
    ? `✅ VIP — ${vip?.plan || "?"} | Khatam: ${safeFormatDate(vip?.expiry)}`
    : `❌ Free User`;
  const permsList = Object.keys(VALID_PERMS)
    .map(k => `  • ${k}: ${getUserPerm(targetId, k) ? "✅" : "❌"}`)
    .join("\n");

  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  👤  <b>USER INFO</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ Name      ▸  <b>${h(name)}</b>\n` +
    `◈ Username  ▸  ${h(uname)}\n` +
    `◈ User ID   ▸  <code>${targetId}</code>\n` +
    `◈ Status    ▸  ${isBanned ? "🚫 BANNED" : "✅ Active"}\n` +
    `◈ VIP       ▸  ${vipLine}\n` +
    `◈ Giveaways Created  ▸  ${userGiveaways.length}\n` +
    `◈ Giveaways Joined   ▸  ${joinedGiveaways.length}\n` +
    `◈ Total Votes Cast   ▸  ${totalVotesCast}` +
    `</blockquote>\n\n` +
    `<b>🔐 Permissions:</b>\n<blockquote>${permsList}</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /ban <userId> [reason] ───
bot.onText(/\/ban\s+(\d+)(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const reason = match[2]?.trim() || "Admin action";
  const chatId = msg.chat.id;
  if (isAdmin(targetId)) {
    return bot.sendMessage(chatId, `❌ Admin ko ban nahi kar sakte!`, { parse_mode: "HTML" });
  }
  bannedUsers.add(targetId);
  await saveConfig("bannedUsers", [...bannedUsers]);
  const bu = botUsers.get(targetId);
  const name = bu?.firstName || String(targetId);
  await bot.sendMessage(chatId,
    `✅ <b>User Banned!</b>\n\n` +
    `<blockquote>` +
    `◈ User   ▸  <b>${h(name)}</b> (<code>${targetId}</code>)\n` +
    `◈ Reason ▸  ${h(reason)}` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
  // Notify user
  bot.sendMessage(targetId,
    `🚫 <b>Aapko is bot se ban kar diya gaya hai.</b>\n\n` +
    `<blockquote>Reason: ${h(reason)}</blockquote>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
});

// ─── /unban <userId> ───
bot.onText(/\/unban\s+(\d+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const chatId = msg.chat.id;
  if (!bannedUsers.has(targetId)) {
    return bot.sendMessage(chatId, `ℹ️ Yeh user pehle se ban nahi hai.`, { parse_mode: "HTML" });
  }
  bannedUsers.delete(targetId);
  await saveConfig("bannedUsers", [...bannedUsers]);
  const bu = botUsers.get(targetId);
  const name = bu?.firstName || String(targetId);
  await bot.sendMessage(chatId,
    `✅ <b>User Unbanned!</b>\n\n` +
    `<blockquote>◈ User ▸ <b>${h(name)}</b> (<code>${targetId}</code>)</blockquote>`,
    { parse_mode: "HTML" }
  );
  bot.sendMessage(targetId,
    `✅ <b>Aapka ban hat gaya hai.</b>\nAb aap bot use kar sakte hain.`,
    { parse_mode: "HTML" }
  ).catch(() => {});
});

// ─── /dm <userId> <message> ───
bot.onText(/\/dm\s+(\d+)\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const text = match[2].trim();
  const chatId = msg.chat.id;
  try {
    await bot.sendMessage(targetId,
      `📩 <b>Admin Message:</b>\n\n<blockquote>${h(text)}</blockquote>`,
      { parse_mode: "HTML" }
    );
    await bot.sendMessage(chatId,
      `✅ <b>Message sent!</b> → <code>${targetId}</code>\n<blockquote>${h(text.slice(0, 100))}${text.length > 100 ? "..." : ""}</blockquote>`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Send failed: ${h(e.message)}`, { parse_mode: "HTML" });
  }
});

// ─── /reply — Admin replies to support message (reply to forwarded msg + /reply <text>) ───
bot.onText(/\/reply\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const replyText = match[1].trim();
  const replyTo = msg.reply_to_message;
  if (!replyTo) {
    return bot.sendMessage(chatId,
      `<b>📩 /reply — Usage:</b>\n<blockquote>Pehle kisi support message ko reply karein, phir:\n<code>/reply Aapka jawab yahan</code></blockquote>`,
      { parse_mode: "HTML" }
    );
  }
  // Extract userId from forwarded message text (format: "👤 Name | ID: 123456")
  const idMatch = replyTo.text?.match(/ID:\s*(\d+)/) || replyTo.caption?.match(/ID:\s*(\d+)/);
  if (!idMatch) {
    return bot.sendMessage(chatId,
      `❌ User ID detect nahi hua. Support card reply karein (jisme "ID: 123456" ho).`,
      { parse_mode: "HTML" }
    );
  }
  const targetId = Number(idMatch[1]);
  try {
    await bot.sendMessage(targetId,
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `  💬  <b>ADMIN REPLY</b>\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
      `<blockquote>${h(replyText)}</blockquote>\n\n` +
      `<i>Agar aur help chahiye toh /support karein.</i>`,
      { parse_mode: "HTML" }
    );
    await bot.sendMessage(chatId,
      `✅ <b>Reply sent!</b> → <code>${targetId}</code>`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Failed: ${h(e.message)}`, { parse_mode: "HTML" });
  }
});

// ─── /listusers [page] ───
bot.onText(/\/listusers(?:\s+(\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const PAGE = 20;
  const page = Math.max(1, parseInt(match[1] || "1"));
  const allUsers = [...botUsers.entries()];
  const total = allUsers.length;
  const totalPages = Math.ceil(total / PAGE);
  const slice = allUsers.slice((page - 1) * PAGE, page * PAGE);
  if (slice.length === 0) {
    return bot.sendMessage(chatId, `❌ Koi users nahi mile.`, { parse_mode: "HTML" });
  }
  const lines = slice.map(([uid, u]) => {
    const name = u.firstName || "?";
    const uname = u.username ? `@${u.username}` : `—`;
    const vipTag = isVip(uid) ? " 👑" : "";
    const banTag = bannedUsers.has(uid) ? " 🚫" : "";
    return `▸ <code>${uid}</code>  <b>${h(name)}</b>  ${h(uname)}${vipTag}${banTag}`;
  }).join("\n");
  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  👥  <b>USER LIST — Page ${page}/${totalPages}</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `${lines}\n\n` +
    `<blockquote>Total: ${total} | 👑 VIP shown | 🚫 Banned shown\n` +
    `Next page: /listusers ${page + 1}</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /endgiveaway <giveawayId> ───
bot.onText(/\/endgiveaway\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${h(gId)}</code> nahi mila.`, { parse_mode: "HTML" });
  if (!g.active) return bot.sendMessage(chatId, `ℹ️ Yeh giveaway pehle se end ho chuka hai.`, { parse_mode: "HTML" });
  g.active = false; g.participationOpen = false; g.paidVotesActive = false;
  await saveGiveaway(g);
  await announceWinners(g, gId, g.creatorId);
  await bot.sendMessage(chatId,
    `✅ <b>Giveaway Force-Ended!</b>\n\n` +
    `<blockquote>◈ Title  ▸  <b>${h(g.title)}</b>\n◈ ID     ▸  <code>${gId}</code>\n◈ Participants ▸  ${g.participants.size}</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /winners <gId> — Show styled winners card for any giveaway ───
bot.onText(/\/winners(?:\s+(\S+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const gId = match[1]?.trim();

  // If no gId given, show user's most recent ended giveaway
  let g, resolvedId;
  if (gId) {
    g = giveaways.get(gId);
    resolvedId = gId;
    if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${h(gId)}</code> nahi mila.`, { parse_mode: "HTML" });
    if (!isAdmin(userId) && g.creatorId !== userId)
      return bot.sendMessage(chatId, `❌ Sirf apne giveaways ke winners dekh sakte ho.`, { parse_mode: "HTML" });
  } else {
    const myEnded = [...giveaways.entries()]
      .filter(([, gv]) => !gv.active && gv.creatorId === userId)
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    if (!myEnded.length)
      return bot.sendMessage(chatId, `ℹ️ Koi ended giveaway nahi mila.\n\n<i>Use: /winners &lt;giveawayId&gt;</i>`, { parse_mode: "HTML" });
    [resolvedId, g] = myEnded[0];
  }

  const parts = [...g.participants.values()].sort((a, b) => b.votes - a.votes);
  const totalVotes = parts.reduce((s, p) => s + p.votes, 0);
  const medals = ["🥇", "🥈", "🥉"];
  const top = parts.slice(0, Math.min(g.winnersCount || 3, parts.length, 10));

  const podium = top.length
    ? top.map((p, i) => {
        const medal = medals[i] || `  <b>${i + 1}.</b>`;
        return `${medal} <b>${h(p.name)}</b> — <code>${p.votes}</code> votes`;
      }).join("\n")
    : `<i>No participants yet</i>`;

  const status = g.active ? `🟢 Active` : `🔴 Ended`;
  const endedAt = !g.active
    ? new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : `Still running`;

  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🏆  <b>GIVEAWAY WINNERS</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `📌 <b>${h(g.title)}</b>\n` +
    `🆔 <code>${resolvedId}</code>  ·  ${status}\n\n` +
    `━━━◈ 🥇 TOP WINNERS ◈━━━\n\n` +
    `${podium}\n\n` +
    `━━━◈━━━━━━━━━━━━━━━━━◈━━━\n` +
    `<blockquote>` +
    `👥 Participants  ▸  <b>${g.participants.size}</b>\n` +
    `🗳️ Total Votes   ▸  <b>${totalVotes}</b>\n` +
    `📅 Status        ▸  ${endedAt}` +
    `</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Home", callback_data: "main_menu" }]] } }
  );
});

// ─── /glink <gId> — Get participation link for a giveaway ───
bot.onText(/\/glink(?:\s+(\S+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const gId = match[1]?.trim();

  let g, resolvedId;
  if (gId) {
    g = giveaways.get(gId);
    resolvedId = gId;
    if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${h(gId)}</code> nahi mila.`, { parse_mode: "HTML" });
    if (!isAdmin(userId) && g.creatorId !== userId)
      return bot.sendMessage(chatId, `❌ Sirf apne giveaways ka link dekh sakte ho.`, { parse_mode: "HTML" });
  } else {
    const myActive = [...giveaways.entries()]
      .filter(([, gv]) => gv.active && gv.creatorId === userId);
    if (!myActive.length)
      return bot.sendMessage(chatId, `ℹ️ Koi active giveaway nahi mila.\n\n<i>Use: /glink &lt;giveawayId&gt;</i>`, { parse_mode: "HTML" });
    [resolvedId, g] = myActive[0];
  }

  const link = `https://t.me/${BOT_USERNAME}?start=${resolvedId}`;
  await bot.sendMessage(chatId,
    `🔗 <b>Giveaway Participation Link</b>\n\n` +
    `📌 <b>${h(g.title)}</b>\n` +
    `🆔 <code>${resolvedId}</code>\n\n` +
    `<blockquote>` +
    `👥 Participants ▸  <b>${g.participants.size}</b>\n` +
    `🟢 Status       ▸  ${g.active ? "Active" : "Ended"}` +
    `</blockquote>\n\n` +
    `🔗 <b>Link:</b>\n${link}\n\n` +
    `<i>Is link ko share karo — log seedha participate kar sakte hain!</i>`,
    { parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🔗 Open Link", url: link }]] }
    }
  );
});

// ─── /active — List all currently live giveaways ───
bot.onText(/\/active/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const running = [...giveaways.entries()].filter(([, g]) => g.active);
  if (!running.length)
    return bot.sendMessage(chatId, `ℹ️ <b>Abhi koi active giveaway nahi hai.</b>`, { parse_mode: "HTML" });

  const lines = running.map(([gId, g]) => {
    const timeLeft = g.endTime ? timeRemaining(g.endTime) : "Manual end";
    const votes = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
    const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;
    return (
      `🟢 <b>${h(g.title)}</b>\n` +
      `   🆔 <code>${gId}</code>  ·  👥 ${g.participants.size}  ·  🗳️ ${votes}\n` +
      `   ⏳ ${timeLeft}  ·  <a href="${link}">Join</a>`
    );
  }).join("\n\n");

  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🟢  <b>ACTIVE GIVEAWAYS (${running.length})</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `${lines}`,
    { parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "🏠 Home", callback_data: "main_menu" }]] }
    }
  );
});

// ─── /cancelgiveaway <gId> — Admin: cancel without announcing winners ───
bot.onText(/\/cancelgiveaway\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${h(gId)}</code> nahi mila.`, { parse_mode: "HTML" });
  if (!g.active) return bot.sendMessage(chatId, `ℹ️ Yeh giveaway pehle se end ho chuka hai.`, { parse_mode: "HTML" });

  g.active = false;
  g.participationOpen = false;
  g.paidVotesActive = false;
  await saveGiveaway(g);

  // Notify channel silently
  if (g.channelId) {
    try {
      await bot.sendMessage(g.channelId,
        `🚫 <b>Giveaway Cancelled</b>\n\n` +
        `📌 <b>${h(g.title)}</b>\n\n` +
        `<i>Yeh giveaway admin dwara cancel kar diya gaya hai. Participation ke liye shukriya.</i>`,
        { parse_mode: "HTML" }
      );
    } catch {}
  }

  await bot.sendMessage(chatId,
    `✅ <b>Giveaway Cancelled!</b>\n\n` +
    `<blockquote>` +
    `◈ Title        ▸  <b>${h(g.title)}</b>\n` +
    `◈ ID           ▸  <code>${gId}</code>\n` +
    `◈ Participants ▸  <b>${g.participants.size}</b>\n` +
    `◈ No winners announced` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /resetvotes <giveawayId> ───
bot.onText(/\/resetvotes\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${h(gId)}</code> nahi mila.`, { parse_mode: "HTML" });
  const oldTotal = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
  // Reset all votes
  for (const [uid, p] of g.participants) {
    p.votes = 0;
    p.freeVoteDone = false;
    p.voters = [];
    g.participants.set(uid, p);
  }
  if (g.voterMap) g.voterMap.clear();
  await saveGiveaway(g);
  await bot.sendMessage(chatId,
    `✅ <b>Votes Reset!</b>\n\n` +
    `<blockquote>` +
    `◈ Giveaway   ▸  <b>${h(g.title)}</b>\n` +
    `◈ ID         ▸  <code>${gId}</code>\n` +
    `◈ Votes Cleared  ▸  ${oldTotal} → 0` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

bot.onText(/\/adminhelp/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;

  const part1 =
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  👑  <b>DRS BOT — ADMIN PANEL</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<b>💳 MEMBERSHIP MANAGEMENT</b>\n` +
    `<blockquote>` +
    `/givemem &lt;userId&gt; &lt;1d|7d|30d&gt;\n  → Grant VIP membership to a user\n\n` +
    `/removemem &lt;userId&gt;\n  → Revoke membership immediately\n\n` +
    `/extendmem &lt;userId&gt; &lt;1d|7d|30d&gt;\n  → Add days on top of existing membership\n\n` +
    `/deductmem &lt;userId&gt; &lt;days&gt;\n  → Deduct days from membership\n` +
    `  Example: /deductmem 123456 3\n` +
    `  Silent mode: /deductmem 123456 3 silent\n\n` +
    `/listmem\n  → View all active VIP members\n\n` +
    `/meminfo &lt;userId&gt;\n  → Check any user's membership status\n\n` +
    `/setplan &lt;1d|7d|30d&gt; &lt;price&gt;\n  → Update plan price\n  Example: /setplan 7d 80` +
    `</blockquote>\n\n` +
    `<b>🆓 FREE GIVEAWAY CONTROL</b>\n` +
    `<blockquote>` +
    `/setfreelimit &lt;number&gt;\n  → Set free giveaway quota per non-VIP user\n  Example: /setfreelimit 15\n\n` +
    `/setfreelimit unlimited\n  → Allow all users unlimited free giveaways\n\n` +
    `/setfreelimit limited\n  → Re-enable the quota at current limit` +
    `</blockquote>\n\n` +
    `<b>🔐 PERMISSIONS</b>\n` +
    `<blockquote>` +
    `/perms &lt;userId&gt;\n  → Interactive button toggle (tap to on/off)\n  Example: /perms 123456789\n\n` +
    `/viewperms &lt;userId&gt;\n  → View all permissions for a user\n\n` +
    `/setperms &lt;userId&gt; &lt;perm&gt; &lt;on|off&gt;\n  → Set one permission via text\n  Example: /setperms 123456 customPhoto on\n\n` +
    `<b>Available permissions:</b>\n` +
    `  • createGiveaway  — Create giveaways\n` +
    `  • voteFree        — Cast free votes\n` +
    `  • buyVotes        — Buy votes (INR/Stars)\n` +
    `  • createPost      — Post to channels\n` +
    `  • forceJoin       — Configure force join\n` +
    `  • customPhoto     — Upload custom giveaway photo` +
    `</blockquote>`;

  const part2 =
    `<b>👥 USER MANAGEMENT</b>\n` +
    `<blockquote>` +
    `/userinfo &lt;userId&gt;\n  → Full user profile (VIP, giveaways, votes, perms, ban)\n\n` +
    `/listusers [page]\n  → All bot users — 👑 VIP &amp; 🚫 Banned marked\n\n` +
    `/ban &lt;userId&gt; [reason]\n  → Ban user (blocks + notifies)\n\n` +
    `/unban &lt;userId&gt;\n  → Remove ban\n\n` +
    `/dm &lt;userId&gt; &lt;msg&gt;\n  → Direct message any user\n\n` +
    `/reply &lt;text&gt;\n  → Reply to support card (reply to forwarded msg + /reply text)\n\n` +
    `/exportusers\n  → Download all users as .txt file` +
    `</blockquote>\n\n` +
    `<b>🎁 GIVEAWAY CONTROLS</b>\n` +
    `<blockquote>` +
    `/allgiveaways\n  → List all giveaways\n\n` +
    `/addvotes &lt;gId&gt; &lt;userId&gt; &lt;count&gt;\n  → Manually add votes\n  Example: /addvotes ABC123 9876 50\n\n` +
    `/removevotes &lt;gId&gt; &lt;userId&gt; &lt;count&gt;\n  → Remove votes (cheating fix)\n\n` +
    `/setwinner &lt;gId&gt; &lt;count&gt;\n  → Change winner count (1–100)\n\n` +
    `/endgiveaway &lt;gId&gt;\n  → Force-close + announce winners\n\n` +
    `/resetvotes &lt;gId&gt;\n  → Reset all votes to zero\n\n` +
    `/clonegiveaway &lt;gId&gt;\n  → Clone giveaway with same settings\n\n` +
    `/giveawayreport &lt;gId&gt;\n  → Download full report (.txt) — leaderboard + payments\n\n` +
    `/announce &lt;gId&gt; &lt;text&gt;\n  → Send message to all participants of a giveaway\n\n` +
    `/remindvote &lt;gId&gt;\n  → Send vote reminder + top 3 to all participants\n\n` +
    `/voteleaderboard\n  → Global top 20 voters across all giveaways\n\n` +
    `/setstar &lt;gId&gt; &lt;votes&gt;\n  → Votes per ⭐ Star\n\n` +
    `/setinr &lt;gId&gt; &lt;votes&gt;\n  → Votes per ₹1 INR` +
    `</blockquote>\n\n` +
    `<b>📢 BROADCAST</b>\n` +
    `<blockquote>` +
    `/broadcast\n  → Compose photo/doc/video+text, pick target (silent)\n\n` +
    `/broadcast &lt;text&gt;\n  → Image+text broadcast (silent)\n\n` +
    `/loud\n  → Same as /broadcast with sound\n\n` +
    `💡 <i>Reply to any msg + /broadcast → copy-forward mode</i>` +
    `</blockquote>\n\n` +
    `<b>⏰ SCHEDULED BROADCAST</b>\n` +
    `<blockquote>` +
    `/schedule &lt;HH:MM&gt; &lt;message&gt;\n  → Auto-send to all users at set IST time\n  Example: /schedule 22:00 Aaj ki update\n\n` +
    `/schedulelist\n  → View all pending scheduled broadcasts\n\n` +
    `/cancelschedule &lt;ID&gt;\n  → Cancel a scheduled broadcast by ID` +
    `</blockquote>\n\n` +
    `<b>📩 DIRECT SEND & PIN</b>\n` +
    `<blockquote>` +
    `/send &lt;chatId&gt; &lt;msg&gt;\n  → Send to specific chat/channel\n\n` +
    `/sendloud &lt;chatId&gt; &lt;msg&gt;\n  → Same with notification\n\n` +
    `/pin &lt;chatId&gt; &lt;msg&gt;\n  → Send and pin a message` +
    `</blockquote>`;

  const part3 =
    `<b>🖼️ IMAGES & WELCOME</b>\n` +
    `<blockquote>` +
    `/setwelcomemsg\n  → Set custom welcome message text (HTML ok)\n\n` +
    `/clearwelcomemsg\n  → Restore default welcome message\n\n` +
    `/setwelcomeimageurl\n  → Set welcome spoiler image (URL)\n\n` +
    `/clearwelcomeimage\n  → Remove welcome image\n\n` +
    `/setmembershipqr\n  → Upload UPI/payment QR code\n\n` +
    `/imageinfo\n  → Check current image + QR status` +
    `</blockquote>\n\n` +
    `<b>🔗 FORCE JOIN</b>\n` +
    `<blockquote>` +
    `/setforcejoin &lt;channelId&gt;\n  → Set force-join slot 1\n\n` +
    `/setforcejoin 2 &lt;channelId&gt;\n  → Set force-join slot 2\n\n` +
    `/forcejoininfo\n  → View current force join config` +
    `</blockquote>\n\n` +
    `<b>📊 STATS & MAINTENANCE</b>\n` +
    `<blockquote>` +
    `/stats\n  → Full bot dashboard\n\n` +
    `/paystats\n  → Pending payments + VIP + ban counts (shows payIds)\n\n` +
    `/removepay &lt;payId&gt;\n  → Remove any pending payment (vote or membership) by ID\n  Example: /removepay PAY123\n\n` +
    `/clearallpending\n  → Clear ALL pending payments at once + notify all users\n\n` +
    `/maintenance on|off\n  → Block all non-admin users (for updates)\n\n` +
    `/allchannels\n  → List all registered channels + groups\n\n` +
    `/cleandb\n  → Clean expired data from MongoDB\n\n` +
    `/adminhelp\n  → Show this panel` +
    `</blockquote>\n\n` +
    `<b>🖼️ NEW UTILITY COMMANDS</b>\n` +
    `<blockquote>` +
    `/setstartimage &lt;url&gt;\n  → Set welcome/start image in one line (no wizard)\n  Example: /setstartimage https://i.imgur.com/abc.jpg\n\n` +
    `/clearstates\n  → Clear all stuck user conversation states\n\n` +
    `/gcount\n  → Quick giveaway count breakdown (active, ended, totals)\n\n` +
    `/topusers\n  → Top 10 users ranked by giveaways created` +
    `</blockquote>\n\n` +
    `<b>👤 USER COMMANDS (reference)</b>\n` +
    `<blockquote>` +
    `/start — Main menu (ding-dong animation)\n` +
    `/help — Full user guide & all commands\n` +
    `/membership — VIP plans + status\n` +
    `/myplan — Own VIP plan card\n` +
    `/leaderboard — Live leaderboard of active giveaway\n` +
    `/mystats — Personal giveaway stats\n` +
    `/botstatus — Quick bot health & stats\n` +
    `/ping — Check bot response time\n` +
    `/myid — Show Telegram user ID\n` +
    `/topvoters — Top participants ranking\n` +
    `/support — Send message to admin` +
    `</blockquote>`;

  await bot.sendMessage(msg.chat.id, part1, { parse_mode: "HTML" });
  await bot.sendMessage(msg.chat.id, part2, { parse_mode: "HTML" });
  await bot.sendMessage(msg.chat.id, part3, { parse_mode: "HTML" });
});

// ============================================================
// ERROR HANDLING & STARTUP
// ============================================================

let last409Log = 0;
bot.on("polling_error", e => {
  if (e.message && e.message.includes("409")) {
    const now = Date.now();
    if (now - last409Log > 60_000) {
      console.error("⚠️ 409 Conflict: Another bot instance is running (Railway/VPS). Stop that instance to resolve. Will keep retrying...");
      last409Log = now;
    }
  } else if (e.message && e.message.includes("EFATAL")) {
    console.error("⚠️ EFATAL polling error — restarting polling in 5s...");
    setTimeout(() => {
      bot.stopPolling().catch(() => {}).then(() => {
        bot.startPolling().catch(re => console.error("Polling restart failed:", re.message));
      });
    }, 5000);
  } else {
    console.error("Polling error:", e.message);
  }
});
bot.on("error", e => console.error("Bot error:", e.message));

// ============================================================
// MAIN START
// ============================================================

// Global crash guard — never let an unhandled rejection kill the process
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled rejection (caught by guard):", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught exception (caught by guard):", err?.message || err);
});

async function main() {
  await connectDB();

  bot.getMe().then(async (me) => {
    BOT_USERNAME = me.username;

    try {
      // Register user-facing commands for ALL users (shows in bot menu for everyone)
      await bot.setMyCommands([
        { command: "start",        description: "🎁 Open DRS Giveaway Bot" },
        { command: "help",         description: "📖 Full user guide & all commands" },
        { command: "membership",   description: "👑 Get VIP Membership" },
        { command: "myplan",       description: "📋 Check my membership status & expiry" },
        { command: "leaderboard",  description: "🏆 Live leaderboard of your active giveaway" },
        { command: "mystats",      description: "📊 Your personal giveaway stats" },
        { command: "botstatus",    description: "🤖 Quick bot health & stats" },
        { command: "ping",         description: "🏓 Check bot response time" },
        { command: "myid",         description: "🪪 Show your Telegram user ID" },
        { command: "createpost",   description: "📢 Create a post in your channel" },
        { command: "topvoters",    description: "🥇 Top participants ranking" },
        { command: "active",       description: "🟢 Show all live giveaways" },
        { command: "winners",      description: "🏆 View winners of your giveaway" },
        { command: "glink",        description: "🔗 Get participation link" },
        { command: "support",      description: "💬 Contact Support" }
      ]);

      // Register full admin command list — visible only in admin's private chat
      await bot.setMyCommands([
        { command: "start",                description: "🎁 Open DRS Giveaway Bot" },
        { command: "help",                 description: "📖 Full user guide & all commands" },
        { command: "membership",           description: "👑 Get Premium Membership" },
        { command: "myplan",               description: "📋 Check my membership status" },
        { command: "leaderboard",          description: "🏆 Live leaderboard of active giveaway" },
        { command: "mystats",              description: "📊 Personal giveaway stats" },
        { command: "botstatus",            description: "🤖 Quick bot health & stats" },
        { command: "ping",                 description: "🏓 Check bot response time" },
        { command: "myid",                 description: "🪪 Your Telegram user ID" },
        { command: "createpost",           description: "📢 Create a channel post" },
        { command: "topvoters",            description: "🥇 Top participants ranking" },
        { command: "active",               description: "🟢 Show all live giveaways" },
        { command: "winners",              description: "🏆 View winners of a giveaway" },
        { command: "glink",                description: "🔗 Get participation link" },
        { command: "support",              description: "💬 Contact Support — @drssupport" },
        { command: "adminhelp",            description: "👑 Admin command list" },
        { command: "stats",                description: "📊 Bot statistics dashboard" },
        { command: "broadcast",            description: "📢 Silent broadcast — Users/Channels/Groups/All" },
        { command: "loud",                 description: "🔊 LOUD broadcast — Users/Channels/Groups/All" },
        { command: "send",                 description: "📩 Send message to specific chat" },
        { command: "sendloud",             description: "🔊 LOUD send to specific chat" },
        { command: "pin",                  description: "📌 Send & pin in channel" },
        { command: "allchannels",          description: "📋 List all registered channels" },
        { command: "allgiveaways",         description: "🎁 List all giveaways" },
        { command: "givemem",              description: "💳 Give membership to user" },
        { command: "removemem",            description: "🗑️ Revoke user membership" },
        { command: "extendmem",            description: "➕ Extend user membership" },
        { command: "listmem",              description: "📋 List all active VIP members" },
        { command: "meminfo",              description: "ℹ️ Check any user's membership" },
        { command: "setplan",              description: "💰 Update plan pricing" },
        { command: "ban",                  description: "🚫 Ban a user" },
        { command: "unban",                description: "✅ Unban a user" },
        { command: "userinfo",             description: "👤 Full user profile" },
        { command: "listusers",            description: "👥 Paginated list of all users" },
        { command: "dm",                   description: "📩 Direct message any user" },
        { command: "addvotes",             description: "➕ Manually add votes to participant" },
        { command: "removevotes",          description: "➖ Remove votes from participant" },
        { command: "endgiveaway",          description: "🏁 Force-close a giveaway + announce winners" },
        { command: "cancelgiveaway",       description: "🚫 Cancel giveaway silently (no winners)" },
        { command: "resetvotes",           description: "🔄 Reset all votes in a giveaway" },
        { command: "setwinner",            description: "🏆 Set winner count for giveaway" },
        { command: "clonegiveaway",        description: "📋 Clone a giveaway" },
        { command: "announce",             description: "📢 Message all giveaway participants" },
        { command: "remindvote",           description: "🔔 Send vote reminder to participants" },
        { command: "voteleaderboard",      description: "🌍 Global top 20 voters" },
        { command: "giveawayreport",       description: "📄 Download giveaway report .txt" },
        { command: "setstar",              description: "⭐ Set votes per Telegram Star" },
        { command: "setinr",               description: "₹ Set votes per INR paid" },
        { command: "schedule",             description: "⏰ Schedule a broadcast at IST time" },
        { command: "schedulelist",         description: "📋 View pending scheduled broadcasts" },
        { command: "cancelschedule",       description: "❌ Cancel a scheduled broadcast" },
        { command: "paystats",             description: "💰 Pending payments dashboard" },
        { command: "exportusers",          description: "📁 Download all users as .txt" },
        { command: "maintenance",          description: "🔧 Toggle maintenance mode on/off" },
        { command: "setwelcomemsg",        description: "✏️ Set custom welcome message" },
        { command: "clearwelcomemsg",      description: "🗑️ Restore default welcome message" },
        { command: "setwelcomeimageurl",   description: "🖼️ Set welcome image via URL (spoiler)" },
        { command: "clearwelcomeimage",    description: "🗑️ Remove welcome banner" },
        { command: "setmembershipqr",      description: "📸 Upload membership QR code" },
        { command: "imageinfo",            description: "ℹ️ Check image status" },
        { command: "setforcejoin",         description: "📢 Configure force join channel" },
        { command: "forcejoininfo",        description: "ℹ️ View force join config" },
        { command: "setfreelimit",         description: "🆓 Set free giveaway quota" },
        { command: "perms",                description: "🔐 Toggle user permissions" },
        { command: "viewperms",            description: "🔐 View user permissions" },
        { command: "setperms",             description: "🔐 Set a specific permission" },
        { command: "allchannels",          description: "📋 List all registered channels" },
        { command: "cleandb",              description: "🧹 Clean junk/expired data" },
        { command: "removepay",            description: "🗑️ Remove a pending payment by ID" },
        { command: "clearallpending",      description: "🗑️ Clear ALL pending payments at once" },
        { command: "setstartimage",        description: "🖼️ Set start/welcome image URL (one-liner)" },
        { command: "clearstates",          description: "🧹 Clear all stuck user states" },
        { command: "gcount",               description: "🎁 Quick giveaway count breakdown" },
        { command: "topusers",             description: "🏆 Top users by giveaways created" }
      ], { scope: { type: "chat", chat_id: MAIN_ADMIN_ID } });

      console.log("✅ Bot commands registered!");
    } catch (e) { console.error("setMyCommands error:", e.message); }

    console.log(`
✅ DRS Giveaway Bot v3.0 Started!
🤖 @${me.username}
👑 Admin ID: ${MAIN_ADMIN_ID}
💾 MongoDB: Connected
📢 Force Join: ${forceJoinChannels.filter(c => c.id).length}/${forceJoinChannels.length} channels configured
💓 Heartbeat: every 5 min

Ready!
    `);

    // 💓 5-minute heartbeat — keeps bot alive on Railway 24x7
    setInterval(async () => {
      try {
        await bot.getMe();
        console.log(`💓 Heartbeat OK — ${new Date().toISOString()}`);
      } catch (e) {
        console.error("💔 Heartbeat failed:", e.message);
      }
    }, 5 * 60 * 1000);

    // ⏳ Auto-Reminder — check every 2 minutes
    setInterval(checkAndSendReminders, 2 * 60 * 1000);

    // 👑 VIP Expiry Checker + 1-Day Warning — runs every 30 minutes
    setInterval(async () => {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      for (const [uid, v] of vipUsers) {
        if (!v.vip || !v.expiry) continue;
        const expDate = new Date(v.expiry);

        // ── Mark expired memberships in DB ──
        if (expDate < now) {
          v.vip = false;
          try { await VipModel.findOneAndUpdate({ userId: uid }, { vip: false }); } catch {}
          continue;
        }

        // ── 1-day expiry warning (send once only) ──
        if (expDate <= in24h && !v.warned24h) {
          v.warned24h = true;
          try { await VipModel.findOneAndUpdate({ userId: uid }, { warned24h: true }); } catch {}
          try {
            await bot.sendMessage(uid,
              `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
              `  ⚠️  <b>MEMBERSHIP EXPIRY</b>\n` +
              `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
              `<blockquote>` +
              `🔔 <b>Kal teri VIP membership khatam ho rahi hai!</b>\n\n` +
              `⭐ Plan    ▸  ${v.plan || "VIP"}\n` +
              `⏳ Khatam  ▸  <b>${safeFormatDateTime(expDate)}</b>\n` +
              `⏱️ Baki    ▸  <b>${timeRemaining(expDate)}</b>\n\n` +
              `Renew karo aur uninterrupted access lo! 🚀` +
              `</blockquote>\n\n` +
              `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
              { parse_mode: "HTML", reply_markup: { inline_keyboard: [
                [{ text: "👑 Renew Membership", callback_data: "vip_membership" }]
              ]}}
            );
          } catch {}
        }
      }
    }, 30 * 60 * 1000);
  }).catch(e => {
    console.error("⚠️ Startup getMe() failed:", e.message, "— Bot may still be polling, will retry.");
  });
}

// ============================================================
// AUTO-REMINDER: sends channel warning before giveaway ends
// ============================================================

const REMINDER_THRESHOLDS = [
  { label: "3h",  ms: 3 * 60 * 60 * 1000, timeStr: "3 Ghante" },
  { label: "1h",  ms: 1 * 60 * 60 * 1000, timeStr: "1 Ghanta" },
  { label: "30m", ms:      30 * 60 * 1000, timeStr: "30 Minute" },
];

async function checkAndSendReminders() {
  const now = Date.now();
  for (const [gId, g] of giveaways) {
    if (!g.active || !g.endTime || !g.channelId) continue;
    const endMs = new Date(g.endTime).getTime();
    if (endMs <= now) continue;
    const timeLeft = endMs - now;
    const totalVotes = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
    const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;

    // ── Channel reminders (3h / 1h / 30m) ──
    for (const { label, ms, timeStr } of REMINDER_THRESHOLDS) {
      if (timeLeft <= ms) {
        const key = `${gId}:${label}`;
        if (remindersSent.has(key)) continue;
        remindersSent.set(key, true);

        const hoursLeft  = Math.floor(timeLeft / (60 * 60 * 1000));
        const minsLeft   = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
        const exactLeft  = hoursLeft > 0
          ? `${hoursLeft}h ${minsLeft}m`
          : `${minsLeft} min`;

        const reminderMsg =
          `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `  ⏳  <b>GIVEAWAY ENDING SOON</b>\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `📌 <b>${h(g.title)}</b>\n\n` +
          `<blockquote>` +
          `◈ Time Left    ▸  <b>${exactLeft} remaining!</b>\n` +
          `◈ Participants ▸  <b>${g.participants.size}</b>\n` +
          `◈ Total Votes  ▸  <b>${totalVotes}</b>` +
          `</blockquote>\n\n` +
          `◈ <i>Join now — time is running out!</i>\n` +
          `✦ ─── <b>@${BOT_USERNAME}</b> ─── ✦`;

        try {
          await bot.sendMessage(g.channelId, reminderMsg, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: `⚡ Participate Now — ${timeStr} bachi!`, url: link }
              ]]
            }
          });
          console.log(`⏳ Reminder [${label}] sent for giveaway ${gId}`);
        } catch (e) {
          console.error(`Reminder send error [${gId}:${label}]:`, e.message);
        }
        break;
      }
    }

    // ── Auto 1-hour participant DM reminder ──
    const ONE_HOUR = 60 * 60 * 1000;
    const dmKey = `${gId}:1h_dm`;
    if (timeLeft <= ONE_HOUR && !remindersSent.has(dmKey) && g.participants.size > 0) {
      remindersSent.set(dmKey, true);

      // Build sorted leaderboard for context
      const sorted = [...g.participants.entries()]
        .sort((a, b) => b[1].votes - a[1].votes);
      const top3 = sorted.slice(0, 3).map(([uid, p], i) => {
        const medal = ["🥇", "🥈", "🥉"][i];
        const bu = botUsers.get(uid);
        return `${medal} <b>${h(bu?.firstName || "User")}</b> — ${p.votes} votes`;
      }).join("\n");

      const minsLeft = Math.floor(timeLeft / (60 * 1000));
      const exactLeft = minsLeft >= 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `${minsLeft} min`;

      let dmSent = 0, dmFail = 0;
      for (const [uid, p] of g.participants) {
        // Find this user's rank
        const rank = sorted.findIndex(([id]) => id === uid) + 1;
        const rankEmoji = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;

        const dmMsg =
          `╔══════════════════════╗\n` +
          `║  ⏰  <b>1 HOUR LEFT!</b>  ║\n` +
          `╚══════════════════════╝\n\n` +
          `📌 <b>${h(g.title)}</b>\n\n` +
          `<blockquote>` +
          `⏳ Time Left  » <b>${exactLeft}</b>\n` +
          `🏅 Your Rank  » <b>${rankEmoji}</b>\n` +
          `🗳️ Your Votes » <b>${p.votes}</b>\n` +
          `👥 Total Part » <b>${g.participants.size}</b>` +
          `</blockquote>\n\n` +
          `🏆 <b>Current Top 3:</b>\n${top3}\n\n` +
          `<i>Sirf 1 ghanta baki hai — abhi vote karo aur apni position pakki karo!</i>`;

        try {
          await bot.sendMessage(uid, dmMsg, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "🗳️ Vote Now!", url: link },
                { text: "🏆 Leaderboard", callback_data: `lb:${gId}` }
              ]]
            }
          });
          dmSent++;
        } catch { dmFail++; }
        await sleep(60); // rate-limit safe
      }
      console.log(`🔔 Auto 1h DM reminder: giveaway ${gId} — sent ${dmSent}, failed ${dmFail}`);
    }
  }
}

main();
