/**
 * 🎰 DRS GIVEAWAY BOT
 * Full-featured Telegram Giveaway & Voting System
 * DRS Branding — Fair · Fast · Automated
 */

import TelegramBot from "node-telegram-bot-api";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAIN_ADMIN_ID = Number(process.env.ADMIN_ID);

if (!BOT_TOKEN) { console.error("❌ TELEGRAM_BOT_TOKEN not set!"); process.exit(1); }
if (!MAIN_ADMIN_ID) { console.error("❌ ADMIN_ID not set!"); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let BOT_USERNAME = "";

// ============================================================
// IN-MEMORY STATE
// ============================================================

// giveawayId -> giveaway object
const giveaways = new Map();

// channelId -> { title, addedBy (userId), type }
const registeredChannels = new Map();

// userId -> conversation state
const userState = new Map();

// userId -> { vip, expiry }
const vipUsers = new Map();

// pending INR vote approvals: paymentId -> { userId, giveawayId, participantId, amount, screenshotFileId }
const pendingPayments = new Map();
let paymentCounter = 1;

function genId(len = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// participant object shape:
// { id, name, creatorId (userId who added), votes, voters: Set<userId>,
//   channelMsgId (message_id in channel), votePostMsgId }

// ============================================================
// HELPERS
// ============================================================

function h(t) {
  return String(t ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getGiveaway(id) { return giveaways.get(String(id)); }

function voteKey(uid, gid) { return `${uid}:${gid}`; }

function isAdmin(uid) { return uid === MAIN_ADMIN_ID; }

function isVip(uid) {
  const d = vipUsers.get(uid);
  if (!d?.vip) return false;
  if (d.expiry && new Date() > d.expiry) { d.vip = false; return false; }
  return true;
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
  if (!parts.length) return "<i>Abhi koi votes nahi.</i>";
  return parts.map((p, i) => {
    const m = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    return `${m} <b>${h(p.name)}</b> — <b>${p.votes}</b> votes`;
  }).join("\n");
}

function parseIST(str) {
  // Format: DD-MM-YYYY HH:MM
  const [datePart, timePart] = str.trim().split(" ");
  if (!datePart || !timePart) return null;
  const [dd, mm, yyyy] = datePart.split("-");
  const [hh, min] = timePart.split(":");
  if (!dd || !mm || !yyyy || !hh || !min) return null;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh - 5, +min - 30)); // IST = UTC+5:30
  return isNaN(d.getTime()) ? null : d;
}

function nowIST() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })
    .replace(",", "");
}

// ============================================================
// KEYBOARDS
// ============================================================

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🎰 New Giveaway", callback_data: "new_giveaway" },
        { text: "👀 My Giveaways", callback_data: "my_giveaways" }
      ],
      [{ text: "❓ How to Use", callback_data: "how_to_use" }],
      [
        { text: "➕ Add Channel", callback_data: "add_channel" },
        { text: "➕ Add Group", callback_data: "add_group" }
      ],
      [{ text: "👑 VIP Membership", callback_data: "vip_membership" }],
      [{ text: "📢 Create Post", callback_data: "create_post" }]
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

async function sendWelcome(chatId, firstName) {
  const text =
    `<b>🎰 DRS GIVEAWAY BOT!</b> 🎊\n\n` +
    `<blockquote>⭐ FULLY AUTOMATED &amp; FAIR GIVEAWAY SYSTEM ✅\n🚀 FAST &amp; TRANSPARENT WINNER</blockquote>\n\n` +
    `<blockquote>🆕 TAP <b>New Giveaway</b> BUTTON TO CREATE A GIVEAWAY ⭐</blockquote>\n\n` +
    `<blockquote>👀 TAP <b>My Giveaways</b> BUTTON TO VIEW YOUR GIVEAWAYS 🟢</blockquote>\n\n` +
    `✦ ───── 🎰 DRS ───── ✦\n` +
    `⚡ POWERED BY: <b>DRS NETWORK</b>\n` +
    `💬 SUPPORT: @DRS_Support`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard()
  });
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

  // Deep link: /start <giveawayId>  — participant joining a giveaway
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
    // Check channel membership
    if (g.channelId) {
      const member = await isMember(g.channelId, userId);
      if (!member) {
        const ch = registeredChannels.get(String(g.channelId));
        return bot.sendMessage(chatId,
          `<b>❌ Channel Member Nahi Ho!</b>\n\n` +
          `<b>${h(g.title)}</b> mein participate karne ke liye pehle channel join karo:\n` +
          (g.channelUsername ? `👉 @${h(g.channelUsername)}` : `Channel ID: <code>${g.channelId}</code>`),
          { parse_mode: "HTML" }
        );
      }
    }
    // Check if already participating
    const existing = g.participants.get(userId);
    const userName = (msg.from.first_name || "") + (msg.from.last_name ? ` ${msg.from.last_name}` : "");
    const userHandle = msg.from.username ? `@${msg.from.username}` : "@NoUser";

    if (existing) {
      // Already a participant — show their post links
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

    // Show confirmation
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

  await sendWelcome(chatId, msg.from.first_name || "");
});

