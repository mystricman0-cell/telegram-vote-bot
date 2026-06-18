/**
 * 🗳️ GIVEAWAY VOTE BOT
 * VTH-style Telegram Giveaway & Voting Bot
 *
 * Features:
 * - Inline keyboard UI (VTH Bot style)
 * - New Giveaway creation with paid voting (Telegram Stars)
 * - Channel/Group management
 * - VIP Membership
 * - Member-only voting
 * - Auto vote removal on leave + channel announcement
 * - Single Main Admin with broadcast & all controls
 */

import TelegramBot from "node-telegram-bot-api";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAIN_ADMIN_ID = Number(process.env.ADMIN_ID);

if (!BOT_TOKEN) { console.error("❌ TELEGRAM_BOT_TOKEN not set!"); process.exit(1); }
if (!MAIN_ADMIN_ID) { console.error("❌ ADMIN_ID not set!"); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ============================================================
// STATE STORAGE (In-memory — upgrade to DB for production)
// ============================================================

// giveawayId -> { id, title, channelId, creatorId, participants: Map<name,{votes,voters,paid}>,
//                 active, votePrice, currency, createdAt, endAt }
const giveaways = new Map();
let giveawayCounter = 1;

// userId -> { channelId, giveawayId, votedFor }  key: `${userId}:${giveawayId}`
const userVotes = new Map();

// userId -> { step, data }  (conversation state for multi-step flows)
const userState = new Map();

// chatId -> { type: 'channel'|'group', title, addedBy }
const registeredChats = new Map();

// userId -> { vip: bool, vipExpiry: Date }
const vipUsers = new Map();

// VIP price in stars
const VIP_PRICE_STARS = 50;
const VIP_DURATION_DAYS = 30;

// ============================================================
// HELPERS
// ============================================================

function h(text) {
  // HTML escape
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isVip(userId) {
  const data = vipUsers.get(userId);
  if (!data || !data.vip) return false;
  if (data.vipExpiry && new Date() > data.vipExpiry) {
    data.vip = false;
    return false;
  }
  return true;
}

function getGiveaway(id) { return giveaways.get(String(id)); }

function voteKey(userId, giveawayId) { return `${userId}:${giveawayId}`; }

async function isChannelMember(chatId, userId) {
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

function formatLeaderboard(participants, max = 10) {
  if (!participants || participants.size === 0) return "<i>Abhi koi votes nahi.</i>";
  const sorted = [...participants.entries()].sort((a, b) => b[1].votes - a[1].votes).slice(0, max);
  return sorted.map(([name, d], i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    return `${medal} <b>${h(name)}</b> — <b>${d.votes}</b> vote${d.votes !== 1 ? "s" : ""}`;
  }).join("\n");
}

function myGiveawaysList(userId) {
  const mine = [...giveaways.values()].filter(g => g.creatorId === userId);
  return mine;
}

// ============================================================
// KEYBOARDS
// ============================================================

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🎰 New Giveaway", callback_data: "new_giveaway" },
        { text: "📋 My Giveaways", callback_data: "my_giveaways" }
      ],
      [
        { text: "❓ How to Use", callback_data: "how_to_use" }
      ],
      [
        { text: "➕ Add Channel", callback_data: "add_channel" },
        { text: "➕ Add Group", callback_data: "add_group" }
      ],
      [
        { text: "👑 VIP Membership", callback_data: "vip_membership" }
      ],
      [
        { text: "📢 Create Post", callback_data: "create_post" }
      ]
    ]
  };
}

function giveawayKeyboard(giveawayId, active) {
  const btns = [
    [
      { text: "🗳️ Vote Karo", callback_data: `vote_list:${giveawayId}` },
      { text: "📊 Results", callback_data: `results:${giveawayId}` }
    ]
  ];
  if (active) {
    btns.push([
      { text: "🛑 Poll Band Karo", callback_data: `stop_poll:${giveawayId}` },
      { text: "🔄 Reset", callback_data: `reset_poll:${giveawayId}` }
    ]);
  } else {
    btns.push([
      { text: "▶️ Poll Shuru Karo", callback_data: `start_poll:${giveawayId}` }
    ]);
  }
  btns.push([{ text: "◀️ Back", callback_data: "my_giveaways" }]);
  return { inline_keyboard: btns };
}

function backKeyboard(cb = "main_menu") {
  return { inline_keyboard: [[{ text: "◀️ Back", callback_data: cb }]] };
}

// ============================================================
// WELCOME MESSAGE
// ============================================================

