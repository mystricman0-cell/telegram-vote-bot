/**
 * Telegram Vote Bot
 *
 * Features:
 * - Channel me bot add karke voting setup
 * - Sirf channel members hi vote kar sakte hain
 * - Participant names forward karke voting shuru
 * - Channel leave par vote automatic hata
 * - Main admin ID ke paas hi broadcast + admin commands
 * - Vote hata toh channel pe announcement
 */

import TelegramBot from "node-telegram-bot-api";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAIN_ADMIN_ID = Number(process.env.ADMIN_ID);

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN environment variable not set!");
  process.exit(1);
}
if (!MAIN_ADMIN_ID) {
  console.error("❌ ADMIN_ID environment variable not set!");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/**
 * In-memory state storage
 * Production me database use karna chahiye
 */

// channelId -> { participants: Map<name, { votes: number, voters: Set<userId> }>, active: boolean }
const channelPolls = new Map();

// userId -> Set<channelId> (user kis kis channel ka member hai bot ke hisaab se)
const channelMembers = new Map();

// userId -> { channelId, votedFor: participantName }
// Ek user ek channel me sirf ek ko vote kar sakta hai
const userVotes = new Map(); // key: `${userId}:${channelId}`

// channelId -> adminId (bot add karne wala)
const channelAdmins = new Map();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getPoll(channelId) {
  return channelPolls.get(String(channelId));
}

function getOrCreatePoll(channelId) {
  const key = String(channelId);
  if (!channelPolls.has(key)) {
    channelPolls.set(key, { participants: new Map(), active: false });
  }
  return channelPolls.get(key);
}

function voteKey(userId, channelId) {
  return `${userId}:${channelId}`;
}

async function isChannelMember(channelId, userId) {
  try {
    const member = await bot.getChatMember(channelId, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

async function isChannelAdmin(channelId, userId) {
  try {
    const member = await bot.getChatMember(channelId, userId);
    return ["administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

function formatLeaderboard(participants) {
  if (participants.size === 0) return "Abhi koi participant nahi hai.";

  const sorted = [...participants.entries()].sort(
    (a, b) => b[1].votes - a[1].votes
  );

  let text = "🏆 *Vote Leaderboard*\n\n";
  sorted.forEach(([name, data], index) => {
    const medal =
      index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
    text += `${medal} *${escapeMarkdown(name)}* — ${data.votes} vote${data.votes !== 1 ? "s" : ""}\n`;
  });
  return text;
}

function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

function helpText() {
  return `🤖 *Vote Bot — Commands*

*Channel Setup (Channel Admin):*
/setvoting \\<channelId\\> — Voting activate karo
/addparticipant \\<channelId\\> \\<naam\\> — Participant add karo
/startpoll \\<channelId\\> — Voting shuru karo
/stoppoll \\<channelId\\> — Voting band karo
/resetpoll \\<channelId\\> — Sab reset karo
/results \\<channelId\\> — Results dekho

*Voting (Channel Members):*
/vote \\<channelId\\> \\<naam\\> — Vote karo

*Main Admin Only:*
/broadcast \\<message\\> — Sab channels ko message bhejo
/allchannels — Registered channels dekho
/adminhelp — Admin commands

*Note:* Channel me join kiye bina vote nahi kar sakte\\. Channel leave karne par vote hat jaata hai\\.`;
}

// ============================================================
// BOT COMMANDS
// ============================================================

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;

  await bot.sendMessage(
    chatId,
    `👋 *Vote Bot mein Aapka Swagat Hai!*\n\nMain aapke Telegram channel mein voting manage karta hoon\\.\n\n${helpText()}`,
    { parse_mode: "MarkdownV2" }
  );
});

// /help
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, helpText(), { parse_mode: "MarkdownV2" });
});

// /setvoting <channelId>
// Channel admin use kare — channel ID set karo
bot.onText(/\/setvoting(?:\s+(-?\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const channelId = match[1];

  if (!channelId) {
    return bot.sendMessage(
      msg.chat.id,
      "❗ Usage: /setvoting <channelId>\n\nChannel ID kaise milega? Channel me @getidsbot add karo ya forward karke dekho."
    );
  }

  const isAdmin = await isChannelAdmin(channelId, userId);
  if (!isAdmin && userId !== MAIN_ADMIN_ID) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Sirf channel admin hi voting setup kar sakta hai."
    );
  }

  getOrCreatePoll(channelId);
  channelAdmins.set(String(channelId), userId);

  await bot.sendMessage(
    msg.chat.id,
    `✅ Channel \`${channelId}\` voting ke liye register ho gaya!\n\nAb /addparticipant <channelId> <naam> se participants add karo.`,
    { parse_mode: "Markdown" }
  );
});

// /addparticipant <channelId> <naam>
bot.onText(/\/addparticipant(?:\s+(-?\d+))?\s*([\s\S]*)/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const channelId = match[1];
  const name = match[2]?.trim();

  if (!channelId || !name) {
    return bot.sendMessage(
      msg.chat.id,
      "❗ Usage: /addparticipant <channelId> <participant naam>"
    );
  }

  const isAdmin = await isChannelAdmin(channelId, userId);
  if (!isAdmin && userId !== MAIN_ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Sirf channel admin hi participant add kar sakta hai.");
  }

  const poll = getOrCreatePoll(channelId);
  if (poll.participants.has(name)) {
    return bot.sendMessage(msg.chat.id, `⚠️ "${name}" pehle se hai!`);
  }

  poll.participants.set(name, { votes: 0, voters: new Set() });
  await bot.sendMessage(
    msg.chat.id,
    `✅ *${escapeMarkdown(name)}* participant list mein add ho gaya channel \`${channelId}\` ke liye\\.`,
    { parse_mode: "MarkdownV2" }
  );
});

