/**
 * 🎰 DRS GIVEAWAY BOT v3.0
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
  timestamp: { type: Date, default: Date.now }
});

const botConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const GiveawayModel = mongoose.model("Giveaway", giveawaySchema);
const ChannelModel = mongoose.model("Channel", channelSchema);
const VipModel = mongoose.model("Vip", vipSchema);
const PendingPaymentModel = mongoose.model("PendingPayment", pendingPaymentSchema);
const PendingMembershipModel = mongoose.model("PendingMembership", pendingMembershipSchema);
const BotConfigModel = mongoose.model("BotConfig", botConfigSchema);

// ============================================================
// IN-MEMORY STATE (fast access, synced to Mongo)
// ============================================================

const giveaways = new Map();
const registeredChannels = new Map();
const userState = new Map();
const vipUsers = new Map();
const pendingPayments = new Map();
const pendingMembershipPayments = new Map();
let paymentCounter = 1;
let membershipPayCounter = 1;
let welcomeImageUrl = null;
let membershipQrFileId = null;
let forceJoinChannels = [];

// Force join default channels (invite links + IDs — set via /setforcejoin)
// Format: { id: "-100xxxxxxxxxx", link: "https://t.me/+xxxx", label: "..." }
const DEFAULT_FORCE_CHANNELS = [
  { id: null, link: "https://t.me/+aMvgXc_nnNAzNThl", label: "🎁 Free Contents" },
  { id: null, link: "https://t.me/+uv1o-BJg3mE3ZmQ1", label: "📢 Updates" }
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
  paymentCounter = allPending.length + 1;

  // Load pending membership
  const allMemPending = await PendingMembershipModel.find({});
  for (const m of allMemPending) {
    pendingMembershipPayments.set(m.payId, {
      userId: m.userId, planKey: m.planKey, timestamp: m.timestamp
    });
  }
  membershipPayCounter = allMemPending.length + 1;

  // Load config
  const imgConfig = await BotConfigModel.findOne({ key: "welcomeImageUrl" });
  if (imgConfig) welcomeImageUrl = imgConfig.value;

  const qrConfig = await BotConfigModel.findOne({ key: "membershipQrFileId" });
  if (qrConfig) membershipQrFileId = qrConfig.value;

  const fjConfig = await BotConfigModel.findOne({ key: "forceJoinChannels" });
  if (fjConfig) forceJoinChannels = fjConfig.value;
  else forceJoinChannels = [...DEFAULT_FORCE_CHANNELS];

  console.log(`📦 Loaded: ${giveaways.size} giveaways, ${registeredChannels.size} channels, ${vipUsers.size} VIP users`);
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

// ============================================================
// BOT INIT
// ============================================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let BOT_USERNAME = "";

// ============================================================
// SLEEP HELPER
// ============================================================

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
    `🎰 <b>DRS GIVEAWAY BOT</b> 🎰`,
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

// 🔄 Loading animation — minimal spinner
async function animLoading(chatId, msgId) {
  const frames = ["⏳", "🔄", "⚙️ <i>Loading...</i>", "✦ <i>Please wait...</i>"];
  const delays = [100, 130, 160];
  for (let i = 0; i < frames.length; i++) {
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); } catch {}
    if (i < frames.length - 1) await sleep(delays[i]);
  }
  await sleep(150);
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
  try { await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts }); } catch {}
  return msg;
}

// ✅ Success animation — celebratory flash
async function animSuccess(chatId, msgId, finalText, opts = {}) {
  const frames = ["🎊", "🎊 ─ ✅ ─ 🎊", "🥳 <b>Confirmed!</b>", "✨ <i>Generating your card...</i>"];
  const delays = [120, 150, 180];
  for (let i = 0; i < frames.length; i++) {
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); } catch {}
    if (i < frames.length - 1) await sleep(delays[i]);
  }
  await sleep(200);
  try { await bot.editMessageText(finalText, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", ...opts }); } catch {}
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
  try { await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts }); } catch {}
  return msg;
}

// 🎰 Giveaway creation animation
async function animCreate(chatId, finalText, opts = {}) {
  try { await bot.sendChatAction(chatId, "typing"); } catch {}
  const frames = ["🎰", "🎰 ═══ 🎰", "✦ <b>Creating Giveaway...</b>", "🚀 <i>Almost ready!</i>"];
  const delays = [110, 140, 170];
  let msg;
  try { msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "HTML" }); } catch { return null; }
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1]);
    try { await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }); } catch {}
  }
  await sleep(200);
  try { await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts }); } catch {}
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
  try { await bot.editMessageText(finalText, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", ...opts }); } catch {}
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
  try { await bot.editMessageText(finalText, { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", ...opts }); } catch {}
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
  try { await bot.editMessageText(finalText, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", ...opts }); } catch {}
}

// ============================================================
// MEMBERSHIP PLANS
// ============================================================

const MEMBERSHIP_PLANS = {
  "1d": { label: "1 Day", days: 1, price: 10 },
  "7d": { label: "7 Days", days: 7, price: 50 },
  "30d": { label: "30 Days", days: 30, price: 350 }
};

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
  return `✅ Active (${m.plan || "VIP"} — expires ${expStr})`;
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
        { text: "🎰 New Giveaway", callback_data: "new_giveaway" },
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

function cancelKeyboard() {
  return { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cancel_flow" }]] };
}

function backKeyboard(cb = "main_menu") {
  return { inline_keyboard: [[{ text: "◀️ Back", callback_data: cb }]] };
}

function mgmtKeyboard(gId, g) {
  return {
    inline_keyboard: [
      [{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }],
      [{ text: `${g.paidVotesActive ? "🔴 Stop Paid Votes" : "🟢 Start Paid Votes"}`, callback_data: `toggle_paid:${gId}` }],
      [{ text: `${g.participationOpen ? "🔴 Stop Participation" : "🟢 Open Participation"}`, callback_data: `toggle_part:${gId}` }],
      [{ text: "🏁 End Giveaway", callback_data: `end_giveaway:${gId}` }],
      [{ text: "🗑️ Clear Channel Posts", callback_data: `clear_posts:${gId}` }],
      [{ text: "◀️ Back", callback_data: "my_giveaways" }]
    ]
  };
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

  // If welcome image set — send it as a spoiler photo (no buttons, separate message)
  if (welcomeImageUrl) {
    try {
      await bot.sendPhoto(chatId, welcomeImageUrl, { has_spoiler: true });
    } catch {}
  }

  const welcomeText =
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `   🎰  <b>DRS GIVEAWAY BOT</b>  🎰\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `▸ Create powerful giveaways instantly\n` +
    `▸ Live voting with real-time leaderboard\n` +
    `▸ Auto vote-removal on channel leave\n` +
    `▸ INR 🇮🇳 &amp; Telegram ⭐ Stars payments` +
    `</blockquote>\n\n` +
    `━━━◈ <b>QUICK ACTIONS</b> ◈━━━\n\n` +
    `🎰 <b>New Giveaway</b>  ·  Create a contest\n` +
    `📂 <b>My Giveaways</b>  ·  Manage events\n` +
    `👑 <b>VIP</b>           ·  Unlock premium\n` +
    `➕ <b>Add Channel</b>   ·  Link your channel\n\n` +
    `✦ ─────── <b>DRS NETWORK</b> ─────── ✦\n` +
    `💬 Support: @DRS_Support_DRS`;

  // Always send welcome as TEXT message so callbacks can editMessageText on it
  const opts = { parse_mode: "HTML", reply_markup: mainMenuKeyboard() };
  const animMsg = await animWelcome(chatId);
  let finalMsg;
  if (animMsg) {
    try {
      await bot.editMessageText(welcomeText, {
        chat_id: chatId, message_id: animMsg.message_id, ...opts
      });
      finalMsg = animMsg;
    } catch {
      finalMsg = await bot.sendMessage(chatId, welcomeText, opts);
    }
  } else {
    finalMsg = await bot.sendMessage(chatId, welcomeText, opts);
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
        `🔒 Bot use karne ke liye pehle ye channels join karo:\n\n` +
        `${displayList}\n\n` +
        `Join karne ke baad ✅ <b>Verify button</b> dabaao.</blockquote>\n\n` +
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
      return bot.sendMessage(chatId, "❌ Giveaway nahi mila. Link check karo.", { parse_mode: "HTML" });
    }
    if (!g.participationOpen) {
      return bot.sendMessage(chatId,
        `<b>❌ Participation Band Hai</b>\n\n<b>${h(g.title)}</b> giveaway mein abhi koi participate nahi kar sakta.`,
        { parse_mode: "HTML" }
      );
    }
    if (g.channelId) {
      const member = await isMember(g.channelId, userId);
      if (!member) {
        return bot.sendMessage(chatId,
          `<b>❌ Channel Member Nahi Ho!</b>\n\n` +
          `<b>${h(g.title)}</b> mein participate karne ke liye pehle channel join karo:\n` +
          (g.channelUsername ? `👉 @${h(g.channelUsername)}` : `Channel ID: <code>${g.channelId}</code>`),
          { parse_mode: "HTML" }
        );
      }
    }
    const existing = g.participants.get(userId);
    const userName = (msg.from.first_name || "") + (msg.from.last_name ? ` ${msg.from.last_name}` : "");

    if (existing) {
      return bot.sendMessage(chatId,
        `<b>🎉 Aap pehle se Participant Hain!</b>\n\n` +
        `📌 <b>${h(g.title)}</b>\n` +
        `🗳️ Current Votes: <b>${existing.votes}</b>\n\n` +
        (existing.channelMsgId && g.channelId
          ? `<a href="https://t.me/c/${String(g.channelId).replace("-100", "")}/${existing.channelMsgId}">📋 My Vote Post</a>\n`
          : "") +
        `🔗 Participation Link: https://t.me/${BOT_USERNAME}?start=${g.id}`,
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
        `👑 <b>DRS GIVEAWAY BOT</b> 💎\n` +
        `<i>· Fair · Fast · Automated ·</i>\n\n` +
        `◆ ─────────────────── ◆\n\n` +
        `<blockquote>✅ Bot is now Admin in:\n<b>${h(chat.title)}</b></blockquote>\n\n` +
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
  const msgId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data;
  await bot.answerCallbackQuery(query.id).catch(() => {});

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
        `<blockquote>⚠️ Kuch channels abhi join nahi kiye:\n\n` +
        `${displayList}\n\n` +
        `❌ Channels join karo phir ✅ Verify button dabaao.</blockquote>\n\n` +
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
      `<blockquote>Action cancel kar diya gaya.\nMain menu par wapas jaao aur dobara start karo.</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
    );
    return;
  }

  // ─── New Giveaway ───
  if (data === "new_giveaway") {
    userState.set(userId, { step: "title", msgId });
    await animLoading(chatId, msgId);
    await bot.editMessageText(
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   🎰  <b>CREATE GIVEAWAY</b>  🎰\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `━━━◈ <b>STEP 1 of 5</b> ◈━━━\n` +
      `<i>Giveaway Title</i>\n\n` +
      `<blockquote>` +
      `📝 Apne giveaway ke liye ek catchy title likho.\n\n` +
      `▸ iPhone 16 Giveaway Contest\n` +
      `▸ Best Creator Vote 2026\n` +
      `▸ Monthly Star Award` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: cancelKeyboard() }
    ).catch(() => {});
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
    await bot.editMessageText(caption, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: kb }).catch(() => {});
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
        `<blockquote>Is category mein abhi koi giveaway nahi hai.\nNaya banao ya kisi giveaway mein join ho!</blockquote>`,
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
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: mgmtKeyboard(gId, g) }
    ).catch(() => {});
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
    }).join("\n") || `<i>▸ Koi votes nahi the</i>`;

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
        const sentMsg = await bot.sendMessage(
          g.channelId,
          participantChannelText(participant, g),
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{
                text: `🗳️ Vote (${participant.votes})`,
                callback_data: `ch_vote:${gId}:${userId}`
              }]]
            }
          }
        );
        channelMsgId = sentMsg.message_id;
        participant.channelMsgId = channelMsgId;
      } catch (e) { console.error("Channel post error:", e.message); }
    }

    await saveGiveaway(g);

    const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;
    const chLink = g.channelId && channelMsgId
      ? `https://t.me/c/${String(g.channelId).replace("-100", "")}/${channelMsgId}`
      : null;

    await animSuccess(chatId, msgId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  🎊  <b>YOU'RE IN!</b>  🎊\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `📌 <b>${h(g.title)}</b>\n\n` +
      `<blockquote>` +
      (g.channelId ? `🔗 Channel   ▸  <a href="${g.channelUsername ? `https://t.me/${g.channelUsername}` : `https://t.me/c/${String(g.channelId).replace("-100","")}`}">Open Channel</a>\n` : "") +
      (chLink ? `🃏 Vote Card ▸  <a href="${chLink}">View My Card</a>\n` : "") +
      `🗳️ Votes     ▸  <b>0</b> (grow by sharing!)\n` +
      `⚡ Status    ▸  🟢 Active` +
      `</blockquote>\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━◈━━━\n` +
      `💡 <i>Share your link to collect more votes!</i>\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Copy Vote Link", switch_inline_query: link }],
            [{ text: "💰 Buy Paid Votes", callback_data: `buy_votes:${gId}` }],
            [{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }],
            [{ text: "🔄 Get Links Again", callback_data: `my_links:${gId}` }]
          ]
        }
      }
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
      await bot.answerCallbackQuery(query.id, { text: "Voting active nahi hai!", show_alert: true });
      return;
    }
    if (g.channelId) {
      const member = await isMember(g.channelId, userId);
      if (!member) {
        await bot.answerCallbackQuery(query.id, { text: "⚠️ Pehle channel join karo, phir vote do!", show_alert: true });
        return;
      }
    }
    if (userId === participantUserId) {
      await bot.answerCallbackQuery(query.id, {
        text: "⚠️ OPERATION DENIED\n\nYOU CANNOT VOTE FOR YOURSELF!",
        show_alert: true
      });
      return;
    }

    const participant = g.participants.get(participantUserId);
    if (!participant) {
      await bot.answerCallbackQuery(query.id, { text: "Participant nahi mila!", show_alert: true });
      return;
    }

    const existingVote = g.voterMap?.get(userId);
    if (existingVote) {
      if (existingVote === participantUserId) {
        await bot.answerCallbackQuery(query.id, { text: "Aap pehle se inhe vote kar chuke hain!", show_alert: true });
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
    await saveGiveaway(g);

    const voterName = (query.from.first_name || "") + (query.from.last_name ? ` ${query.from.last_name}` : "");
    await bot.answerCallbackQuery(query.id, {
      text:
        `✅ VOTE ADDED!\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `◈ FROM   : ${voterName}\n` +
        `◈ FOR    : ${participant.name}\n` +
        `◈ COUNT  : ${participant.votes} votes\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `⚡ @${BOT_USERNAME}`,
      show_alert: true
    });

    await updateChannelPost(g, participant);
    return;
  }

  // ─── Buy Paid Votes ───
  if (data.startsWith("buy_votes:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (!g.paidVotesActive) {
      await bot.answerCallbackQuery(query.id, { text: "Paid votes abhi available nahi.", show_alert: true });
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
      `Payment method choose karo:`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: btns } }
    ).catch(() => {});
    return;
  }

  // ─── Pay INR ───
  if (data.startsWith("pay_inr:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g?.qrFileId) {
      await bot.answerCallbackQuery(query.id, { text: "INR payment setup nahi hai!", show_alert: true });
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
      `📸 <b>Screenshot bhejo</b> (image as photo, not as file):`,
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
      await bot.answerCallbackQuery(query.id, { text: "Pehle giveaway join karo!", show_alert: true });
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
    await bot.editMessageText(
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   ❓  <b>GUIDE &amp; HELP</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `1️⃣  <b>Bot ko Channel Admin Banao</b>\n` +
      `     Bot add karo ▸ Admin rights do\n\n` +
      `2️⃣  <b>Giveaway Create Karo</b>\n` +
      `     Title ▸ Channel ▸ End Type ▸ Time\n` +
      `     Paid Votes ▸ Currency ▸ QR ▸ Rates\n\n` +
      `3️⃣  <b>Participants Link se Join Karein</b>\n` +
      `     Link share karo ▸ User click kare\n` +
      `     Channel join kare ▸ Confirm kare\n` +
      `     Auto: Vote card channel mein post!\n\n` +
      `4️⃣  <b>Voting (Channel Card pe)</b>\n` +
      `     "🗳️ Vote" button dabaao\n` +
      `     ⚠️ Sirf channel members vote kar sakte\n\n` +
      `5️⃣  <b>Auto Vote Deduction</b>\n` +
      `     Channel leave ▸ votes auto-remove\n` +
      `     Participant ko alert bhi milta hai` +
      `</blockquote>\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━◈━━━\n` +
      `💡 <i>Channel ID ke liye: @getidsbot use karo</i>\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── Add Channel / Group ───
  if (data === "add_channel" || data === "add_group") {
    const type = data === "add_channel" ? "channel" : "group";
    userState.set(userId, { step: "reg_chat", type });
    await animLoading(chatId, msgId);
    await bot.editMessageText(
      `<b>➕ ${type === "channel" ? "Channel" : "Group"} Add Karo</b>\n\n` +
      `${type === "channel" ? "Channel" : "Group"} ID bhejo:\n<i>Example: -1001234567890</i>\n\n` +
      `<b>Note:</b> Pehle bot ko ${type === "channel" ? "channel" : "group"} ka admin banao.\n` +
      `Ya simply bot ko add karo — automatically register ho jaata hai.`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
    ).catch(() => {});
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
      `💳 1 Day   ▸  ₹10\n` +
      `💳 7 Days  ▸  ₹50\n` +
      `💎 30 Days ▸  ₹350` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`;

    const kb = m
      ? { inline_keyboard: [[{ text: "◀️ Back", callback_data: "main_menu" }]] }
      : {
          inline_keyboard: [
            [{ text: "1D - ₹10", callback_data: "buy_mem:1d" }, { text: "7D - ₹50", callback_data: "buy_mem:7d" }],
            [{ text: "30D - ₹350", callback_data: "buy_mem:30d" }],
            [{ text: "◀️ Back", callback_data: "main_menu" }]
          ]
        };

    await bot.editMessageText(featuresText, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: kb
    }).catch(() => {});
    return;
  }

  // ─── Buy Membership (INR plan) ───
  if (data.startsWith("buy_mem:")) {
    const planKey = data.split(":")[1];
    const plan = MEMBERSHIP_PLANS[planKey];
    if (!plan) return;

    if (!membershipQrFileId) {
      await bot.answerCallbackQuery(query.id, {
        text: "❌ Payment QR abhi set nahi hai. Admin se contact karo.",
        show_alert: true
      });
      return;
    }

    const payId = String(membershipPayCounter++);
    const memData = { userId, planKey, timestamp: new Date() };
    pendingMembershipPayments.set(payId, memData);
    await PendingMembershipModel.create({ payId, ...memData });

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
      await bot.sendMessage(chatId, "❌ QR bhejne mein error. Admin se contact karo.", { parse_mode: "HTML" });
    }
    return;
  }

  // ─── I've Paid (Membership) ───
  if (data.startsWith("mem_paid:")) {
    const payId = data.split(":")[1];
    const pending = pendingMembershipPayments.get(payId);
    if (!pending) {
      await bot.answerCallbackQuery(query.id, { text: "Payment already processed ya expired.", show_alert: true });
      return;
    }
    const plan = MEMBERSHIP_PLANS[pending.planKey];
    await bot.answerCallbackQuery(query.id, { text: "✅ Request bhej di! Admin verify karega.", show_alert: true });
    await bot.editMessageCaption(
      `💳 <b>Purchase ${plan?.label} Membership</b>\n\n🧾 <b>Amount: ₹${plan?.price}</b>\n\n⏳ <i>Admin verification pending...</i>\nPayment ID: <code>${payId}</code>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});

    try {
      await bot.sendMessage(MAIN_ADMIN_ID,
        `<b>💳 New Membership Payment Claim</b>\n\n` +
        `Payment ID: <code>${payId}</code>\n` +
        `User ID: <code>${userId}</code>\n` +
        `Plan: <b>${plan?.label} — ₹${plan?.price}</b>\n\n` +
        `User ne payment claim ki hai. Approve karein?`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `approve_mem:${payId}` },
                { text: "❌ Reject", callback_data: `reject_mem:${payId}` }
              ]
            ]
          }
        }
      );
    } catch (e) { console.error("Admin mem notify:", e.message); }
    return;
  }

  // ─── Admin: Approve Membership ───
  if (data.startsWith("approve_mem:")) {
    if (!isAdmin(userId)) return;
    const payId = data.split(":")[1];
    const pending = pendingMembershipPayments.get(payId);
    if (!pending) {
      await bot.answerCallbackQuery(query.id, { text: "Payment nahi mila ya already processed.", show_alert: true });
      return;
    }
    const plan = MEMBERSHIP_PLANS[pending.planKey];
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
    try {
      await bot.sendMessage(pending.userId,
        `<b>❌ Membership Payment Rejected</b>\n\nPayment ID: <code>${payId}</code>\n\nPayment verify nahi ho saka. Dobara try karo ya @DRS_Support_DRS se contact karo.`,
        { parse_mode: "HTML" }
      );
    } catch {}
    return;
  }

  // ─── Create Post ───
  if (data === "create_post") {
    await animLoading(chatId, msgId);
    const myChannels = [...registeredChannels.entries()].filter(([, c]) => c.addedBy === userId || isAdmin(userId));
    if (!myChannels.length) {
      await bot.editMessageText(
        `<b>📢 Create Post</b>\n\n❌ Koi registered channel nahi.\nPehle channel mein bot ko admin banao.`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
      ).catch(() => {});
      return;
    }
    userState.set(userId, { step: "create_post" });
    await bot.editMessageText(
      `<b>📢 Create Post</b>\n\nWoh message bhejo jo channel mein post karna hai:`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: cancelKeyboard() }
    ).catch(() => {});
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
      await finishGiveawayCreation(userId, chatId, null);
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
        `<blockquote>Apna UPI/Google Pay QR code ki photo bhejo.\nUsers isi pe payment karenge.</blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    } else {
      state.step = "stars_rate";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `⭐ <b>SET STARS RATE</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>1 Telegram Star pe kitne votes milenge?\n\nExample: <code>10</code> → 1 Star = 10 votes</blockquote>`,
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
      return bot.answerCallbackQuery(query.id, { text: "Payment nahi mila!", show_alert: true });
    }
    userState.set(userId, { step: "approve_votes", paymentId: payId });
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(MAIN_ADMIN_ID,
      `Kitne votes dene hain user <code>${payment.userId}</code> ko? (number bhejo)`,
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
        `<b>❌ Payment Rejected</b>\n\nAapki payment verify nahi ho saki.\nPayment ID: <code>${payId}</code>\n\nDubara try karo ya support se contact karo.`,
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
  try {
    await bot.editMessageReplyMarkup(
      {
        inline_keyboard: [[{
          text: `🗳️ Vote (${participant.votes})`,
          callback_data: `ch_vote:${g.id}:${participant.id}`
        }]]
      },
      { chat_id: g.channelId, message_id: participant.channelMsgId }
    );
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
    : `<i>▸ Koi votes nahi the</i>`;

  const channelCard =
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🏆  <b>GIVEAWAY ENDED!</b>  🏆\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `🎊  🎉  🥳  🎊  🎉  🥳  🎊\n\n` +
    `📌 <b>${h(g.title)}</b>\n\n` +
    `━━━◈  🏆 WINNERS 🏆  ◈━━━\n\n` +
    `${podiumText}\n\n` +
    `━━━◈━━━━━━━━━━━━━━━━━◈━━━\n` +
    `<blockquote>` +
    `👥 Participants  ▸  <b>${g.participants.size}</b>\n` +
    `🗳️ Total Votes   ▸  <b>${totalVotes}</b>\n` +
    `📅 Ended At      ▸  ${now}` +
    `</blockquote>\n\n` +
    `🎊 <i>Sabko participation ke liye shukriya!</i>\n` +
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

  for (let i = 0; i < top3.length; i++) {
    const winner = top3[i];
    if (winner.id === creatorId) continue;
    const winnerDM =
      `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  🎊  <b>CONGRATULATIONS!</b>  🎊\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `🥳 <b>Aap ${rankNames[i]} Place Jeet Gaye!</b>\n\n` +
      `📌 <b>${h(g.title)}</b>\n\n` +
      `<blockquote>` +
      `🏆 Rank    ▸  <b>${rankNames[i]}</b>\n` +
      `🗳️ Votes   ▸  <b>${winner.votes}</b>\n` +
      `👥 Players ▸  ${g.participants.size} total` +
      `</blockquote>\n\n` +
      `🎉 <i>DRS Network ki taraf se dil se badhai!</i>\n` +
      `✦ ─── <b>@${BOT_USERNAME}</b> ─── ✦`;
    try { await bot.sendMessage(winner.id, winnerDM, { parse_mode: "HTML" }); } catch {}
  }
}

// ============================================================
// HELPER: participantChannelText
// ============================================================
function participantChannelText(participant, g) {
  return (
    `✦━━━━━━ 🎰 DRS GIVEAWAY ━━━━━━✦\n\n` +
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

  await animCreate(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🎉  <b>GIVEAWAY CREATED!</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>` +
    `📌 Title   ▸  <b>${h(g.title)}</b>\n` +
    `🆔 ID      ▸  <code>${gId}</code>\n` +
    `⚡ Status  ▸  🟢 ACTIVE\n` +
    `💰 Paid    ▸  ${g.paidVotesActive ? "✅ Enabled" : "❌ Disabled"}\n` +
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
        `<blockquote>₹1 pe kitne votes milenge?\n\nExample: <code>45</code> → ₹1 = 45 votes</blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
      return;
    }

    if (state.step === "awaiting_inr_screenshot") {
      const gId = state.giveawayId;
      const g = getGiveaway(gId);
      if (!g) return;

      const payId = String(paymentCounter++);
      const payData = { userId, giveawayId: gId, screenshotFileId: fileId, timestamp: new Date() };
      pendingPayments.set(payId, payData);
      await PendingPaymentModel.create({ payId, ...payData });
      userState.delete(userId);

      await bot.sendMessage(chatId,
        `<b>✅ Screenshot Received!</b>\n\n` +
        `Admin verify kar raha hai. Verified hone ke baad votes add ho jaayenge.\n\n` +
        `Payment ID: <code>${payId}</code>`,
        { parse_mode: "HTML" }
      );

      try {
        await bot.sendPhoto(MAIN_ADMIN_ID, fileId, {
          caption:
            `<b>💰 New INR Payment Request</b>\n\n` +
            `Payment ID: <code>${payId}</code>\n` +
            `User ID: <code>${userId}</code>\n` +
            `Giveaway: <b>${h(g.title)}</b> (<code>${gId}</code>)\n\n` +
            `Kitne votes approve karein?`,
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
  if (!state) return;

  // ─── Admin approving vote count ───
  if (userId === MAIN_ADMIN_ID && state.step === "approve_votes") {
    const votes = parseInt(text, 10);
    if (isNaN(votes) || votes < 1) {
      await bot.sendMessage(MAIN_ADMIN_ID, "❌ Valid number bhejo.");
      return;
    }
    const payId = state.paymentId;
    const payment = pendingPayments.get(payId);
    if (!payment) {
      userState.delete(MAIN_ADMIN_ID);
      return bot.sendMessage(MAIN_ADMIN_ID, "❌ Payment nahi mila!");
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

    await bot.sendMessage(MAIN_ADMIN_ID, `✅ ${votes} votes add kiye user ${payment.userId} ko!`);
    try {
      await bot.sendMessage(payment.userId,
        `<b>✅ Payment Approved!</b>\n\n` +
        `<b>${votes} votes</b> aapke account mein add ho gaye!\n` +
        `<b>${h(g.title)}</b>\n\n` +
        `Current Votes: <b>${participant.votes}</b>`,
        { parse_mode: "HTML" }
      );
    } catch {}
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
      await bot.sendMessage(chatId, "❌ Valid number bhejo (minimum 1).");
      return;
    }
    state.votesPerInr = rate;
    if (state.currency === "both") {
      state.step = "stars_rate";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `⭐ <b>SET STARS VOTE RATE</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote>1 Star pe kitne votes milenge?\n\nExample: <code>5</code> → 1 ⭐ = 5 votes</blockquote>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    } else {
      await bot.sendMessage(chatId, "✅ <b>Rates recorded! Finalizing your giveaway...</b>", { parse_mode: "HTML" });
      await finishGiveawayCreation(userId, chatId, state.qrFileId);
    }
    return;
  }

  if (state.step === "stars_rate") {
    const rate = parseInt(text, 10);
    if (isNaN(rate) || rate < 1) {
      await bot.sendMessage(chatId, "❌ Valid number bhejo (minimum 1).");
      return;
    }
    state.votesPerStar = rate;
    userState.set(userId, state);
    await bot.sendMessage(chatId, "✅ <b>Rates recorded! Finalizing your giveaway...</b>", { parse_mode: "HTML" });
    await finishGiveawayCreation(userId, chatId, state.qrFileId);
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
      await bot.sendMessage(chatId, `❌ Chat nahi mila. Bot ko admin banao phir try karo.`, { parse_mode: "HTML" });
    }
    return;
  }

  if (state.step === "create_post") {
    const myChans = [...registeredChannels.entries()].filter(([, c]) => c.addedBy === userId || isAdmin(userId));
    let sent = 0, failed = 0;
    for (const [chId] of myChans) {
      try { await bot.sendMessage(chId, `📢 <b>Post from DRS Bot</b>\n\n${h(text)}`, { parse_mode: "HTML" }); sent++; }
      catch { failed++; }
    }
    userState.delete(userId);
    await bot.sendMessage(chatId,
      `<b>✅ Post Sent!</b>\n✅ Sent: ${sent}\n❌ Failed: ${failed}`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
    );
    return;
  }

  // ─── Admin: set welcome image URL ───
  if (state.step === "set_welcome_image_url" && isAdmin(userId)) {
    const url = text.trim();
    if (!url.startsWith("http")) {
      await bot.sendMessage(chatId, "❌ Valid URL bhejo (http/https se shuru ho).");
      return;
    }
    welcomeImageUrl = url;
    await saveConfig("welcomeImageUrl", url);
    userState.delete(userId);
    await bot.sendMessage(chatId,
      `✅ <b>Welcome image URL set ho gaya!</b>\n\nURL: <code>${h(url)}</code>\n\nAb /start karne par yeh image <b>spoiler mode</b> mein dikhegi. 🎭`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ─── Admin: set force join channel ───
  if (state.step === "set_force_join" && isAdmin(userId)) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await bot.sendMessage(chatId, "❌ Format: <code>CHANNEL_ID INVITE_LINK LABEL</code>\nExample: <code>-1001234567890 https://t.me/+xxx Free Contents</code>", { parse_mode: "HTML" });
      return;
    }
    const chId = parts[0];
    const link = parts[1];
    const label = parts.slice(2).join(" ") || "Join Channel";
    const idx = state.channelIndex;

    forceJoinChannels[idx] = { id: chId, link, label };
    await saveConfig("forceJoinChannels", forceJoinChannels);
    userState.delete(userId);
    await bot.sendMessage(chatId,
      `✅ <b>Force Join Channel ${idx + 1} set ho gaya!</b>\n\nID: <code>${chId}</code>\nLink: ${link}\nLabel: ${label}`,
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
            `♻️ <b>Auto-Resync: Vote Removed</b>\n\n` +
            `<blockquote>👤 User: ${h(leftName)} left the channel.</blockquote>\n` +
            `<blockquote>🏅 Participant: ${h(p.name)}</blockquote>\n` +
            `<blockquote>🗳 Updated Votes: ${p.votes}</blockquote>`,
            { parse_mode: "HTML" }
          );
        } catch (e) { console.error("Leave channel announcement:", e.message); }

        try {
          await bot.sendMessage(p.id,
            `⚠️ <b>Vote Deduction Alert!</b>\n\n` +
            `A user (${h(leftName)}) left the required channel.\n` +
            `Your vote count has been reduced.\n` +
            `↳ <b>New Count: ${p.votes}</b>`,
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
        if (theirP) { theirP.votes = Math.max(0, theirP.votes - 1); await updateChannelPost(g, theirP); }
        g.voterMap.delete(leftUserId);
        await saveGiveaway(g);
      }
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
    : {
        inline_keyboard: [
          [{ text: "1D - ₹10", callback_data: "buy_mem:1d" }, { text: "7D - ₹50", callback_data: "buy_mem:7d" }],
          [{ text: "30D - ₹350", callback_data: "buy_mem:30d" }],
          [{ text: "◀️ Back", callback_data: "main_menu" }]
        ]
      };
  await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: kb });
});

bot.onText(/\/support/, async (msg) => {
  if (msg.chat.type !== "private") return;
  await bot.sendMessage(msg.chat.id,
    `<b>💬 DRS Bot Support</b>\n\n` +
    `Need help? Contact us:\n\n` +
    `📩 Support: @DRS_Support_DRS\n` +
    `⚡ Powered by: <b>DRS NETWORK</b>\n\n` +
    `<i>Please describe your issue clearly when contacting support.</i>`,
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
      `<b>📢 Create Post</b>\n\n❌ Koi registered channel nahi.\nPehle channel mein bot ko admin banao.`,
      { parse_mode: "HTML" }
    );
  }
  userState.set(userId, { step: "create_post" });
  await bot.sendMessage(chatId,
    `<b>📢 Create Post</b>\n\nWoh message bhejo jo channel mein post karna hai.\n\n` +
    `<i>Registered channels: ${myChannels.map(([, c]) => c.title).join(", ")}</i>`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
});

// ============================================================
// MAIN ADMIN COMMANDS
// ============================================================

bot.onText(/\/broadcast\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const message = match[1];
  let sent = 0, failed = 0;
  for (const [id] of registeredChannels) {
    try { await bot.sendMessage(id, `<b>📢 DRS Broadcast</b>\n\n${h(message)}`, { parse_mode: "HTML", disable_notification: true }); sent++; }
    catch { failed++; }
  }
  await bot.sendMessage(msg.chat.id, `✅ Broadcast done! (Silent)\n✅ Sent: ${sent}\n❌ Failed: ${failed}`);
});

bot.onText(/\/loud\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const message = match[1];
  let sent = 0, failed = 0;
  for (const [id] of registeredChannels) {
    try { await bot.sendMessage(id, `<b>📢 DRS Broadcast</b>\n\n${h(message)}`, { parse_mode: "HTML", disable_notification: false }); sent++; }
    catch { failed++; }
  }
  await bot.sendMessage(msg.chat.id, `✅ LOUD Broadcast done!\n✅ Sent: ${sent}\n❌ Failed: ${failed}`);
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
  if (!registeredChannels.size) return bot.sendMessage(msg.chat.id, "Koi registered channel nahi.");
  let text = "<b>📋 Registered Channels:</b>\n\n";
  for (const [id, c] of registeredChannels) {
    text += `• <b>${h(c.title)}</b> (<code>${id}</code>) — ${c.type}\n`;
  }
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/allgiveaways/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  if (!giveaways.size) return bot.sendMessage(msg.chat.id, "Koi giveaway nahi.");
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
    `<b>🖼️ Set Welcome Image via URL</b>\n\nImage ka direct URL bhejo (http/https).\nYe image /start pe <b>Spoiler Mode</b> 🎭 mein dikhegi.\n\n<i>Current: ${welcomeImageUrl ? "✅ Set" : "❌ Not set"}</i>`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() }
  );
});

// /clearwelcomeimage — Remove welcome banner
bot.onText(/\/clearwelcomeimage/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  welcomeImageUrl = null;
  await saveConfig("welcomeImageUrl", null);
  await bot.sendMessage(msg.chat.id, "✅ Welcome banner image remove kar di.", { parse_mode: "HTML" });
});

// /setmembershipqr — Admin uploads membership payment QR
bot.onText(/\/setmembershipqr/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  userState.set(msg.from.id, { step: "set_membership_qr" });
  await bot.sendMessage(msg.chat.id,
    `<b>📸 Set Membership Payment QR</b>\n\nAbhi <b>photo bhejo</b> jo membership purchase pe dikhega.\n\n<i>Current: ${membershipQrFileId ? "✅ Set" : "❌ Not set"}</i>`,
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
    `Format bhejo:\n<code>CHANNEL_ID INVITE_LINK LABEL</code>\n\n` +
    `Example:\n<code>-1001234567890 https://t.me/+xxx Free Contents</code>\n\n` +
    `<i>Channel ID ke liye bot ko us channel ka admin banao, phir @getidsbot se ID lo.</i>`,
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

// /givemem — Admin manually give membership
bot.onText(/\/givemem\s+(\d+)\s+(1d|7d|30d)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const planKey = match[2];
  const plan = MEMBERSHIP_PLANS[planKey];
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + plan.days);
  const vipData = { vip: true, plan: plan.label, expiry, days: plan.days };
  vipUsers.set(targetId, vipData);
  await saveVip(targetId, vipData);
  await bot.sendMessage(msg.chat.id, `✅ User <code>${targetId}</code> ko <b>${plan.label} Membership</b> diya!\nExpiry: ${expiry.toLocaleDateString("en-IN")}`, { parse_mode: "HTML" });
  try {
    await bot.sendMessage(targetId,
      `<b>🎊 Membership Activated!</b>\n\n⭐ Plan: <b>${plan.label}</b>\n📅 Expires: <b>${expiry.toLocaleDateString("en-IN")}</b>\n\nPremium features ab available hain!`,
      { parse_mode: "HTML" }
    );
  } catch {}
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

bot.onText(/\/adminhelp/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id,
    `<b>👑 DRS Bot — Admin Commands</b>\n\n` +
    `<b>🖼️ Images:</b>\n` +
    `/setwelcomeimageurl — Set welcome image via URL (spoiler mode)\n` +
    `/clearwelcomeimage — Remove welcome banner\n` +
    `/setmembershipqr — Upload membership payment QR photo\n` +
    `/imageinfo — Check current image status\n\n` +
    `<b>📢 Force Join:</b>\n` +
    `/setforcejoin 1 — Configure force join channel 1\n` +
    `/setforcejoin 2 — Configure force join channel 2\n` +
    `/forcejoininfo — View force join config\n\n` +
    `<b>📢 Broadcast:</b>\n` +
    `/broadcast &lt;msg&gt; — Silent broadcast all channels\n` +
    `/loud &lt;msg&gt; — LOUD broadcast (with sound)\n\n` +
    `<b>📩 Direct Send:</b>\n` +
    `/send &lt;chatId&gt; &lt;msg&gt; — Send to specific chat\n` +
    `/sendloud &lt;chatId&gt; &lt;msg&gt; — LOUD send\n\n` +
    `<b>📌 Pin:</b>\n` +
    `/pin &lt;chatId&gt; &lt;msg&gt; — Send &amp; pin in channel\n\n` +
    `<b>💳 Membership:</b>\n` +
    `/givemem &lt;userId&gt; &lt;1d|7d|30d&gt; — Manually give membership\n\n` +
    `<b>📊 Info:</b>\n` +
    `/allchannels — All registered channels\n` +
    `/allgiveaways — All giveaways overview\n` +
    `/adminhelp — This help menu\n\n` +
    `<b>🧹 Maintenance:</b>\n` +
    `/cleandb — Clean junk/expired data from database`,
    { parse_mode: "HTML" }
  );
});

// ============================================================
// ERROR HANDLING & STARTUP
// ============================================================

bot.on("polling_error", e => console.error("Polling error:", e.message));
bot.on("error", e => console.error("Bot error:", e.message));

// ============================================================
// MAIN START
// ============================================================

async function main() {
  await connectDB();

  bot.getMe().then(async (me) => {
    BOT_USERNAME = me.username;

    try {
      await bot.setMyCommands([
        { command: "start",      description: "🎰 Open DRS Giveaway Bot" },
        { command: "membership", description: "👑 Get Premium Membership" },
        { command: "support",    description: "💬 Contact Support" },
        { command: "createpost", description: "📢 Create a channel post" }
      ]);

      await bot.setMyCommands([
        { command: "start",                description: "🎰 Open DRS Giveaway Bot" },
        { command: "membership",           description: "👑 Get Premium Membership" },
        { command: "support",              description: "💬 Contact Support" },
        { command: "createpost",           description: "📢 Create a channel post" },
        { command: "adminhelp",            description: "👑 Admin command list" },
        { command: "broadcast",            description: "📢 Silent broadcast to all channels" },
        { command: "loud",                 description: "🔊 LOUD broadcast to all channels" },
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

Ready!
    `);
  });
}

main();
