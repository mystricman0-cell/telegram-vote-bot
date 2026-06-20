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
  days: Number
});

const pendingPaymentSchema = new mongoose.Schema({
  payId: { type: String, required: true, unique: true },
  userId: Number,
  giveawayId: String,
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
let paymentCounter = 1;
let membershipPayCounter = 1;
let welcomeImageUrl = null;
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
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log("✅ MongoDB Connected!");
    await loadStateFromDB();
  } catch (e) {
    console.error("❌ MongoDB connection error:", e.message);
  }
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
    vipUsers.set(v.userId, { vip: v.vip, plan: v.plan, expiry: v.expiry, days: v.days });
  }

  // Load pending payments
  const allPending = await PendingPaymentModel.find({});
  for (const p of allPending) {
    pendingPayments.set(p.payId, {
      userId: p.userId, giveawayId: p.giveawayId,
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
  if (plansConfig) membershipPlans = plansConfig.value;

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
  if (d.expiry && new Date() > d.expiry) { d.vip = false; return null; }
  return d;
}

function isVip(uid) { return getMembership(uid) !== null; }

function membershipBadge(uid) {
  const m = getMembership(uid);
  if (!m) return "❌ Inactive";
  const expStr = m.expiry ? new Date(m.expiry).toLocaleDateString("en-IN") : "∞";
  return `◈ Active (${m.plan || "VIP"} — expires ${expStr})`;
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
        { text: "🎁 New Giveaway", callback_data: "new_giveaway" },
        { text: "📂 My Giveaways", callback_data: "my_giveaways" }
      ],
      [
        { text: "➕ Add Channel", callback_data: "add_channel" },
        { text: "➕ Add Group", callback_data: "add_group" }
      ],
      [
        { text: "👑 VIP Membership", callback_data: "vip_membership" },
        { text: "📢 Create Post", callback_data: "create_post" }
      ],
      [{ text: "❓ Guide & Help", callback_data: "how_to_use" }]
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
  return { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cancel_flow" }]] };
}

function backKeyboard(cb = "main_menu") {
  return { inline_keyboard: [[{ text: "◀️ Back", callback_data: cb }]] };
}

function mgmtKeyboard(gId, g, showVipControls = false) {
  const rows = [
    [{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }, { text: "📊 Top Participants", callback_data: `topvoters:${gId}` }],
    [{ text: `${g.paidVotesActive ? "🔴 Stop Paid Votes" : "🟢 Start Paid Votes"}`, callback_data: `toggle_paid:${gId}` }],
    [{ text: `${g.participationOpen ? "🔴 Stop Participation" : "🟢 Open Participation"}`, callback_data: `toggle_part:${gId}` }],
  ];
  if (showVipControls) {
    rows.push([{
      text: g.extraForceJoin
        ? `🔗 Force Join: ${g.extraForceJoin.channelUsername ? "@" + g.extraForceJoin.channelUsername : "Set ✅"} — Change`
        : "🔗 Set Force Join Channel (VIP)",
      callback_data: `set_gj:${gId}`
    }]);
    if (g.extraForceJoin) {
      rows.push([{ text: "❌ Remove Force Join", callback_data: `clear_gj:${gId}` }]);
    }
  }
  rows.push([{ text: "🏁 End Giveaway", callback_data: `end_giveaway:${gId}` }]);
  rows.push([{ text: "🗑️ Clear Channel Posts", callback_data: `clear_posts:${gId}` }]);
  rows.push([{ text: "◀️ Back", callback_data: "my_giveaways" }]);
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

  try { await bot.sendChatAction(chatId, "typing"); } catch {}

  const welcomeText =
    `✦ ━━━━━━━━━━━━━━━━━━━━━ ✦\n` +
    `   🎁  <b>DRS GIVEAWAY BOT</b>  🎁\n` +
    `✦ ━━━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
    `<blockquote>` +
    `▸ Create powerful giveaways instantly\n` +
    `▸ Live voting with real-time leaderboard\n` +
    `▸ Auto vote-removal on channel leave\n` +
    `▸ INR 🇮🇳 &amp; Telegram ⭐ Stars payments` +
    `</blockquote>\n\n` +
    `━━━◇ <b>QUICK ACTIONS</b> ◇━━━\n\n` +
    `🎁 <b>New Giveaway</b>   ·  Create a contest\n` +
    `📂 <b>My Giveaways</b>  ·  Manage events\n` +
    `👑 <b>VIP</b>              ·  Unlock premium\n` +
    `➕ <b>Add Channel</b>   ·  Link your channel\n\n` +
    `✦ ────── <b>DRS NETWORK</b> ────── ✦\n` +
    `💬 Support: @drssupport`;

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
  const chatId = query.message.chat.id;
  let msgId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data;
  await bot.answerCallbackQuery(query.id).catch(() => {});

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
      await bot.answerCallbackQuery(query.id, { text: "❌ Broadcast session expired. Use /broadcast again.", show_alert: true });
      return;
    }
    userState.delete(userId);
    try { await bot.deleteMessage(chatId, msgId); } catch {}
    const targetLabel = { users: "👥 Users", channels: "📢 Channels", groups: "🏘️ Groups", all: "🌐 All" }[target];
    await bot.sendMessage(chatId,
      `⏳ <b>Broadcasting to ${targetLabel}...</b>\n<i>Please wait...</i>`,
      { parse_mode: "HTML" }
    );
    await doBroadcast(chatId, state.adminMsg, state.text, state.silent, target);
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
    await animLoading(chatId, msgId);
    await replyToCallback(chatId, msgId, caption, { reply_markup: kb });
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
      await bot.answerCallbackQuery(query.id, { text: "👑 VIP Membership required for this feature!", show_alert: true });
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
    await bot.answerCallbackQuery(query.id, { text: "✅ Force join channel remove ho gaya!" });
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
    if (!g) { await bot.answerCallbackQuery(query.id, { text: "❌ Giveaway not found!", show_alert: true }); return; }
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Only the giveaway creator can view this!", show_alert: true });
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
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true });
      return;
    }
    g.paidVotesActive = !g.paidVotesActive;
    await saveGiveaway(g);
    await bot.editMessageReplyMarkup(mgmtKeyboard(gId, g), { chat_id: chatId, message_id: msgId }).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: `Paid votes ${g.paidVotesActive ? "ON" : "OFF"}!` });
    return;
  }

  // ─── Toggle Participation ───
  if (data.startsWith("toggle_part:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true });
      return;
    }
    g.participationOpen = !g.participationOpen;
    await saveGiveaway(g);
    await bot.editMessageReplyMarkup(mgmtKeyboard(gId, g), { chat_id: chatId, message_id: msgId }).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: `Participation ${g.participationOpen ? "OPEN" : "CLOSED"}!` });
    return;
  }

  // ─── End Giveaway ───
  if (data.startsWith("end_giveaway:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true });
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
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true });
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
    await bot.answerCallbackQuery(query.id, { text: `${cleared} posts delete kiye!`, show_alert: true });
    return;
  }

  // ─── Confirm Join (participant) ───
  if (data.startsWith("confirm_join:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (!g.participationOpen) {
      await bot.answerCallbackQuery(query.id, { text: "Participation band hai!", show_alert: true });
      return;
    }

    // ── Duplicate join guard ──
    if (g.participants.has(userId)) {
      const existing = g.participants.get(userId);
      const chLink = existing.channelMsgId && g.channelId
        ? `https://t.me/c/${String(g.channelId).replace("-100", "")}/${existing.channelMsgId}`
        : null;
      await bot.answerCallbackQuery(query.id, { text: "You are already a participant in this giveaway!", show_alert: true });
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

    const existingVote = g.voterMap?.get(userId);
    if (existingVote) {
      if (existingVote === participantUserId) {
        await bot.answerCallbackQuery(query.id, { text: "You have already voted for this participant!", show_alert: true }).catch(() => {});
        return;
      }
      const oldP = g.participants.get(existingVote);
      if (oldP) {
        oldP.votes = Math.max(0, oldP.votes - 1);
        oldP.voters.delete(userId);
        await updateChannelPost(g, oldP);
      }
    }

    if (!g.voterMap) g.voterMap = new Map();
    participant.votes += 1;
    participant.voters.add(userId);
    g.voterMap.set(userId, participantUserId);

    // Save and update channel post BEFORE answerCallbackQuery
    // (answerCallbackQuery may silently fail if already answered by the pre-handler at top
    //  of callback_query — that would skip everything after it)
    await saveGiveaway(g);
    await updateChannelPost(g, participant);

    const voterName = (query.from.first_name || "") + (query.from.last_name ? ` ${query.from.last_name}` : "");
    await notifyAdmin(
      `🗳️ <b>Vote Cast</b>\n` +
      `From: <b>${h(voterName)}</b> (<code>${userId}</code>)\n` +
      `For: <b>${h(participant.name)}</b>\n` +
      `Giveaway: <b>${h(g.title)}</b>\n` +
      `Total votes: <b>${participant.votes}</b>`
    );

    // answerCallbackQuery may silently fail (already answered) — that's fine
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
      await bot.answerCallbackQuery(query.id, { text: "❌ Paid votes are not available for this giveaway.", show_alert: true });
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
      await bot.answerCallbackQuery(query.id, { text: "❌ INR payment is not set up for this giveaway!", show_alert: true });
      return;
    }
    userState.set(userId, { step: "awaiting_inr_screenshot", giveawayId: gId });
    try {
      await bot.sendPhoto(chatId, g.qrFileId, {
        caption:
          `🇮🇳 <b>PAY VIA UPI/QR</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `<blockquote>◈ Rate: <b>${g.votesPerInr} Votes</b> per ₹1\n\nSteps:\n1️⃣ Scan the QR code above\n2️⃣ Pay your desired amount\n3️⃣ Take screenshot of payment\n4️⃣ Send screenshot here ↓</blockquote>\n` +
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
      await bot.answerCallbackQuery(query.id, { text: "❌ You must join the giveaway first!", show_alert: true });
      return;
    }
    try {
      await bot.sendInvoice(
        chatId,
        `Vote Pack — ${h(g.title)}`,
        `${g.votesPerStar} votes ke liye 1 Telegram Star do`,
        `paid_vote_${gId}_${userId}`,
        "", "XTR",
        [{ label: `${g.votesPerStar} Votes`, amount: 1 }]
      );
    } catch (e) {
      console.error("Stars invoice error:", e.message);
      await bot.sendMessage(chatId, `<b>Error:</b> ${h(e.message)}`, { parse_mode: "HTML" });
    }
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
    await animLoading(chatId, msgId);
    await replyToCallback(chatId, msgId,
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
    await animLoading(chatId, msgId);
    await replyToCallback(chatId, msgId,
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
    await animLoading(chatId, msgId);
    const badge = membershipBadge(userId);
    const m = getMembership(userId);
    const featuresText =
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   👑  <b>VIP MEMBERSHIP</b>\n` +
      `   ${badge}\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      (m
        ? `<blockquote>✅ <b>You are a VIP Member!</b>\n⏳ Expires: ${new Date(m.expiry).toLocaleDateString("en-IN")}</blockquote>\n\n`
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

    await replyToCallback(chatId, msgId, featuresText, { reply_markup: kb });
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
      });
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
      await bot.answerCallbackQuery(query.id, { text: "❌ Server error. Please try again.", show_alert: true });
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
      await bot.answerCallbackQuery(query.id, { text: "❌ Payment session expired. Please try again.", show_alert: true });
      return;
    }
    const plan = getMembershipPlan(pending.planKey);
    await bot.answerCallbackQuery(query.id, { text: "✅ Now send your screenshot!" });
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
      await bot.answerCallbackQuery(query.id, { text: "❌ Payment not found or already processed.", show_alert: true });
      return;
    }
    const plan = getMembershipPlan(pending.planKey);
    if (!plan) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Plan configuration not found. Contact admin.", show_alert: true });
      return;
    }
    pendingMembershipPayments.delete(payId);
    await PendingMembershipModel.deleteOne({ payId });

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + plan.days);
    const vipData = { vip: true, plan: plan.label, expiry, days: plan.days };
    vipUsers.set(pending.userId, vipData);
    await saveVip(pending.userId, vipData);

    await bot.answerCallbackQuery(query.id, { text: `✅ Membership approved — ${plan.label}!` });
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
      `◈ Expiry  ▸  ${expiry.toLocaleDateString("en-IN")}` +
      `</blockquote>`
    );
    try {
      await bot.sendMessage(pending.userId,
        `<b>🎊 Membership Activated!</b>\n\n` +
        `⭐ Plan: <b>${plan.label}</b>\n` +
        `📅 Expires: <b>${expiry.toLocaleDateString("en-IN")}</b>\n\n` +
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
    await bot.answerCallbackQuery(query.id, { text: "Payment rejected." });
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
      await bot.answerCallbackQuery(query.id, { text: "Default image use hogi." });
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
      await bot.answerCallbackQuery(query.id, { text: "❌ VIP record not found for this user.", show_alert: true });
      return;
    }
    const current = getUserPerm(targetId, perm);
    const newVal = !current;
    const newPerms = { ...(v.perms || {}), [perm]: newVal };
    const updated = { ...v, perms: newPerms };
    vipUsers.set(targetId, updated);
    await saveVip(targetId, updated);
    await bot.answerCallbackQuery(query.id, { text: `${VALID_PERMS[perm]}: ${newVal ? "✅ ON" : "❌ OFF"}` });

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
    await bot.answerCallbackQuery(query.id, { text: "✅ All permissions reset (all enabled)." });

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
      await bot.answerCallbackQuery(query.id, { text: "Access denied!", show_alert: true });
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

  // ─── Admin: Approve INR payment ───
  if (data.startsWith("approve_pay:")) {
    if (!isAdmin(userId)) return;
    const payId = data.split(":")[1];
    const payment = pendingPayments.get(payId);
    if (!payment) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Payment record not found!", show_alert: true });
    }
    userState.set(userId, { step: "approve_votes", paymentId: payId });
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(MAIN_ADMIN_ID,
      `How many votes to add for user <code>${payment.userId}</code>? (send a number)`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ─── Admin: Reject INR payment ───
  if (data.startsWith("reject_pay:")) {
    if (!isAdmin(userId)) return;
    const payId = data.split(":")[1];
    const payment = pendingPayments.get(payId);
    if (!payment) return;
    pendingPayments.delete(payId);
    await PendingPaymentModel.deleteOne({ payId });
    await bot.answerCallbackQuery(query.id, { text: "Payment rejected!" });
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
  if (msg.chat.type !== "private") return;
  if (msg.successful_payment) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
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

  // ─── Support message (any message type) ───
  if (state?.step === "awaiting_support_message") {
    userState.delete(userId);
    const pu = botUsers.get(userId) || {};
    const puName = h(msg.from.first_name || pu.firstName || "Unknown");
    const puHandle = msg.from.username ? `@${msg.from.username}` : (pu.username ? `@${pu.username}` : `ID: ${userId}`);

    // Build text preview for text messages (show inline, not just forwarded)
    const textPreview = msg.text
      ? `\n\n📝 <b>Message:</b>\n<blockquote>${h(msg.text)}</blockquote>`
      : (msg.caption ? `\n\n📝 <b>Caption:</b>\n<blockquote>${h(msg.caption)}</blockquote>` : "");

    const infoMsg =
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  📩  <b>SUPPORT REQUEST</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `◈ Name    ▸  <b>${puName}</b>\n` +
      `◈ Handle  ▸  ${puHandle}\n` +
      `◈ User ID ▸  <code>${userId}</code>` +
      `</blockquote>` +
      textPreview +
      `\n\n✦ ─── <b>DRS NETWORK</b> ─── ✦`;

    const resolveKb = {
      inline_keyboard: [[
        { text: "✅ Resolved", callback_data: `sup_resolve:${userId}` },
        { text: "❌ Not Resolved", callback_data: `sup_pending:${userId}` }
      ]]
    };

    try {
      await bot.sendMessage(MAIN_ADMIN_ID, infoMsg, { parse_mode: "HTML", reply_markup: resolveKb });
      // Also forward the original message (photo/video/sticker/etc) if non-text
      if (!msg.text) {
        await bot._request("forwardMessage", {
          chat_id: MAIN_ADMIN_ID,
          from_chat_id: chatId,
          message_id: msg.message_id
        });
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
      const payData = { userId, giveawayId: gId, screenshotFileId: fileId, timestamp: new Date() };
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

      try {
        await bot.sendPhoto(MAIN_ADMIN_ID, fileId, {
          caption: (() => {
            const pu = botUsers.get(userId);
            const puName = pu?.firstName ? h(pu.firstName) : "Unknown";
            const puHandle = pu?.username ? `@${pu.username}` : `ID: ${userId}`;
            return `<b>💰 New INR Payment Request</b>\n\n` +
              `<blockquote>` +
              `◈ Name     ▸  <b>${puName}</b> (${puHandle})\n` +
              `◈ User ID  ▸  <code>${userId}</code>\n` +
              `◈ Giveaway ▸  <b>${h(g.title)}</b> (<code>${gId}</code>)\n` +
              `◈ Pay ID   ▸  <code>${payId}</code>` +
              `</blockquote>\n\n` +
              `Kitne votes approve karein?`;
          })(),
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `approve_pay:${payId}` },
                { text: "❌ Reject", callback_data: `reject_pay:${payId}` }
              ]
            ]
          }
        });
      } catch (e) { console.error("Admin notify error:", e.message); }
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
  if (userId === MAIN_ADMIN_ID && state.step === "approve_votes") {
    const votes = parseInt(text, 10);
    if (isNaN(votes) || votes < 1) {
      await bot.sendMessage(MAIN_ADMIN_ID, "❌ Please enter a valid number.");
      return;
    }
    const payId = state.paymentId;
    const payment = pendingPayments.get(payId);
    if (!payment) {
      userState.delete(MAIN_ADMIN_ID);
      return bot.sendMessage(MAIN_ADMIN_ID, "❌ Payment record not found!");
    }
    userState.delete(MAIN_ADMIN_ID);
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

    await bot.sendMessage(MAIN_ADMIN_ID, `✅ ${votes} votes added for user ${payment.userId}!`);
    try {
      await bot.sendMessage(payment.userId,
        `<b>✅ Payment Approved!</b>\n\n` +
        `<b>${votes} votes</b> have been added to your account!\n` +
        `<b>${h(g.title)}</b>\n\n` +
        `Current Votes: <b>${participant.votes}</b>`,
        { parse_mode: "HTML" }
      );
    } catch {}
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
      await bot.sendMessage(chatId, "✅ <b>Rates recorded!</b>", { parse_mode: "HTML" });
      await askCustomPhotoOrFinish(userId, chatId, state.qrFileId);
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
    const vipData = { vip: true, plan: "30 Days", expiry, days: 30 };
    vipUsers.set(userId, vipData);
    await saveVip(userId, vipData);
    await bot.sendMessage(chatId,
      `<b>👑 VIP Activated!</b>\n\nExpiry: <b>${expiry.toLocaleDateString("en-IN")}</b>`,
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
      `<b>✅ Stars Payment Done!</b>\n\n` +
      `<b>${votesToAdd} votes</b> add ho gaye!\n` +
      `Stars spent: <b>${stars} ⭐</b>\n` +
      `Current votes: <b>${participant.votes}</b>`,
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
    return;
  }
});

// ============================================================
// CHANNEL MEMBER LEFT — Vote Auto-Remove
// ============================================================

bot.on("chat_member", async (update) => {
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

// ── Broadcast helper ──
// target: "users" | "channels" | "groups" | "all"
async function doBroadcast(adminChatId, adminMsg, textContent, silent, target = "all") {
  const channelIds = [...registeredChannels.entries()]
    .filter(([, c]) => c.type === "channel")
    .map(([id]) => id);
  const groupIds = [...registeredChannels.entries()]
    .filter(([, c]) => c.type === "group" || c.type === "supergroup")
    .map(([id]) => id);
  const userIds = [...botUsers.keys()];

  let targets = [];
  if (target === "users")    targets = userIds;
  else if (target === "channels") targets = channelIds;
  else if (target === "groups")   targets = groupIds;
  else targets = [...new Set([...channelIds, ...groupIds, ...userIds])];

  const replyTo = adminMsg.reply_to_message;
  let sent = 0, failed = 0;

  for (const id of targets) {
    try {
      if (replyTo) {
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
  }

  const targetLabel = { users: "👥 Users", channels: "📢 Channels", groups: "👥 Groups", all: "🌐 All" }[target];
  const mode = replyTo ? "Message-Copy" : "Image+Text";
  const notif = silent ? "🔕 Silent" : "🔔 LOUD";
  await bot.sendMessage(adminChatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  ${silent ? "📢" : "🔔"}  <b>BROADCAST DONE</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ Target   ▸  ${targetLabel}\n` +
    `◈ Mode     ▸  ${notif} ${mode}\n` +
    `◈ Total    ▸  ${targets.length}\n` +
    `◈ Sent     ▸  ✅ ${sent}\n` +
    `◈ Failed   ▸  ❌ ${failed}` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
}

// ── Show broadcast target selection menu ──
async function showBroadcastMenu(chatId, userId, adminMsg, text, silent) {
  userState.set(userId, { step: "broadcast_pending", adminMsg, text, silent });
  const notif = silent ? "🔕 Silent" : "🔔 LOUD";
  const mode = adminMsg.reply_to_message ? "📋 Message-Copy" : "🖼️ Image+Text";
  await bot.sendMessage(chatId,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  📢  <b>BROADCAST — ${notif}</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `Mode: ${mode}\n` +
    `${text ? `Message: <i>${h(text.slice(0, 60))}${text.length > 60 ? "..." : ""}</i>` : `Copied message selected ✅`}` +
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
  if (!text && !msg.reply_to_message) {
    return bot.sendMessage(msg.chat.id,
      `<b>📢 /broadcast — Usage:</b>\n\n` +
      `<blockquote>` +
      `Option 1: Reply to ANY message (photo/text/video) + type <code>/broadcast</code>\n` +
      `→ That exact message will be copied to: Users / Channels / Groups / All\n\n` +
      `Option 2: <code>/broadcast Your text here</code>\n` +
      `→ Sends image + text in premium style` +
      `</blockquote>`,
      { parse_mode: "HTML" }
    );
  }
  await showBroadcastMenu(msg.chat.id, msg.from.id, msg, text || "", true);
});

// /loud — LOUD broadcast with target selection
bot.onText(/\/loud(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const text = match[1]?.trim();
  if (!text && !msg.reply_to_message) {
    return bot.sendMessage(msg.chat.id,
      `<b>🔔 /loud — Usage:</b>\n\n` +
      `<blockquote>` +
      `Option 1: Reply to ANY message (photo/text/video) + type <code>/loud</code>\n` +
      `→ That exact message will be LOUDLY sent to: Users / Channels / Groups / All\n\n` +
      `Option 2: <code>/loud Your text here</code>\n` +
      `→ Image + text with notification sound` +
      `</blockquote>`,
      { parse_mode: "HTML" }
    );
  }
  await showBroadcastMenu(msg.chat.id, msg.from.id, msg, text || "", false);
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
  const vipData = { vip: true, plan: plan.label, expiry, days: plan.days };
  vipUsers.set(targetId, vipData);
  await saveVip(targetId, vipData);
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  ✅  <b>MEMBERSHIP GRANTED</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ User ID  ▸  <code>${targetId}</code>\n` +
    `◈ Plan     ▸  <b>${plan.label}</b>\n` +
    `◈ Expiry   ▸  ${expiry.toLocaleDateString("en-IN")}\n` +
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
      `◈ Expiry  ▸  <b>${expiry.toLocaleDateString("en-IN")}</b>\n\n` +
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
    `◈ New Expiry ▸  <b>${expiry.toLocaleDateString("en-IN")}</b>` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
  try {
    await bot.sendMessage(targetId,
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `  ⏰  <b>MEMBERSHIP EXTENDED!</b>\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
      `<blockquote>◈ Added     ▸  +${plan.days} days\n◈ New Expiry ▸  <b>${expiry.toLocaleDateString("en-IN")}</b></blockquote>`,
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

  // Remove expired VIP users
  for (const [uid, v] of vipUsers) {
    if (v.expiry && new Date(v.expiry) < new Date()) {
      vipUsers.delete(uid);
      await VipModel.deleteOne({ userId: uid });
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

// /myplan — VIP User: Check own membership status
bot.onText(/\/myplan/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const m = getMembership(userId);
  if (!m) {
    return bot.sendMessage(msg.chat.id,
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `  📋  <b>MY MEMBERSHIP</b>\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
      `<blockquote>` +
      `◈ Status  ▸  ❌ <b>No Active Membership</b>\n\n` +
      `Use /membership to get a plan, or contact admin.` +
      `</blockquote>`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "👑 Get Membership", callback_data: "vip_membership" }]] } }
    );
  }
  const expiry = m.expiry ? new Date(m.expiry) : null;
  const now = new Date();
  const daysLeft = expiry ? Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))) : "∞";
  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  👑  <b>MY MEMBERSHIP</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `◈ Status    ▸  ✅ <b>ACTIVE</b>\n` +
    `◈ Plan      ▸  ${m.plan || "VIP"}\n` +
    `◈ Expires   ▸  ${expiry ? expiry.toLocaleDateString("en-IN") : "∞"}\n` +
    `◈ Days Left ▸  <b>${daysLeft} days</b>` +
    `</blockquote>\n\n` +
    `━━━◈ <b>YOUR ACCESS</b> ◈━━━\n\n` +
    `<blockquote>` +
    `🎁 Create giveaways\n` +
    `📢 Post giveaway image in your channel\n` +
    `🔗 Set per-giveaway Force Join channel\n` +
    `📊 Full giveaway management panel\n` +
    `🏆 Live leaderboard & voting controls` +
    `</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🎁 My Giveaways", callback_data: "my_giveaways" }]] } }
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

bot.onText(/\/adminhelp/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;

  const part1 =
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  👑  <b>DRS BOT — ADMIN PANEL</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<b>💳 MEMBERSHIP MANAGEMENT</b>\n` +
    `<blockquote>` +
    `/givemem &lt;userId&gt; &lt;1d|7d|30d&gt;\n  → Grant membership to a user\n\n` +
    `/removemem &lt;userId&gt;\n  → Revoke membership\n\n` +
    `/extendmem &lt;userId&gt; &lt;1d|7d|30d&gt;\n  → Extend membership (added to existing)\n\n` +
    `/listmem\n  → View all active members (name + permissions)\n\n` +
    `/meminfo &lt;userId&gt;\n  → Check membership status of any user\n\n` +
    `/setplan &lt;1d|7d|30d&gt; &lt;price&gt; &lt;days&gt;\n  → Update plan price/duration\n  Example: /setplan 7d 80 7` +
    `</blockquote>\n\n` +
    `<b>🔐 PERMISSIONS (Button UI)</b>\n` +
    `<blockquote>` +
    `/perms &lt;userId&gt;\n  → Interactive button toggle — tap to on/off any permission\n  Example: /perms 123456789\n\n` +
    `/viewperms &lt;userId&gt;\n  → View all permissions for a user\n\n` +
    `/setperms &lt;userId&gt; &lt;perm&gt; &lt;on|off&gt;\n  → Set a single permission (text command)\n\n` +
    `<b>Available Permissions:</b>\n` +
    `  • createGiveaway — Create giveaways\n` +
    `  • voteFree — Cast free votes\n` +
    `  • buyVotes — Buy votes with INR/Stars\n` +
    `  • createPost — Post to channels\n` +
    `  • forceJoin — Configure force join\n` +
    `  • customPhoto — Upload custom giveaway photo` +
    `</blockquote>`;

  const part2 =
    `<b>🎁 GIVEAWAY CONTROLS</b>\n` +
    `<blockquote>` +
    `/allgiveaways — View all giveaways\n\n` +
    `/setstar &lt;gId&gt; &lt;n&gt; — Set votes per ⭐ Star\n` +
    `/setinr &lt;gId&gt; &lt;n&gt; — Set votes per ₹1 INR\n` +
    `  Example: /setstar ABC12345 10` +
    `</blockquote>\n\n` +
    `<b>📢 BROADCAST</b>\n` +
    `<blockquote>` +
    `/broadcast — Choose target: Users / Channels / Groups / All (silent)\n` +
    `/broadcast &lt;text&gt; — Send image+text to chosen target (silent)\n` +
    `/loud — Same as broadcast but with notification sound\n` +
    `/loud &lt;text&gt; — Send image+text loudly to chosen target\n\n` +
    `💡 Reply to any message + /broadcast → forwards that exact message to the selected target` +
    `</blockquote>\n\n` +
    `<b>📩 DIRECT SEND & PIN</b>\n` +
    `<blockquote>` +
    `/send &lt;chatId&gt; &lt;msg&gt; — Send to specific chat\n` +
    `/sendloud &lt;chatId&gt; &lt;msg&gt; — LOUD send\n` +
    `/pin &lt;chatId&gt; &lt;msg&gt; — Send &amp; pin` +
    `</blockquote>`;

  const part3 =
    `<b>🖼️ IMAGES & CONFIG</b>\n` +
    `<blockquote>` +
    `/setwelcomeimageurl — Set welcome image (spoiler)\n` +
    `/clearwelcomeimage — Remove welcome image\n` +
    `/setmembershipqr — Upload payment QR photo\n` +
    `/imageinfo — Check image status` +
    `</blockquote>\n\n` +
    `<b>📢 FORCE JOIN</b>\n` +
    `<blockquote>` +
    `/setforcejoin 1 — Set force join channel 1\n` +
    `/setforcejoin 2 — Set force join channel 2\n` +
    `/forcejoininfo — View current force join config` +
    `</blockquote>\n\n` +
    `<b>📊 INFO & MAINTENANCE</b>\n` +
    `<blockquote>` +
    `/stats — Bot ka full dashboard (users, channels, votes)\n` +
    `/allchannels — Registered channels\n` +
    `/cleandb — Clean expired data from DB\n` +
    `/adminhelp — Show this panel` +
    `</blockquote>\n\n` +
    `━━━◈ <b>VIP USER COMMANDS</b> ◈━━━\n` +
    `<blockquote>` +
    `/myplan — Check your own membership status\n` +
    `/membership — Membership info + plans\n\n` +
    `<b>VIP Features (when Membership is Active):</b>\n` +
    `▸ Giveaway creation\n` +
    `▸ Giveaway image posted to channel\n` +
    `▸ Per-giveaway Force Join set\n` +
    `▸ Full management panel` +
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
    console.error("⚠️ Fatal polling error, reconnecting...");
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
      await bot.setMyCommands([
        { command: "start",                description: "🎁 Open DRS Giveaway Bot" },
        { command: "membership",           description: "👑 Get Premium Membership" },
        { command: "myplan",               description: "📋 Check my membership status" },
        { command: "createpost",           description: "📢 Create a channel post" },
        { command: "support",              description: "💬 Contact Support — @drssupport" },
        { command: "adminhelp",            description: "👑 Admin command list" },
        { command: "broadcast",            description: "📢 Silent broadcast — Users/Channels/Groups/All" },
        { command: "loud",                 description: "🔊 LOUD broadcast — Users/Channels/Groups/All" },
        { command: "send",                 description: "📩 Send message to specific chat" },
        { command: "sendloud",             description: "🔊 LOUD send to specific chat" },
        { command: "pin",                  description: "📌 Send & pin in channel" },
        { command: "allchannels",          description: "📋 List all registered channels" },
        { command: "allgiveaways",         description: "🎁 List all giveaways" },
        { command: "givemem",              description: "💳 Give membership to user" },
        { command: "setwelcomeimageurl",   description: "🖼️ Set welcome image via URL (spoiler)" },
        { command: "setmembershipqr",      description: "📸 Upload membership QR code" },
        { command: "clearwelcomeimage",    description: "🗑️ Remove welcome banner" },
        { command: "imageinfo",            description: "ℹ️ Check image status" },
        { command: "setforcejoin",         description: "📢 Configure force join channel" },
        { command: "forcejoininfo",        description: "ℹ️ View force join config" },
        { command: "stats",                description: "📊 Bot statistics dashboard" },
        { command: "topvoters",            description: "📊 Top participants in your giveaway" },
        { command: "cleandb",              description: "🧹 Clean junk/expired data" }
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
        break; // only one reminder per check cycle per giveaway
      }
    }
  }
}

main();