// ============================================================
// BOT ADDED TO CHANNEL (my_chat_member)
// ============================================================

bot.on("my_chat_member", async (update) => {
  const { chat, new_chat_member, from } = update;
  if (!["channel", "supergroup", "group"].includes(chat.type)) return;

  const isNowAdmin = ["administrator", "creator"].includes(new_chat_member?.status);
  const wasAdmin = ["administrator", "creator"].includes(update.old_chat_member?.status);

  if (isNowAdmin && !wasAdmin) {
    // Bot just became admin — register channel
    const key = String(chat.id);
    registeredChannels.set(key, {
      title: chat.title || "Unknown",
      type: chat.type,
      addedBy: from.id,
      username: chat.username || null
    });

    // Send welcome to the person who added
    try {
      await bot.sendMessage(from.id,
        `Dear,\n\n` +
        `🎊 <b>Thanks for adding me!</b> 🐱\n\n` +
        `<blockquote>👑 I am now an Admin in:</blockquote>\n` +
        `<blockquote>${h(chat.title)} 🐱</blockquote>\n\n` +
        `<blockquote>/start to create or manage giveaways 🎰🎊</blockquote>\n\n` +
        `<blockquote>You can now use /createpost to 🖊️\ncreate message with link 🔗 button and\npost specifically to this channel. 😇</blockquote>`,
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

  // ─── Main Menu ───
  if (data === "main_menu") {
    userState.delete(userId);
    await bot.editMessageText(
      `<b>🎰 DRS GIVEAWAY BOT!</b> 🎊\n\n` +
      `<blockquote>⭐ FULLY AUTOMATED &amp; FAIR GIVEAWAY SYSTEM ✅\n🚀 FAST &amp; TRANSPARENT WINNER</blockquote>\n\n` +
      `<blockquote>🆕 TAP New Giveaway BUTTON TO CREATE A GIVEAWAY ⭐</blockquote>\n\n` +
      `<blockquote>👀 TAP My Giveaways BUTTON TO VIEW YOUR GIVEAWAYS 🟢</blockquote>\n\n` +
      `✦ ───── 🎰 DRS ───── ✦\n⚡ POWERED BY: <b>DRS NETWORK</b>\n💬 SUPPORT: @DRS_Support`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── Cancel flow ───
  if (data === "cancel_flow") {
    userState.delete(userId);
    await bot.editMessageText(
      "❌ Cancelled. Main menu pe wapas aao:",
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
    ).catch(() => {});
    return;
  }

  // ─── New Giveaway ───
  if (data === "new_giveaway") {
    userState.set(userId, { step: "title", msgId });
    await bot.editMessageText(
      `<b>📝 Create New Giveaway: Step 1</b>\n\n` +
      `<b>Enter Giveaway Description</b>\n` +
      `Send a short, catchy title for your event.\n` +
      `<i>(e.g., 'iPhone 15 Contest', 'Best Photo 2024')</i>\n\n` +
      `<blockquote>💡 Type /skip to use default: 'Vote for your favorite!'</blockquote>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: cancelKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── My Giveaways ───
  if (data === "my_giveaways") {
    const mine = [...giveaways.values()].filter(g => g.creatorId === userId || isAdmin(userId));
    if (!mine.length) {
      await bot.editMessageText(
        `<b>👀 My Giveaways</b>\n\n<i>Koi giveaway nahi. "New Giveaway" se banao!</i>`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
      ).catch(() => {});
      return;
    }
    const btns = mine.map(g => ([{ text: `${g.active ? "🟢" : "🔴"} ${g.title} (${g.participants.size})`, callback_data: `mgmt:${g.id}` }]));
    btns.push([{ text: "◀️ Back", callback_data: "main_menu" }]);
    await bot.editMessageText(
      `<b>👀 My Giveaways</b>\n\n🟢 Active  🔴 Ended\nSelect karo:`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: btns } }
    ).catch(() => {});
    return;
  }

  // ─── Management Panel ───
  if (data.startsWith("mgmt:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    const totalVotes = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
    const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;
    await bot.editMessageText(
      `<b>⚙️ Management Panel</b>\n\n` +
      `<b>ID:</b> <code>${gId}</code>\n` +
      `<b>Title:</b> ${h(g.title)}\n` +
      `<b>Status:</b> ${g.active ? "🟢 active" : "🔴 ended"}\n` +
      `<b>Participants:</b> ${g.participants.size}\n` +
      `<b>Total Votes:</b> ${totalVotes}\n` +
      `<b>Link:</b> <a href="${link}">${link}</a>\n` +
      `<b>Paid Votes:</b> ${g.paidVotesActive ? "🟢 On" : "🔴 Off"}\n` +
      `<b>Participation:</b> ${g.participationOpen ? "🟢 Open" : "🔴 Closed"}`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: mgmtKeyboard(gId, g) }
    ).catch(() => {});
    return;
  }

  // ─── Leaderboard ───
  if (data.startsWith("lb:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g) return;
    await bot.editMessageText(
      `<b>🏆 ${h(g.title)} — Leaderboard</b>\n\n${formatLeaderboard(g)}`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard(`mgmt:${gId}`) }
    ).catch(() => {});
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
    const lb = formatLeaderboard(g);
    if (g.channelId) {
      try {
        await bot.sendMessage(g.channelId,
          `<b>🏁 ${h(g.title)} — GIVEAWAY ENDED!</b>\n\n<b>Final Leaderboard:</b>\n${lb}`,
          { parse_mode: "HTML" }
        );
      } catch (e) { console.error("Channel end msg:", e.message); }
    }
    await bot.editMessageText(
      `<b>🏁 Giveaway Ended!</b>\n\n<b>${h(g.title)}</b>\n\n<b>Final Results:</b>\n${lb}`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard("my_giveaways") }
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

    // Add participant
    const participant = {
      id: userId,
      name: userName,
      handle: userHandle,
      votes: 0,
      voters: new Set(),
      channelMsgId: null
    };
    g.participants.set(userId, participant);

    // Post in channel
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
                text: `📦 Vote (${participant.votes})`,
                callback_data: `ch_vote:${gId}:${userId}`
              }]]
            }
          }
        );
        channelMsgId = sentMsg.message_id;
        participant.channelMsgId = channelMsgId;
      } catch (e) { console.error("Channel post error:", e.message); }
    }

    const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;
    const chLink = g.channelId && channelMsgId
      ? `https://t.me/c/${String(g.channelId).replace("-100", "")}/${channelMsgId}`
      : null;

    await bot.editMessageText(
      `<b>🎊 Participation Confirmed!</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      (g.channelId ? `📢 <b>Target Channel:</b> <a href="${g.channelUsername ? `https://t.me/${g.channelUsername}` : `https://t.me/c/${String(g.channelId).replace("-100","")}`}">Open Channel</a>\n` : "") +
      (chLink ? `📋 <b>Your Vote Post:</b> <a href="${chLink}">View My Post</a>\n` : "") +
      `━━━━━━━━━━━━━━━━━━\n` +
      `✨ <i>Tip: Share your link with friends to get more votes!</i>`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Copy Vote Link", switch_inline_query: link }],
            [{ text: "💰 Buy Paid Votes", callback_data: `buy_votes:${gId}` }],
            [{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }],
            [{ text: "🔄 Get Links Again", callback_data: `my_links:${gId}` }]
          ]
        }
      }
    ).catch(() => {});
    return;
  }

  // ─── Channel Vote Button (from channel) ───
  if (data.startsWith("ch_vote:")) {
    const parts = data.split(":");
    const gId = parts[1];
    const participantUserId = Number(parts[2]);
    const g = getGiveaway(gId);

    if (!g || !g.active) {
      await bot.answerCallbackQuery(query.id, { text: "Voting active nahi hai!", show_alert: true });
      return;
    }
    if (!g.participationOpen && !g.participants.has(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Participation band hai!", show_alert: true });
      return;
    }

    // Check channel membership
    if (g.channelId) {
      const member = await isMember(g.channelId, userId);
      if (!member) {
        await bot.answerCallbackQuery(query.id, {
          text: "⚠️ Pehle channel join karo, phir vote do!",
          show_alert: true
        });
        return;
      }
    }

    // Can't vote for yourself
    if (userId === participantUserId) {
      await bot.answerCallbackQuery(query.id, { text: "Aap khud ko vote nahi de sakte!", show_alert: true });
      return;
    }

    const key = voteKey(userId, gId);
    const participant = g.participants.get(participantUserId);
    if (!participant) {
      await bot.answerCallbackQuery(query.id, { text: "Participant nahi mila!", show_alert: true });
      return;
    }

    // Remove old vote
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

    await bot.answerCallbackQuery(query.id, { text: `✅ Vote diya! ${participant.name} ko ${participant.votes} votes.`, show_alert: true });

    // Update channel post
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
    if (g.paymentMode === "inr" || g.paymentMode === "both") {
      btns.push([{ text: "🇮🇳 Pay via INR/UPI (QR)", callback_data: `pay_inr:${gId}` }]);
    }
    if (g.paymentMode === "stars" || g.paymentMode === "both") {
      btns.push([{ text: "⭐ Pay via Telegram Stars", callback_data: `pay_stars:${gId}` }]);
    }
    btns.push([{ text: "◀️ Back", callback_data: `my_links:${gId}` }]);

    await bot.editMessageText(
      `<b>💰 Buy Paid Votes</b>\n\n` +
      `<b>${h(g.title)}</b>\n\n` +
      (g.paymentMode === "inr" || g.paymentMode === "both"
        ? `🇮🇳 <b>INR Rate:</b> ${g.votesPerInr} Votes = 1 INR\n` : "") +
      (g.paymentMode === "stars" || g.paymentMode === "both"
        ? `⭐ <b>Stars Rate:</b> ${g.votesPerStar} Votes = 1 Star\n` : "") +
      `\nPayment method choose karo:`,
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
          `🇮🇳 <b>Pay via QR</b>\n\n` +
          `<b>Rate: ${g.votesPerInr} Votes / 1 INR</b>\n\n` +
          `1. Scan QR below.\n` +
          `2. Pay desired amount.\n` +
          `3. Send Screenshot here.`,
        parse_mode: "HTML"
      });
    } catch (e) { console.error("QR send error:", e.message); }
    await bot.sendMessage(chatId,
      `📸 Payment screenshot bhejo (photo as image, not file):`,
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
    // Send Stars invoice (1 star = votesPerStar votes)
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
      `<b>🔗 Your Links</b>\n\n` +
      `<b>${h(g.title)}</b>\n\n` +
      `📌 Participation Link:\n<code>${link}</code>\n\n` +
      (chLink ? `📋 Vote Post:\n<a href="${chLink}">View My Post</a>\n\n` : "") +
      `🗳️ Current Votes: <b>${participant?.votes ?? 0}</b>`,
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
    await bot.editMessageText(
      `<b>❓ DRS Bot — How to Use</b>\n\n` +
      `<b>1️⃣ Bot ko Channel Admin Banao</b>\n` +
      `   Bot join hote hi aapko welcome message milega\n\n` +
      `<b>2️⃣ New Giveaway Create Karo</b>\n` +
      `   • Title → Channel Select → End Type → End Time\n` +
      `   • Paid votes on/off → Currency (INR/Stars/Both)\n` +
      `   • QR upload (INR ke liye) → Vote rate set karo\n\n` +
      `<b>3️⃣ Participants Kaise Join Karein</b>\n` +
      `   • Share karo participation link\n` +
      `   • Users link pe click karein → channel join karein → confirm\n` +
      `   • Channel mein unka vote post auto-create hoga\n\n` +
      `<b>4️⃣ Voting</b>\n` +
      `   • Channel post pe "Vote (n)" button dabaao\n` +
      `   • Sirf channel members hi vote kar sakte hain\n\n` +
      `<b>5️⃣ Leave = Vote Hata</b>\n` +
      `   • Channel leave karne par vote automatic remove\n` +
      `   • Participant ko deduction alert milega\n\n` +
      `<b>Channel ID Kaise Milega?</b>\n` +
      `   @getidsbot channel mein add karo`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: backKeyboard() }
    ).catch(() => {});
    return;
  }

  // ─── Add Channel ───
  if (data === "add_channel" || data === "add_group") {
    const type = data === "add_channel" ? "channel" : "group";
    userState.set(userId, { step: "reg_chat", type });
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
    const vip = isVip(userId);
    await bot.editMessageText(
      vip
        ? `<b>👑 VIP Membership</b>\n\n✅ Aap <b>VIP Member</b> hain!\n\nBenefits:\n• Unlimited giveaways\n• Priority support\n• Advanced features`
        : `<b>👑 VIP Membership</b>\n\nBenefits:\n• ♾️ Unlimited giveaways\n• ⚡ Priority support\n• 🎨 Advanced features\n\n💰 Price: <b>50 ⭐ Stars / 30 days</b>`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "HTML",
        reply_markup: vip ? backKeyboard() : {
          inline_keyboard: [
            [{ text: "💳 Buy VIP — 50 ⭐ Stars", callback_data: "buy_vip" }],
            [{ text: "◀️ Back", callback_data: "main_menu" }]
          ]
        }
      }
    ).catch(() => {});
    return;
  }

  // ─── Buy VIP ───
  if (data === "buy_vip") {
    try {
      await bot.sendInvoice(chatId, "VIP Membership", "30 din VIP — unlimited giveaways",
        `vip_${userId}`, "", "XTR", [{ label: "VIP 30 Days", amount: 50 }]);
    } catch (e) { console.error("VIP invoice:", e.message); }
    return;
  }

  // ─── Create Post ───
  if (data === "create_post") {
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

  // ─── Giveaway creation sub-steps ───

  // Channel select from registered list
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
        `<b>📅 Set End Date &amp; Time</b>\n\n` +
        `<b>Current Time (IST):</b> ${h(now)}\n\n` +
        `<b>Format:</b> DD-MM-YYYY HH:MM\n` +
        `<i>Example: 25-12-2026 18:00</i>`,
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
        `<b>💱 Select Supported Currency</b>\n\nChoose how you want to receive payments:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🇮🇳 INR (UPI/QR)", callback_data: "cur_inr" }],
              [{ text: "⭐ Telegram Stars", callback_data: "cur_stars" }],
              [{ text: "🔄 Both (INR & Stars)", callback_data: "cur_both" }],
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
        `<b>📸 Upload Payment QR Code</b>\n\nPlease send the <b>Photo</b> of your UPI/QR Code now.`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    } else {
      // Stars only
      state.step = "stars_rate";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `<b>📊 Set Vote Rate (Stars)</b>\n\nHow many votes for <b>1 Star</b>?\n<i>Example: 10 (user gets 10 votes per 1 Star)</i>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
    }
    return;
  }
});

// ============================================================
// HELPER: askPaidVotes
// ============================================================
async function askPaidVotes(chatId) {
  await bot.sendMessage(chatId,
    `<b>💰 Paid Votes Configuration</b>\n\nDo you want to allow users to buy extra votes using Money or Telegram Stars?\n<i>This generates revenue and increases vote counts.</i>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Enable Paid Votes", callback_data: "paid_yes" }],
          [
            { text: "❌ Disable Paid Votes", callback_data: "paid_no" },
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
          text: `📦 Vote (${participant.votes})`,
          callback_data: `ch_vote:${g.id}:${participant.id}`
        }]]
      },
      { chat_id: g.channelId, message_id: participant.channelMsgId }
    );
  } catch (e) { console.error("Update post error:", e.message); }
}

// ============================================================
// HELPER: participantChannelText
// ============================================================
function participantChannelText(participant, g) {
  return (
    `<b>WELCOME TO\nDRS GIVEAWAY BOT\n· Fair · Fast · Automated ·</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<b>🏅 PARTICIPANT DETAILS</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<blockquote>▶ USER: <b>${h(participant.name)}</b></blockquote>\n` +
    `<blockquote>▶ USER-ID: <b>${participant.id}</b></blockquote>\n` +
    `<blockquote>▶ USERNAME: <b>${h(participant.handle)}</b></blockquote>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<blockquote>⚠️ NOTE: ONLY CHANNEL SUBSCRIBERS CAN VOTE</blockquote>\n\n` +
    `<blockquote>@${BOT_USERNAME}</blockquote>`
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
  userState.delete(userId);

  // Set auto-end timer
  if (g.autoEnd && g.endTime) {
    const ms = g.endTime.getTime() - Date.now();
    if (ms > 0) {
      setTimeout(async () => {
        const giveaway = getGiveaway(gId);
        if (!giveaway || !giveaway.active) return;
        giveaway.active = false;
        giveaway.participationOpen = false;
        giveaway.paidVotesActive = false;
        const lb = formatLeaderboard(giveaway);
        if (giveaway.channelId) {
          try {
            await bot.sendMessage(giveaway.channelId,
              `<b>🏁 ${h(giveaway.title)} — AUTO ENDED!</b>\n\n<b>Final Results:</b>\n${lb}`,
              { parse_mode: "HTML" }
            );
          } catch {}
        }
        try {
          await bot.sendMessage(userId,
            `<b>🏁 Aapka Giveaway Auto-End Ho Gaya!</b>\n\n<b>${h(giveaway.title)}</b>\n\n<b>Final Results:</b>\n${lb}`,
            { parse_mode: "HTML" }
          );
        } catch {}
      }, ms);
    }
  }

  const link = `https://t.me/${BOT_USERNAME}?start=${gId}`;

  await bot.sendMessage(chatId,
    `<b>✅ Giveaway Created Successfully!</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📝 <b>Desc:</b> ${h(g.title)}\n` +
    `🆔 <b>ID:</b> <code>${gId}</code>\n\n` +
    `🔗 <b>Participation Link:</b>\n<a href="${link}">${link}</a>\n` +
    `━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚙️ Manage Giveaway", callback_data: `mgmt:${gId}` }],
          [{ text: "🏆 Leaderboard", callback_data: `lb:${gId}` }]
        ]
      }
    }
  );
}

// ============================================================
// MESSAGE HANDLER (multi-step flow + photo handler)
// ============================================================

bot.on("message", async (msg) => {
  if (msg.chat.type !== "private") return;
  if (msg.successful_payment) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";
  const state = userState.get(userId);

  // ─── Photo handler for QR code / INR screenshot ───
  if (msg.photo) {
    if (!state) return;
    const fileId = msg.photo[msg.photo.length - 1].file_id;

    if (state.step === "qr_upload") {
      state.qrFileId = fileId;
      state.step = "inr_rate";
      userState.set(userId, state);
      await bot.sendMessage(chatId,
        `<b>📊 Set Vote Rates</b>\n\nHow many votes for <b>1 INR</b>?\n<i>Example: Send 45 (user gets 45 votes per 1 Rupee)</i>`,
        { parse_mode: "HTML", reply_markup: backKeyboard("cancel_flow") }
      );
      return;
    }

    if (state.step === "awaiting_inr_screenshot") {
      // User sent payment screenshot
      const gId = state.giveawayId;
      const g = getGiveaway(gId);
      if (!g) return;

      const payId = String(paymentCounter++);
      pendingPayments.set(payId, {
        userId, giveawayId: gId, screenshotFileId: fileId, timestamp: new Date()
      });
      userState.delete(userId);

      await bot.sendMessage(chatId,
        `<b>✅ Screenshot Received!</b>\n\n` +
        `Admin verify kar raha hai. Verified hone ke baad votes add ho jaayenge.\n\n` +
        `Payment ID: <code>${payId}</code>`,
        { parse_mode: "HTML" }
      );

      // Notify main admin
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

  // ─── GIVEAWAY CREATION STEPS ───

  if (state.step === "title") {
    const title = text === "/skip" ? "Vote for your favorite!" : text;
    state.title = title;
    state.step = "pick_channel";
    userState.set(userId, state);

    // Show channels where bot is admin (registered channels by this user)
    const myChans = [...registeredChannels.entries()].filter(([, c]) => c.addedBy === userId || isAdmin(userId));

    const btns = myChans.map(([id, c]) => ([{
      text: `📢 ${c.title}`,
      callback_data: `sel_ch:${id}`
    }]));
    btns.push([{ text: "✏️ Enter Manually", callback_data: "ch_manual" }]);
    btns.push([{ text: "◀️ Back", callback_data: "cancel_flow" }]);

    await bot.sendMessage(chatId,
      `<b>📢 Select Target Channel</b>\n\nChoose the channel where the giveaway will be posted.\n<i>Only channels where I am an Admin are shown below.</i>\n\n<b>Found: ${myChans.length} Channel${myChans.length !== 1 ? "s" : ""}</b>`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: btns } }
    );
    return;
  }

  if (state.step === "pick_channel" && text) {
    // Manual channel ID entry
    try {
      const chatInfo = await bot.getChat(text);
      state.channelId = String(chatInfo.id);
      state.channelTitle = chatInfo.title;
      state.channelUsername = chatInfo.username || null;
      registeredChannels.set(state.channelId, {
        title: chatInfo.title, type: chatInfo.type,
        addedBy: userId, username: chatInfo.username || null
      });
    } catch {
      state.channelId = text;
      state.channelTitle = text;
    }
    state.step = "end_type";
    userState.set(userId, state);
    await bot.sendMessage(chatId,
      `<b>⏳ Giveaway Ending Configuration</b>\n\n🤖 <b>Automatic:</b> Ends automatically at a specific time.\n✋ <b>Manual:</b> You stop it manually using the panel.`,
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
        `<b>📊 Set Vote Rate (Stars)</b>\n\nHow many votes for <b>1 Star</b>?\n<i>Example: 5</i>`,
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

  // ─── Register chat manually ───
  if (state.step === "reg_chat") {
    try {
      const chatInfo = await bot.getChat(text);
      registeredChannels.set(String(chatInfo.id), {
        title: chatInfo.title || text,
        type: chatInfo.type,
        addedBy: userId,
        username: chatInfo.username || null
      });
      userState.delete(userId);
      await bot.sendMessage(chatId,
        `<b>✅ ${h(state.type === "channel" ? "Channel" : "Group")} Registered!</b>\n\n` +
        `<b>${h(chatInfo.title || text)}</b>\n` +
        `ID: <code>${chatInfo.id}</code>`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] } }
      );
    } catch {
      await bot.sendMessage(chatId,
        `❌ Chat nahi mila. Bot ko admin banao phir try karo.`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  // ─── Create post ───
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
});

// ============================================================
// ADMIN: Approve/Reject INR payment
// ============================================================

bot.on("callback_query", async (query) => {
  const data = query.data;
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;

  if (data.startsWith("approve_pay:")) {
    if (!isAdmin(userId)) return;
    const payId = data.split(":")[1];
    const payment = pendingPayments.get(payId);
    if (!payment) {
      return bot.answerCallbackQuery(query.id, { text: "Payment nahi mila!", show_alert: true });
    }
    // Ask admin how many votes to give
    userState.set(userId, { step: "approve_votes", paymentId: payId });
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(MAIN_ADMIN_ID,
      `Kitne votes dene hain user <code>${payment.userId}</code> ko? (number bhejo)`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (data.startsWith("reject_pay:")) {
    if (!isAdmin(userId)) return;
    const payId = data.split(":")[1];
    const payment = pendingPayments.get(payId);
    if (!payment) return;
    pendingPayments.delete(payId);
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

// Handle admin typing vote count for approval
bot.on("message", async (msg) => {
  if (msg.chat.type !== "private") return;
  if (msg.from.id !== MAIN_ADMIN_ID) return;
  const state = userState.get(MAIN_ADMIN_ID);
  if (!state || state.step !== "approve_votes") return;
  const votes = parseInt(msg.text?.trim(), 10);
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

  const g = getGiveaway(payment.giveawayId);
  if (!g) return;

  // Add votes to the participant
  let participant = g.participants.get(payment.userId);
  if (!participant) {
    const user = await bot.getChat(payment.userId).catch(() => null);
    const name = user ? ((user.first_name || "") + (user.last_name ? ` ${user.last_name}` : "")) : String(payment.userId);
    participant = { id: payment.userId, name, handle: `@${user?.username || "NoUser"}`, votes: 0, voters: new Set(), channelMsgId: null };
    g.participants.set(payment.userId, participant);
  }
  participant.votes += votes;
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
    vipUsers.set(userId, { vip: true, expiry });
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
    let participant = g.participants.get(participantUserId);
    if (!participant) return;
    const votesToAdd = stars * g.votesPerStar;
    participant.votes += votesToAdd;
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
        await updateChannelPost(g, p);

        // Channel announcement
        try {
          await bot.sendMessage(channelId,
            `<b>🔴 Voter Left — Vote Removed</b>\n━━━━━━━━━━━━━━━━━━\n` +
            `👤 <b>Voter:</b> ${h(leftName)}\n` +
            `↳ <b>Affected:</b> ${h(p.name)} (ID: ${p.id})\n` +
            `📌 <b>Giveaway:</b> ${gId}\n` +
            `━━━━━━━━━━━━━━━━━━`,
            { parse_mode: "HTML" }
          );
        } catch (e) { console.error("Leave channel announcement:", e.message); }

        // Notify participant (the one who lost a vote)
        try {
          await bot.sendMessage(p.id,
            `<b>⚠️ Vote Deduction Alert!</b>\n\n` +
            `A user (<b>${h(leftName)}</b>) left the required channel.\n` +
            `Your vote count has been reduced.\n` +
            `↳ <b>New Count: ${p.votes}</b>`,
            { parse_mode: "HTML" }
          );
        } catch {}
      }
    }

    // Also remove them as participant if they joined
    const participantData = g.participants.get(leftUserId);
    if (participantData) {
      // Remove their votes from whoever they voted for
      const theirVotedFor = g.voterMap?.get(leftUserId);
      if (theirVotedFor) {
        const theirP = g.participants.get(theirVotedFor);
        if (theirP) { theirP.votes = Math.max(0, theirP.votes - 1); await updateChannelPost(g, theirP); }
        g.voterMap.delete(leftUserId);
      }
    }
  }
});

// ============================================================
// MAIN ADMIN COMMANDS
// ============================================================

bot.onText(/\/broadcast\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const message = match[1];
  let sent = 0, failed = 0;
  for (const [id] of registeredChannels) {
    try { await bot.sendMessage(id, `<b>📢 DRS Broadcast</b>\n\n${h(message)}`, { parse_mode: "HTML" }); sent++; }
    catch { failed++; }
  }
  await bot.sendMessage(msg.chat.id, `✅ Broadcast done!\n✅ Sent: ${sent}\n❌ Failed: ${failed}`);
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

bot.onText(/\/adminhelp/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id,
    `<b>👑 Main Admin Commands:</b>\n\n` +
    `/broadcast &lt;msg&gt;\n/allchannels\n/allgiveaways\n/adminhelp`,
    { parse_mode: "HTML" }
  );
});

// ============================================================
// ERROR HANDLING & STARTUP
// ============================================================

bot.on("polling_error", e => console.error("Polling error:", e.message));
bot.on("error", e => console.error("Bot error:", e.message));

bot.getMe().then(me => {
  BOT_USERNAME = me.username;
  console.log(`
✅ DRS Giveaway Bot Started!
🤖 @${me.username}
👑 Admin ID: ${MAIN_ADMIN_ID}

Ready!
  `);
});