async function sendWelcome(chatId, firstName = "") {
  const botInfo = await bot.getMe();
  const text =
    `<b>🎰 GIVEAWAY • BOT</b>\n\n` +
    `╔══════════════════════╗\n` +
    `║  <b>Fair · Fast · Automated</b>  ║\n` +
    `╚══════════════════════╝\n\n` +
    `👋 <b>Welcome ${h(firstName)}!</b>\n\n` +
    `<blockquote>⭐ <b>FULLY AUTOMATED &amp; FAIR GIVEAWAY SYSTEM</b> ✅\n🚀 FAST &amp; TRANSPARENT WINNER</blockquote>\n\n` +
    `<blockquote>🆕 TAP <b>New Giveaway</b> BUTTON TO CREATE A GIVEAWAY ⭐</blockquote>\n\n` +
    `<blockquote>📋 TAP <b>My Giveaways</b> BUTTON TO VIEW YOUR GIVEAWAYS 👀</blockquote>\n\n` +
    `─────── 🎰 ───────\n` +
    `⚡ POWERED BY: <b>@${h(botInfo.username)}</b>\n` +
    `💬 SUPPORT: @admin`;

  return bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard()
  });
}

// ============================================================
// /start
// ============================================================

bot.onText(/\/start/, async (msg) => {
  if (msg.chat.type !== "private") return;
  userState.delete(msg.from.id);
  await sendWelcome(msg.chat.id, msg.from.first_name);
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

  // ─── Main Menu ───
  if (data === "main_menu") {
    userState.delete(userId);
    await bot.editMessageText(
      `<b>🎰 GIVEAWAY • BOT</b>\n\n` +
      `<blockquote>⭐ FULLY AUTOMATED &amp; FAIR GIVEAWAY SYSTEM ✅\n🚀 FAST &amp; TRANSPARENT WINNER</blockquote>\n\n` +
      `<blockquote>🆕 TAP New Giveaway BUTTON TO CREATE A GIVEAWAY ⭐</blockquote>\n\n` +
      `<blockquote>📋 TAP My Giveaways BUTTON TO VIEW YOUR GIVEAWAYS 👀</blockquote>\n\n` +
      `─────── 🎰 ───────\n` +
      `⚡ POWERED BY: <b>Giveaway Bot</b>\n💬 SUPPORT: @admin`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── New Giveaway ───
  if (data === "new_giveaway") {
    userState.set(userId, { step: "giveaway_title" });
    await bot.editMessageText(
      `<b>🎰 New Giveaway Create Karo</b>\n\n` +
      `<b>Step 1/4:</b> Giveaway ka <b>title</b> bhejo:\n\n` +
      `<i>Example: Diwali Giveaway 2026</i>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── My Giveaways ───
  if (data === "my_giveaways") {
    const mine = myGiveawaysList(userId);
    if (mine.length === 0) {
      await bot.editMessageText(
        `<b>📋 My Giveaways</b>\n\n<i>Aapka koi giveaway nahi hai.\nNew Giveaway button se banao!</i>`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
      ).catch(() => {});
      return;
    }
    const btns = mine.map(g => ([{
      text: `${g.active ? "🟢" : "🔴"} ${g.title}`,
      callback_data: `giveaway_detail:${g.id}`
    }]));
    btns.push([{ text: "◀️ Back", callback_data: "main_menu" }]);
    await bot.editMessageText(
      `<b>📋 My Giveaways</b>\n\n🟢 = Active  🔴 = Inactive\n\nSelect karo:`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: btns } }
    ).catch(() => {});
    return;
  }

  // ─── Giveaway Detail ───
  if (data.startsWith("giveaway_detail:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) {
      await bot.answerCallbackQuery(query.id, { text: "Giveaway nahi mila!", show_alert: true });
      return;
    }
    const totalVotes = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
    const text =
      `<b>🎰 ${h(g.title)}</b>\n\n` +
      `📌 Status: <b>${g.active ? "🟢 Active" : "🔴 Inactive"}</b>\n` +
      `👥 Participants: <b>${g.participants.size}</b>\n` +
      `🗳️ Total Votes: <b>${totalVotes}</b>\n` +
      `💰 Vote Price: <b>${g.votePrice > 0 ? `${g.votePrice} ⭐ Stars` : "Free"}</b>\n` +
      (g.channelId ? `📢 Channel: <code>${h(g.channelId)}</code>\n` : "") +
      `\n<b>Participants:</b>\n${[...g.participants.keys()].map((n, i) => `${i + 1}. ${h(n)}`).join("\n") || "<i>Koi nahi</i>"}`;

    await bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: giveawayKeyboard(gId, g.active)
    }).catch(() => {});
    return;
  }

  // ─── Vote List (show participants to vote for) ───
  if (data.startsWith("vote_list:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g || !g.active) {
      await bot.answerCallbackQuery(query.id, { text: "Voting active nahi hai!", show_alert: true });
      return;
    }
    if (g.channelId) {
      const isMember = await isChannelMember(g.channelId, userId);
      if (!isMember) {
        await bot.answerCallbackQuery(query.id, {
          text: "Pehle channel join karo, phir vote do!",
          show_alert: true
        });
        return;
      }
    }
    if (g.participants.size === 0) {
      await bot.answerCallbackQuery(query.id, { text: "Koi participant nahi hai!", show_alert: true });
      return;
    }
    const btns = [...g.participants.keys()].map(name => ([{
      text: `🗳️ ${name}`,
      callback_data: `do_vote:${gId}:${name}`
    }]));
    btns.push([{ text: "◀️ Back", callback_data: `giveaway_detail:${gId}` }]);

    const priceText = g.votePrice > 0 ? `\n💰 Vote Price: <b>${g.votePrice} ⭐ Stars</b>` : "";
    await bot.editMessageText(
      `<b>🗳️ ${h(g.title)}</b>\n\nKis ko vote dena chahte ho?${priceText}\n\n<i>Sirf channel members hi vote kar sakte hain.</i>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: btns } }
    ).catch(() => {});
    return;
  }

  // ─── Do Vote ───
  if (data.startsWith("do_vote:")) {
    const parts = data.split(":");
    const gId = parts[1];
    const participantName = parts.slice(2).join(":");
    const g = getGiveaway(gId);

    if (!g || !g.active) {
      await bot.answerCallbackQuery(query.id, { text: "Voting band ho gayi!", show_alert: true });
      return;
    }

    if (g.channelId) {
      const isMember = await isChannelMember(g.channelId, userId);
      if (!isMember) {
        await bot.answerCallbackQuery(query.id, {
          text: "Pehle channel join karo!",
          show_alert: true
        });
        return;
      }
    }

    const key = voteKey(userId, gId);
    const existing = userVotes.get(key);
    if (existing && existing.votedFor === participantName) {
      await bot.answerCallbackQuery(query.id, {
        text: `Aap pehle se ${participantName} ko vote kar chuke hain!`,
        show_alert: true
      });
      return;
    }

    // Paid vote — send invoice
    if (g.votePrice > 0) {
      userState.set(userId, { step: "awaiting_payment", giveawayId: gId, participantName, msgId, chatId });
      await bot.answerCallbackQuery(query.id).catch(() => {});
      try {
        await bot.sendInvoice(
          chatId,
          `Vote: ${participantName}`,
          `"${g.title}" giveaway mein ${participantName} ko vote do`,
          `vote_${gId}_${userId}_${participantName}`,
          "",
          "XTR",
          [{ label: `Vote for ${participantName}`, amount: g.votePrice }]
        );
      } catch (e) {
        console.error("Invoice error:", e.message);
        await bot.sendMessage(chatId,
          `<b>Payment Error:</b> Invoice create nahi ho saka.\n\n<i>${h(e.message)}</i>`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    // Free vote — direct
    await recordVote(userId, gId, participantName, g, chatId, query.from.first_name, msgId);
    return;
  }

  // ─── Results ───
  if (data.startsWith("results:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) {
      await bot.answerCallbackQuery(query.id, { text: "Giveaway nahi mila!", show_alert: true });
      return;
    }
    const lb = formatLeaderboard(g.participants);
    await bot.editMessageText(
      `<b>📊 ${h(g.title)} — Results</b>\n\n${lb}`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard(`giveaway_detail:${gId}`) }
    ).catch(() => {});
    return;
  }

  // ─── Start Poll ───
  if (data.startsWith("start_poll:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (g.creatorId !== userId && userId !== MAIN_ADMIN_ID) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator poll shuru kar sakta hai!", show_alert: true });
      return;
    }
    if (g.participants.size === 0) {
      await bot.answerCallbackQuery(query.id, { text: "Pehle participants add karo!", show_alert: true });
      return;
    }
    g.active = true;
    if (g.channelId) {
      try {
        const pList = [...g.participants.keys()].map((n, i) => `${i + 1}. ${n}`).join("\n");
        await bot.sendMessage(g.channelId,
          `<b>🎰 VOTING SHURU HO GAYI!</b>\n\n` +
          `<b>${h(g.title)}</b>\n\n` +
          `<b>Participants:</b>\n${h(pList)}\n\n` +
          `💰 Vote Price: <b>${g.votePrice > 0 ? `${g.votePrice} ⭐ Stars` : "Free"}</b>\n\n` +
          `Bot ko PM karo aur vote do:\n<code>/vote ${gId}</code>`,
          { parse_mode: "HTML" }
        );
      } catch (e) { console.error("Channel msg error:", e.message); }
    }
    await bot.editMessageText(
      `<b>🎰 ${h(g.title)}</b>\n\n` +
      `✅ <b>Voting shuru ho gayi!</b>\n\n` +
      `👥 Participants: <b>${g.participants.size}</b>\n` +
      `💰 Price: <b>${g.votePrice > 0 ? `${g.votePrice} ⭐` : "Free"}</b>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: giveawayKeyboard(gId, true) }
    ).catch(() => {});
    return;
  }

  // ─── Stop Poll ───
  if (data.startsWith("stop_poll:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (g.creatorId !== userId && userId !== MAIN_ADMIN_ID) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator poll band kar sakta hai!", show_alert: true });
      return;
    }
    g.active = false;
    const lb = formatLeaderboard(g.participants);
    if (g.channelId) {
      try {
        await bot.sendMessage(g.channelId,
          `<b>🛑 ${h(g.title)} — VOTING BAND HO GAYI!</b>\n\n<b>Final Results:</b>\n${lb}`,
          { parse_mode: "HTML" }
        );
      } catch (e) { console.error("Channel msg error:", e.message); }
    }
    await bot.editMessageText(
      `<b>🛑 ${h(g.title)}</b>\n\n✅ Voting band ho gayi!\n\n<b>Final Results:</b>\n${lb}`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: giveawayKeyboard(gId, false) }
    ).catch(() => {});
    return;
  }

  // ─── Reset Poll ───
  if (data.startsWith("reset_poll:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    if (g.creatorId !== userId && userId !== MAIN_ADMIN_ID) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator reset kar sakta hai!", show_alert: true });
      return;
    }
    for (const [, p] of g.participants) {
      for (const vid of p.voters) userVotes.delete(voteKey(vid, gId));
      p.votes = 0; p.voters = new Set();
    }
    g.active = false;
    await bot.answerCallbackQuery(query.id, { text: "Reset ho gaya!", show_alert: true });
    await bot.editMessageText(
      `<b>🔄 ${h(g.title)}</b>\n\n✅ Sab votes reset ho gaye. Poll inactive hai.`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: giveawayKeyboard(gId, false) }
    ).catch(() => {});
    return;
  }

  // ─── How to Use ───
  if (data === "how_to_use") {
    await bot.editMessageText(
      `<b>❓ Bot Use Kaise Karein</b>\n\n` +
      `<b>1️⃣ New Giveaway Create Karo</b>\n` +
      `   • "New Giveaway" button dabao\n` +
      `   • Title, Channel ID, Participants aur Vote Price dalo\n\n` +
      `<b>2️⃣ Channel Mein Add Karo</b>\n` +
      `   • Bot ko channel ka Admin banao\n` +
      `   • "Add Channel" se register karo\n\n` +
      `<b>3️⃣ Poll Shuru Karo</b>\n` +
      `   • "My Giveaways" mein jaao\n` +
      `   • Apna giveaway select karo\n` +
      `   • "Poll Shuru Karo" dabao\n\n` +
      `<b>4️⃣ Voting (Members)</b>\n` +
      `   • Channel mein join karo\n` +
      `   • Bot ko PM karo: /vote <ID>\n` +
      `   • Participant select karo\n` +
      `   • Agar paid hai toh Stars se pay karo\n\n` +
      `<b>5️⃣ Channel Leave = Vote Hata</b>\n` +
      `   • Koi channel chhode toh uska vote auto-remove\n` +
      `   • Channel pe announcement aati hai\n\n` +
      `<b>Channel ID Kaise Milega?</b>\n` +
      `   @getidsbot ko channel mein add karo`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── Add Channel ───
  if (data === "add_channel") {
    userState.set(userId, { step: "add_channel" });
    await bot.editMessageText(
      `<b>➕ Channel Add Karo</b>\n\n` +
      `Apna channel ID bhejo:\n\n` +
      `<i>Example: -1001234567890</i>\n\n` +
      `<b>Note:</b> Pehle bot ko channel ka admin banao.`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── Add Group ───
  if (data === "add_group") {
    userState.set(userId, { step: "add_group" });
    await bot.editMessageText(
      `<b>➕ Group Add Karo</b>\n\n` +
      `Apna group ID bhejo:\n\n` +
      `<i>Example: -1001234567890</i>\n\n` +
      `<b>Note:</b> Pehle bot ko group ka admin banao.`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── VIP Membership ───
  if (data === "vip_membership") {
    const vip = isVip(userId);
    const text = vip
      ? `<b>👑 VIP Membership</b>\n\n✅ Aap pehle se <b>VIP Member</b> hain!\n\n<b>Benefits:</b>\n• Unlimited giveaways\n• Priority support\n• Custom branding`
      : `<b>👑 VIP Membership</b>\n\n<b>Benefits:</b>\n• ♾️ Unlimited giveaways\n• ⚡ Priority support\n• 🎨 Custom branding\n• 🔓 Advanced features\n\n💰 Price: <b>${VIP_PRICE_STARS} ⭐ Stars</b>\n📅 Duration: <b>${VIP_DURATION_DAYS} days</b>`;
    const keyboard = vip
      ? backKeyboard()
      : {
          inline_keyboard: [
            [{ text: `💳 Buy VIP — ${VIP_PRICE_STARS} ⭐ Stars`, callback_data: "buy_vip" }],
            [{ text: "◀️ Back", callback_data: "main_menu" }]
          ]
        };
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: keyboard
    }).catch(() => {});
    return;
  }

  // ─── Buy VIP ───
  if (data === "buy_vip") {
    try {
      await bot.sendInvoice(
        chatId,
        "VIP Membership",
        `${VIP_DURATION_DAYS} din ke liye VIP membership — unlimited giveaways, priority support`,
        `vip_${userId}`,
        "",
        "XTR",
        [{ label: "VIP Membership (30 Days)", amount: VIP_PRICE_STARS }]
      );
    } catch (e) {
      console.error("VIP invoice error:", e.message);
      await bot.sendMessage(chatId, `<b>Error:</b> ${h(e.message)}`, { parse_mode: "HTML" });
    }
    return;
  }

  // ─── Create Post ───
  if (data === "create_post") {
    userState.set(userId, { step: "create_post" });
    await bot.editMessageText(
      `<b>📢 Post Create Karo</b>\n\n` +
      `Woh message bhejo jo aap apne registered channels/groups mein post karna chahte hain:`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
    ).catch(() => {});
    return;
  }
});

// ============================================================
// MESSAGE HANDLER (Multi-step conversation flow)
// ============================================================

bot.on("message", async (msg) => {
  if (!msg.text || msg.chat.type !== "private") return;
  if (msg.text.startsWith("/")) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const state = userState.get(userId);

  if (!state) return;

  // ─── Giveaway Creation Flow ───
  if (state.step === "giveaway_title") {
    state.giveawayTitle = text;
    state.step = "giveaway_channel";
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `<b>Step 2/4:</b> Giveaway kis channel ke liye hai?\n\n` +
      `Channel ID bhejo (jaise <code>-1001234567890</code>)\n\n` +
      `Ya "skip" likhو agar koi channel link nahi karna.`,
      { parse_mode: "HTML", reply_markup: backKeyboard("main_menu") }
    );
    return;
  }

  if (state.step === "giveaway_channel") {
    if (text.toLowerCase() !== "skip") {
      state.giveawayChannelId = text;
    }
    state.step = "giveaway_participants";
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `<b>Step 3/4:</b> Participants ke naam bhejo\n\n` +
      `<i>Har naam naye line mein likhо:</i>\n\n` +
      `<code>Rahul Kumar\nPriya Sharma\nAmit Singh</code>`,
      { parse_mode: "HTML", reply_markup: backKeyboard("main_menu") }
    );
    return;
  }

  if (state.step === "giveaway_participants") {
    const names = text.split("\n").map(n => n.trim()).filter(n => n.length > 0);
    if (names.length < 2) {
      await bot.sendMessage(chatId, "⚠️ Kam se kam 2 participants chahiye! Dobara bhejo.");
      return;
    }
    state.giveawayParticipants = names;
    state.step = "giveaway_price";
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `<b>Step 4/4:</b> Vote Price set karo\n\n` +
      `⭐ Kitne <b>Telegram Stars</b> mein vote milega?\n\n` +
      `<code>0</code> = Free voting\n` +
      `<code>1</code> = 1 Star per vote\n` +
      `<code>5</code> = 5 Stars per vote`,
      { parse_mode: "HTML", reply_markup: backKeyboard("main_menu") }
    );
    return;
  }

  if (state.step === "giveaway_price") {
    const price = parseInt(text, 10);
    if (isNaN(price) || price < 0) {
      await bot.sendMessage(chatId, "⚠️ Valid number bhejo (0 ya usse zyada).");
      return;
    }

    const gId = String(giveawayCounter++);
    const participants = new Map();
    for (const name of state.giveawayParticipants) {
      participants.set(name, { votes: 0, voters: new Set() });
    }

    const giveaway = {
      id: gId,
      title: state.giveawayTitle,
      channelId: state.giveawayChannelId || null,
      creatorId: userId,
      participants,
      active: false,
      votePrice: price,
      currency: "XTR",
      createdAt: new Date()
    };

    giveaways.set(gId, giveaway);
    userState.delete(userId);

    const pList = state.giveawayParticipants.map((n, i) => `${i + 1}. ${h(n)}`).join("\n");
    await bot.sendMessage(chatId,
      `<b>✅ Giveaway Create Ho Gaya!</b>\n\n` +
      `🎰 <b>${h(giveaway.title)}</b>\n` +
      `🆔 ID: <code>${gId}</code>\n` +
      `📢 Channel: <code>${h(giveaway.channelId || "Koi nahi")}</code>\n` +
      `💰 Vote Price: <b>${price > 0 ? `${price} ⭐ Stars` : "Free"}</b>\n\n` +
      `<b>Participants (${state.giveawayParticipants.length}):</b>\n${pList}\n\n` +
      `Ab "My Giveaways" se poll shuru karo!`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "▶️ Abhi Poll Shuru Karo", callback_data: `start_poll:${gId}` }],
            [{ text: "📋 My Giveaways", callback_data: "my_giveaways" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
          ]
        }
      }
    );
    return;
  }

  // ─── Add Channel ───
  if (state.step === "add_channel" || state.step === "add_group") {
    const type = state.step === "add_channel" ? "channel" : "group";
    try {
      const chatInfo = await bot.getChat(text);
      registeredChats.set(String(chatInfo.id), {
        type,
        title: chatInfo.title || text,
        addedBy: userId
      });
      userState.delete(userId);
      await bot.sendMessage(chatId,
        `<b>✅ ${type === "channel" ? "Channel" : "Group"} Register Ho Gaya!</b>\n\n` +
        `📌 <b>${h(chatInfo.title || text)}</b>\n` +
        `🆔 ID: <code>${chatInfo.id}</code>\n\n` +
        `Ab is ID ko giveaway create karte waqt use karo.`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
      );
    } catch (e) {
      await bot.sendMessage(chatId,
        `<b>❌ Error:</b> Chat nahi mila.\n\n` +
        `<b>Check karo:</b>\n• Bot channel/group ka admin hai?\n• ID sahi hai?`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  // ─── Create Post ───
  if (state.step === "create_post") {
    const chats = [...registeredChats.values()].filter(c => c.addedBy === userId);
    if (chats.length === 0) {
      await bot.sendMessage(chatId,
        `⚠️ Aapka koi registered channel/group nahi hai.\nPehle "Add Channel" se add karo.`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
      );
      userState.delete(userId);
      return;
    }
    let sent = 0, failed = 0;
    for (const [chatIdKey, c] of registeredChats) {
      if (c.addedBy !== userId && userId !== MAIN_ADMIN_ID) continue;
      try {
        await bot.sendMessage(chatIdKey, `📢 <b>Post</b>\n\n${h(text)}`, { parse_mode: "HTML" });
        sent++;
      } catch { failed++; }
    }
    userState.delete(userId);
    await bot.sendMessage(chatId,
      `<b>✅ Post Bhej Di Gayi!</b>\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
    );
    return;
  }
});