// /removeparticipant <channelId> <naam>
bot.onText(/\/removeparticipant(?:\s+(-?\d+))?\s*([\s\S]*)/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const channelId = match[1];
  const name = match[2]?.trim();

  if (!channelId || !name) {
    return bot.sendMessage(msg.chat.id, "❗ Usage: /removeparticipant <channelId> <naam>");
  }

  const isAdmin = await isChannelAdmin(channelId, userId);
  if (!isAdmin && userId !== MAIN_ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Sirf channel admin hi participant hata sakta hai.");
  }

  const poll = getPoll(channelId);
  if (!poll || !poll.participants.has(name)) {
    return bot.sendMessage(msg.chat.id, `❌ "${name}" participant list mein nahi hai.`);
  }

  // Us participant ke sab votes remove karo
  const participantData = poll.participants.get(name);
  for (const voterId of participantData.voters) {
    userVotes.delete(voteKey(voterId, channelId));
  }

  poll.participants.delete(name);
  await bot.sendMessage(
    msg.chat.id,
    `✅ *${escapeMarkdown(name)}* participant list se hata diya gaya\\.`,
    { parse_mode: "MarkdownV2" }
  );
});

// /startpoll <channelId>
bot.onText(/\/startpoll(?:\s+(-?\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const channelId = match[1];

  if (!channelId) {
    return bot.sendMessage(msg.chat.id, "❗ Usage: /startpoll <channelId>");
  }

  const isAdmin = await isChannelAdmin(channelId, userId);
  if (!isAdmin && userId !== MAIN_ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Sirf channel admin hi poll shuru kar sakta hai.");
  }

  const poll = getPoll(channelId);
  if (!poll) {
    return bot.sendMessage(msg.chat.id, "❌ Pehle /setvoting se channel register karo.");
  }
  if (poll.participants.size === 0) {
    return bot.sendMessage(msg.chat.id, "❌ Pehle /addparticipant se participants add karo.");
  }
  if (poll.active) {
    return bot.sendMessage(msg.chat.id, "⚠️ Poll pehle se active hai!");
  }

  poll.active = true;

  // Channel pe announcement
  const participantList = [...poll.participants.keys()]
    .map((n, i) => `${i + 1}\\. ${escapeMarkdown(n)}`)
    .join("\n");

  const announcement =
    `🗳️ *VOTING SHURU HO GAYI\\!*\n\n` +
    `*Participants:*\n${participantList}\n\n` +
    `Vote karne ke liye:\n` +
    `➡️ @${(await bot.getMe()).username} ko PM karo aur likhо:\n` +
    `/vote ${channelId} <participant naam>\n\n` +
    `⚠️ Sirf channel members hi vote kar sakte hain\\.`;

  try {
    await bot.sendMessage(channelId, announcement, { parse_mode: "MarkdownV2" });
  } catch (e) {
    console.error("Channel message send error:", e.message);
  }

  await bot.sendMessage(msg.chat.id, `✅ Poll shuru ho gaya channel \`${channelId}\` mein!`, {
    parse_mode: "Markdown",
  });
});

// /stoppoll <channelId>
bot.onText(/\/stoppoll(?:\s+(-?\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const channelId = match[1];

  if (!channelId) {
    return bot.sendMessage(msg.chat.id, "❗ Usage: /stoppoll <channelId>");
  }

  const isAdmin = await isChannelAdmin(channelId, userId);
  if (!isAdmin && userId !== MAIN_ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Sirf channel admin hi poll band kar sakta hai.");
  }

  const poll = getPoll(channelId);
  if (!poll || !poll.active) {
    return bot.sendMessage(msg.chat.id, "⚠️ Koi active poll nahi hai.");
  }

  poll.active = false;

  const leaderboard = formatLeaderboard(poll.participants);

  // Channel pe final results
  try {
    await bot.sendMessage(
      channelId,
      `🛑 *VOTING BAND HO GAYI\\!*\n\n${leaderboard}`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (e) {
    console.error("Channel message send error:", e.message);
  }

  await bot.sendMessage(msg.chat.id, `✅ Poll band ho gaya!\n\n${leaderboard}`, {
    parse_mode: "MarkdownV2",
  });
});

// /results <channelId>
bot.onText(/\/results(?:\s+(-?\d+))?/, async (msg, match) => {
  const channelId = match[1];

  if (!channelId) {
    return bot.sendMessage(msg.chat.id, "❗ Usage: /results <channelId>");
  }

  const poll = getPoll(channelId);
  if (!poll) {
    return bot.sendMessage(msg.chat.id, "❌ Is channel ki koi voting setup nahi hai.");
  }

  const leaderboard = formatLeaderboard(poll.participants);
  await bot.sendMessage(msg.chat.id, leaderboard, { parse_mode: "MarkdownV2" });
});

// /resetpoll <channelId>
bot.onText(/\/resetpoll(?:\s+(-?\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const channelId = match[1];

  if (!channelId) {
    return bot.sendMessage(msg.chat.id, "❗ Usage: /resetpoll <channelId>");
  }

  const isAdmin = await isChannelAdmin(channelId, userId);
  if (!isAdmin && userId !== MAIN_ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Sirf channel admin hi reset kar sakta hai.");
  }

  // Sab votes remove karo
  const poll = getPoll(channelId);
  if (poll) {
    for (const [, data] of poll.participants) {
      for (const voterId of data.voters) {
        userVotes.delete(voteKey(voterId, channelId));
      }
      data.votes = 0;
      data.voters = new Set();
    }
    poll.active = false;
  }

  await bot.sendMessage(msg.chat.id, `✅ Channel \`${channelId}\` ka poll reset ho gaya!`, {
    parse_mode: "Markdown",
  });
});

// /vote <channelId> <naam>  — Private chat mein
bot.onText(/\/vote(?:\s+(-?\d+))?\s*([\s\S]*)/, async (msg, match) => {
  if (msg.chat.type !== "private") {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ Vote karne ke liye mujhe private message karo!"
    );
  }

  const userId = msg.from.id;
  const channelId = match[1];
  const participantName = match[2]?.trim();

  if (!channelId || !participantName) {
    return bot.sendMessage(
      msg.chat.id,
      "❗ Usage: /vote <channelId> <participant naam>\n\nExample: /vote -1001234567890 Rahul"
    );
  }

  const poll = getPoll(channelId);
  if (!poll) {
    return bot.sendMessage(msg.chat.id, "❌ Is channel ki koi voting setup nahi hai.");
  }
  if (!poll.active) {
    return bot.sendMessage(msg.chat.id, "❌ Is channel mein abhi koi active voting nahi hai.");
  }

  // Check: channel member hai?
  const isMember = await isChannelMember(channelId, userId);
  if (!isMember) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ *Aap channel ke member nahi hain!*\n\nPehle channel join karo, phir vote karo.",
      { parse_mode: "Markdown" }
    );
  }

  // Participant exist karta hai?
  if (!poll.participants.has(participantName)) {
    const list = [...poll.participants.keys()].map((n) => `• ${n}`).join("\n");
    return bot.sendMessage(
      msg.chat.id,
      `❌ "${participantName}" participant list mein nahi hai.\n\n*Available participants:*\n${list}`,
      { parse_mode: "Markdown" }
    );
  }

  const key = voteKey(userId, channelId);
  const existingVote = userVotes.get(key);

  if (existingVote) {
    if (existingVote.votedFor === participantName) {
      return bot.sendMessage(
        msg.chat.id,
        `⚠️ Aap pehle se *${participantName}* ko vote kar chuke hain!`,
        { parse_mode: "Markdown" }
      );
    }

    // Purana vote hatao
    const oldParticipant = poll.participants.get(existingVote.votedFor);
    if (oldParticipant) {
      oldParticipant.votes = Math.max(0, oldParticipant.votes - 1);
      oldParticipant.voters.delete(userId);
    }
  }

  // Naya vote do
  const participant = poll.participants.get(participantName);
  participant.votes += 1;
  participant.voters.add(userId);
  userVotes.set(key, { votedFor: participantName, channelId });

  const userName = msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : "");

  await bot.sendMessage(
    msg.chat.id,
    `✅ *Aapka vote ${escapeMarkdown(participantName)} ko diya gaya\\!*\n\n📊 Current votes: *${participant.votes}*`,
    { parse_mode: "MarkdownV2" }
  );

  // Channel pe update
  try {
    const leaderboard = formatLeaderboard(poll.participants);
    await bot.sendMessage(
      channelId,
      `🗳️ *New Vote\\!*\n\n*${escapeMarkdown(userName)}* ne *${escapeMarkdown(participantName)}* ko vote diya\\!\n\n${leaderboard}`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (e) {
    console.error("Channel update error:", e.message);
  }
});

// ============================================================
// CHANNEL MEMBER LEFT — vote automatic hatega
// ============================================================
bot.on("chat_member", async (update) => {
  const { chat, new_chat_member, old_chat_member } = update;

  // Check kar rahe hain kya user left/kicked hua
  const wasActive = ["member", "administrator", "creator"].includes(
    old_chat_member?.status
  );
  const isNowGone = ["left", "kicked", "banned"].includes(
    new_chat_member?.status
  );

  if (!wasActive || !isNowGone) return;

  const channelId = String(chat.id);
  const userId = new_chat_member.user.id;
  const userName =
    new_chat_member.user.first_name +
    (new_chat_member.user.last_name ? ` ${new_chat_member.user.last_name}` : "");

  const poll = getPoll(channelId);
  if (!poll) return;

  const key = voteKey(userId, channelId);
  const existingVote = userVotes.get(key);

  if (existingVote) {
    const participantName = existingVote.votedFor;
    const participant = poll.participants.get(participantName);

    if (participant) {
      participant.votes = Math.max(0, participant.votes - 1);
      participant.voters.delete(userId);
    }

    userVotes.delete(key);

    // Channel pe announce karo
    try {
      await bot.sendMessage(
        channelId,
        `⚠️ *Vote Hata Diya Gaya\\!*\n\n*${escapeMarkdown(userName)}* ne channel chhod diya\\.\nInka vote *${escapeMarkdown(participantName)}* se hat gaya\\.\n\n📊 Updated votes: *${participant?.votes ?? 0}*`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (e) {
      console.error("Channel announcement error:", e.message);
    }
  }
});

// ============================================================
// MAIN ADMIN ONLY COMMANDS
// ============================================================

// /broadcast <message>
bot.onText(/\/broadcast\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  if (msg.from.id !== MAIN_ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Sirf main admin broadcast kar sakta hai.");
  }

  const message = match[1];
  const channels = [...channelPolls.keys()];

  if (channels.length === 0) {
    return bot.sendMessage(msg.chat.id, "⚠️ Koi registered channel nahi hai.");
  }

  let sent = 0;
  let failed = 0;

  for (const channelId of channels) {
    try {
      await bot.sendMessage(channelId, `📢 *Broadcast Message*\n\n${message}`, {
        parse_mode: "Markdown",
      });
      sent++;
    } catch (e) {
      console.error(`Broadcast failed for ${channelId}:`, e.message);
      failed++;
    }
  }

  await bot.sendMessage(
    msg.chat.id,
    `✅ Broadcast complete!\n✅ Sent: ${sent}\n❌ Failed: ${failed}`
  );
});

// /allchannels
bot.onText(/\/allchannels/, async (msg) => {
  if (msg.chat.type !== "private") return;
  if (msg.from.id !== MAIN_ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Sirf main admin ye command use kar sakta hai.");
  }

  const channels = [...channelPolls.entries()];
  if (channels.length === 0) {
    return bot.sendMessage(msg.chat.id, "⚠️ Koi registered channel nahi hai.");
  }

  let text = "📋 *Registered Channels:*\n\n";
  for (const [channelId, poll] of channels) {
    text += `• \`${channelId}\`\n`;
    text += `  Status: ${poll.active ? "🟢 Active" : "🔴 Inactive"}\n`;
    text += `  Participants: ${poll.participants.size}\n`;
    const totalVotes = [...poll.participants.values()].reduce(
      (sum, p) => sum + p.votes,
      0
    );
    text += `  Total Votes: ${totalVotes}\n\n`;
  }

  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// /adminhelp
bot.onText(/\/adminhelp/, async (msg) => {
  if (msg.chat.type !== "private") return;
  if (msg.from.id !== MAIN_ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Sirf main admin ke liye hai.");
  }

  const text = `👑 *Main Admin Commands:*

/broadcast <message> — Sab registered channels ko message bhejo
/allchannels — Sab registered channels ki list
/setvoting <channelId> — Kisi bhi channel me voting setup karo
/startpoll <channelId> — Kisi bhi channel me poll shuru karo
/stoppoll <channelId> — Kisi bhi channel me poll band karo
/resetpoll <channelId> — Kisi bhi channel ka poll reset karo
/addparticipant <channelId> <naam> — Participant add karo
/removeparticipant <channelId> <naam> — Participant hatao
/results <channelId> — Kisi bhi channel ke results dekho`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// ============================================================
// FORWARDED MESSAGE HANDLER (participants set karna)
// Channel admin agar participant ka naam forward kare
// ============================================================
bot.on("message", async (msg) => {
  if (msg.chat.type !== "private") return;
  if (!msg.forward_from && !msg.forward_sender_name) return;
  if (!msg.text) return;

  // Forwarded message mein participant naam dhundo
  // Format: "VOTE: <channelId>\n<naam1>\n<naam2>" ya sirf text
  const text = msg.text.trim();

  const voteSetupMatch = text.match(/^VOTE:\s*(-?\d+)\n([\s\S]+)$/i);
  if (!voteSetupMatch) return;

  const userId = msg.from.id;
  const channelId = voteSetupMatch[1];
  const namesRaw = voteSetupMatch[2];
  const names = namesRaw
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  const isAdmin = await isChannelAdmin(channelId, userId);
  if (!isAdmin && userId !== MAIN_ADMIN_ID) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Sirf channel admin hi participants setup kar sakta hai."
    );
  }

  const poll = getOrCreatePoll(channelId);
  channelAdmins.set(String(channelId), userId);

  const added = [];
  for (const name of names) {
    if (!poll.participants.has(name)) {
      poll.participants.set(name, { votes: 0, voters: new Set() });
      added.push(name);
    }
  }

  if (added.length === 0) {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ Sab participants pehle se add hain!"
    );
  }

  const list = added.map((n) => `• ${n}`).join("\n");
  await bot.sendMessage(
    msg.chat.id,
    `✅ *${added.length} Participants Add Ho Gaye!*\n\n${list}\n\nChannel: \`${channelId}\`\n\nAb /startpoll ${channelId} se voting shuru karo.`,
    { parse_mode: "Markdown" }
  );
});

// ============================================================
// ERROR HANDLING
// ============================================================
bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
});

bot.on("error", (error) => {
  console.error("Bot error:", error.message);
});

// ============================================================
// STARTUP
// ============================================================
bot.getMe().then((me) => {
  console.log(`
✅ Vote Bot Started!
🤖 Bot: @${me.username}
👑 Main Admin ID: ${MAIN_ADMIN_ID}

📖 Usage:
1. Bot ko apne channel ka admin banao
2. /setvoting <channelId> se register karo
3. /addparticipant <channelId> <naam> se participants add karo
4. /startpoll <channelId> se voting shuru karo
5. Members /vote <channelId> <naam> karke vote de sakte hain
  `);
});