// ============================================================
// /vote <giveawayId> COMMAND
// ============================================================

bot.onText(/\/vote(?:\s+(\S+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") {
    return bot.sendMessage(msg.chat.id, "⚠️ Vote karne ke liye mujhe private message karo!");
  }
  const chatId = msg.chat.id;
  const gId = match[1];
  if (!gId) {
    return bot.sendMessage(chatId,
      `<b>Usage:</b> <code>/vote &lt;giveawayId&gt;</code>\n\n"My Giveaways" se Giveaway ID lo.`,
      { parse_mode: "HTML" }
    );
  }
  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(chatId, "❌ Giveaway nahi mila. ID check karo.");
  if (!g.active) return bot.sendMessage(chatId, "❌ Abhi koi active voting nahi hai.");
  if (g.participants.size === 0) return bot.sendMessage(chatId, "❌ Koi participant nahi hai.");

  if (g.channelId) {
    const isMember = await isChannelMember(g.channelId, msg.from.id);
    if (!isMember) {
      return bot.sendMessage(chatId,
        `<b>❌ Channel Member Nahi Ho!</b>\n\nPehle channel join karo phir vote do.`,
        { parse_mode: "HTML" }
      );
    }
  }

  const btns = [...g.participants.keys()].map(name => ([{
    text: `🗳️ ${name}`,
    callback_data: `do_vote:${gId}:${name}`
  }]));

  await bot.sendMessage(chatId,
    `<b>🗳️ ${h(g.title)}</b>\n\nKis ko vote dena hai?\n💰 Price: <b>${g.votePrice > 0 ? `${g.votePrice} ⭐ Stars` : "Free"}</b>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: btns } }
  );
});

// ============================================================
// PAYMENT HANDLERS
// ============================================================

// Pre-checkout — approve payment
bot.on("pre_checkout_query", async (query) => {
  await bot.answerPreCheckoutQuery(query.id, true).catch((e) => {
    console.error("pre_checkout error:", e.message);
  });
});

// Successful payment
bot.on("message", async (msg) => {
  if (!msg.successful_payment) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const payload = msg.successful_payment.invoice_payload;

  // VIP Payment
  if (payload.startsWith("vip_")) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + VIP_DURATION_DAYS);
    vipUsers.set(userId, { vip: true, vipExpiry: expiry });
    await bot.sendMessage(chatId,
      `<b>👑 VIP Membership Activate Ho Gayi!</b>\n\n` +
      `✅ <b>${VIP_DURATION_DAYS} din</b> ke liye active\n` +
      `📅 Expiry: <b>${expiry.toLocaleDateString("en-IN")}</b>\n\n` +
      `Enjoy karo unlimited giveaways!`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] }
      }
    );
    return;
  }

  // Vote Payment: vote_<giveawayId>_<userId>_<participantName>
  if (payload.startsWith("vote_")) {
    const parts = payload.split("_");
    const gId = parts[1];
    const participantName = parts.slice(3).join("_");
    const g = getGiveaway(gId);
    if (!g) return;
    await recordVote(userId, gId, participantName, g, chatId, msg.from.first_name, null);
  }
});

// ============================================================
// recordVote helper
// ============================================================
async function recordVote(userId, gId, participantName, g, chatId, firstName, editMsgId) {
  const key = voteKey(userId, gId);
  const existing = userVotes.get(key);

  if (existing) {
    const old = g.participants.get(existing.votedFor);
    if (old) { old.votes = Math.max(0, old.votes - 1); old.voters.delete(userId); }
  }

  const p = g.participants.get(participantName);
  if (!p) return;
  p.votes += 1;
  p.voters.add(userId);
  userVotes.set(key, { votedFor: participantName, giveawayId: gId });

  const successText =
    `<b>✅ Vote Registered!</b>\n\n` +
    `🗳️ Aapka vote <b>${h(participantName)}</b> ko gaya!\n` +
    `📊 Current Votes: <b>${p.votes}</b>`;

  if (editMsgId) {
    await bot.editMessageText(successText, {
      chat_id: chatId, message_id: editMsgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "📊 Results Dekho", callback_data: `results:${gId}` }]] }
    }).catch(() => bot.sendMessage(chatId, successText, { parse_mode: "HTML" }));
  } else {
    await bot.sendMessage(chatId, successText, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "📊 Results Dekho", callback_data: `results:${gId}` }]] }
    });
  }

  // Channel update
  if (g.channelId) {
    try {
      const lb = formatLeaderboard(g.participants);
      await bot.sendMessage(g.channelId,
        `<b>🗳️ New Vote — ${h(g.title)}</b>\n\n` +
        `<b>${h(firstName)}</b> ne <b>${h(participantName)}</b> ko vote diya!\n\n` +
        `<b>Updated Leaderboard:</b>\n${lb}`,
        { parse_mode: "HTML" }
      );
    } catch (e) { console.error("Channel update error:", e.message); }
  }
}

// ============================================================
// CHANNEL MEMBER LEFT — Vote auto-remove
// ============================================================

bot.on("chat_member", async (update) => {
  const { chat, new_chat_member, old_chat_member } = update;
  const wasActive = ["member", "administrator", "creator"].includes(old_chat_member?.status);
  const isNowGone = ["left", "kicked", "banned"].includes(new_chat_member?.status);
  if (!wasActive || !isNowGone) return;

  const channelId = String(chat.id);
  const userId = new_chat_member.user.id;
  const userName = new_chat_member.user.first_name +
    (new_chat_member.user.last_name ? ` ${new_chat_member.user.last_name}` : "");

  // Check all active giveaways for this channel
  for (const [gId, g] of giveaways) {
    if (String(g.channelId) !== channelId) continue;
    const key = voteKey(userId, gId);
    const existing = userVotes.get(key);
    if (!existing) continue;

    const participantName = existing.votedFor;
    const p = g.participants.get(participantName);
    if (p) { p.votes = Math.max(0, p.votes - 1); p.voters.delete(userId); }
    userVotes.delete(key);

    try {
      await bot.sendMessage(channelId,
        `<b>⚠️ Vote Hata Diya Gaya!</b>\n\n` +
        `<b>${h(userName)}</b> ne channel chhod diya.\n` +
        `Inका vote <b>${h(participantName)}</b> se hat gaya.\n\n` +
        `📊 Updated Votes: <b>${p?.votes ?? 0}</b>`,
        { parse_mode: "HTML" }
      );
    } catch (e) { console.error("Leave announcement error:", e.message); }
  }
});

// ============================================================
// MAIN ADMIN COMMANDS
// ============================================================

bot.onText(/\/broadcast\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  if (msg.from.id !== MAIN_ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Sirf main admin ke liye.");
  const message = match[1];
  let sent = 0, failed = 0;
  for (const [chatId] of registeredChats) {
    try { await bot.sendMessage(chatId, `<b>📢 Broadcast</b>\n\n${h(message)}`, { parse_mode: "HTML" }); sent++; }
    catch { failed++; }
  }
  await bot.sendMessage(msg.chat.id, `✅ Broadcast done!\n✅ Sent: ${sent}\n❌ Failed: ${failed}`);
});

bot.onText(/\/allchannels/, async (msg) => {
  if (msg.chat.type !== "private") return;
  if (msg.from.id !== MAIN_ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Sirf main admin ke liye.");
  if (registeredChats.size === 0) return bot.sendMessage(msg.chat.id, "Koi registered chat nahi.");
  let text = "<b>📋 Registered Chats:</b>\n\n";
  for (const [id, c] of registeredChats) {
    text += `• <b>${h(c.title)}</b> (<code>${id}</code>) — ${c.type}\n`;
  }
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/allgiveaways/, async (msg) => {
  if (msg.chat.type !== "private") return;
  if (msg.from.id !== MAIN_ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Sirf main admin ke liye.");
  if (giveaways.size === 0) return bot.sendMessage(msg.chat.id, "Koi giveaway nahi.");
  let text = "<b>📋 All Giveaways:</b>\n\n";
  for (const [id, g] of giveaways) {
    const total = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
    text += `<b>${h(g.title)}</b> (ID: <code>${id}</code>)\n`;
    text += `   Status: ${g.active ? "🟢 Active" : "🔴 Inactive"} | Votes: ${total}\n\n`;
  }
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/adminhelp/, async (msg) => {
  if (msg.chat.type !== "private") return;
  if (msg.from.id !== MAIN_ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Sirf main admin ke liye.");
  await bot.sendMessage(msg.chat.id,
    `<b>👑 Main Admin Commands:</b>\n\n` +
    `/broadcast &lt;message&gt; — Sab chats ko message\n` +
    `/allchannels — Registered channels/groups\n` +
    `/allgiveaways — Sab giveaways dekho\n` +
    `/adminhelp — Ye help`,
    { parse_mode: "HTML" }
  );
});

// ============================================================
// ERROR HANDLING
// ============================================================

bot.on("polling_error", (err) => console.error("Polling error:", err.message));
bot.on("error", (err) => console.error("Bot error:", err.message));

// ============================================================
// STARTUP
// ============================================================

bot.getMe().then((me) => {
  console.log(`
✅ Giveaway Vote Bot Started!
🤖 Bot: @${me.username}
👑 Main Admin ID: ${MAIN_ADMIN_ID}
💰 VIP Price: ${VIP_PRICE_STARS} Stars

Ready to handle giveaways!
  `);
});
