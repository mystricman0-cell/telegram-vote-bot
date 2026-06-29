/**
 * 🎁 DRS GIVEAWAY BOT v3.0.8
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

// Dynamic owner ID — starts from env, can be changed at runtime via /setownerid
let ownerAdminId = MAIN_ADMIN_ID;

// Log destination — where user logs/notifications are sent (user or channel). null = ownerAdminId
let logDestId = null;

// Returns the active log destination (channel or user)
function getLogDest() { return logDestId || ownerAdminId; }

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
  panelThreshold: { type: Number, default: 15 },
  panelWindowSecs: { type: Number, default: 90 },
  channelMsgIds: { type: [Number], default: [] },
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

// ─── Security Schemas ───
const securityLogSchema = new mongoose.Schema({
  userId: Number, username: String, action: String, detail: String,
  timestamp: { type: Date, default: Date.now }
});
const warningSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  count: { type: Number, default: 0 }, reasons: [String],
  lastWarnAt: { type: Date, default: Date.now }
});
const shadowBanSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  reason: String, at: { type: Date, default: Date.now }
});
const trustedUserSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true }, addedAt: { type: Date, default: Date.now }
});
const blockedWordSchema = new mongoose.Schema({
  word: { type: String, required: true, unique: true }, addedAt: { type: Date, default: Date.now }
});
const honeypotTrapSchema = new mongoose.Schema({
  command: { type: String, required: true, unique: true }, addedAt: { type: Date, default: Date.now }
});
const SecurityLogModel = mongoose.model("SecurityLog", securityLogSchema);
const WarningModel     = mongoose.model("Warning",     warningSchema);
const ShadowBanModel   = mongoose.model("ShadowBan",   shadowBanSchema);
const TrustedUserModel = mongoose.model("TrustedUser", trustedUserSchema);
const BlockedWordModel = mongoose.model("BlockedWord", blockedWordSchema);
const HoneypotTrapModel = mongoose.model("HoneypotTrap", honeypotTrapSchema);

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
const lbBroadcastTimers = new Map(); // gId → { intervalId, hours, nextAt, channelId }
let scheduleCounter = 1;
let paymentCounter = 1;
let membershipPayCounter = 1;
let welcomeImageUrl = null;
const voteVelocity = new Map(); // "gId:partId" → { count, windowStart, alerted }
const pendingVoteMap = new Map(); // userId → { gId, participantUserId } — awaiting channel join before vote

// ─── Security state ───
const userWarnings      = new Map();   // userId → { count, reasons, lastWarnAt }
const shadowBanned      = new Set();   // userIds
const trustedUsers      = new Set();   // userIds
const blockedWords      = new Set();   // word strings
const honeypotTraps     = new Set();   // fake command strings
const honeypotTripped   = new Map();   // userId → [{ command, at }]
const flaggedUsers      = new Map();   // userId → { reason, at }
const mutedUsers        = new Set();   // userIds
const securityLog       = [];          // last 500 events (in-memory)
const commandRateLimit  = new Map();   // userId → { count, windowStart }
const userCommandHistory = new Map();  // userId → [{ cmd, at }]
let securityMode        = "normal";    // "strict"|"normal"|"off"
let antispamEnabled     = true;
let honeypotEnabled     = true;
let maxWarnings         = 3;
let autobanEnabled      = true;
let emergencyLocked     = false;
const botStartTime      = Date.now();

// ============================================================
// DEFAULT SECURITY: HONEYPOT TRAPS + BLOCKED WORDS
// Auto-seeded to MongoDB on first run (version-controlled)
// ============================================================

const DEFAULT_HONEYPOT_TRAPS = [
  // ── Hacking / Exploits ──
  "hack","hacked","hacker","hackers","hacking","hackbot","hackme","hackthis",
  "exploit","exploits","exploiting","exploited","exploiter","payload","payloads",
  "script","scripts","scriptbot","botnet","botnets","ddos","dosattack","dos",
  "spam","spambot","spammer","spammers","spamming","flood","flooding","flooder",
  "brute","bruteforce","bruteforcing","crack","cracked","cracker","crackers","cracking",
  "bypass","bypassed","bypassme","phishing","phish","phishme",
  "scam","scambot","scammer","scammers","scamming",
  "carding","carder","carders","cc_dump","cvv","bin","bins",
  "otp","otpbypass","bypass_otp","termux","linux","kali","kalilinux","ubuntu",
  "python","py","pip","node","npm","git","github","clone","repo","repository",
  "session","string_session","pyrogram","telethon","telethon_session","session_string",
  "account","accounts","report_bot","report_spam",
  "proxy","proxies","vpn","scan","scanner","nmap","sqlmap",
  "vulnerability","vulnerable","exploit_db","exploitdb",
  "shell","reverse_shell","revshell","terminal","bash",
  "apk","modapk","mod","modded","premium","pro","freepremium","free_premium",
  // ── Malware / RAT / Tools ──
  "rat","keylogger","malware","ransomware","trojan","virus","worm",
  "backdoor","rootkit","zero_day","zeroday",
  "xss","sqli","lfi","rfi","csrf","rce","c2","botmaster",
  "loic","hoic","slowloris","metasploit","msfvenom","msfconsole",
  "netcat","nc","wireshark","aircrack","hashcat","john","hydra",
  "medusa","burpsuite","owasp","nikto","dirb","gobuster","ffuf","wfuzz",
  "sqlninja","xsstrike","commix","weevely","msfpayload","meterpreter",
  "mimikatz","lazagne","bloodhound","empire","cobalt_strike",
  "powersploit","powercat","psexec","winrm","wmiexec","dcsync",
  "pass_hash","golden_ticket","silver_ticket","kerberoast","asreproast",
  // ── Telegram Specific ──
  "telegram_hack","tg_hack","account_hack","phone_hack",
  "otp_bypass","twofactor_bypass","twofa_bypass","account_recover","account_steal",
  "session_hijack","string_session_gen","pyrogram_client","telethon_client",
  "account_gen","account_sell","tg_member","tg_scraper","tg_adder",
  "mass_add","spambot","floodbot","tgbot_hack","group_hack","channel_hack",
  "phone_verify","fake_otp","sim_swap","kyc_bypass",
  "tg_token","bot_token","bot_hack","admin_hack","admin_panel","adminpanel",
  "admin_login","cpanel","cpanelhack","ftp_crack","ssh_crack","rdp_crack",
  "telnet_crack","database_dump","db_dump","mysql_dump","sql_dump",
  "data_breach","leak_db","leaked_db","server_hack","vps_hack","cloud_hack",
  "aws_hack","azure_hack","gcp_hack","docker_escape","api_hack",
  "mongodb_inject","nosql_inject","redis_inject","graphql_inject",
  "xml_inject","ldap_inject","blind_sql","time_sql","union_sql",
  // ── Userbot / Scraper ──
  "userbot","ub","tg_userbot","userbotplugin","plugin","plugins",
  "module","modules","addon","addons","join_all","leave_all",
  "scrape","scraper","scraping","member_add","adder","add_members",
  "invite","inviter","massdm","mass_dm","gcast","global_broadcast",
  "forwarder","auto_forward","auto_reply","afk","tagall","broadcast_all",
  "input_peer","access_hash","encode","decode","base64_decode",
  "member_scraper","group_scraper","channel_scraper","contact_scraper",
  "phone_scraper","data_scraper","username_scraper","profile_scraper",
  "message_copy","message_sender","bulk_message","mass_message",
  "joiner","leaver","join_bot","leave_bot","report_all","mass_report",
  "dm_all","pm_all","pm_bot","spammer_bot","flood_all","spam_all",
  // ── Adult / NSFW ──
  "adult","nsfw","leaks","premiumchan","onlyfans","xxx","pornhub","xnxx",
  "xvideos","nude","nudes","explicit","sexbot","adult_bot","nsfw_bot",
  "leak_channel","onlyfans_free","adult_content","18plus","eighteen_plus",
  "pornlink","nsfwlink","nude_leak","celebrity_leak","mms","mmslink",
  // ── Gambling / Betting ──
  "casino","bet","betting","lottery","gamble","gambling","slots","poker",
  "jackpot","satta","matka","cricket_bet","ipl_bet","prediction",
  "tipster","bet365","onexbet","betway","1xbet","satta_king","satta_matka",
  "lucky_draw_hack","lottery_win","jackpot_trick","casino_trick",
  // ── Carding / Financial Fraud ──
  "creditcard","debit_card","card_crack","paypal_hack","upi_hack",
  "paytm_hack","bank_hack","net_banking","otp_hack","aadhaar_bypass",
  "pan_bypass","fake_kyc","money_double","investment_scam","ponzi","mlm_scam",
  "crypto_scam","bitcoin_double","eth_double","wallet_hack","seed_phrase",
  "private_key","recovery_phrase","mnemonic","binance_hack","coinbase_hack",
  "metamask_hack","trustwallet_hack","phantom_hack","ledger_hack",
  "card_gen","cardgen","cc_checker","bin_checker","live_cc","dead_cc",
  "cc_valid","cc_invalid","cvv_check","card_check","paypal_check",
  "stripe_check","braintree_check","paypal_gen","card_dump",
  // ── Password / Auth Bypass ──
  "password_crack","password_dump","password_list","wordlist","rockyou",
  "password_spray","credential_stuff","credential_harvest","cred_dump",
  "rainbow_table","hash_crack","sha1_crack","md5_crack","bcrypt_crack",
  "ntlm_crack","lm_crack","kerberos_crack","ticket_crack",
  // ── Social Engineering ──
  "social_engineer","se","pretexting","vishing","smishing",
  "spear_phish","whaling","clone_phishing","watering_hole","baiting",
  // ── Mobile Hacking ──
  "android_hack","ios_hack","iphone_hack","samsung_hack","xiaomi_hack",
  "apk_mod","apk_crack","apk_patch","apk_decompile","apk_recompile",
  "apk_inject","ios_jailbreak","iphone_unlock","imei_unlock","bootloader",
  // ── Gaming Cheats / Mods ──
  "cheat_codes","pubg_mod","freefire_mod","diamonds","coins",
  "unlimited_money","generator","keygen","key_gen","serial_number",
  "license","activation","cracked_software","warez","torrent","magnet",
  "mediafire","zippyshare","drive_link","mega_nz","piracy",
  "game_hack","game_cheat","pubg_hack","freefire_hack","cod_hack",
  "minecraft_crack","roblox_hack","fortnite_hack","valorant_hack",
  "csgo_cheat","cs2_cheat","aimbot","wallhack","esp_cheat",
  // ── Token / API Key Stealers ──
  "token_grab","token_grabber","discord_token","whatsapp_session",
  "facebook_hack","instagram_hack","snapchat_hack","twitter_hack",
  "gmail_hack","email_hack","script_kiddie","github_leak","pastebin_hack",
  // ── Network / Server ──
  "port_scan","port_scanner","portscan","arp_spoof","arp_poison",
  "dns_spoof","dns_hijack","mitm","man_in_middle","ssl_strip",
  "wifi_crack","wpa_crack","wpa2_crack","handshake_crack","pmkid",
  "evil_twin","rogue_ap","captive_portal_hack","hotspot_hack",
  // ── File / Malware ──
  "exe","cmd","cmdexe","powershell","batch_script","vbs_script",
  "macro_virus","office_macro","pdf_exploit","zip_bomb","fork_bomb",
  "memory_bomb","cpu_bomb","kill_bot","kill_all","destroy_db",
  // ── Miscellaneous ──
  "darkweb","dark_web","deepweb","deep_web","tor_browser","onion_link",
  "blackhat","black_hat","greyhat","grey_hat","pentest_tool",
  "ctf_help","pwn","pwntools","pwnme","overflow","buffer_overflow",
  "heap_spray","use_after_free","format_string","rop_chain","shellcode",
  "obfuscate","deobfuscate","unpack","pack","encode_payload","encrypt_payload",
  "steganography","stego","hide_payload","bypass_detection",
  "antivirus_bypass","av_bypass","amsi_bypass","edr_bypass",
  "sandbox_bypass","vm_detect","vm_escape","hypervisor_escape",
  "container_escape","privilege_escalate","priv_esc","uac_bypass",
];

const DEFAULT_BLOCKED_WORDS = [
  // ── Hindi (Devanagari) ──
  "भड़वा","भड़वे","रंडी","रंडिया","भोसड़ी","भोसड़ीके","चुत","चुतिया",
  "चूतिया","लंड","लौड़ा","लोड़ा","मादरचोद","बहनचोद","भड़ुआ",
  "हरामी","हरामजादे","हरामजादा","कमीना","कमीने","बेशर्म","गांड",
  "कुतिया","कुत्ते","सुअर","सूअर","गधा","बकलोल","रंडीबाज",
  "चुतमारी","गांडू","भोसड़ा","लौड़ेबाज","मादरचोद","बहनचोद",
  "हरामखोर","कुत्ते की औलाद","साले","साली","कमीनी","भड़ासी",
  // ── Hinglish Transliterated ──
  "madarchod","madarchodd","maderchod","maadarchodd","bhenchod","bhainchod",
  "behenchod","behnchod","bc","mc","chutiya","chutiye","chutiyapon","chut",
  "lund","lauda","lavda","lavde","gaand","gandu","gand","randi","randiya",
  "randwe","randwa","harami","haramjada","haramjadi","haramzada","haramzadi",
  "haramkhor","kameena","kamine","bhadva","bhadviya","bhadua","saala","saali",
  "saale","maadarchodd","bhosdike","bhosadike","bhosadwale","bhosadi","bhosda",
  "khankhi","khankhar","randi_ki_aulad","gand_mara","gand_maro","gaandmaro",
  "chakka","hijra","hijre","kutwa","kuttiya","sooar","suwar","suwara",
  "ullu","ullu_ka_patha","bevakoof","bewakoof","chutad","chutmarani",
  "lund_maro","laude_ke","gaand_maro","bhosdiwale","maadarchodd",
  "sala_kutta","sali_kutiya","haramkhor","kamine_log","kamini","kamine",
  "bkl","bkl_sala","maa_ki_aankh","teri_maa","teri_ma","teri_bahan",
  "maa_chudao","behen_chudao","gandu_sala","lund_khao","lauda_khao",
  "chut_mein","gaand_mein","rand","randi_rona","randibaz","randibazi",
  // ── English Abuses ──
  "fuck","fucking","fucked","fucker","fucks","motherfucker","mf",
  "shit","bullshit","bitch","bitches","bastard","bastards",
  "asshole","assholes","dickhead","cunt","prick","twat",
  "slut","whore","whores","dick","cock","pussy",
  "son_of_a_bitch","sob","nigger","nigga","fag","faggot",
  "retard","moron","idiot_fuck","dumbfuck","dipshit","jackass",
  "shithead","arsehole","bloody_hell","bollocks","wanker","tosser",
];

// ============================================================
// SUB-ADMIN SYSTEM
// Add admins with granular permissions via /addadmin
// ============================================================
const subAdmins = new Map(); // Map<userId, { name, username, addedAt, permissions: Set<string> }>

const ADMIN_PERMS = {
  all:               "🔑 Full access (same as main admin)",
  approve_payments:  "✅ Approve/reject vote & membership payments",
  manage_giveaways:  "🎁 End/cancel/reset/addvotes for giveaways",
  broadcast:         "📢 Send broadcasts to users/channels/all",
  ban_users:         "🚫 Ban & unban users",
  view_stats:        "📊 View stats, paystats, listusers, allgiveaways",
  manage_membership: "👑 Grant/revoke/extend VIP membership",
  security:          "🛡️ Warn, mute, shadowban, security commands",
};

// ============================================================
// UI TEXT CUSTOMIZATION SYSTEM
// Change any text/emoji/button via /customize or /settext
// ============================================================
const botCustomTexts = new Map();

const DEFAULT_UI_TEXTS = {
  // ── Welcome Screen — Text ──
  "welcome.title":             "𝐃𝐑𝐒 𝐆𝐈𝐕𝐄𝐀𝐖𝐀𝐘 𝐁𝐎𝐓! 🎁",
  "welcome.feature1":          "✨ ꜰᴜʟʟʏ ᴀᴜᴛᴏᴍᴀᴛᴇᴅ &amp; ꜰᴀɪʀ ɢɪᴠᴇᴀᴡᴀʏ ꜱʏꜱᴛᴇᴍ ✔️",
  "welcome.feature2":          "⚡️ ꜰᴀꜱᴛ &amp; ᴛʀᴀɴꜱᴘᴀʀᴇɴᴛ ᴡɪɴɴᴇʀ ꜱᴇʟᴇᴄᴛɪᴏɴ ✔️",
  "welcome.feature3":          "🛡 ꜱᴇᴄᴜʀᴇ, ʀᴇʟɪᴀʙʟᴇ &amp; ᴇᴀꜱʏ ᴛᴏ ᴜꜱᴇ ✔️",
  "welcome.feature4":          "🎊 ʜᴏꜱᴛ ɢɪᴠᴇᴀᴡᴀʏꜱ ᴡɪᴛʜ ᴀ ᴘʀᴇᴍɪᴜᴍ ᴇxᴘᴇʀɪᴇɴᴄᴇ ✔️",
  "welcome.tip1":              "🔺 ᴛᴀᴘ 🎁 ɴᴇᴡ ɢɪᴠᴇᴀᴡᴀʏ ʙᴜᴛᴛᴏɴ ᴛᴏ ᴄʀᴇᴀᴛᴇ ᴀ ɢɪᴠᴇᴀᴡᴀʏ ⭐",
  "welcome.tip2":              "🔺 ᴛᴀᴘ 📂 ᴍʏ ɢɪᴠᴇᴀᴡᴀʏꜱ ʙᴜᴛᴛᴏɴ ᴛᴏ ᴠɪᴇᴡ ʏᴏᴜʀ ɢɪᴠᴇᴀᴡᴀʏꜱ ⭐️",
  "welcome.divider":           "✈️━━━━━ 𝐃𝐑𝐒 ━━━━━✈️",
  "welcome.divider_url":       "https://t.me/rchiex",
  "welcome.powered":           "⚡️ ᴘᴏᴡᴇʀᴇᴅ : 𝐃𝐑𝐒 ɴᴇᴛᴡᴏʀᴋ 🔥",
  "welcome.powered_url":       "https://t.me/rchiex",
  "welcome.powered_name":      "𝐃𝐑𝐒 ɴᴇᴛᴡᴏʀᴋ",
  "welcome.support":           "🔥 ꜱᴜᴘᴘᴏʀᴛ :— 𝐀𝐁𝐇𝐈𝐒𝐇𝐄𝐊 🔥",
  "welcome.support_url":       "https://t.me/drssupport",
  "welcome.support_name":      "𝐀𝐁𝐇𝐈𝐒𝐇𝐄𝐊",
  // ── Welcome Screen — Buttons ──
  "welcome.btn_new_giveaway":  "`ɴᴇᴡ ɢɪᴠᴇᴀᴡᴀʏ, 🎁",
  "welcome.btn_my_giveaways":  "`ᴍʏ ɢɪᴠᴇᴀᴡᴀʏꜱ, 📂",
  "welcome.btn_add_channel":   "`ᴀᴅᴅ ᴄʜᴀɴɴᴇʟ, 📢",
  "welcome.btn_add_group":     "`ᴀᴅᴅ ɢʀᴏᴜᴘ, 👥",
  "welcome.btn_vip":           "`ᴠɪᴘ ᴍᴇᴍʙᴇʀꜱʜɪᴘ, 👑",
  "welcome.btn_create_post":   "`ᴄʀᴇᴀᴛᴇ ᴘᴏꜱᴛ, 🚀",
  "welcome.btn_guide":         "`ɢᴜɪᴅᴇ & ʜᴇʟᴘ,",
  // ── Legacy keys (kept for compatibility) ──
  "welcome.header":            "🎁 <b>DRS GIVEAWAY BOT</b> 🎁",
  "welcome.tagline":           "✦ Fair · Fast · Automated ✦",
  "welcome.btn_join":          "🎯 Join a Giveaway",
  "welcome.btn_create":        "➕ Create Giveaway",
  "welcome.btn_help":          "📖 Help & Guide",
  "welcome.btn_support":       "💬 Support",
  "welcome.btn_leaderboard":   "🏆 Leaderboard",
  // Giveaway UI
  "giveaway.btn_participate":  "🎯 Participate",
  "giveaway.btn_vote":         "🗳️ Vote Now!",
  "giveaway.btn_leaderboard":  "🏆 ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ",
  "giveaway.btn_share":        "📤 Share",
  "giveaway.winner_header":    "🏆 <b>WINNERS ANNOUNCED!</b> 🏆",
  "giveaway.active_header":    "🔷 <b>LIVE GIVEAWAYS</b>",
  "giveaway.ended_tag":        "🏁 Ended",
  "giveaway.label_votes":      "🗳️ Votes",
  "giveaway.label_rank":       "🏅 Rank",
  "giveaway.label_participants":"👥 Participants",
  "giveaway.medal_1":          "🥇",
  "giveaway.medal_2":          "🥈",
  "giveaway.medal_3":          "🥉",
  // VIP / Membership
  "vip.badge":                 "👑 VIP",
  "vip.tag_active":            "✅ Active",
  "vip.tag_expired":           "⚠️ Expired",
  "vip.btn_buy":               "💎 Get VIP Membership",
  // Payments
  "pay.btn_inr":               "💳 Pay via UPI/INR",
  "pay.btn_stars":             "⭐ Pay with Stars",
  "pay.msg_success":           "✅ Payment verified! Votes added.",
  "pay.msg_pending":           "⏳ Payment is under review.",
  "pay.msg_rejected":          "❌ Payment rejected. Contact support.",
  // Support
  "support.header":            "💬 <b>DRS Support</b>",
  "support.btn":               "📩 Contact Support",
  // System / Errors
  "sys.footer":                "✦ ─── <b>@DRS_GiveawayBot</b> ─── ✦",
  "sys.maintenance":           "🔧 Bot is under maintenance. Please try again later.",
  "sys.banned":                "🚫 You are banned from using this bot.",
  "sys.admin_only":            "❌ Admin only!",
  "sys.not_found":             "❌ Not found.",
  "sys.btn_back":              "🔙 Back",
  "sys.btn_close":             "❌ Close",
  "sys.btn_confirm":           "✅ Confirm",
  "sys.btn_cancel":            "🚫 Cancel",
};

function getUI(key) {
  return botCustomTexts.has(key) ? botCustomTexts.get(key) : (DEFAULT_UI_TEXTS[key] ?? key);
}
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

  // ─── Load Security Data ───
  const allWarnings = await WarningModel.find({});
  for (const w of allWarnings) userWarnings.set(w.userId, { count: w.count, reasons: w.reasons || [], lastWarnAt: w.lastWarnAt });
  const allShadowBans = await ShadowBanModel.find({});
  for (const s of allShadowBans) shadowBanned.add(s.userId);
  const allTrusted = await TrustedUserModel.find({});
  for (const t of allTrusted) trustedUsers.add(t.userId);
  const allBlockedWords = await BlockedWordModel.find({});
  for (const b of allBlockedWords) blockedWords.add(b.word);
  const allHoneypotTraps = await HoneypotTrapModel.find({});
  for (const h of allHoneypotTraps) honeypotTraps.add(h.command);
  const secConfig = await BotConfigModel.findOne({ key: "securityConfig" });
  if (secConfig?.value) {
    if (secConfig.value.securityMode) securityMode = secConfig.value.securityMode;
    if (secConfig.value.antispamEnabled !== undefined) antispamEnabled = secConfig.value.antispamEnabled;
    if (secConfig.value.honeypotEnabled !== undefined) honeypotEnabled = secConfig.value.honeypotEnabled;
    if (secConfig.value.maxWarnings) maxWarnings = secConfig.value.maxWarnings;
    if (secConfig.value.autobanEnabled !== undefined) autobanEnabled = secConfig.value.autobanEnabled;
    if (secConfig.value.emergencyLocked !== undefined) emergencyLocked = secConfig.value.emergencyLocked;
  }
  const recentSecLogs = await SecurityLogModel.find({}).sort({ timestamp: -1 }).limit(200).lean();
  for (const l of recentSecLogs.reverse()) securityLog.push(l);

  // Load custom UI texts
  const uiConfigs = await BotConfigModel.find({ key: /^ui:/ });
  for (const c of uiConfigs) {
    botCustomTexts.set(c.key.replace('ui:', ''), c.value);
  }

  // Load sub-admins
  const subAdminsCfg = await BotConfigModel.findOne({ key: "subAdmins" });
  if (subAdminsCfg?.value && Array.isArray(subAdminsCfg.value)) {
    for (const sa of subAdminsCfg.value) {
      subAdmins.set(sa.userId, { ...sa, permissions: new Set(sa.permissions || []) });
    }
  }

  // Load dynamic owner admin ID
  const ownerCfg = await BotConfigModel.findOne({ key: "ownerAdminId" });
  if (ownerCfg?.value) ownerAdminId = Number(ownerCfg.value);

  // Load log destination (channel or user ID for user logs/notifications)
  const logDestCfg = await BotConfigModel.findOne({ key: "logDestId" });
  if (logDestCfg?.value) logDestId = logDestCfg.value;

  console.log(`📦 Loaded: ${giveaways.size} giveaways, ${registeredChannels.size} channels, ${vipUsers.size} VIP users, ${botUsers.size} bot users, ${botCustomTexts.size} custom UI texts, ${subAdmins.size} sub-admins`);
  // Seed defaults (one-time — skips if already done)
  await seedDefaultSecurity();
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
// MEMORY EVICTION — removes old ended giveaways from RAM
// They stay in MongoDB; only deleted from in-memory Map
// ============================================================
const MEMORY_EVICT_AFTER_DAYS = 7;

function runMemoryEviction() {
  const cutoff = Date.now() - MEMORY_EVICT_AFTER_DAYS * 24 * 60 * 60 * 1000;
  let evicted = 0;
  for (const [id, g] of giveaways) {
    if (!g.active && g.createdAt && new Date(g.createdAt).getTime() < cutoff) {
      giveaways.delete(id);
      evicted++;
    }
  }
  if (evicted > 0) console.log(`🧹 Memory eviction: ${evicted} old ended giveaways removed from RAM`);
  return evicted;
}

// ============================================================
// DB AUTO-CLEANUP — trims collections that grow unbounded
// USER DATA (BotUser, Vip, active giveaways) is NEVER touched
// ============================================================
async function runDBCleanup() {
  const results = { secLogs: 0, payments: 0, membershipPayments: 0, giveawaysCompressed: 0 };
  try {
    // 1. Trim SecurityLog — keep latest 500 only
    const totalLogs = await SecurityLogModel.countDocuments();
    if (totalLogs > 500) {
      const anchor = await SecurityLogModel.find({}).sort({ timestamp: -1 }).skip(500).limit(1).lean();
      if (anchor[0]) {
        const r = await SecurityLogModel.deleteMany({ timestamp: { $lte: anchor[0].timestamp } });
        results.secLogs = r.deletedCount;
      }
    }

    // 2. Delete resolved pending payments older than 30 days
    const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const pr = await PendingPaymentModel.deleteMany({ timestamp: { $lt: cutoff30d } });
    results.payments = pr.deletedCount;

    // 3. Delete resolved pending membership payments older than 30 days
    const PendingMembershipModel = mongoose.model("PendingMembership");
    if (PendingMembershipModel) {
      const mr = await PendingMembershipModel.deleteMany({ timestamp: { $lt: cutoff30d } }).catch(() => ({ deletedCount: 0 }));
      results.membershipPayments = mr.deletedCount;
    }

    // 4. Compress old ended giveaways (>60 days) — wipe participants/voterMap, keep metadata
    const cutoff60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const oldEnded = await GiveawayModel.find({ active: false, createdAt: { $lt: cutoff60d } }).select("id participants voterMap").lean();
    for (const g of oldEnded) {
      const hasData = (g.participants && Object.keys(g.participants).length > 0) ||
                      (g.voterMap && Object.keys(g.voterMap).length > 0);
      if (hasData) {
        await GiveawayModel.updateOne({ id: g.id }, { $set: { participants: {}, voterMap: {} } });
        results.giveawaysCompressed++;
      }
    }

    console.log(`🗄️ DB Cleanup: ${results.secLogs} sec logs, ${results.payments} payments, ${results.giveawaysCompressed} giveaways compressed`);
  } catch (e) {
    console.error("DB cleanup error:", e.message);
  }
  return results;
}

// Seeds DEFAULT_HONEYPOT_TRAPS + DEFAULT_BLOCKED_WORDS to MongoDB on first run
// Bumping SECURITY_SEED_VERSION will re-seed new additions on next restart
const SECURITY_SEED_VERSION = "v1";
async function seedDefaultSecurity() {
  try {
    const existing = await BotConfigModel.findOne({ key: "defaultSecurityVersion" });
    if (existing?.value === SECURITY_SEED_VERSION) return; // already seeded

    console.log("🔐 Seeding default honeypot traps & blocked words...");

    // Bulk-upsert honeypot traps
    const trapOps = DEFAULT_HONEYPOT_TRAPS.map(cmd => ({
      updateOne: {
        filter: { command: cmd },
        update: { command: cmd },
        upsert: true
      }
    }));
    await HoneypotTrapModel.bulkWrite(trapOps, { ordered: false }).catch(() => {});

    // Bulk-upsert blocked words
    const wordOps = DEFAULT_BLOCKED_WORDS.map(word => ({
      updateOne: {
        filter: { word },
        update: { word },
        upsert: true
      }
    }));
    await BlockedWordModel.bulkWrite(wordOps, { ordered: false }).catch(() => {});

    // Also add to in-memory sets (loadStateFromDB runs before this, so need to merge)
    for (const cmd of DEFAULT_HONEYPOT_TRAPS) honeypotTraps.add(cmd);
    for (const word of DEFAULT_BLOCKED_WORDS) blockedWords.add(word);

    // Mark as seeded
    await BotConfigModel.findOneAndUpdate(
      { key: "defaultSecurityVersion" },
      { key: "defaultSecurityVersion", value: SECURITY_SEED_VERSION },
      { upsert: true }
    );

    console.log(`✅ Seeded ${honeypotTraps.size} honeypot traps + ${blockedWords.size} blocked words.`);
  } catch (e) {
    console.error("seedDefaultSecurity error:", e.message);
  }
}

async function saveSubAdmins() {
  const arr = [];
  for (const [userId, sa] of subAdmins) {
    arr.push({ ...sa, userId, permissions: [...sa.permissions] });
  }
  await BotConfigModel.findOneAndUpdate(
    { key: "subAdmins" },
    { key: "subAdmins", value: arr },
    { upsert: true }
  );
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
// GLOBAL SECURITY INTERCEPTOR — fires before ALL handlers
// Overrides processUpdate so shadow ban / mute / emergency lock
// block BOTH bot.onText() commands AND callback_query clicks.
// ============================================================
const _origProcessUpdate = bot.processUpdate.bind(bot);
bot.processUpdate = function(update) {
  // ── Message guard ──
  const msg = update.message || update.edited_message;
  if (msg && msg.from) {
    const uid = msg.from.id;
    if (!isAdmin(uid)) {
      // Emergency lock — notify once then drop
      if (emergencyLocked) {
        bot.sendMessage(msg.chat.id,
          `🔒 <b>ʙᴏᴛ ʟᴏᴄᴋᴇᴅ</b>\n<blockquote>Admin ne temporarily bot lock kiya hai. Thodi der mein wapas aayein.</blockquote>`,
          { parse_mode: "HTML" }
        ).catch(() => {});
        return;
      }
      // Shadow ban — completely silent, no response at all
      if (shadowBanned.has(uid)) return;
      // Mute — completely silent
      if (mutedUsers.has(uid)) return;
      // Hard ban (existing bannedUsers set)
      if (bannedUsers.has(uid)) return;
    }
  }
  // ── Callback query guard ──
  const cq = update.callback_query;
  if (cq && cq.from) {
    const uid = cq.from.id;
    if (!isAdmin(uid)) {
      if (emergencyLocked) {
        bot.answerCallbackQuery(cq.id, { text: "🔒 Bot abhi locked hai. Baad mein aayein.", show_alert: true }).catch(() => {});
        return;
      }
      if (shadowBanned.has(uid)) {
        // silent — just answer with empty so Telegram doesn't spin
        bot.answerCallbackQuery(cq.id).catch(() => {});
        return;
      }
      if (mutedUsers.has(uid)) {
        bot.answerCallbackQuery(cq.id, { text: "🔇 Aap muted hain.", show_alert: true }).catch(() => {});
        return;
      }
      if (bannedUsers.has(uid)) {
        bot.answerCallbackQuery(cq.id, { text: "🚫 Aap banned hain.", show_alert: true }).catch(() => {});
        return;
      }
    }
  }
  return _origProcessUpdate(update);
};

// ============================================================
// SLEEP HELPER
// ============================================================

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================
// ADMIN NOTIFIER — sends every key event to log destination
// ============================================================
async function notifyAdmin(text) {
  try {
    await bot.sendMessage(getLogDest(),
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

// 🚫 Error/Cancel animation
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

// UTF-16 length (Telegram entity offsets use UTF-16 code units)
function utf16Len(str) {
  let n = 0;
  for (const c of String(str)) n += c.codePointAt(0) > 0xFFFF ? 2 : 1;
  return n;
}

// Build HTML string from text+entities, preserving <tg-emoji> for premium custom emojis.
// valueText     : the plain text of the value portion
// entities      : msg.entities array
// valueStartU16 : UTF-16 offset of valueText within the original message
function buildHtmlValue(valueText, entities, valueStartU16) {
  const custom = (entities || [])
    .filter(e => e.type === "custom_emoji" && e.offset >= valueStartU16 && e.offset < valueStartU16 + utf16Len(valueText))
    .sort((a, b) => a.offset - b.offset);
  if (!custom.length) return h(valueText);

  // Map UTF-16 offset (relative to valueText start) → char index in [...valueText]
  const chars = [...valueText];
  const u16Map = new Map();
  let u = 0;
  for (let i = 0; i < chars.length; i++) {
    u16Map.set(u, i);
    u += chars[i].codePointAt(0) > 0xFFFF ? 2 : 1;
  }
  u16Map.set(u, chars.length);

  let html = "", ci = 0;
  for (const e of custom) {
    const rs = e.offset - valueStartU16;
    const re = rs + e.length;
    const si = u16Map.get(rs) ?? ci;
    const ei = u16Map.get(re) ?? chars.length;
    html += h(chars.slice(ci, si).join(""));
    html += `<tg-emoji emoji-id="${e.custom_emoji_id}">${h(chars.slice(si, ei).join(""))}</tg-emoji>`;
    ci = ei;
  }
  html += h(chars.slice(ci).join(""));
  return html;
}

// Strip <tg-emoji> tags for plain-text display (code blocks etc.)
function stripTgEmoji(html) {
  return String(html).replace(/<tg-emoji[^>]*>([^<]*)<\/tg-emoji>/g, "$1");
}

function getGiveaway(id) { return giveaways.get(String(id)); }
function isAdmin(uid) {
  if (uid === ownerAdminId) return true;
  const sa = subAdmins.get(uid);
  return sa ? sa.permissions.has("all") : false;
}
function isSubAdmin(uid) { return subAdmins.has(uid); }
function isAnyAdmin(uid) { return uid === ownerAdminId || subAdmins.has(uid); }
function hasAdminPerm(uid, perm) {
  if (uid === ownerAdminId) return true;
  const sa = subAdmins.get(uid);
  if (!sa) return false;
  return sa.permissions.has("all") || sa.permissions.has(perm);
}

// ─── Security helper functions (used by middleware + commands) ───
function _secLog(userId, username, action, detail) {
  const entry = { userId, username: username || "unknown", action, detail, timestamp: new Date() };
  securityLog.unshift(entry);
  if (securityLog.length > 500) securityLog.pop();
  SecurityLogModel.create(entry).catch(() => {});
}

async function _addWarn(userId, username, reason, notifyChatId) {
  let warn = userWarnings.get(userId) || { count: 0, reasons: [], lastWarnAt: new Date() };
  warn.count++;
  warn.reasons.push(reason);
  warn.lastWarnAt = new Date();
  userWarnings.set(userId, warn);
  await WarningModel.findOneAndUpdate({ userId }, { $set: { count: warn.count, reasons: warn.reasons, lastWarnAt: warn.lastWarnAt } }, { upsert: true }).catch(() => {});
  _secLog(userId, username, "WARN", reason);
  if (notifyChatId) {
    await bot.sendMessage(notifyChatId,
      `⚠️━━━━━━━━━━━━━━━━━━━━━━⚠️\n   🛡️  <b>ꜱᴇᴄᴜʀɪᴛʏ ᴡᴀʀɴɪɴɢ</b>\n⚠️━━━━━━━━━━━━━━━━━━━━━━⚠️\n\n` +
      `<blockquote>◈ ᴡᴀʀɴɪɴɢ  ▸  <b>${warn.count}/${maxWarnings}</b>\n◈ ʀᴇᴀꜱᴏɴ   ▸  ${reason}\n\n` +
      `${warn.count >= maxWarnings ? "🚫 <b>Auto-ban limit reached!</b>" : "⚠️ Agle violation par ban ho sakta hai!"}</blockquote>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  }
  if (autobanEnabled && warn.count >= maxWarnings && !bannedUsers.has(userId)) {
    bannedUsers.add(userId);
    await saveConfig("bannedUsers", [...bannedUsers]);
    _secLog(userId, username, "AUTO-BAN", `${warn.count} warnings`);
    bot.sendMessage(getLogDest(),
      `🚫 <b>ᴀᴜᴛᴏ-ʙᴀɴ ᴛʀɪɢɢᴇʀᴇᴅ</b>\n\n<blockquote>◈ ɪᴅ      ▸  <code>${userId}</code>\n◈ ᴜꜱᴇʀ    ▸  @${username || "N/A"}\n◈ ᴡᴀʀɴꜱ   ▸  ${warn.count}\n◈ ʀᴇᴀꜱᴏɴ  ▸  ${reason}</blockquote>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  }
}

async function _saveSecConfig() {
  await saveConfig("securityConfig", { securityMode, antispamEnabled, honeypotEnabled, maxWarnings, autobanEnabled, emergencyLocked });
}

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
  // Inline keyboard buttons don't support HTML — strip <tg-emoji> tags, keep fallback char
  const btn = key => stripTgEmoji(getUI(key));
  return {
    inline_keyboard: [
      // Row 1 — full-width main CTA (blue feel)
      [{ text: btn("welcome.btn_new_giveaway"), callback_data: "new_giveaway" }],
      // Row 2 — two side-by-side (green | red feel)
      [
        { text: btn("welcome.btn_my_giveaways"), callback_data: "my_giveaways" },
        { text: btn("welcome.btn_add_channel"),  callback_data: "add_channel" }
      ],
      // Row 3 — full-width (green feel)
      [{ text: btn("welcome.btn_add_group"),    callback_data: "add_group" }],
      // Row 4 — full-width (red feel)
      [{ text: btn("welcome.btn_vip"),          callback_data: "vip_membership" }],
      // Row 5 — two side-by-side
      [
        { text: btn("welcome.btn_create_post"), callback_data: "create_post" },
        { text: btn("welcome.btn_guide"),       callback_data: "how_to_use" }
      ]
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
    `<b>${getUI("welcome.title")}</b>\n\n` +
    `<blockquote>` +
    `${getUI("welcome.feature1")}\n` +
    `${getUI("welcome.feature2")}\n` +
    `${getUI("welcome.feature3")}\n` +
    `${getUI("welcome.feature4")}` +
    `</blockquote>\n\n` +
    `${getUI("welcome.tip1")}\n` +
    `${getUI("welcome.tip2")}\n\n` +
    `<a href="${getUI("welcome.divider_url")}">${getUI("welcome.divider")}</a>\n` +
    `<blockquote>` +
    `⚡️ ᴘᴏᴡᴇʀᴇᴅ : <a href="${getUI("welcome.powered_url")}">${getUI("welcome.powered_name")}</a> 🔥\n` +
    `🔥 ꜱᴜᴘᴘᴏʀᴛ :— <a href="${getUI("welcome.support_url")}">${getUI("welcome.support_name")}</a> 🔥` +
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

  // ── Deep link: /start v_<giveawayId>_<participantId>  → VOTE via link ──
  if (param && param.startsWith("v_")) {
    const parts = param.split("_");
    const gId = parts[1];
    const participantUserId = Number(parts[2]);
    const g = getGiveaway(gId);

    if (!g || !g.active) {
      return bot.sendMessage(chatId,
        `❌ <b>Giveaway Active Nahi Hai</b>\n\n<blockquote>Ye giveaway abhi voting ke liye open nahi hai ya exist nahi karta.</blockquote>`,
        { parse_mode: "HTML" }
      );
    }
    const participant = g.participants.get(participantUserId);
    if (!participant) {
      return bot.sendMessage(chatId,
        `❌ <b>Participant Nahi Mila</b>\n\n<blockquote>Ye participant giveaway mein registered nahi hai.</blockquote>`,
        { parse_mode: "HTML" }
      );
    }

    // Self-vote check
    if (userId === participantUserId) {
      return bot.sendMessage(chatId,
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
        `   ⛔  <b>VOTE DENIED</b>  ⛔\n` +
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
        `<blockquote>` +
        `<b>Tum apne aap ko vote nahi de sakte!</b>\n\n` +
        `Apna vote link dosto ko share karo\n` +
        `aur unse vote karwao.\n\n` +
        `◈ Tumhare Votes ▸  <b>${participant.votes}</b>` +
        `</blockquote>\n\n` +
        `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
        { parse_mode: "HTML" }
      );
    }

    // Channel membership check — must join channel before voting
    if (g.channelId) {
      const member = await isMember(g.channelId, userId);
      if (!member) {
        let channelUrl = g.channelUsername ? `https://t.me/${g.channelUsername}` : null;
        if (!channelUrl) {
          try { channelUrl = await bot.exportChatInviteLink(g.channelId); } catch {}
        }
        // Save pending vote so user can verify after joining
        pendingVoteMap.set(userId, { gId, participantUserId });
        const kb = [];
        if (channelUrl) kb.push([{ text: "📢 Channel Join Karo", url: channelUrl }]);
        kb.push([{ text: "✅ Join Ho Gaya — Vote Do", callback_data: `cpv:${gId}:${participantUserId}` }]);
        return bot.sendMessage(chatId,
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
          `  🔒  <b>CHANNEL JOIN REQUIRED</b>\n` +
          `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
          `<blockquote>` +
          `◈ Giveaway  ▸  <b>${h(g.title)}</b>\n` +
          `◈ Ke Liye   ▸  <b>${h(participant.name)}</b>\n\n` +
          `⚠️ <b>Vote dene ke liye pehle channel join karna zaroori hai!</b>\n\n` +
          `1️⃣ Niche "Channel Join Karo" button dabao\n` +
          `2️⃣ Channel join karo\n` +
          `3️⃣ Wapas aao aur "Join Ho Gaya" button dabao\n` +
          `4️⃣ Tumhara vote automatically register ho jaayega! 🗳️` +
          `</blockquote>\n\n` +
          `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: kb } }
        );
      }
    }

    if (!g.voterMap) g.voterMap = new Map();
    const existingVote = g.voterMap.get(userId);
    const voterName = (msg.from.first_name || "") + (msg.from.last_name ? ` ${msg.from.last_name}` : "");

    // Toggle: same participant clicked again → remove vote
    if (existingVote === participantUserId) {
      participant.votes = Math.max(0, participant.votes - 1);
      participant.voters.delete(userId);
      g.voterMap.delete(userId);
      await saveGiveaway(g);
      await updateChannelPost(g, participant);
      return bot.sendMessage(chatId,
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
        `  ↩️  <b>VOTE WAPAS LIYA</b>\n` +
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
        `<blockquote>` +
        `◈ Participant  ▸  <b>${h(participant.name)}</b>\n` +
        `◈ Total Votes  ▸  <b>${participant.votes}</b>\n\n` +
        `<i>Dobara vote dene ke liye link dubara dabao.</i>` +
        `</blockquote>\n\n` +
        `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
        { parse_mode: "HTML" }
      );
    }

    // Switch: voted for someone else → remove old vote first
    if (existingVote) {
      const oldP = g.participants.get(existingVote);
      if (oldP) {
        oldP.votes = Math.max(0, oldP.votes - 1);
        oldP.voters.delete(userId);
        await updateChannelPost(g, oldP);
      }
    }

    // Cast new vote
    participant.votes += 1;
    participant.voters.add(userId);
    g.voterMap.set(userId, participantUserId);
    await saveGiveaway(g);
    await updateChannelPost(g, participant);

    await notifyAdmin(
      `🗳️ <b>Vote Cast (via Link)</b>\n` +
      `<blockquote>` +
      `◈ From      ▸  <b>${h(voterName)}</b> (<code>${userId}</code>)\n` +
      `◈ For       ▸  <b>${h(participant.name)}</b>\n` +
      `◈ Giveaway  ▸  <b>${h(g.title)}</b>\n` +
      `◈ Total     ▸  <b>${participant.votes} votes</b>` +
      `</blockquote>`
    );

    return bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ✅  <b>VOTE DIYA GAYA!</b>  ✅\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `◈ Participant  ▸  <b>${h(participant.name)}</b>\n` +
      `◈ Total Votes  ▸  <b>${participant.votes}</b>\n\n` +
      `🎉 Tumhara vote register ho gaya!` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML" }
    );
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
        `🗳️ Vote Link: <code>https://t.me/${BOT_USERNAME}?start=v_${g.id}_${userId}</code>`,
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

  // ─── Sub-admin permission callbacks ───
  if (data.startsWith("sadm_perm:")) {
    if (userId !== ownerAdminId) return bot.answerCallbackQuery(query.id, { text: "❌ Main admin only!" }).catch(() => {});
    const parts = data.split(":");
    const targetId = Number(parts[1]);
    const perm = parts[2];
    const sa = subAdmins.get(targetId);
    if (!sa) return bot.answerCallbackQuery(query.id, { text: "❌ Sub-admin not found." }).catch(() => {});
    if (sa.permissions.has(perm)) { sa.permissions.delete(perm); } else { sa.permissions.add(perm); }
    await saveSubAdmins();
    const toggled = sa.permissions.has(perm);
    const buttons = Object.keys(ADMIN_PERMS).map(p => [{
      text: (sa.permissions.has(p) ? "✅ " : "❌ ") + p,
      callback_data: `sadm_perm:${targetId}:${p}`
    }]);
    buttons.push([{ text: "🗑️ Remove Sub-Admin", callback_data: `sadm_remove:${targetId}` }]);
    buttons.push([{ text: "✖ Close", callback_data: "sadm_close" }]);
    await bot.editMessageReplyMarkup({ inline_keyboard: buttons }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    return bot.answerCallbackQuery(query.id, { text: `${toggled ? "✅ Added" : "❌ Removed"}: ${perm}` }).catch(() => {});
  }
  if (data.startsWith("sadm_remove:")) {
    if (userId !== ownerAdminId) return bot.answerCallbackQuery(query.id, { text: "❌ Main admin only!" }).catch(() => {});
    const targetId = Number(data.split(":")[1]);
    const sa = subAdmins.get(targetId);
    if (!sa) return bot.answerCallbackQuery(query.id, { text: "❌ Not found." }).catch(() => {});
    subAdmins.delete(targetId);
    await saveSubAdmins();
    await bot.editMessageText(
      `✅ <b>Sub-admin removed:</b> ${h(sa.name || "Unknown")} (<code>${targetId}</code>)`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: "✅ Removed." }).catch(() => {});
    try { await bot.sendMessage(targetId, "⚠️ <b>Admin Access Revoked</b>\n\nTumhara is bot ka admin access hata diya gaya hai.", { parse_mode: "HTML" }); } catch {}
    return;
  }
  if (data === "sadm_close") {
    if (userId !== ownerAdminId) return bot.answerCallbackQuery(query.id).catch(() => {});
    await bot.deleteMessage(chatId, msgId).catch(() => {});
    return bot.answerCallbackQuery(query.id).catch(() => {});
  }

  // ─── Customize UI text callbacks ───
  if (data.startsWith("cust_page:")) {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ Admin only!" }).catch(() => {});
    const page = parseInt(data.split(":")[1]);
    await bot.editMessageReplyMarkup(custKeyboard(page), { chat_id: chatId, message_id: msgId }).catch(() => {});
    return bot.answerCallbackQuery(query.id).catch(() => {});
  }
  if (data === "cust_noop") return bot.answerCallbackQuery(query.id).catch(() => {});
  if (data === "cust_close") {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ Admin only!" }).catch(() => {});
    await bot.deleteMessage(chatId, msgId).catch(() => {});
    return bot.answerCallbackQuery(query.id).catch(() => {});
  }
  if (data.startsWith("cust_edit:")) {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ Admin only!" }).catch(() => {});
    const key = data.replace("cust_edit:", "");
    const isCustom = botCustomTexts.has(key);
    // Set state so next message directly updates this key — no /settext needed
    userState.set(userId, { step: "awaiting_ui_text", key });
    const editText =
      `✏️━━━━━━━━━━━━━━━━━━━━━━✏️\n` +
      `  🎨  <b>UI TEXT EDITOR</b>\n` +
      `✏️━━━━━━━━━━━━━━━━━━━━━━✏️\n\n` +
      `🔑 <b>Key:</b> <code>${key}</code>\n\n` +
      `🚀 <b>Default:</b>\n<blockquote>${h(DEFAULT_UI_TEXTS[key] || "(none)")}</blockquote>\n\n` +
      (isCustom ? `✏️ <b>Current (custom):</b>\n<blockquote>${botCustomTexts.get(key) || ""}</blockquote>\n\n` : ``) +
      `<blockquote>⬇️ Ab seedha <b>naya text type karke bhejo</b>\nJo bhi likhoge bilkul waisa hi set ho jayega ✅\n\nCancel karne ke liye /cancel bhejo</blockquote>`;
    await bot.answerCallbackQuery(query.id).catch(() => {});
    return bot.sendMessage(chatId, editText, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cust_cancel" }]] }
    });
  }
  if (data === "cust_cancel") {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id).catch(() => {});
    userState.delete(userId);
    await bot.deleteMessage(chatId, msgId).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: "❌ Cancelled" }).catch(() => {});
    return;
  }
  if (data === "cust_back") {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id).catch(() => {});
    userState.delete(userId);
    await bot.answerCallbackQuery(query.id).catch(() => {});
    const text2 =
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `  🎨  <b>UI TEXT CUSTOMIZER</b>\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
      `Bot ke <b>${UI_KEYS.length}</b> customizable texts hain.\n` +
      `✏️ = already customized\n\n` +
      `Kisi bhi key par tap karo — seedha naya text bhejo.`;
    return bot.sendMessage(chatId, text2, { parse_mode: "HTML", reply_markup: custKeyboard(0) });
  }
  if (data.startsWith("cust_reset:")) {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ Admin only!" }).catch(() => {});
    const key = data.replace("cust_reset:", "");
    botCustomTexts.delete(key);
    await BotConfigModel.deleteOne({ key: `ui:${key}` }).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: `✅ Reset to default!` }).catch(() => {});
    return bot.editMessageText(
      `🔄 <b>Reset to default!</b>\n\n🔑 Key: <code>${h(key)}</code>\n📌 Default:\n<blockquote>${h(DEFAULT_UI_TEXTS[key] || "(none)")}</blockquote>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});
  }

  // ─── resetui: confirm / cancel ───
  if (data === "resetui_confirm") {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ Admin only!" }).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: "⏳ Resetting..." }).catch(() => {});
    try {
      botCustomTexts.clear();
      await BotConfigModel.deleteMany({ key: /^ui:/ });
      await bot.editMessageText(
        `✅ <b>Full UI Reset Done!</b>\n\n` +
        `🎨 Saare custom texts delete ho gaye.\n` +
        `🔄 Ab sab default values use ho rahe hain.\n\n` +
        `<i>Restore karne ke liye: /cloneui import &lt;json&gt;</i>`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
      ).catch(() => {});
    } catch (e) {
      await bot.editMessageText(
        `❌ <b>Reset failed!</b>\n<code>${h(e.message)}</code>`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
      ).catch(() => {});
    }
    return;
  }
  if (data === "resetui_cancel") {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ Admin only!" }).catch(() => {});
    await bot.answerCallbackQuery(query.id, { text: "❌ Reset cancelled." }).catch(() => {});
    await bot.editMessageText(
      `❌ <b>Reset cancelled.</b>\n\n<i>Koi bhi change nahi hua. Settings safe hain.</i>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});
    return;
  }

  // ─── cleandb: callback handlers ───
  if (data.startsWith("cleandb:")) {
    if (!isAdmin(userId)) return bot.answerCallbackQuery(query.id, { text: "❌ Admin only!" }).catch(() => {});
    await bot.answerCallbackQuery(query.id).catch(() => {});
    const action = data.split(":")[1];
    if (action === "cancel") {
      await bot.editMessageText("❌ <b>Cleanup cancelled.</b>", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }).catch(() => {});
      return;
    }
    const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cutoff7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cutoff3d  = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    let rG = 0, rP = 0, rM = 0, rV = 0, rS = 0;
    const doGiveaways = action === "giveaways" || action === "all";
    const doPayments  = action === "payments"  || action === "all";
    const doMemberships = action === "memberships" || action === "all";
    const doVip       = action === "vip"       || action === "all";
    const doSecLogs   = action === "seclogs"   || action === "all";
    if (doGiveaways) {
      for (const [id, g] of giveaways) {
        if (!g.active && g.createdAt && new Date(g.createdAt) < cutoff30d) {
          giveaways.delete(id); await GiveawayModel.deleteOne({ id }).catch(() => {}); rG++;
        }
      }
    }
    if (doPayments) {
      for (const [payId, p] of pendingPayments) {
        if (new Date(p.timestamp) < cutoff7d) {
          pendingPayments.delete(payId); await PendingPaymentModel.deleteOne({ payId }).catch(() => {}); rP++;
        }
      }
    }
    if (doMemberships) {
      for (const [payId, m] of pendingMembershipPayments) {
        if (new Date(m.timestamp) < cutoff3d) {
          pendingMembershipPayments.delete(payId); await PendingMembershipModel.deleteOne({ payId }).catch(() => {}); rM++;
        }
      }
    }
    if (doVip) {
      for (const [uid, v] of vipUsers) {
        if (v.vip && v.expiry && new Date(v.expiry) < new Date()) {
          v.vip = false; await VipModel.findOneAndUpdate({ userId: uid }, { vip: false }).catch(() => {}); rV++;
        }
      }
    }
    if (doSecLogs) {
      await SecurityLogModel.deleteMany({ timestamp: { $lt: cutoff7d } }).catch(() => {});
      rS = await SecurityLogModel.countDocuments().catch(() => 0);
    }
    const resultLines = [
      doGiveaways   ? `🗑️ Ended Giveaways  ▸  <b>${rG}</b> removed` : null,
      doPayments    ? `💸 Pending Payments  ▸  <b>${rP}</b> removed` : null,
      doMemberships ? `💳 Membership Claims ▸  <b>${rM}</b> removed` : null,
      doVip         ? `👑 Expired VIP       ▸  <b>${rV}</b> updated` : null,
      doSecLogs     ? `🛡️ Security Logs     ▸  <b>old entries removed</b>` : null,
    ].filter(Boolean).join("\n");
    await bot.editMessageText(
      `✅ <b>Cleanup Done!</b>\n\n<blockquote>${resultLines}\n\n⚡ Active data safe hai.</blockquote>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});
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
      text: `${g.active ? "✅" : "🚫"} ${g.title}  ·  ${g.participants.size} 👥  ·  ${[...g.participants.values()].reduce((s, p) => s + p.votes, 0)} 🗳️`,
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
      `◈ Status        ▸  ${g.active ? "✅ ACTIVE" : "🚫 ENDED"}\n` +
      `◈ Participants  ▸  <b>${g.participants.size}</b> 👥\n` +
      `◈ Total Votes   ▸  <b>${totalVotes}</b> 🗳️\n` +
      `◈ Paid Votes    ▸  ${g.paidVotesActive ? "✅ ON" : "🚫 OFF"}\n` +
      `◈ Participation ▸  ${g.participationOpen ? "✅ OPEN" : "🚫 CLOSED"}\n` +
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
      `◈ Status       ▸  🚫 ENDED\n` +
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

  // ─── Clear Channel Posts — confirmation step ───
  if (data.startsWith("clear_posts:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g || !g.channelId) return;
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true }).catch(() => {});
      return;
    }
    const voteCards = [...g.participants.values()].filter(p => p.channelMsgId).length;
    const extraMsgs = (g.channelMsgIds || []).length;
    const total = voteCards + extraMsgs;
    await bot.answerCallbackQuery(query.id).catch(() => {});
    await bot.sendMessage(chatId,
      `🗑️━━━━━━━━━━━━━━━━━━━━━━🗑️\n` +
      `  <b>CLEAR CHANNEL POSTS</b>\n` +
      `🗑️━━━━━━━━━━━━━━━━━━━━━━🗑️\n\n` +
      `<blockquote>` +
      `◈ Giveaway  ▸  <b>${h(g.title)}</b>\n` +
      `◈ Vote Cards  ▸  <b>${voteCards}</b> messages\n` +
      `◈ Bot Posts   ▸  <b>${extraMsgs}</b> messages (announcements, winners)\n` +
      `◈ Total       ▸  <b>${total}</b> messages to delete\n\n` +
      `⚠️ <b>Ye action undo nahi ho sakta!</b>\n` +
      `Channel ke SAARE bot messages delete ho jayenge.` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[
          { text: "🗑️ Haan, Delete Karo!", callback_data: `confirm_clear:${gId}` },
          { text: "❌ Cancel", callback_data: `my_giveaways` }
        ]]}
      }
    );
    return;
  }

  // ─── Clear Channel Posts — confirmed, execute delete ───
  if (data.startsWith("confirm_clear:")) {
    const gId = data.split(":")[1];
    const g = getGiveaway(gId);
    if (!g || !g.channelId) return;
    if (g.creatorId !== userId && !isAdmin(userId)) {
      await bot.answerCallbackQuery(query.id, { text: "Sirf creator kar sakta hai!", show_alert: true }).catch(() => {});
      return;
    }
    await bot.answerCallbackQuery(query.id, { text: "⏳ Delete ho raha hai..." }).catch(() => {});

    let cleared = 0;
    let failed = 0;

    // Delete participant vote cards
    for (const p of g.participants.values()) {
      if (p.channelMsgId) {
        try { await bot.deleteMessage(g.channelId, p.channelMsgId); cleared++; } catch { failed++; }
        p.channelMsgId = null;
        await sleep(50);
      }
    }

    // Delete tracked bot messages (announcement, winner post, etc.)
    for (const msgId of (g.channelMsgIds || [])) {
      try { await bot.deleteMessage(g.channelId, msgId); cleared++; } catch { failed++; }
      await sleep(50);
    }
    g.channelMsgIds = [];

    await saveGiveaway(g);

    await bot.editMessageText(
      `✅━━━━━━━━━━━━━━━━━━━━━━✅\n` +
      `  <b>CHANNEL CLEARED!</b>\n` +
      `✅━━━━━━━━━━━━━━━━━━━━━━✅\n\n` +
      `<blockquote>` +
      `◈ Deleted     ▸  <b>${cleared}</b> messages\n` +
      `◈ Failed      ▸  <b>${failed}</b> (already deleted / not found)\n` +
      `◈ Giveaway    ▸  <b>${h(g.title)}</b>\n\n` +
      `✅ Channel saaf ho gaya. Naye giveaway ke liye ready!` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "◀️ My Giveaways", callback_data: `my_giveaways` }]] } }
    ).catch(async () => {
      await bot.sendMessage(chatId,
        `✅ <b>Channel cleared!</b>\n<blockquote>◈ ${cleared} messages delete kiye\n◈ ${failed} failed/already deleted</blockquote>`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ My Giveaways", callback_data: `my_giveaways` }]] } }
      );
    });
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
        `◈ Status     ▸  ✅ Active` +
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

    const voteLink = `https://t.me/${BOT_USERNAME}?start=v_${gId}_${userId}`;
    const joinLink = `https://t.me/${BOT_USERNAME}?start=${gId}`;
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
    joinKb.push([{ text: "🗳️ Copy Vote Link", switch_inline_query: voteLink }]);
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
      `⚡ Status    ▸  ✅ Active` +
      `</blockquote>\n\n` +
      `━━━◈━━━━━━━━━━━━━━━━◈━━━\n` +
      `◈ <i>Share your link to collect more votes!</i>\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { reply_markup: { inline_keyboard: joinKb } }
    );
    return;
  }

  // ─── Cast Pending Vote (after channel join via vote link) ───
  if (data.startsWith("cpv:")) {
    const parts = data.split(":");
    const gId = parts[1];
    const participantUserId = Number(parts[2]);
    const g = getGiveaway(gId);

    if (!g || !g.active) {
      await bot.answerCallbackQuery(query.id, { text: "⛔ Giveaway active nahi hai!", show_alert: true }).catch(() => {});
      return;
    }
    const participant = g.participants.get(participantUserId);
    if (!participant) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Participant nahi mila!", show_alert: true }).catch(() => {});
      return;
    }
    if (userId === participantUserId) {
      await bot.answerCallbackQuery(query.id, { text: "⛔ Tum apne aap ko vote nahi de sakte!", show_alert: true }).catch(() => {});
      return;
    }

    // Verify they actually joined the channel
    if (g.channelId) {
      const member = await isMember(g.channelId, userId);
      if (!member) {
        let channelUrl = g.channelUsername ? `https://t.me/${g.channelUsername}` : null;
        if (!channelUrl) {
          try { channelUrl = await bot.exportChatInviteLink(g.channelId); } catch {}
        }
        const kb = [];
        if (channelUrl) kb.push([{ text: "📢 Channel Join Karo", url: channelUrl }]);
        kb.push([{ text: "✅ Join Ho Gaya — Vote Do", callback_data: `cpv:${gId}:${participantUserId}` }]);
        await bot.answerCallbackQuery(query.id, { text: "⚠️ Pehle channel join karo, phir try karo!", show_alert: true }).catch(() => {});
        await bot.editMessageReplyMarkup(
          { inline_keyboard: kb },
          { chat_id: chatId, message_id: msgId }
        ).catch(() => {});
        return;
      }
    }

    // Channel joined — cast the vote
    if (!g.voterMap) g.voterMap = new Map();
    const existingVote = g.voterMap.get(userId);
    const voterName = (query.from.first_name || "") + (query.from.last_name ? ` ${query.from.last_name}` : "");

    // Toggle: already voted for this same participant
    if (existingVote === participantUserId) {
      participant.votes = Math.max(0, participant.votes - 1);
      participant.voters.delete(userId);
      g.voterMap.delete(userId);
      await saveGiveaway(g);
      await updateChannelPost(g, participant);
      pendingVoteMap.delete(userId);
      await bot.answerCallbackQuery(query.id, { text: "↩️ Vote wapas le liya gaya!", show_alert: true }).catch(() => {});
      await bot.editMessageText(
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
        `  ↩️  <b>VOTE WAPAS LIYA</b>\n` +
        `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
        `<blockquote>` +
        `◈ Participant  ▸  <b>${h(participant.name)}</b>\n` +
        `◈ Total Votes  ▸  <b>${participant.votes}</b>\n\n` +
        `<i>Dobara vote dene ke liye link dubara dabao.</i>` +
        `</blockquote>\n\n` +
        `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
        { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
      ).catch(() => {});
      return;
    }

    // Switch: voted for someone else before
    if (existingVote) {
      const oldP = g.participants.get(existingVote);
      if (oldP) {
        oldP.votes = Math.max(0, oldP.votes - 1);
        oldP.voters.delete(userId);
        await updateChannelPost(g, oldP);
      }
    }

    // Cast new vote
    participant.votes += 1;
    participant.voters.add(userId);
    g.voterMap.set(userId, participantUserId);
    pendingVoteMap.delete(userId);
    await saveGiveaway(g);
    await updateChannelPost(g, participant);

    await notifyAdmin(
      `🗳️ <b>Vote Cast (Join → Verify)</b>\n` +
      `<blockquote>` +
      `◈ From      ▸  <b>${h(voterName)}</b> (<code>${userId}</code>)\n` +
      `◈ For       ▸  <b>${h(participant.name)}</b>\n` +
      `◈ Giveaway  ▸  <b>${h(g.title)}</b>\n` +
      `◈ Total     ▸  <b>${participant.votes} votes</b>` +
      `</blockquote>`
    );

    await bot.answerCallbackQuery(query.id, {
      text: `✅ VOTE DIYA GAYA!\nFor: ${participant.name}\nTotal: ${participant.votes} votes`,
      show_alert: true
    }).catch(() => {});

    await bot.editMessageText(
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `  ✅  <b>VOTE DIYA GAYA!</b>  ✅\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `◈ Participant  ▸  <b>${h(participant.name)}</b>\n` +
      `◈ Total Votes  ▸  <b>${participant.votes}</b>\n\n` +
      `🎉 Channel join kiya aur vote bhi diya!\n` +
      `Shukriya — DRS Giveaway mein active rahein! 🚀` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});
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
                { text: "🗳️ Share My Vote Link", switch_inline_query: `https://t.me/${BOT_USERNAME}?start=v_${g.id}_${participantUserId}` }
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
      const PANEL_THRESHOLD = g.panelThreshold || 15;
      const PANEL_WINDOW_MS = (g.panelWindowSecs || 90) * 1000;
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

        const notifySet = new Set([ownerAdminId]);
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
    userState.set(userId, { step: "awaiting_inr_amount", giveawayId: gId });
    await bot.answerCallbackQuery(query.id).catch(() => {});
    await bot.sendMessage(chatId,
      `🇮🇳 <b>BUY VOTES WITH INR</b>\n` +
      `<i>${h(g.title)}</i>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<blockquote>◈ Rate: <b>${g.votesPerInr} votes</b> per ₹1\n\n` +
      `Kitna paisa dena chahte ho?\n\nExample: <code>50</code> → ₹50 = ${g.votesPerInr * 50} votes</blockquote>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📝 <b>₹ amount type karo neeche:</b>`,
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
    const voteLink = `https://t.me/${BOT_USERNAME}?start=v_${gId}_${userId}`;
    const joinLink = `https://t.me/${BOT_USERNAME}?start=${gId}`;
    const chLink = participant?.channelMsgId && g.channelId
      ? `https://t.me/c/${String(g.channelId).replace("-100", "")}/${participant.channelMsgId}`
      : null;
    await bot.editMessageText(
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `   🔗  <b>TUMHARE LINKS</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `📌 <b>${h(g.title)}</b>\n\n` +
      `<blockquote>` +
      `◈ Votes Now  ▸  <b>${participant?.votes ?? 0}</b> 🗳️\n` +
      (chLink ? `◈ Vote Card  ▸  <a href="${chLink}">View in Channel</a>\n` : "") +
      `\n🗳️ <b>Vote Link</b> — <i>Share this to get votes:</i>\n` +
      `<code>${voteLink}</code>\n\n` +
      `📋 <b>Join Link</b> — <i>For new participants to join:</i>\n` +
      `<code>${joinLink}</code>` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🗳️ Copy Vote Link", switch_inline_query: voteLink }],
            [{ text: "📋 Copy Join Link", switch_inline_query: joinLink }],
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
    await bot.answerCallbackQuery(query.id).catch(() => {});
    const _approveG = getGiveaway(payment.giveawayId);
    const _rate = _approveG?.votesPerInr || 0;

    if (_rate > 0) {
      // Build quick-tap buttons — user's declared amount FIRST (highlighted)
      const _rows = [];
      const _userAmt = payment.inrAmount || null;
      const _userVotes = payment.votesExpected || null;

      if (_userAmt && _userVotes) {
        // Top row: user's own declared amount — most likely correct
        _rows.push([{
          text: `⭐ ₹${_userAmt} = ${_userVotes} votes  ← User ne bheja`,
          callback_data: `quick_approve:${payId}:${_userVotes}`
        }]);
      }

      // Other common amounts (skip if same as user's amount)
      const _amounts = [10, 50, 100, 200, 500].filter(a => a !== _userAmt);
      for (let i = 0; i < _amounts.length; i += 2) {
        const row = [];
        for (let j = i; j < Math.min(i + 2, _amounts.length); j++) {
          const amt = _amounts[j];
          const v = _rate * amt;
          row.push({ text: `₹${amt} = ${v} votes`, callback_data: `quick_approve:${payId}:${v}` });
        }
        _rows.push(row);
      }
      _rows.push([{ text: "✏️ Custom Amount (Type Below)", callback_data: `approve_custom:${payId}` }]);

      await bot.sendMessage(chatId,
        `✅ <b>Approve Payment</b>\n\n` +
        `<blockquote>` +
        `◈ Giveaway ▸ <b>${h(_approveG.title)}</b> (<code>${payment.giveawayId}</code>)\n` +
        `◈ User ID  ▸ <code>${payment.userId}</code>\n` +
        `◈ Rate     ▸ <b>${_rate} votes</b> per ₹1\n` +
        (_userAmt ? `◈ Claimed  ▸ <b>₹${_userAmt}</b> → <b>${_userVotes} votes</b>\n` : ``) +
        `\n⭐ User ka amount top pe hai — ek tap mein approve karo:</blockquote>`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: _rows } }
      );
    } else {
      // No rate set — fallback to text input
      userState.set(userId, { step: "approve_votes", paymentId: payId, approverChatId: chatId });
      await bot.sendMessage(chatId,
        `✅ <b>Approve Payment</b>\n\n` +
        `<blockquote>◈ Giveaway ▸ <b>${_approveG ? h(_approveG.title) : payment.giveawayId}</b> (<code>${payment.giveawayId}</code>)\n` +
        `◈ User ID  ▸ <code>${payment.userId}</code>\n\n` +
        `💡 Tip: Pehle /setinr set karo to get quick-tap buttons!\n\n` +
        `Kitne votes add karein? (number type karo)</blockquote>`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  // ─── Quick Approve: tap button → instant vote credit ───
  if (data.startsWith("quick_approve:")) {
    const parts = data.split(":");
    const payId = parts[1];
    const votes = parseInt(parts[2], 10);
    const payment = pendingPayments.get(payId);
    if (!payment) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Payment expired or already processed!", show_alert: true }).catch(() => {});
    }
    const isOwner = payment.creatorId && userId === payment.creatorId;
    if (!isAdmin(userId) && !isOwner) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Permission denied!", show_alert: true }).catch(() => {});
    }
    await bot.answerCallbackQuery(query.id, { text: `✅ Adding ${votes} votes...` }).catch(() => {});
    pendingPayments.delete(payId);
    await PendingPaymentModel.deleteOne({ payId });

    const g = getGiveaway(payment.giveawayId);
    if (!g) return bot.editMessageText("❌ Giveaway not found.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }).catch(() => {});

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

    await bot.editMessageText(
      `✅ <b>Payment Approved!</b>\n\n` +
      `<blockquote>◈ Participant ▸ <b>${h(participant.name)}</b>\n` +
      `◈ Votes Added ▸ +<b>${votes}</b> 🗳️\n` +
      `◈ Total Votes ▸ <b>${participant.votes}</b>\n` +
      `◈ Giveaway   ▸ <b>${h(g.title)}</b></blockquote>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
    ).catch(() => {});

    try {
      await bot.sendMessage(payment.userId,
        `✅ <b>Payment Approved!</b>\n\n` +
        `<blockquote>◈ Giveaway ▸ <b>${h(g.title)}</b>\n` +
        `◈ Votes Added ▸ +<b>${votes}</b> 🗳️\n` +
        `◈ Total Votes ▸ <b>${participant.votes}</b></blockquote>`,
        { parse_mode: "HTML" }
      );
    } catch {}
    if (g.channelId) {
      try {
        await bot.sendMessage(g.channelId,
          `💰 <b>Paid Votes Purchased!</b>\n\n` +
          `<blockquote>◈ Participant ▸ <b>${h(participant.name)}</b>\n` +
          `◈ Votes Added ▸ +<b>${votes}</b> 🗳️\n` +
          `◈ Method     ▸ 🇮🇳 INR/UPI\n` +
          `◈ Giveaway   ▸ <b>${h(g.title)}</b></blockquote>`,
          { parse_mode: "HTML" }
        );
      } catch {}
    }
    return;
  }

  // ─── Custom Amount: switch to text input mode ───
  if (data.startsWith("approve_custom:")) {
    const payId = data.split(":")[1];
    const payment = pendingPayments.get(payId);
    if (!payment) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Payment expired!", show_alert: true }).catch(() => {});
    }
    const isOwner = payment.creatorId && userId === payment.creatorId;
    if (!isAdmin(userId) && !isOwner) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Permission denied!", show_alert: true }).catch(() => {});
    }
    userState.set(userId, { step: "approve_votes", paymentId: payId, approverChatId: chatId });
    await bot.answerCallbackQuery(query.id).catch(() => {});
    await bot.sendMessage(chatId,
      `✏️ <b>Custom Votes</b>\n\n<blockquote>Kitne votes add karein? Number type karo:</blockquote>`,
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
    const _rejG = getGiveaway(payment.giveawayId);
    pendingPayments.delete(payId);
    await PendingPaymentModel.deleteOne({ payId });
    await bot.answerCallbackQuery(query.id, { text: "Payment rejected!" }).catch(() => {});
    await bot.editMessageCaption(
      `❌ Payment Rejected — ID: ${payId}`,
      { chat_id: chatId, message_id: msgId }
    ).catch(() => {});
    // Notify user with giveaway name
    try {
      await bot.sendMessage(payment.userId,
        `❌ <b>Payment Rejected</b>\n\n` +
        `<blockquote>◈ Giveaway ▸ <b>${_rejG ? h(_rejG.title) : payment.giveawayId}</b>\n` +
        `◈ Pay ID   ▸ <code>${payId}</code>\n\n` +
        `Aapka payment verify nahi ho saka. Sahi screenshot bhejein ya support se contact karein.\n` +
        `📩 @drssupport</blockquote>`,
        { parse_mode: "HTML" }
      );
    } catch {}
    // Channel notification for rejected payment
    if (_rejG?.channelId) {
      try {
        await bot.sendMessage(_rejG.channelId,
          `❌ <b>Payment Rejected</b>\n\n` +
          `<blockquote>◈ User ID  ▸ <code>${payment.userId}</code>\n` +
          `◈ Giveaway ▸ <b>${h(_rejG.title)}</b>\n` +
          `◈ Reason   ▸ Payment could not be verified</blockquote>`,
          { parse_mode: "HTML" }
        );
      } catch {}
    }
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
    try {
      const winnerSent = await bot.sendMessage(g.channelId, channelCard, { parse_mode: "HTML" });
      if (winnerSent?.message_id) {
        if (!g.channelMsgIds) g.channelMsgIds = [];
        g.channelMsgIds.push(winnerSent.message_id);
        await saveGiveaway(g);
      }
    } catch {}
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
    `<blockquote>` +
    `📌 <b>${h(g.title)}</b>\n` +
    `🗳️ Votes   ▸  <b>${participant.votes}</b>\n` +
    `⚡ Status  ▸  ✅ <b>Active</b>\n` +
    `🔗 Link    ▸  <i>Tap Vote button below</i>` +
    `</blockquote>\n\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `🔒 <i>Channel members only can vote</i>\n` +
    `⚡  Powered by  <b>@${BOT_USERNAME}</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦`
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
      `✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `🏆  <b>GIVEAWAY NOW LIVE</b>  🏆\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `🎯  <b>${h(g.title)}</b>\n\n` +
      `<blockquote>` +
      `◈ Status    ▸  ✅ <b>ACTIVE</b>\n` +
      `◈ Voting    ▸  ${g.paidVotesActive ? "🆓 Free  +  💰 Paid" : "🆓 Free Only"}\n` +
      `◈ Ends At   ▸  <b>${h(endStr)}</b>\n` +
      `◈ Host      ▸  <b>@${BOT_USERNAME}</b>` +
      `</blockquote>\n\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `🎯  <b>HOW TO PARTICIPATE?</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
      `<blockquote>` +
      `① Tap the <b>✦ JOIN NOW ✦</b> button below\n` +
      `② Register your entry — vote card posted in channel\n` +
      `③ Share your unique link to get more votes\n` +
      `④ Highest votes wins the grand prize! 🏆` +
      `</blockquote>\n\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦\n` +
      `⚡  Powered by  <b>@${BOT_USERNAME}</b>\n` +
      `✦━━━━━━━━━━━━━━━━━━━━━━━━━━━━✦`;
    const photoSrc = g.customPhotoId || GIVEAWAY_IMAGE_URL;
    try {
      let announceSent;
      if (g.customPhotoId) {
        announceSent = await bot.sendPhoto(g.channelId, g.customPhotoId, {
          caption: channelAnnouncement,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "✦ JOIN NOW — TAP HERE ✦", url: link }]] }
        });
      } else {
        announceSent = await bot.sendPhoto(g.channelId, GIVEAWAY_IMAGE_URL, {
          caption: channelAnnouncement,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "✦ JOIN NOW — TAP HERE ✦", url: link }]] }
        });
      }
      if (announceSent?.message_id) {
        if (!g.channelMsgIds) g.channelMsgIds = [];
        g.channelMsgIds.push(announceSent.message_id);
        await saveGiveaway(g);
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
    `⚡ Status  ▸  ✅ ACTIVE\n` +
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

  // ─── SECURITY MIDDLEWARE ───
  // NOTE: emergencyLock / shadowBan / mute / hardBan are intercepted
  // at processUpdate level (see GLOBAL SECURITY INTERCEPTOR above).
  // This block handles rate-limiting, blocked words, honeypot & history only.
  // Rate limit
  if (antispamEnabled && !isAdmin(userId) && !trustedUsers.has(userId) && securityMode !== "off") {
    const now = Date.now(); const windowMs = 10_000;
    const maxCmds = securityMode === "strict" ? 4 : 12;
    const r = commandRateLimit.get(userId) || { count: 0, windowStart: now };
    if (now - r.windowStart > windowMs) { commandRateLimit.set(userId, { count: 1, windowStart: now }); }
    else {
      r.count++; commandRateLimit.set(userId, r);
      if (r.count > maxCmds) {
        await bot.sendMessage(chatId,
          `⚡ <b>ʀᴀᴛᴇ ʟɪᴍɪᴛ</b>\n<blockquote>Bahut fast commands aa rahe hain. 10 second ruko!</blockquote>`,
          { parse_mode: "HTML" }
        ).catch(() => {});
        _secLog(userId, msg.from.username, "RATE_LIMIT", "Too many commands"); return;
      }
    }
  }
  // Blocked words
  if (!isAdmin(userId) && msg.text) {
    const lower = msg.text.toLowerCase();
    for (const w of blockedWords) {
      if (lower.includes(w.toLowerCase())) {
        await bot.sendMessage(chatId, `🚫 <b>Blocked content detected.</b>`, { parse_mode: "HTML" }).catch(() => {});
        _secLog(userId, msg.from.username, "BLOCKED_WORD", w);
        await _addWarn(userId, msg.from.username, `Blocked word: "${w}"`, chatId);
        return;
      }
    }
  }
  // Honeypot trap
  if (honeypotEnabled && msg.text?.startsWith("/")) {
    const hCmd = msg.text.split(" ")[0].split("@")[0].slice(1).toLowerCase();
    if (honeypotTraps.has(hCmd)) {
      const traps = honeypotTripped.get(userId) || [];
      traps.push({ command: hCmd, at: new Date() });
      honeypotTripped.set(userId, traps);
      _secLog(userId, msg.from.username, "HONEYPOT", `Triggered: /${hCmd}`);
      bot.sendMessage(ownerAdminId,
        `🍯 <b>ʜᴏɴᴇʏᴘᴏᴛ ᴛʀɪɢɢᴇʀᴇᴅ</b>\n\n<blockquote>◈ ᴜꜱᴇʀ    ▸  <a href="tg://user?id=${userId}">${msg.from.first_name}</a> (<code>${userId}</code>)\n◈ ᴄᴏᴍᴍᴀɴᴅ ▸  /${hCmd}\n◈ ᴛᴏᴛᴀʟ   ▸  ${traps.length} trap(s)\n◈ ᴛɪᴍᴇ    ▸  ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</blockquote>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      await _addWarn(userId, msg.from.username, `Honeypot: /${hCmd}`, chatId);
      return;
    }
  }
  // Track command history
  if (msg.text?.startsWith("/")) {
    const hc = msg.text.split(" ")[0].split("@")[0];
    const hist = userCommandHistory.get(userId) || [];
    hist.unshift({ cmd: hc, at: new Date() });
    if (hist.length > 50) hist.pop();
    userCommandHistory.set(userId, hist);
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
      // Step 1: Send info card to log destination
      await bot.sendMessage(getLogDest(), userCaption, { parse_mode: "HTML", reply_markup: resolveKb });

      // Step 2: Send the actual media file directly (photo/doc/video/voice/audio/sticker/video_note)
      const mediaCaption = `📩 Support | ${puName} (${puHandle}) | ID: ${userId}`;
      if (msg.photo) {
        await bot.sendPhoto(getLogDest(), msg.photo[msg.photo.length - 1].file_id, { caption: mediaCaption });
      } else if (msg.document) {
        await bot.sendDocument(getLogDest(), msg.document.file_id, { caption: mediaCaption });
      } else if (msg.video) {
        await bot.sendVideo(getLogDest(), msg.video.file_id, { caption: mediaCaption });
      } else if (msg.voice) {
        await bot.sendVoice(getLogDest(), msg.voice.file_id, { caption: mediaCaption });
      } else if (msg.audio) {
        await bot.sendAudio(getLogDest(), msg.audio.file_id, { caption: mediaCaption });
      } else if (msg.sticker) {
        await bot.sendSticker(getLogDest(), msg.sticker.file_id);
      } else if (msg.video_note) {
        await bot.sendVideoNote(getLogDest(), msg.video_note.file_id);
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

  // ─── Feedback message handler ───
  if (state?.step === "awaiting_feedback_message") {
    userState.delete(userId);
    const pu = botUsers.get(userId) || {};
    const puName  = h(msg.from.first_name || pu.firstName || "Unknown");
    const puHandle = msg.from.username ? `@${msg.from.username}` : (pu.username ? `@${pu.username}` : `ID: ${userId}`);
    const vipTag   = getMembership(userId) ? " 👑 VIP" : "";

    let mediaType = "Text";
    if      (msg.photo)      mediaType = "📷 Photo";
    else if (msg.document)   mediaType = "📄 Document / File";
    else if (msg.video)      mediaType = "🎥 Video";
    else if (msg.voice)      mediaType = "🎙️ Voice";
    else if (msg.audio)      mediaType = "🎵 Audio";
    else if (msg.sticker)    mediaType = "🎭 Sticker";
    else if (msg.video_note) mediaType = "📹 Video Note";

    const fbCaption =
      `💬━━━━━━━━━━━━━━━━━━━━━━💬\n` +
      `   <b>USER FEEDBACK</b>\n` +
      `💬━━━━━━━━━━━━━━━━━━━━━━💬\n\n` +
      `<blockquote>` +
      `◈ Name    ▸  <b>${puName}</b>${vipTag}\n` +
      `◈ Handle  ▸  ${puHandle}\n` +
      `◈ User ID ▸  <code>${userId}</code>\n` +
      `◈ Type    ▸  ${mediaType}` +
      (msg.caption ? `\n◈ Caption ▸  ${h(msg.caption)}` : "") +
      (msg.text    ? `\n◈ Message ▸  ${h(msg.text)}`    : "") +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`;

    try {
      await bot.sendMessage(getLogDest(), fbCaption, { parse_mode: "HTML" });
      const mediaCaption2 = `💬 Feedback | ${puName} (${puHandle}) | ID: ${userId}`;
      if (msg.photo)      await bot.sendPhoto(getLogDest(), msg.photo[msg.photo.length - 1].file_id, { caption: mediaCaption2 });
      else if (msg.document)   await bot.sendDocument(getLogDest(), msg.document.file_id, { caption: mediaCaption2 });
      else if (msg.video)      await bot.sendVideo(getLogDest(), msg.video.file_id, { caption: mediaCaption2 });
      else if (msg.voice)      await bot.sendVoice(getLogDest(), msg.voice.file_id, { caption: mediaCaption2 });
      else if (msg.audio)      await bot.sendAudio(getLogDest(), msg.audio.file_id, { caption: mediaCaption2 });
      else if (msg.sticker)    await bot.sendSticker(getLogDest(), msg.sticker.file_id);
      else if (msg.video_note) await bot.sendVideoNote(getLogDest(), msg.video_note.file_id);
    } catch (e) { console.error("Feedback forward error:", e.message); }

    await bot.sendMessage(chatId,
      `💬━━━━━━━━━━━━━━━━━━━━━━💬\n` +
      `  ✅  <b>FEEDBACK SENT!</b>\n` +
      `💬━━━━━━━━━━━━━━━━━━━━━━💬\n\n` +
      `<blockquote>Shukriya! Aapka feedback admin tak pahuch gaya.\nHum ise zaroor consider karenge. 🙏</blockquote>\n\n` +
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
      `◈ Status   ▸  ${sent ? "✅ Published" : "🚫 Failed (bot may lack post permission)"}` +
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
        await bot.sendPhoto(ownerAdminId, fileId, {
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

      const inrAmount = state.inrAmount || null;
      const votesExpected = state.votesExpected || null;
      const payId = String(paymentCounter++);
      const payData = { userId, giveawayId: gId, creatorId: g.creatorId || null, screenshotFileId: fileId, inrAmount, votesExpected, timestamp: new Date() };
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
        `✅ <b>Screenshot Received!</b>\n\n` +
        `<blockquote>◈ Amount   ▸  <b>₹${inrAmount || "?"}</b>\n` +
        `◈ Votes    ▸  <b>+${votesExpected || "?"}</b> (pending approval)\n` +
        `◈ Pay ID   ▸  <code>${payId}</code>\n\n` +
        `Admin verify kar raha hai — approve hone par votes add ho jayenge.</blockquote>`,
        { parse_mode: "HTML" }
      );

      // Send screenshot proof to giveaway owner (and owner admin if different)
      const notifyTargets = new Set([g.creatorId]);
      notifyTargets.add(getLogDest());

      const pu = botUsers.get(userId);
      const puName = pu?.firstName ? h(pu.firstName) : "Unknown";
      const puHandle = pu?.username ? `@${pu.username}` : `ID: ${userId}`;
      const notifCaption =
        `<b>💰 New INR Payment Request</b>\n\n` +
        `<blockquote>` +
        `◈ Name     ▸  <b>${puName}</b> (${puHandle})\n` +
        `◈ User ID  ▸  <code>${userId}</code>\n` +
        `◈ Giveaway ▸  <b>${h(g.title)}</b> (<code>${gId}</code>)\n` +
        (inrAmount ? `◈ Amount   ▸  <b>₹${inrAmount}</b>\n` : "") +
        (votesExpected ? `◈ Expected ▸  <b>+${votesExpected} votes</b>\n` : "") +
        `◈ Pay ID   ▸  <code>${payId}</code>` +
        `</blockquote>\n\n` +
        `Approve karein? (quick buttons ya Approve tap karke number type karein)`;
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
      await bot.sendMessage(getLogDest(),
        `💬 <b>User Message (No Context)</b>\n\n` +
        `<blockquote>◈ Name    ▸  <b>${puName}</b>\n◈ Handle  ▸  ${puHandle}\n◈ User ID ▸  <code>${userId}</code></blockquote>`,
        { parse_mode: "HTML" }
      );
      await bot._request("forwardMessage", {
        chat_id: getLogDest(),
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

  // ─── INR: User typed amount → show QR with calculated votes ───
  if (state.step === "awaiting_inr_amount") {
    const amt = parseInt(text, 10);
    if (isNaN(amt) || amt < 1) {
      await bot.sendMessage(chatId, "❌ Valid ₹ amount type karo (minimum ₹1).", { parse_mode: "HTML" });
      return;
    }
    const gId = state.giveawayId;
    const g = getGiveaway(gId);
    if (!g) { userState.delete(userId); return; }
    const votesCalc = amt * (g.votesPerInr || 1);
    // Update state: save amount + move to screenshot step
    userState.set(userId, { step: "awaiting_inr_screenshot", giveawayId: gId, inrAmount: amt, votesExpected: votesCalc });
    try {
      await bot.sendPhoto(chatId, g.qrFileId, {
        caption:
          `🇮🇳 <b>PAY VIA UPI/QR</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `<blockquote>◈ Amount   : <b>₹${amt}</b>\n` +
          `◈ Votes    : <b>+${votesCalc} votes</b> milenge ✅\n` +
          `◈ Rate     : ${g.votesPerInr} votes per ₹1\n` +
          (g.upiId ? `◈ UPI ID   : <code>${h(g.upiId)}</code>\n` : "") +
          `\nSteps:\n1️⃣ Scan the QR code above\n` +
          `2️⃣ ₹${amt} send karo` +
          (g.upiId ? ` (ya UPI ID pe directly)\n` : `\n`) +
          `3️⃣ Payment screenshot lo\n` +
          `4️⃣ Screenshot yahan bhejo ↓</blockquote>\n` +
          `━━━━━━━━━━━━━━━━━━━━`,
        parse_mode: "HTML"
      });
    } catch (e) { console.error("QR send error:", e.message); }
    await bot.sendMessage(chatId,
      `📸 <b>Send your payment screenshot</b> (photo ke roop mein, file nahi):`,
      { parse_mode: "HTML", reply_markup: backKeyboard(`buy_votes:${gId}`) }
    );
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
    // h() se escape karo taaki exactly jaisa type kiya waisa dikhe
    customWelcomeText = text ? h(text) : null;
    await saveConfig("customWelcomeText", customWelcomeText);
    await bot.sendMessage(chatId,
      `✅ <b>Custom welcome message set!</b>\n\n<blockquote>${customWelcomeText?.slice(0, 300) || ""}</blockquote>\n\n<i>Preview dekhne ke liye /previewwelcome bhejo.</i>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ─── Admin: awaiting_ui_text (from /customize tap) ───
  if (state?.step === "awaiting_ui_text" && isAdmin(userId)) {
    const key = state.key;
    userState.delete(userId);
    if (!DEFAULT_UI_TEXTS.hasOwnProperty(key)) {
      return bot.sendMessage(chatId, `❌ Invalid key: <code>${h(key)}</code>`, { parse_mode: "HTML" });
    }
    const rawText  = msg.text || "";
    const value    = rawText.trim();
    // Leading whitespace = UTF-16 offset where value starts (ASCII spaces)
    const leadingWs  = rawText.length - rawText.trimStart().length;
    const htmlValue  = buildHtmlValue(value, msg.entities, leadingWs);
    botCustomTexts.set(key, htmlValue);
    await BotConfigModel.findOneAndUpdate(
      { key: `ui:${key}` }, { key: `ui:${key}`, value: htmlValue }, { upsert: true }
    ).catch(() => {});
    await bot.sendMessage(chatId,
      `✅━━━━━━━━━━━━━━━━━━━━━━✅\n` +
      `  🎨  <b>TEXT UPDATED!</b>\n` +
      `✅━━━━━━━━━━━━━━━━━━━━━━✅\n\n` +
      `🔑 <b>Key:</b> <code>${h(key)}</code>\n\n` +
      `👁 <b>Aisa dikhega (premium emoji sahit):</b>\n` +
      `┌───────────────────────┐\n` +
      `  ${htmlValue}\n` +
      `└───────────────────────┘\n\n` +
      `<i>Bilkul waisa hi set ho gaya! ✅\nReset: /resettext ${h(key)}</i>`,
      { parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "🎨 Back to Customize", callback_data: "cust_back" }, { text: "🔄 Reset to Default", callback_data: `cust_reset:${key}` }]] }
      }
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
    text: `${g.active ? "✅" : "🚫"} ${g.title.slice(0, 28)}  ·  ${g.participants.size} 👥`,
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
    `/support — ᴄᴏɴᴛᴀᴄᴛ ꜱᴜᴘᴘᴏʀᴛ\n` +
    `/about — ᴀʙᴏᴜᴛ ᴛʜɪꜱ ʙᴏᴛ\n` +
    `/version — ʙᴏᴛ ᴠᴇʀꜱɪᴏɴ &amp; ᴜᴘᴛɪᴍᴇ\n` +
    `/uptime — ʙᴏᴛ ᴜᴘᴛɪᴍᴇ\n` +
    `/rules — ʙᴏᴛ ʀᴜʟᴇꜱ\n` +
    `/faq — ꜰʀᴇǫᴜᴇɴᴛʟʏ ᴀꜱᴋᴇᴅ ǫᴜᴇꜱᴛɪᴏɴꜱ\n` +
    `/terms — ᴛᴇʀᴍꜱ ᴏꜰ ꜱᴇʀᴠɪᴄᴇ\n` +
    `/countdown — ɢɪᴠᴇᴀᴡᴀʏ ᴄᴏᴜɴᴛᴅᴏᴡɴ\n` +
    `/rank — ʏᴏᴜʀ ɢʟᴏʙᴀʟ ʀᴀɴᴋ\n` +
    `/invite — ʜᴏᴡ ᴛᴏ ɪɴᴠɪᴛᴇ ʙᴏᴛ\n` +
    `/notify — ɴᴏᴛɪꜰɪᴄᴀᴛɪᴏɴꜱ ɪɴꜰᴏ\n` +
    `/refer — ʏᴏᴜʀ ʀᴇꜰᴇʀʀᴀʟ ʟɪɴᴋ\n` +
    `/feedback — ꜱᴇɴᴅ ꜰᴇᴇᴅʙᴀᴄᴋ` +
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
    `<blockquote>⚡️ ᴘᴏᴡᴇʀᴇᴅ : <a href="https://t.me/rchiex">𝐃𝐑𝐒 ɴᴇᴛᴡᴏʀᴋ</a> 🔥\n` +
    `🔥 ꜱᴜᴘᴘᴏʀᴛ :— <a href="https://t.me/drssupport">𝐀𝐁𝐇𝐈𝐒𝐇𝐄𝐊</a> 🔥</blockquote>`,
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
    text: `✅ ${g.title.slice(0, 28)} · ${g.participants.size} 👥`,
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
  // Real totals — query DB so evicted giveaways are counted correctly
  const [totalGiveaways, totalUsers] = await Promise.all([
    GiveawayModel.countDocuments().catch(() => giveaways.size),
    BotUserModel.countDocuments().catch(() => botUsers.size),
  ]);
  const activeGiveaways = [...giveaways.values()].filter(g => g.active).length;
  const totalChannels = registeredChannels.size;
  // Count active VIPs correctly — iterate vipUsers Map by userId key
  const vipCount = [...vipUsers.entries()].filter(([uid]) => getMembership(uid) !== null).length;
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "broadcast")) return;
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "broadcast")) return;
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

bot.onText(/\/allgiveaways(?:\s+(\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from?.id)) return;
  try {
    if (!giveaways.size) return bot.sendMessage(msg.chat.id, "No giveaways found.");
    const PAGE = 20;
    const page = Math.max(1, parseInt(match?.[1]) || 1);
    const arr  = [...giveaways.entries()];
    const total = arr.length;
    const totalPages = Math.ceil(total / PAGE);
    const pg = Math.min(page, totalPages);
    const slice = arr.slice((pg - 1) * PAGE, pg * PAGE);
    let text = `<b>📋 All Giveaways (${total})</b> — Page ${pg}/${totalPages}\n\n`;
    for (const [id, g] of slice) {
      const votes = [...g.participants.values()].reduce((s, p) => s + p.votes, 0);
      text += `${g.active ? "✅" : "🚫"} <b>${h(g.title)}</b>\n   ID: <code>${id}</code> · ${g.participants.size} 👥 · ${votes} 🗳️\n`;
    }
    if (pg < totalPages) text += `\nNext page: /allgiveaways ${pg + 1}`;
    await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
  } catch(e) { bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`, { parse_mode: "HTML" }).catch(()=>{}); }
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "manage_membership")) return;
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "manage_membership")) return;
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
bot.onText(/\/listmem(?:\s+(\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from?.id)) return;
  try {
    const now = new Date();
    const active = [...vipUsers.entries()].filter(([, v]) => {
      if (!v.vip) return false;
      if (v.expiry && now > new Date(v.expiry)) return false;
      return true;
    });
    if (!active.length) return bot.sendMessage(msg.chat.id,
      `◈━━━━━━━━━━━━━━━━━━━━━━◈\n  📋  <b>ACTIVE MEMBERS</b>\n◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n<blockquote>No active members at the moment.</blockquote>`,
      { parse_mode: "HTML" });
    const PAGE = 10;
    const page = Math.max(1, parseInt(match?.[1]) || 1);
    const totalPages = Math.ceil(active.length / PAGE);
    const pg = Math.min(page, totalPages);
    const slice = active.slice((pg - 1) * PAGE, pg * PAGE);
    let text = `◈━━━━━━━━━━━━━━━━━━━━━━◈\n  📋  <b>ACTIVE MEMBERS</b> (${active.length}) — Page ${pg}/${totalPages}\n◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n`;
    for (const [uid, v] of slice) {
      const expiry = v.expiry ? new Date(v.expiry) : null;
      const daysLeft = expiry ? Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)) : "∞";
      const bu = botUsers.get(uid);
      const nameStr = bu?.firstName ? `<b>${h(bu.firstName)}</b>${bu.username ? ` (@${bu.username})` : ""}` : `<i>Unknown</i>`;
      text += `<blockquote>👤 ${nameStr}\n◈ ID ▸ <code>${uid}</code>\n◈ Plan ▸ ${v.plan || "VIP"}\n◈ Expires ▸ ${expiry ? expiry.toLocaleDateString("en-IN") : "∞"}\n◈ Days Left ▸ ${daysLeft}d</blockquote>\n\n`;
    }
    if (pg < totalPages) text += `Next page: /listmem ${pg + 1}`;
    await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
  } catch(e) { bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`, { parse_mode: "HTML" }).catch(()=>{}); }
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

// /setpanelthreshold — Owner/Admin: Set vote panel detection threshold per giveaway
bot.onText(/\/setpanelthreshold(?:\s+(.+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const args = (match[1] || "").trim().split(/\s+/);

  // Usage: /setpanelthreshold <gId> <votes> [seconds]
  if (args.length < 2 || !args[0] || !args[1]) {
    return bot.sendMessage(chatId,
      `🚨 <b>Set Panel Detection Threshold</b>\n\n` +
      `<blockquote>Usage:\n` +
      `<code>/setpanelthreshold &lt;giveawayId&gt; &lt;votes&gt; [seconds]</code>\n\n` +
      `◈ <b>votes</b>   — Kitne votes in window pe alert trigger ho (default: 15)\n` +
      `◈ <b>seconds</b> — Time window in seconds (default: 90)\n\n` +
      `Example:\n` +
      `<code>/setpanelthreshold ABC123 20 60</code>\n` +
      `→ 20 votes in 60 seconds pe alert\n\n` +
      `<code>/setpanelthreshold ABC123 30</code>\n` +
      `→ 30 votes in 90 seconds (default window) pe alert</blockquote>`,
      { parse_mode: "HTML" }
    );
  }

  const gId = args[0];
  const votes = parseInt(args[1], 10);
  const secs = args[2] ? parseInt(args[2], 10) : null;

  if (isNaN(votes) || votes < 1) {
    return bot.sendMessage(chatId, "❌ <b>Votes</b> ek valid number hona chahiye (minimum 1).", { parse_mode: "HTML" });
  }
  if (secs !== null && (isNaN(secs) || secs < 10)) {
    return bot.sendMessage(chatId, "❌ <b>Seconds</b> minimum 10 hone chahiye.", { parse_mode: "HTML" });
  }

  const g = getGiveaway(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${gId}</code> nahi mila.`, { parse_mode: "HTML" });

  const isOwner = g.creatorId === userId;
  if (!isAdmin(userId) && !isOwner) {
    return bot.sendMessage(chatId, "❌ Sirf giveaway owner ya admin ye set kar sakta hai.", { parse_mode: "HTML" });
  }

  g.panelThreshold = votes;
  if (secs !== null) g.panelWindowSecs = secs;
  await saveGiveaway(g);

  await bot.sendMessage(chatId,
    `✅ <b>Panel Threshold Updated!</b>\n\n` +
    `<blockquote>` +
    `◈ Giveaway  ▸  <b>${h(g.title)}</b> (<code>${gId}</code>)\n` +
    `◈ Trigger   ▸  <b>${g.panelThreshold} votes</b> in <b>${g.panelWindowSecs}s</b>\n\n` +
    `Ab agar koi <b>${g.panelThreshold}+ votes</b> in <b>${g.panelWindowSecs} seconds</b> kisi ek participant ko deta hai,\ntoh tume turant alert milega! 🚨</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// /cleandb — Admin: Interactive selective MongoDB cleanup
bot.onText(/\/cleandb$/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;

  // Count what's cleanable
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cutoff7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const cutoff3d  = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const oldGiveaways = [...giveaways.values()].filter(g => !g.active && g.createdAt && new Date(g.createdAt) < cutoff30d).length;
  const oldPayments  = [...pendingPayments.values()].filter(p => new Date(p.timestamp) < cutoff7d).length;
  const oldMemberships = [...pendingMembershipPayments.values()].filter(m => new Date(m.timestamp) < cutoff3d).length;
  const expiredVip   = [...vipUsers.values()].filter(v => v.vip && v.expiry && new Date(v.expiry) < new Date()).length;
  const oldSecLogs   = Math.max(0, securityLog.length - 100);
  const oldSecLogDB  = await SecurityLogModel.countDocuments({ timestamp: { $lt: cutoff7d } }).catch(() => 0);

  const keyboard = {
    inline_keyboard: [
      [{ text: `🗑️ Ended Giveaways 30d+ (${oldGiveaways})`, callback_data: "cleandb:giveaways" }],
      [{ text: `💸 Old Pending Payments 7d+ (${oldPayments})`, callback_data: "cleandb:payments" }],
      [{ text: `💳 Old Membership Claims 3d+ (${oldMemberships})`, callback_data: "cleandb:memberships" }],
      [{ text: `👑 Mark Expired VIP Inactive (${expiredVip})`, callback_data: "cleandb:vip" }],
      [{ text: `🛡️ Old Security Logs 7d+ (${oldSecLogDB})`, callback_data: "cleandb:seclogs" }],
      [{ text: `🧹 CLEAN ALL ABOVE`, callback_data: "cleandb:all" }],
      [{ text: "❌ Cancel", callback_data: "cleandb:cancel" }]
    ]
  };
  await bot.sendMessage(chatId,
    `🧹━━━━━━━━━━━━━━━━━━━━━━🧹\n   <b>𝐌𝐎𝐍𝐆𝐎𝐃𝐁 𝐂𝐋𝐄𝐀𝐍𝐔𝐏</b>\n🧹━━━━━━━━━━━━━━━━━━━━━━🧹\n\n` +
    `<blockquote>Kya clean karna hai? Select karo:\n\n` +
    `⚠️ Active giveaways, current votes, VIP data SAFE rahega.\nSirf junk/expired data hata.\n\nHar item independently select kar sakte ho ya sab ek saath.</blockquote>`,
    { parse_mode: "HTML", reply_markup: keyboard }
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "manage_giveaways")) return;
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "manage_giveaways")) return;
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
  lines.push(`Status: ${g.active ? "✅ Active" : "🚫 Ended"}`);
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

// ─── Leaderboard Broadcast — helpers ───
function buildLbCard(g) {
  const sorted = [...g.participants.entries()]
    .sort((a, b) => b[1].votes - a[1].votes);
  const medals = ["🥇", "🥈", "🥉"];
  const top10 = sorted.slice(0, 10);
  let rows = "";
  top10.forEach(([uid, p], i) => {
    const bu = botUsers.get(uid);
    const name = h(bu?.firstName || "User");
    const uname = bu?.username ? ` (@${bu.username})` : "";
    const medal = medals[i] || `${i + 1}.`;
    rows += `${medal} <b>${name}</b>${uname} — <b>${p.votes}</b> votes\n`;
  });
  const now = new Date();
  const istStr = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true,
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  🏆  <b>LIVE LEADERBOARD</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `📌 <b>${h(g.title)}</b>\n` +
    `👥 Participants: <b>${g.participants.size}</b>\n\n` +
    `<blockquote>${rows.trim()}</blockquote>\n\n` +
    `🕐 Updated: ${istStr} IST\n` +
    `✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️`
  );
}

function stopLbBroadcast(gId) {
  const entry = lbBroadcastTimers.get(gId);
  if (!entry) return false;
  clearInterval(entry.intervalId);
  lbBroadcastTimers.delete(gId);
  return true;
}

// ─── /setlbbroadcast <gId> <hours> — Auto-broadcast leaderboard to channel ───
bot.onText(/\/setlbbroadcast\s+(\S+)\s+(\d+(?:\.\d+)?)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const hours = parseFloat(match[2]);
  const g = giveaways.get(gId);
  if (!g) return bot.sendMessage(chatId, `❌ Giveaway <code>${gId}</code> nahi mila.`, { parse_mode: "HTML" });
  if (!g.active) return bot.sendMessage(chatId, `⚠️ Yeh giveaway already end ho chuka hai.`, { parse_mode: "HTML" });
  if (!g.channelId) return bot.sendMessage(chatId, `❌ Is giveaway ka channel set nahi hai.`, { parse_mode: "HTML" });
  if (hours < 0.5 || hours > 24) return bot.sendMessage(chatId, `❌ Hours 0.5 se 24 ke beech hone chahiye.`, { parse_mode: "HTML" });

  // Stop existing timer if any
  stopLbBroadcast(gId);

  const intervalMs = Math.round(hours * 60 * 60 * 1000);

  const intervalId = setInterval(async () => {
    const live = giveaways.get(gId);
    if (!live || !live.active) { stopLbBroadcast(gId); return; }
    const card = buildLbCard(live);
    try {
      await bot.sendMessage(live.channelId, card, { parse_mode: "HTML" });
    } catch (e) { console.error(`LB Broadcast error giveaway ${gId}:`, e.message); }
    const entry = lbBroadcastTimers.get(gId);
    if (entry) entry.nextAt = new Date(Date.now() + intervalMs);
  }, intervalMs);

  lbBroadcastTimers.set(gId, {
    intervalId,
    hours,
    nextAt: new Date(Date.now() + intervalMs),
    channelId: g.channelId
  });

  // Send one immediately
  const card = buildLbCard(g);
  try { await bot.sendMessage(g.channelId, card, { parse_mode: "HTML" }); } catch {}

  await bot.sendMessage(chatId,
    `✅ <b>Leaderboard Broadcast Set!</b>\n\n` +
    `<blockquote>` +
    `◈ Giveaway  ▸  <b>${h(g.title)}</b>\n` +
    `◈ Interval  ▸  every <b>${hours}h</b>\n` +
    `◈ Channel   ▸  <code>${g.channelId}</code>\n` +
    `◈ Status    ▸  ✅ Active (posted now)` +
    `</blockquote>\n\n` +
    `💡 Stop karne ke liye: /stoplbbroadcast <code>${gId}</code>`,
    { parse_mode: "HTML" }
  );
});

// ─── /stoplbbroadcast <gId> — Stop auto leaderboard broadcast ───
bot.onText(/\/stoplbbroadcast\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const gId = match[1].trim();
  const stopped = stopLbBroadcast(gId);
  const g = giveaways.get(gId);
  if (!stopped) return bot.sendMessage(chatId,
    `⚠️ <code>${gId}</code> ke liye koi active broadcast nahi hai.`, { parse_mode: "HTML" });
  await bot.sendMessage(chatId,
    `🛑 <b>Leaderboard Broadcast Stopped!</b>\n\n` +
    `<blockquote>◈ Giveaway ▸  <b>${h(g?.title || gId)}</b></blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /listlbbroadcast — View all active leaderboard broadcasts ───
bot.onText(/\/listlbbroadcast/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  if (lbBroadcastTimers.size === 0)
    return bot.sendMessage(chatId,
      `📭 <b>Koi active leaderboard broadcast nahi hai.</b>\n\n` +
      `💡 Set karne ke liye:\n<code>/setlbbroadcast &lt;gId&gt; &lt;hours&gt;</code>`,
      { parse_mode: "HTML" }
    );
  let text = `✦━━━━━━━━━━━━━━━━━━━━━✦\n  📡  <b>ACTIVE LB BROADCASTS</b>\n✦━━━━━━━━━━━━━━━━━━━━━✦\n\n`;
  for (const [gId, entry] of lbBroadcastTimers) {
    const g = giveaways.get(gId);
    const nextStr = entry.nextAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true,
      hour: "2-digit", minute: "2-digit" });
    text += `<b>${h(g?.title || gId)}</b>\n` +
      `  ◈ ID       ▸ <code>${gId}</code>\n` +
      `  ◈ Interval ▸ every ${entry.hours}h\n` +
      `  ◈ Next     ▸ ${nextStr} IST\n\n`;
  }
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "ban_users")) return;
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "ban_users")) return;
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
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "manage_giveaways")) return;
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

  const status = g.active ? `✅ Active` : `🚫 Ended`;
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
    `✅ Status       ▸  ${g.active ? "Active" : "Ended"}` +
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
      `✅ <b>${h(g.title)}</b>\n` +
      `   🆔 <code>${gId}</code>  ·  👥 ${g.participants.size}  ·  🗳️ ${votes}\n` +
      `   ⏳ ${timeLeft}  ·  <a href="${link}">Join</a>`
    );
  }).join("\n\n");

  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n` +
    `  ✅  <b>ACTIVE GIVEAWAYS (${running.length})</b>\n` +
    `✦━━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `${lines}`,
    { parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "🏠 Home", callback_data: "main_menu" }]] }
    }
  );
});

// ─── /cancelgiveaway <gId> — Admin: cancel without announcing winners ───
bot.onText(/\/cancelgiveaway\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !hasAdminPerm(msg.from.id, "manage_giveaways")) return;
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
    `/setlbbroadcast &lt;gId&gt; &lt;hours&gt;\n  → Auto-post live leaderboard to channel every X hours\n  Range: 0.5–24h · Posts immediately + on interval\n  Example: /setlbbroadcast ABC123 2\n\n` +
    `/stoplbbroadcast &lt;gId&gt;\n  → Stop auto leaderboard broadcast for a giveaway\n\n` +
    `/listlbbroadcast\n  → View all active leaderboard broadcasts\n\n` +
    `/setstar &lt;gId&gt; &lt;votes&gt;\n  → Votes per ⭐ Star\n  Example: /setstar ABC123 3 → 1 ⭐ = 3 votes\n\n` +
    `/setinr &lt;gId&gt; &lt;votes&gt;\n  → Votes per ₹1 INR\n  Example: /setinr ABC123 5 → ₹1 = 5 votes, ₹100 = 500 votes\n\n` +
    `<b>🚨 ANTI-CHEAT (Vote Panel Detection)</b>\n` +
    `Agar koi ek participant ko 15+ votes 90 seconds mein milte hain,\ntumhe turant alert milega with these action buttons:\n` +
    `  ➖ Votes Minus  — kitne bhi votes deduct karo\n` +
    `  🗑️ Hatao        — giveaway se remove + user ko DM\n` +
    `  🚫 Ban + Remove — bot se ban + giveaway se remove\n` +
    `  ⚠️ Warn Karo   — fair play warning DM bhejo\n` +
    `  ✅ Dismiss      — ignore karo (genuine spike tha)\n\n` +
    `/setpanelthreshold &lt;gId&gt; &lt;votes&gt; [seconds]\n  → Custom alert threshold per giveaway\n  Default: 15 votes / 90s\n  Example: /setpanelthreshold ABC123 20 60\n  → 20 votes in 60s pe alert\n\n` +
    `/removevotes &lt;gId&gt; &lt;userId&gt; &lt;count&gt;\n  → Manually votes deduct karo (cheating fix)\n\n` +
    `/flaguser &lt;userId&gt; [reason]\n  → Suspicious user ko monitor karo (koi action nahi, bas label)` +
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
    `/setwelcomemsg\n  → Set custom welcome message (jo bhejo waisa hi dikhe)\n\n` +
    `/clearwelcomemsg\n  → Restore default welcome message\n\n` +
    `/previewwelcome\n  → Current welcome screen preview dekho (image + buttons)\n\n` +
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
    `/health\n  → Bot health — uptime, DB, memory, giveaways, VIP, security\n\n` +
    `/paystats\n  → Pending payments + VIP + ban counts (shows payIds)\n\n` +
    `/removepay &lt;payId&gt;\n  → Remove any pending payment by ID\n\n` +
    `/clearallpending\n  → Clear ALL pending payments + notify users\n\n` +
    `/maintenance on|off\n  → Block all non-admin users (for updates)\n\n` +
    `/allchannels\n  → List all registered channels + groups\n\n` +
    `/cleandb\n  → Clean expired data from MongoDB\n\n` +
    `/adminhelp\n  → Show this panel` +
    `</blockquote>\n\n` +
    `<b>🎨 UI CUSTOMIZER</b>\n` +
    `<blockquote>` +
    `/customize\n  → Interactive UI text customizer (button menu)\n\n` +
    `/settext &lt;key&gt; &lt;value&gt;\n  → Set any UI text, emoji or button label\n  Example: /settext welcome.title 🎉 DRS Bot\n\n` +
    `/resettext &lt;key&gt;\n  → Reset one UI text to default\n\n` +
    `/listtext\n  → List all UI text keys + current values` +
    `</blockquote>\n\n` +
    `<b>👑 SUB-ADMIN MANAGEMENT</b>\n` +
    `<blockquote>` +
    `/addadmin &lt;userId&gt; &lt;perms&gt;\n  → Add sub-admin with specific permissions\n  Perms: all | approve_payments, broadcast, ban_users, manage_giveaways\n  Example: /addadmin 123456 all\n\n` +
    `/removeadmin &lt;userId&gt;\n  → Remove sub-admin access\n  Example: /removeadmin 123456\n\n` +
    `/listadmins\n  → List all sub-admins + their permissions\n\n` +
    `/editadminperms &lt;userId&gt;\n  → Edit sub-admin permissions via button UI` +
    `</blockquote>\n\n` +
    `<b>🖼️ UTILITY COMMANDS</b>\n` +
    `<blockquote>` +
    `/setstartimage &lt;url&gt;\n  → Set welcome image directly (no wizard)\n\n` +
    `/clearstates\n  → Clear all stuck user conversation states\n\n` +
    `/gcount\n  → Quick giveaway count breakdown\n\n` +
    `/topusers\n  → Top 10 users by giveaways created\n\n` +
    `/pushgithub [message]\n  → Push vote-bot.mjs to GitHub\n  Example: /pushgithub fix: update welcome text` +
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
    `/support — Send message to admin\n` +
    `/about — About this bot\n` +
    `/version — Bot version & uptime\n` +
    `/uptime — Bot uptime\n` +
    `/rules — Bot usage rules\n` +
    `/faq — Frequently asked questions\n` +
    `/terms — Terms of service\n` +
    `/countdown — Active giveaway countdown\n` +
    `/rank — Your global rank\n` +
    `/invite — How to invite bot to channel\n` +
    `/notify — Notification info\n` +
    `/refer — Your referral link\n` +
    `/feedback — Send feedback to admin` +
    `</blockquote>`;

  const part4 =
    `🔐━━━━━━━━━━━━━━━━━━━━━━🔐\n` +
    `   🛡️  <b>SECURITY & PROTECTION</b>\n` +
    `🔐━━━━━━━━━━━━━━━━━━━━━━🔐\n\n` +
    `<blockquote>` +
    `📖 Full security reference: /securityhelp\n\n` +
    `<b>🍯 Honeypot</b>\n` +
    `/honeypot on|off — Enable/disable honeypot\n` +
    `/honeytrap &lt;cmd&gt; — Add fake trap command\n` +
    `/removetrap &lt;cmd&gt; — Remove trap\n` +
    `/listtraps — All active traps\n` +
    `/honeypotlist — Users who triggered traps\n` +
    `/cleanhoneypot — Clear triggered list\n\n` +
    `<b>⚠️ Warnings</b>\n` +
    `/warnuser &lt;id&gt; [reason] — Warn user\n` +
    `/warnings &lt;id&gt; — Check warnings\n` +
    `/clearwarnings &lt;id&gt; — Clear warnings\n` +
    `/setmaxwarns &lt;n&gt; — Auto-ban threshold\n` +
    `/autoban on|off — Toggle auto-ban\n\n` +
    `<b>🔇 Mute / Shadow</b>\n` +
    `/muteuser &lt;id&gt; — Mute\n` +
    `/unmuteuser &lt;id&gt; — Unmute\n` +
    `/mutedlist — List muted\n` +
    `/shadowban &lt;id&gt; — Ghost ban (silent)\n` +
    `/unshadowban &lt;id&gt; — Remove ghost ban\n` +
    `/shadowlist — List shadow banned\n\n` +
    `<b>✅ Trust / Flag</b>\n` +
    `/trustuser &lt;id&gt; — Whitelist user\n` +
    `/untrustuser &lt;id&gt; — Remove whitelist\n` +
    `/trustedlist — Trusted users\n` +
    `/flaguser &lt;id&gt; [reason] — Flag suspicious\n` +
    `/unflaguser &lt;id&gt; — Remove flag\n` +
    `/flaggedlist — Flagged users\n\n` +
    `<b>🌐 Modes</b>\n` +
    `/securitymode strict|normal|off\n` +
    `/antispam on|off\n` +
    `/emergencylock — Lock all users\n` +
    `/emergencyunlock — Restore access\n\n` +
    `<b>📊 Stats / Logs</b>\n` +
    `/securitystats — Full dashboard\n` +
    `/suspicious — Last 20 events\n` +
    `/auditlog — Last 30 entries\n` +
    `/clearaudit — Clear logs\n` +
    `/resetsecurity — Reset ALL state (bans/warns/mutes/shadow/flags/honeypot hits)\n` +
    `/userhistory &lt;id&gt; — Command history\n` +
    `/securityreport — Download full .txt report\n` +
    `/ratelimitreset &lt;id&gt; — Reset rate limit\n\n` +
    `<b>🚫 Word Filter</b>\n` +
    `/blockword &lt;word&gt; — Block word\n` +
    `/unblockword &lt;word&gt; — Unblock\n` +
    `/blockedwords — List all blocked` +
    `</blockquote>\n\n` +
    `✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️\n` +
    `<blockquote>🛡️ DRS Security Engine v1.0 — Active Protection</blockquote>`;

  await bot.sendMessage(msg.chat.id, part1, { parse_mode: "HTML" });
  await bot.sendMessage(msg.chat.id, part2, { parse_mode: "HTML" });
  await bot.sendMessage(msg.chat.id, part3, { parse_mode: "HTML" });
  await bot.sendMessage(msg.chat.id, part4, { parse_mode: "HTML" });
});

// ============================================================
// SECURITY, PROTECTION & HONEYPOT COMMANDS
// ============================================================

// ─── /securityhelp — Full 40-command security reference (600+ words) ───
bot.onText(/\/securityhelp/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const sec1 =
    `🔐━━━━━━━━━━━━━━━━━━━━━━🔐\n` +
    `   🛡️  <b>𝐃𝐑𝐒 𝐁𝐎𝐓 — 𝐒𝐄𝐂𝐔𝐑𝐈𝐓𝐘 𝐏𝐀𝐍𝐄𝐋</b>\n` +
    `🔐━━━━━━━━━━━━━━━━━━━━━━🔐\n\n` +
    `<b>🍯 HONEYPOT SYSTEM</b>\n` +
    `<blockquote>` +
    `/honeypot on|off\n  → Honeypot system enable/disable karo\n  Agar on: fake commands ke traps active hote hain\n  Agar off: saare traps bypass ho jate hain\n  Example: /honeypot on\n\n` +
    `/honeytrap &lt;command&gt;\n  → Ek fake command add karo as trap\n  Koi bhi user yeh command use kare → admin ko instant alert\n  + user ko automatic warning milti hai\n  Example: /honeytrap adminpanel\n  Example: /honeytrap hackbot\n\n` +
    `/removetrap &lt;command&gt;\n  → Ek honeypot command remove karo\n  Example: /removetrap adminpanel\n\n` +
    `/listtraps\n  → Saare active honeypot commands dekho\n\n` +
    `/honeypotlist\n  → Kin users ne honeypot trigger kiya — full log with commands & timestamps\n\n` +
    `/cleanhoneypot\n  → Honeypot triggered users ki memory list clear karo` +
    `</blockquote>\n\n` +
    `<b>⚠️ WARNING SYSTEM</b>\n` +
    `<blockquote>` +
    `/warnuser &lt;userId&gt; [reason]\n  → User ko manual warning do\n  Warning count track hoti hai MongoDB mein\n  maxWarnings tak pahunche → auto-ban (agar enabled)\n  Example: /warnuser 123456 vote manipulation kar raha tha\n\n` +
    `/warnings &lt;userId&gt;\n  → User ki warnings check karo: total count + har reason\n  Example: /warnings 123456\n\n` +
    `/clearwarnings &lt;userId&gt;\n  → User ki saari warnings hata do (slate clean)\n  Example: /clearwarnings 123456\n\n` +
    `/setmaxwarns &lt;number&gt;\n  → Auto-ban trigger hone ke liye kitni warnings chahiye (1-20)\n  Default: 3 warnings\n  Example: /setmaxwarns 5\n\n` +
    `/autoban on|off\n  → Auto-ban toggle: warning limit pe automatically ban ho\n  Example: /autoban on` +
    `</blockquote>`;

  const sec2 =
    `<b>🔇 MUTE & SHADOW BAN</b>\n` +
    `<blockquote>` +
    `/muteuser &lt;userId&gt;\n  → User mute karo: bot unke messages par koi response nahi deta\n  User ko pata chalta hai par kuch kar nahi sakta\n  Example: /muteuser 123456\n\n` +
    `/unmuteuser &lt;userId&gt;\n  → Mute hatao, user phir se interact kar sakta hai\n  Example: /unmuteuser 123456\n\n` +
    `/mutedlist\n  → Saare muted users ki list dekho\n\n` +
    `/shadowban &lt;userId&gt;\n  → Ghost ban: user sochega bot chal raha hai\n  Actually koi bhi response nahi milta — completely silent\n  User ko bilkul pata nahi chalta ki woh shadow-banned hai!\n  ⚡ Hackers aur abusers ke liye best tool\n  Example: /shadowban 123456\n\n` +
    `/unshadowban &lt;userId&gt;\n  → Shadow ban hatao, user normal ho jata hai\n  Example: /unshadowban 123456\n\n` +
    `/shadowlist\n  → Saare shadow banned users ki list` +
    `</blockquote>\n\n` +
    `<b>✅ TRUSTED USERS (Whitelist)</b>\n` +
    `<blockquote>` +
    `/trustuser &lt;userId&gt;\n  → User ko trusted whitelist mein dalo\n  Trusted users: rate limiting bypass + honeypot ignore\n  Apne co-admins ya verified users ke liye use karo\n  Example: /trustuser 123456\n\n` +
    `/untrustuser &lt;userId&gt;\n  → Trusted list se hatao\n  Example: /untrustuser 123456\n\n` +
    `/trustedlist\n  → Saare trusted users dekho` +
    `</blockquote>\n\n` +
    `<b>🚩 FLAG / SUSPICIOUS USERS</b>\n` +
    `<blockquote>` +
    `/flaguser &lt;userId&gt; [reason]\n  → User ko suspicious flag karo (admin monitoring)\n  Flag = koi action nahi, bas monitoring label\n  Example: /flaguser 123456 vote manipulation suspicion\n\n` +
    `/unflaguser &lt;userId&gt;\n  → Flag hatao\n  Example: /unflaguser 123456\n\n` +
    `/flaggedlist\n  → Saare flagged users aur unke reasons dekho` +
    `</blockquote>`;

  const sec3 =
    `<b>🌐 SECURITY MODES & CONTROLS</b>\n` +
    `<blockquote>` +
    `/securitymode strict|normal|off\n  → Bot ka security level set karo\n  • strict → 4 commands/10s, max protection\n  • normal → 12 commands/10s (default balanced)\n  • off    → Rate limiting completely off\n  Example: /securitymode strict\n\n` +
    `/antispam on|off\n  → Spam/flood protection toggle karo\n  On = rate limiting active, Off = no rate limiting\n  Example: /antispam on\n\n` +
    `/emergencylock\n  → INSTANT: Saare non-admin users ko block karo\n  Bot sirf admin ke liye kaam karega\n  ⚠️ Use karo jab bot exploit ho raha ho ya hacking attempt ho\n\n` +
    `/emergencyunlock\n  → Emergency lock hatao, bot normal operation par wapas` +
    `</blockquote>\n\n` +
    `<b>📊 SECURITY STATS & LOGS</b>\n` +
    `<blockquote>` +
    `/securitystats\n  → Full security dashboard: mode, anti-spam, honeypot, auto-ban,\n  emergency lock, trap count, warnings, shadow bans, mutes, etc.\n\n` +
    `/suspicious\n  → Last 20 security events: rate limits, honeypots, blocked words, warnings\n\n` +
    `/auditlog\n  → Last 30 detailed bot activity log entries with timestamps\n\n` +
    `/clearaudit\n  → Security + audit log saaf karo (in-memory + MongoDB)\n\n` +
    `/userhistory &lt;userId&gt;\n  → Kisi user ne last 30 commands kya bheje (history)\n  Example: /userhistory 123456\n\n` +
    `/securityreport\n  → Complete security report .txt download karo\n  Includes: config, traps, warnings, shadow bans, flagged, blocked words, full log\n\n` +
    `/ratelimitreset &lt;userId&gt;\n  → Kisi user ka rate limit counter reset karo (manual override)` +
    `</blockquote>\n\n` +
    `<b>🚫 BLOCKED WORDS FILTER</b>\n` +
    `<blockquote>` +
    `/blockword &lt;word|phrase&gt;\n  → Yeh word/phrase block karo\n  Koi bhi message mein yeh hoga → reject + warning\n  Example: /blockword badword\n  Example: /blockword scam link\n\n` +
    `/unblockword &lt;word&gt;\n  → Word/phrase unblock karo\n  Example: /unblockword badword\n\n` +
    `/blockedwords\n  → Saare blocked words/phrases ki list dekho` +
    `</blockquote>\n\n` +
    `✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️\n` +
    `<blockquote>🛡️ DRS Security Engine v1.0\nHoneypot · Rate Limit · Shadow Ban · Auto-Ban · Word Filter · Emergency Lock · Audit Log</blockquote>`;

  await bot.sendMessage(msg.chat.id, sec1, { parse_mode: "HTML" });
  await bot.sendMessage(msg.chat.id, sec2, { parse_mode: "HTML" });
  await bot.sendMessage(msg.chat.id, sec3, { parse_mode: "HTML" });
});

// ─── /honeypot on|off ───
bot.onText(/\/honeypot (on|off)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  honeypotEnabled = match[1] === "on";
  await _saveSecConfig();
  await bot.sendMessage(msg.chat.id, `🍯 <b>Honeypot ${honeypotEnabled ? "ENABLED ✅" : "DISABLED ❌"}</b>\n<blockquote>${honeypotEnabled ? "Fake commands par trap active." : "Honeypot traps bypass ho rahe hain."}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /honeytrap <command> ───
bot.onText(/\/honeytrap (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const cmd = match[1].trim().toLowerCase().replace(/^\//, "");
  honeypotTraps.add(cmd);
  await HoneypotTrapModel.findOneAndUpdate({ command: cmd }, { command: cmd }, { upsert: true }).catch(() => {});
  await bot.sendMessage(msg.chat.id,
    `🍯 <b>Honeypot Trap Added</b>\n<blockquote>◈ Command ▸ <code>/${cmd}</code>\n◈ Effect  ▸ Koi bhi use kare → instant admin alert + warning!</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /removetrap <command> ───
bot.onText(/\/removetrap (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const cmd = match[1].trim().toLowerCase().replace(/^\//, "");
  honeypotTraps.delete(cmd);
  await HoneypotTrapModel.deleteOne({ command: cmd }).catch(() => {});
  await bot.sendMessage(msg.chat.id, `✅ <b>Trap removed:</b> <code>/${cmd}</code>`, { parse_mode: "HTML" });
});

// ─── /listtraps ───
bot.onText(/\/listtraps(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAdmin(msg.from?.id)) return;
  try {
    if (!honeypotTraps.size) return bot.sendMessage(msg.chat.id, `🍯 <b>No honeypot traps set.</b>\n<blockquote>Use /honeytrap &lt;command&gt; to add one.</blockquote>`, { parse_mode: "HTML" });
    const PAGE = 50;
    const page = Math.max(1, parseInt(match?.[1]) || 1);
    const arr  = [...honeypotTraps];
    const total = arr.length;
    const totalPages = Math.ceil(total / PAGE);
    const pg = Math.min(page, totalPages);
    const slice = arr.slice((pg - 1) * PAGE, pg * PAGE);
    const list = slice.map((c, i) => `${(pg - 1) * PAGE + i + 1}. <code>/${c}</code>`).join("\n");
    const nav = totalPages > 1 ? `\n\n📄 Page ${pg}/${totalPages}${pg < totalPages ? ` · Next: /listtraps ${pg + 1}` : " · ✅ Last page"}` : "";
    await bot.sendMessage(msg.chat.id, `🍯 <b>Honeypot Traps (${total})</b>\n<blockquote>${list}</blockquote>${nav}`, { parse_mode: "HTML" });
  } catch(e) { bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`, { parse_mode: "HTML" }).catch(()=>{}); }
});

// ─── /honeypotlist ───
bot.onText(/\/honeypotlist/, async (msg) => {
  if (!isAdmin(msg.from?.id)) return;
  try {
    if (!honeypotTripped.size) return bot.sendMessage(msg.chat.id, `🍯 <b>No users have triggered honeypots yet.</b>`, { parse_mode: "HTML" });
    const entries = [...honeypotTripped.entries()].slice(0, 30); // max 30 to avoid limit
    let lines = "";
    for (const [uid, traps] of entries) {
      const u = botUsers.get(uid);
      lines += `▸ <code>${uid}</code> @${u?.username || "N/A"} — <b>${traps.length}</b> trap(s)\n`;
      lines += traps.slice(0, 2).map(t => `  └ /${t.command} · ${new Date(t.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`).join("\n") + "\n\n";
    }
    const more = honeypotTripped.size > 30 ? `\n<i>...and ${honeypotTripped.size - 30} more users</i>` : "";
    await bot.sendMessage(msg.chat.id, `🍯 <b>Honeypot Triggered (${honeypotTripped.size} users)</b>\n<blockquote>${lines.trim()}</blockquote>${more}`, { parse_mode: "HTML" });
  } catch(e) { bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`, { parse_mode: "HTML" }).catch(()=>{}); }
});

// ─── /cleanhoneypot ───
bot.onText(/\/cleanhoneypot/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  honeypotTripped.clear();
  await bot.sendMessage(msg.chat.id, `🧹 <b>Honeypot triggered list cleared.</b>`, { parse_mode: "HTML" });
});

// ─── /warnuser <userId> [reason] ───
bot.onText(/\/warnuser (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const parts = match[1].trim().split(" ");
  const targetId = Number(parts[0]);
  const reason = parts.slice(1).join(" ") || "Admin warning";
  if (!targetId) return bot.sendMessage(msg.chat.id, `Usage: /warnuser &lt;userId&gt; [reason]`, { parse_mode: "HTML" });
  const u = botUsers.get(targetId);
  await _addWarn(targetId, u?.username, reason, targetId);
  const warn = userWarnings.get(targetId);
  await bot.sendMessage(msg.chat.id,
    `⚠️ <b>Warning Issued</b>\n<blockquote>◈ User   ▸ <code>${targetId}</code> @${u?.username || "N/A"}\n◈ Reason ▸ ${reason}\n◈ Total  ▸ ${warn?.count || 1}/${maxWarnings}</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /warnings <userId> ───
bot.onText(/\/warnings (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const warn = userWarnings.get(targetId);
  if (!warn || warn.count === 0) return bot.sendMessage(msg.chat.id, `✅ <b>No warnings</b> for <code>${targetId}</code>`, { parse_mode: "HTML" });
  const reasons = warn.reasons.map((r, i) => `${i + 1}. ${r}`).join("\n");
  await bot.sendMessage(msg.chat.id,
    `⚠️ <b>Warnings: <code>${targetId}</code></b>\n<blockquote>◈ Count  ▸ <b>${warn.count}/${maxWarnings}</b>\n◈ Last   ▸ ${new Date(warn.lastWarnAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n\n${reasons}</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /clearwarnings <userId> ───
bot.onText(/\/clearwarnings (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  userWarnings.delete(targetId);
  await WarningModel.deleteOne({ userId: targetId }).catch(() => {});
  await bot.sendMessage(msg.chat.id, `✅ <b>Warnings cleared</b> for <code>${targetId}</code>`, { parse_mode: "HTML" });
});

// ─── /muteuser <userId> ───
bot.onText(/\/muteuser (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  mutedUsers.add(targetId);
  _secLog(targetId, botUsers.get(targetId)?.username, "MUTE", "Admin muted");
  await bot.sendMessage(msg.chat.id, `🔇 <b>User muted: <code>${targetId}</code></b>\n<blockquote>Bot unke messages ka response nahi dega.</blockquote>`, { parse_mode: "HTML" });
});

// ─── /unmuteuser <userId> ───
bot.onText(/\/unmuteuser (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  mutedUsers.delete(Number(match[1]));
  await bot.sendMessage(msg.chat.id, `🔊 <b>User unmuted: <code>${match[1]}</code></b>`, { parse_mode: "HTML" });
});

// ─── /mutedlist ───
bot.onText(/\/mutedlist/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  if (!mutedUsers.size) return bot.sendMessage(msg.chat.id, `🔇 <b>No muted users.</b>`, { parse_mode: "HTML" });
  const list = [...mutedUsers].map((id, i) => `${i + 1}. <code>${id}</code> @${botUsers.get(id)?.username || "N/A"}`).join("\n");
  await bot.sendMessage(msg.chat.id, `🔇 <b>Muted Users (${mutedUsers.size})</b>\n<blockquote>${list}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /shadowban <userId> ───
bot.onText(/\/shadowban (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  shadowBanned.add(targetId);
  await ShadowBanModel.findOneAndUpdate({ userId: targetId }, { userId: targetId, reason: "Admin", at: new Date() }, { upsert: true }).catch(() => {});
  _secLog(targetId, botUsers.get(targetId)?.username, "SHADOWBAN", "Admin shadow-banned");
  await bot.sendMessage(msg.chat.id,
    `👻 <b>Shadow Ban Applied</b>\n<blockquote>◈ User   ▸ <code>${targetId}</code>\n◈ Effect ▸ Koi response nahi milega — user ko pata nahi chalta!\n◈ Hackers ke liye best tool 🛡️</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /unshadowban <userId> ───
bot.onText(/\/unshadowban (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  shadowBanned.delete(targetId);
  await ShadowBanModel.deleteOne({ userId: targetId }).catch(() => {});
  await bot.sendMessage(msg.chat.id, `👻 <b>Shadow ban removed: <code>${targetId}</code></b>`, { parse_mode: "HTML" });
});

// ─── /shadowlist ───
bot.onText(/\/shadowlist/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  if (!shadowBanned.size) return bot.sendMessage(msg.chat.id, `👻 <b>No shadow banned users.</b>`, { parse_mode: "HTML" });
  const list = [...shadowBanned].map((id, i) => `${i + 1}. <code>${id}</code> @${botUsers.get(id)?.username || "N/A"}`).join("\n");
  await bot.sendMessage(msg.chat.id, `👻 <b>Shadow Banned (${shadowBanned.size})</b>\n<blockquote>${list}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /trustuser <userId> ───
bot.onText(/\/trustuser (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  trustedUsers.add(targetId);
  await TrustedUserModel.findOneAndUpdate({ userId: targetId }, { userId: targetId, addedAt: new Date() }, { upsert: true }).catch(() => {});
  await bot.sendMessage(msg.chat.id, `✅ <b>User Trusted: <code>${targetId}</code></b>\n<blockquote>Rate limit + honeypot bypass active.</blockquote>`, { parse_mode: "HTML" });
});

// ─── /untrustuser <userId> ───
bot.onText(/\/untrustuser (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  trustedUsers.delete(targetId);
  await TrustedUserModel.deleteOne({ userId: targetId }).catch(() => {});
  await bot.sendMessage(msg.chat.id, `✅ <b>Removed from trusted: <code>${targetId}</code></b>`, { parse_mode: "HTML" });
});

// ─── /trustedlist ───
bot.onText(/\/trustedlist/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  if (!trustedUsers.size) return bot.sendMessage(msg.chat.id, `✅ <b>No trusted users.</b>`, { parse_mode: "HTML" });
  const list = [...trustedUsers].map((id, i) => `${i + 1}. <code>${id}</code> @${botUsers.get(id)?.username || "N/A"}`).join("\n");
  await bot.sendMessage(msg.chat.id, `✅ <b>Trusted Users (${trustedUsers.size})</b>\n<blockquote>${list}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /flaguser <userId> [reason] ───
bot.onText(/\/flaguser (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const parts = match[1].trim().split(" ");
  const targetId = Number(parts[0]);
  const reason = parts.slice(1).join(" ") || "Suspicious activity";
  if (!targetId) return bot.sendMessage(msg.chat.id, `Usage: /flaguser &lt;userId&gt; [reason]`, { parse_mode: "HTML" });
  flaggedUsers.set(targetId, { reason, at: new Date() });
  _secLog(targetId, botUsers.get(targetId)?.username, "FLAGGED", reason);
  await bot.sendMessage(msg.chat.id, `🚩 <b>User Flagged</b>\n<blockquote>◈ ID     ▸ <code>${targetId}</code>\n◈ Reason ▸ ${reason}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /unflaguser <userId> ───
bot.onText(/\/unflaguser (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  flaggedUsers.delete(Number(match[1]));
  await bot.sendMessage(msg.chat.id, `🚩 <b>Flag removed: <code>${match[1]}</code></b>`, { parse_mode: "HTML" });
});

// ─── /flaggedlist ───
bot.onText(/\/flaggedlist/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  if (!flaggedUsers.size) return bot.sendMessage(msg.chat.id, `🚩 <b>No flagged users.</b>`, { parse_mode: "HTML" });
  let lines = "";
  for (const [id, f] of flaggedUsers) {
    const u = botUsers.get(id);
    lines += `▸ <code>${id}</code> @${u?.username || "N/A"} — ${f.reason}\n`;
  }
  await bot.sendMessage(msg.chat.id, `🚩 <b>Flagged Users (${flaggedUsers.size})</b>\n<blockquote>${lines.trim()}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /autoban on|off ───
bot.onText(/\/autoban (on|off)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  autobanEnabled = match[1] === "on";
  await _saveSecConfig();
  await bot.sendMessage(msg.chat.id, `🚫 <b>Auto-ban ${autobanEnabled ? "ENABLED ✅" : "DISABLED ❌"}</b>\n<blockquote>${autobanEnabled ? `${maxWarnings} warnings = auto-ban` : "Auto-ban off."}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /setmaxwarns <number> ───
bot.onText(/\/setmaxwarns (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const n = Number(match[1]);
  if (n < 1 || n > 20) return bot.sendMessage(msg.chat.id, `❌ 1 se 20 ke beech value do.`);
  maxWarnings = n;
  await _saveSecConfig();
  await bot.sendMessage(msg.chat.id, `⚠️ <b>Max Warnings → ${n}</b>\n<blockquote>${n} warnings ke baad auto-ban trigger hoga.</blockquote>`, { parse_mode: "HTML" });
});

// ─── /securitymode strict|normal|off ───
bot.onText(/\/securitymode (strict|normal|off)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  securityMode = match[1];
  await _saveSecConfig();
  const desc = securityMode === "strict" ? "4 cmds/10s, maximum protection" : securityMode === "normal" ? "12 cmds/10s, balanced (default)" : "Rate limiting completely off";
  await bot.sendMessage(msg.chat.id, `🌐 <b>Security Mode: ${securityMode.toUpperCase()}</b>\n<blockquote>${desc}</blockquote>`, { parse_mode: "HTML" });
});

bot.onText(/\/securitymode$/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id,
    `🌐 <b>Current Security Mode: ${securityMode.toUpperCase()}</b>\n<blockquote>Usage: /securitymode strict|normal|off</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /antispam on|off ───
bot.onText(/\/antispam (on|off)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  antispamEnabled = match[1] === "on";
  await _saveSecConfig();
  await bot.sendMessage(msg.chat.id, `⚡ <b>Anti-Spam ${antispamEnabled ? "ENABLED ✅" : "DISABLED ❌"}</b>`, { parse_mode: "HTML" });
});

// ─── /emergencylock ───
bot.onText(/\/emergencylock/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  emergencyLocked = true;
  await _saveSecConfig();
  await bot.sendMessage(msg.chat.id,
    `🔒━━━━━━━━━━━━━━━━━━━━━━🔒\n   🚨  <b>EMERGENCY LOCK ACTIVE</b>\n🔒━━━━━━━━━━━━━━━━━━━━━━🔒\n\n` +
    `<blockquote>⚠️ Saare non-admin users BLOCKED!\nSirf aap (admin) bot use kar sakte ho.\nUse /emergencyunlock to restore.</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /emergencyunlock ───
bot.onText(/\/emergencyunlock/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  emergencyLocked = false;
  await _saveSecConfig();
  await bot.sendMessage(msg.chat.id, `🔓 <b>Emergency Lock REMOVED</b>\n<blockquote>Bot normal operation mein wapas aa gaya.</blockquote>`, { parse_mode: "HTML" });
});

// ─── /securitystats ───
bot.onText(/\/securitystats/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const totalWarned = userWarnings.size;
  const totalWarnings = [...userWarnings.values()].reduce((s, w) => s + w.count, 0);
  const uptime = Math.floor((Date.now() - botStartTime) / 1000);
  const uptimeStr = `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`;
  await bot.sendMessage(msg.chat.id,
    `🛡️━━━━━━━━━━━━━━━━━━━━━━🛡️\n   📊  <b>ꜱᴇᴄᴜʀɪᴛʏ ᴅᴀꜱʜʙᴏᴀʀᴅ</b>\n🛡️━━━━━━━━━━━━━━━━━━━━━━🛡️\n\n` +
    `<blockquote>` +
    `◈ ꜱᴇᴄᴜʀɪᴛʏ ᴍᴏᴅᴇ   ▸  <b>${securityMode.toUpperCase()}</b>\n` +
    `◈ ᴀɴᴛɪ-ꜱᴘᴀᴍ      ▸  <b>${antispamEnabled ? "✅ ON" : "❌ OFF"}</b>\n` +
    `◈ ʜᴏɴᴇʏᴘᴏᴛ       ▸  <b>${honeypotEnabled ? "✅ ON" : "❌ OFF"}</b>\n` +
    `◈ ᴀᴜᴛᴏ-ʙᴀɴ       ▸  <b>${autobanEnabled ? "✅ ON" : "❌ OFF"}</b>\n` +
    `◈ ᴇᴍᴇʀɢᴇɴᴄʏ ʟᴏᴄᴋ  ▸  <b>${emergencyLocked ? "🔒 ACTIVE" : "🔓 OFF"}</b>\n\n` +
    `◈ ʜᴏɴᴇʏᴘᴏᴛ ᴛʀᴀᴘꜱ  ▸  ${honeypotTraps.size}\n` +
    `◈ ᴛʀɪᴘᴘᴇᴅ ᴜꜱᴇʀꜱ   ▸  ${honeypotTripped.size}\n` +
    `◈ ᴡᴀʀɴᴇᴅ ᴜꜱᴇʀꜱ    ▸  ${totalWarned} users (${totalWarnings} total)\n` +
    `◈ ꜱʜᴀᴅᴏᴡ ʙᴀɴɴᴇᴅ   ▸  ${shadowBanned.size}\n` +
    `◈ ᴍᴜᴛᴇᴅ ᴜꜱᴇʀꜱ     ▸  ${mutedUsers.size}\n` +
    `◈ ᴛʀᴜꜱᴛᴇᴅ ᴜꜱᴇʀꜱ   ▸  ${trustedUsers.size}\n` +
    `◈ ꜰʟᴀɢɢᴇᴅ ᴜꜱᴇʀꜱ   ▸  ${flaggedUsers.size}\n` +
    `◈ ʙʟᴏᴄᴋᴇᴅ ᴡᴏʀᴅꜱ   ▸  ${blockedWords.size}\n` +
    `◈ ꜱᴇᴄ ʟᴏɢ ᴇɴᴛʀɪᴇꜱ  ▸  ${securityLog.length}\n` +
    `◈ ᴍᴀx ᴡᴀʀɴɪɴɢꜱ    ▸  ${maxWarnings}\n` +
    `◈ ᴜᴘᴛɪᴍᴇ          ▸  ${uptimeStr}` +
    `</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /suspicious — Recent security log ───
bot.onText(/\/suspicious/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  if (!securityLog.length) return bot.sendMessage(msg.chat.id, `🛡️ <b>Security log empty.</b>`, { parse_mode: "HTML" });
  const recent = securityLog.slice(0, 20);
  const lines = recent.map(e =>
    `▸ <code>${e.userId}</code> · <b>${e.action}</b> · ${String(e.detail || "").slice(0, 40)}\n  <i>${new Date(e.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</i>`
  ).join("\n\n");
  await bot.sendMessage(msg.chat.id, `🛡️ <b>Security Log (last ${recent.length})</b>\n\n<blockquote>${lines}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /auditlog ───
bot.onText(/\/auditlog/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  if (!securityLog.length) return bot.sendMessage(msg.chat.id, `📋 <b>Audit log empty.</b>`, { parse_mode: "HTML" });
  const recent = securityLog.slice(0, 30);
  const lines = recent.map((e, i) =>
    `${i + 1}. [<b>${e.action}</b>] <code>${e.userId}</code> @${e.username || "N/A"}\n  └ ${String(e.detail || "").slice(0, 50)} · <i>${new Date(e.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</i>`
  ).join("\n");
  await bot.sendMessage(msg.chat.id, `📋 <b>Audit Log (last 30)</b>\n\n<blockquote>${lines}</blockquote>`, { parse_mode: "HTML" });
});

// ─── /clearaudit ───
bot.onText(/\/clearaudit/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  securityLog.length = 0;
  await SecurityLogModel.deleteMany({}).catch(() => {});
  await bot.sendMessage(msg.chat.id, `🧹 <b>Security/Audit log cleared.</b>`, { parse_mode: "HTML" });
});

// ─── /resetsecurity — Reset all security state (keep config/traps/words) ───
bot.onText(/\/resetsecurity/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;

  const prevBanned   = bannedUsers.size;
  const prevWarnings = userWarnings.size;
  const prevShadow   = shadowBanned.size;
  const prevMuted    = mutedUsers.size;
  const prevFlagged  = flaggedUsers.size;
  const prevHoney    = honeypotTripped.size;

  // Clear state — keep traps, blocked words, securityMode, maxWarnings, autobanEnabled, antispamEnabled
  bannedUsers.clear();
  userWarnings.clear();
  shadowBanned.clear();
  mutedUsers.clear();
  flaggedUsers.clear();
  honeypotTripped.clear();
  securityLog.length = 0;

  // Persist resets
  await saveConfig("bannedUsers",   []).catch(() => {});
  await saveConfig("shadowBanned",  []).catch(() => {});
  await saveConfig("mutedUsers",    []).catch(() => {});
  await saveConfig("trustedUsers",  [...trustedUsers]).catch(() => {});
  await SecurityLogModel.deleteMany({}).catch(() => {});

  await bot.sendMessage(chatId,
    `🔄━━━━━━━━━━━━━━━━━━━━━━🔄\n` +
    `  🛡️  <b>SECURITY RESET DONE</b>\n` +
    `🔄━━━━━━━━━━━━━━━━━━━━━━🔄\n\n` +
    `<blockquote>` +
    `✅ Saari security state clear ho gayi:\n\n` +
    `🚫 Banned Users     » <b>${prevBanned} → 0</b>\n` +
    `⚠️ Warnings         » <b>${prevWarnings} → 0</b>\n` +
    `👻 Shadow Bans      » <b>${prevShadow} → 0</b>\n` +
    `🔇 Muted Users      » <b>${prevMuted} → 0</b>\n` +
    `🚩 Flagged Users    » <b>${prevFlagged} → 0</b>\n` +
    `🍯 Honeypot Hits    » <b>${prevHoney} → 0</b>\n` +
    `📋 Security Logs    » <b>Cleared</b>\n\n` +
    `🔒 <i>Config safe hai:</i>\n` +
    `▸ Honeypot traps (${honeypotTraps.size})\n` +
    `▸ Blocked words (${blockedWords.size})\n` +
    `▸ Security mode: <b>${securityMode.toUpperCase()}</b>\n` +
    `▸ Trusted users (${trustedUsers.size}) — unchanged` +
    `</blockquote>`,
    { parse_mode: "HTML" }
  );
});

// ─── /previewwelcome — Preview welcome screen ───
bot.onText(/\/previewwelcome/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id,
    `👁️ <b>Welcome screen preview bhej raha hoon...</b>`,
    { parse_mode: "HTML" }
  );
  await sendWelcome(msg.chat.id, msg.from.id);
});

// ─── /userhistory <userId> ───
bot.onText(/\/userhistory (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const targetId = Number(match[1]);
  const hist = userCommandHistory.get(targetId);
  if (!hist?.length) return bot.sendMessage(msg.chat.id, `📋 <b>No command history for <code>${targetId}</code></b>`, { parse_mode: "HTML" });
  const u = botUsers.get(targetId);
  const lines = hist.slice(0, 30).map((h, i) =>
    `${i + 1}. <code>${h.cmd}</code> · <i>${new Date(h.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</i>`
  ).join("\n");
  await bot.sendMessage(msg.chat.id,
    `📋 <b>Command History</b>\n<blockquote>◈ User ▸ <code>${targetId}</code> @${u?.username || "N/A"}\n\n${lines}</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /blockword <word> ───
bot.onText(/\/blockword (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const word = match[1].trim().toLowerCase();
  blockedWords.add(word);
  await BlockedWordModel.findOneAndUpdate({ word }, { word }, { upsert: true }).catch(() => {});
  await bot.sendMessage(msg.chat.id, `🚫 <b>Word blocked:</b> <code>${word}</code>`, { parse_mode: "HTML" });
});

// ─── /unblockword <word> ───
bot.onText(/\/unblockword (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const word = match[1].trim().toLowerCase();
  blockedWords.delete(word);
  await BlockedWordModel.deleteOne({ word }).catch(() => {});
  await bot.sendMessage(msg.chat.id, `✅ <b>Word unblocked:</b> <code>${word}</code>`, { parse_mode: "HTML" });
});

// ─── /blockedwords ───
bot.onText(/\/blockedwords(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAdmin(msg.from?.id)) return;
  try {
    if (!blockedWords.size) return bot.sendMessage(msg.chat.id, `✅ <b>No blocked words.</b>`, { parse_mode: "HTML" });
    const PAGE = 60;
    const page = Math.max(1, parseInt(match?.[1]) || 1);
    const arr  = [...blockedWords];
    const total = arr.length;
    const totalPages = Math.ceil(total / PAGE);
    const pg = Math.min(page, totalPages);
    const slice = arr.slice((pg - 1) * PAGE, pg * PAGE);
    const list = slice.map((w, i) => `${(pg - 1) * PAGE + i + 1}. <code>${w}</code>`).join("\n");
    const nav = totalPages > 1 ? `\n\n📄 Page ${pg}/${totalPages}${pg < totalPages ? ` · Next: /blockedwords ${pg + 1}` : " · ✅ Last page"}` : "";
    await bot.sendMessage(msg.chat.id, `🚫 <b>Blocked Words (${total})</b>\n<blockquote>${list}</blockquote>${nav}`, { parse_mode: "HTML" });
  } catch(e) { bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`, { parse_mode: "HTML" }).catch(()=>{}); }
});

// ─── /ratelimitreset <userId> ───
bot.onText(/\/ratelimitreset (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  commandRateLimit.delete(Number(match[1]));
  await bot.sendMessage(msg.chat.id, `✅ <b>Rate limit reset for <code>${match[1]}</code></b>`, { parse_mode: "HTML" });
});

// ─── /securityreport ───
bot.onText(/\/securityreport/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  await bot.sendChatAction(chatId, "upload_document").catch(() => {});
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const sep  = "=".repeat(60);
  const dash = "-".repeat(40);

  let report = ``;
  report += `╔══════════════════════════════════════════════════════════╗\n`;
  report += `║         DRS BOT — FULL SECURITY REPORT                  ║\n`;
  report += `╚══════════════════════════════════════════════════════════╝\n`;
  report += `Generated : ${now}\n`;
  report += `Bot Users : ${botUsers.size} total\n`;
  report += `${sep}\n\n`;

  // ── SUMMARY ──
  report += `SUMMARY\n${dash}\n`;
  report += `Banned Users     : ${bannedUsers.size}\n`;
  report += `Shadow Banned    : ${shadowBanned.size}\n`;
  report += `Muted Users      : ${mutedUsers.size}\n`;
  report += `Flagged Users    : ${flaggedUsers.size}\n`;
  report += `Warned Users     : ${userWarnings.size}\n`;
  report += `Trusted Users    : ${trustedUsers.size}\n`;
  report += `Honeypot Hits    : ${honeypotTripped.size}\n`;
  report += `Blocked Words    : ${blockedWords.size}\n`;
  report += `Honeypot Traps   : ${honeypotTraps.size}\n`;
  report += `Security Logs    : ${securityLog.length}\n\n`;

  // ── SECURITY CONFIG ──
  report += `SECURITY CONFIG\n${dash}\n`;
  report += `Mode             : ${securityMode.toUpperCase()}\n`;
  report += `Anti-Spam        : ${antispamEnabled ? "ON" : "OFF"}\n`;
  report += `Honeypot         : ${honeypotEnabled ? "ON" : "OFF"}\n`;
  report += `Auto-Ban         : ${autobanEnabled ? "ON" : "OFF"}\n`;
  report += `Emergency Lock   : ${emergencyLocked ? "ON ⚠️" : "OFF"}\n`;
  report += `Max Warnings     : ${maxWarnings}\n\n`;

  // ── BANNED USERS ──
  report += `BANNED USERS (${bannedUsers.size})\n${dash}\n`;
  if (bannedUsers.size === 0) {
    report += `None\n`;
  } else {
    for (const uid of bannedUsers) {
      const u = botUsers.get(uid);
      report += `  • ${uid}  @${u?.username || "N/A"}  — ${u?.firstName || ""}\n`;
    }
  }
  report += `\n`;

  // ── SHADOW BANNED ──
  report += `SHADOW BANNED (${shadowBanned.size})\n${dash}\n`;
  if (shadowBanned.size === 0) {
    report += `None\n`;
  } else {
    for (const uid of shadowBanned) {
      const u = botUsers.get(uid);
      report += `  • ${uid}  @${u?.username || "N/A"}\n`;
    }
  }
  report += `\n`;

  // ── MUTED USERS ──
  report += `MUTED USERS (${mutedUsers.size})\n${dash}\n`;
  if (mutedUsers.size === 0) {
    report += `None\n`;
  } else {
    for (const uid of mutedUsers) {
      const u = botUsers.get(uid);
      report += `  • ${uid}  @${u?.username || "N/A"}\n`;
    }
  }
  report += `\n`;

  // ── FLAGGED USERS ──
  report += `FLAGGED USERS (${flaggedUsers.size})\n${dash}\n`;
  if (flaggedUsers.size === 0) {
    report += `None\n`;
  } else {
    for (const [uid, f] of flaggedUsers) {
      const u = botUsers.get(uid);
      report += `  • ${uid}  @${u?.username || "N/A"}  — Reason: ${f.reason}  At: ${f.at ? new Date(f.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "N/A"}\n`;
    }
  }
  report += `\n`;

  // ── WARNED USERS ──
  report += `WARNED USERS (${userWarnings.size})\n${dash}\n`;
  if (userWarnings.size === 0) {
    report += `None\n`;
  } else {
    for (const [uid, w] of userWarnings) {
      const u = botUsers.get(uid);
      report += `  • ${uid}  @${u?.username || "N/A"}  — ${w.count}/${maxWarnings} warnings\n`;
      (w.reasons || []).forEach(r => { report += `      - ${r}\n`; });
    }
  }
  report += `\n`;

  // ── TRUSTED USERS ──
  report += `TRUSTED USERS (${trustedUsers.size})\n${dash}\n`;
  if (trustedUsers.size === 0) {
    report += `None\n`;
  } else {
    for (const uid of trustedUsers) {
      const u = botUsers.get(uid);
      report += `  • ${uid}  @${u?.username || "N/A"}\n`;
    }
  }
  report += `\n`;

  // ── HONEYPOT TRAPS ──
  report += `HONEYPOT TRAPS (${honeypotTraps.size})\n${dash}\n`;
  report += `${[...honeypotTraps].join(", ") || "None"}\n\n`;

  // ── HONEYPOT TRIGGERED ──
  report += `HONEYPOT TRIGGERED (${honeypotTripped.size} users)\n${dash}\n`;
  if (honeypotTripped.size === 0) {
    report += `None\n`;
  } else {
    for (const [uid, traps] of honeypotTripped) {
      const u = botUsers.get(uid);
      report += `  • ${uid}  @${u?.username || "N/A"}  — ${traps.length} trap(s)\n`;
      traps.forEach(t => { report += `      - /${t.command}  at  ${new Date(t.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n`; });
    }
  }
  report += `\n`;

  // ── BLOCKED WORDS ──
  report += `BLOCKED WORDS (${blockedWords.size})\n${dash}\n`;
  report += `${[...blockedWords].join(", ") || "None"}\n\n`;

  // ── SECURITY LOG ──
  report += `SECURITY LOG (last 100 events)\n${dash}\n`;
  if (securityLog.length === 0) {
    report += `No events logged.\n`;
  } else {
    securityLog.slice(0, 100).forEach((e, i) => {
      report += `${String(i + 1).padStart(3, " ")}. [${new Date(e.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}]\n`;
      report += `      Action  : ${e.action}\n`;
      report += `      User    : ${e.userId}  @${e.username || "N/A"}\n`;
      report += `      Detail  : ${e.detail || "—"}\n`;
    });
  }

  report += `\n${sep}\n`;
  report += `End of Report — DRS Network\n`;

  const buf = Buffer.from(report, "utf8");
  const ts  = new Date().toISOString().slice(0, 10);
  await bot.sendDocument(chatId, buf, {
    caption: `📋 <b>Security Report</b>\n<blockquote>Generated: ${now}\n\nBanned: ${bannedUsers.size} | Muted: ${mutedUsers.size} | Shadow: ${shadowBanned.size}\nFlagged: ${flaggedUsers.size} | Warned: ${userWarnings.size} | Trusted: ${trustedUsers.size}\nHoneypot hits: ${honeypotTripped.size} | Logs: ${securityLog.length}</blockquote>`,
    parse_mode: "HTML"
  }, { filename: `drs_security_report_${ts}.txt`, contentType: "text/plain" });
});

// ============================================================
// NEW USER COMMANDS
// ============================================================

// ─── /memstats ─── (admin only)
bot.onText(/\/memstats/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const mem = process.memoryUsage();
  const toMB = b => (b / 1024 / 1024).toFixed(2);

  const activeGiveaways   = [...giveaways.values()].filter(g => g.active).length;
  const endedGiveaways    = [...giveaways.values()].filter(g => !g.active).length;
  const totalParticipants = [...giveaways.values()].reduce((s, g) => s + (g.participants?.size || 0), 0);

  await bot.sendMessage(msg.chat.id,
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  📊  <b>MEMORY STATS</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `🧠 <b>Node.js Heap:</b>\n` +
    `  • Used:     <b>${toMB(mem.heapUsed)} MB</b>\n` +
    `  • Total:    <b>${toMB(mem.heapTotal)} MB</b>\n` +
    `  • RSS:      <b>${toMB(mem.rss)} MB</b>\n` +
    `  • External: <b>${toMB(mem.external)} MB</b>\n\n` +
    `📦 <b>In-Memory Maps:</b>\n` +
    `  • 🎁 Giveaways (total in RAM): <b>${giveaways.size}</b>\n` +
    `    ↳ Active: <b>${activeGiveaways}</b> · Ended: <b>${endedGiveaways}</b>\n` +
    `    ↳ Total participants in RAM: <b>${totalParticipants}</b>\n` +
    `  • 👥 Bot Users:      <b>${botUsers.size}</b>\n` +
    `  • 👑 VIP Users:      <b>${vipUsers.size}</b>\n` +
    `  • 📢 Channels:       <b>${registeredChannels.size}</b>\n` +
    `  • 💳 Pending Pays:   <b>${pendingPayments.size}</b>\n` +
    `  • 🎨 Custom Texts:   <b>${botCustomTexts.size}</b>\n` +
    `  • 👑 Sub-Admins:     <b>${subAdmins.size}</b>\n` +
    `  • ⚠️ Warnings:       <b>${userWarnings.size}</b>\n` +
    `  • 🔇 Muted:          <b>${mutedUsers.size}</b>\n` +
    `  • 👻 Shadow Banned:  <b>${shadowBanned.size}</b>\n` +
    `  • 🍯 Honeypot Hits:  <b>${honeypotTripped.size}</b>\n` +
    `  • ⏰ Scheduled Msgs: <b>${scheduledMessages.size}</b>\n\n` +
    `<blockquote>🧹 Eviction: ended giveaways &gt;7 days auto-removed from RAM every 30 min\n` +
    `🔄 Manual: /autoclean — run cleanup now</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /about ───
bot.onText(/\/about/, async (msg) => {
  if (msg.chat.type !== "private") return;
  await bot.sendMessage(msg.chat.id,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n   ℹ️  <b>𝐀𝐁𝐎𝐔𝐓 𝐃𝐑𝐒 𝐁𝐎𝐓</b>\n✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>◈ ɴᴀᴍᴇ     ▸  <b>DRS Giveaway Bot</b>\n◈ ᴠᴇʀꜱɪᴏɴ  ▸  <b>v3.0.8</b>\n◈ ɴᴇᴛᴡᴏʀᴋ  ▸  <a href="https://t.me/rchiex">DRS Network</a>\n◈ ꜱᴜᴘᴘᴏʀᴛ  ▸  <a href="https://t.me/drssupport">@drssupport</a>\n◈ ʙᴀꜱᴇ    ▸  MongoDB · Node.js · Telegram API\n◈ ꜰᴇᴀᴛᴜʀᴇꜱ ▸  Giveaway · Voting · VIP · Anti-Cheat · Security Engine</blockquote>\n\n✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } });
});

// ─── /version ───
bot.onText(/\/version/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const uptime = Math.floor((Date.now() - botStartTime) / 1000);
  const uptimeStr = `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`;
  await bot.sendMessage(msg.chat.id,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n   🔢  <b>ʙᴏᴛ ᴠᴇʀꜱɪᴏɴ</b>\n✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>◈ ᴠᴇʀꜱɪᴏɴ  ▸  <b>v3.0.8</b>\n◈ ᴜᴘᴛɪᴍᴇ   ▸  ${uptimeStr}\n◈ ᴅʙ       ▸  MongoDB\n◈ ʀᴜɴᴛɪᴍᴇ  ▸  Node.js 18+\n◈ ꜰʀᴀᴍᴇᴡᴏʀᴋ ▸  node-telegram-bot-api</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /uptime ───
bot.onText(/\/uptime/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const uptime = Math.floor((Date.now() - botStartTime) / 1000);
  const d = Math.floor(uptime / 86400), h = Math.floor((uptime % 86400) / 3600), m = Math.floor((uptime % 3600) / 60), s = uptime % 60;
  await bot.sendMessage(msg.chat.id,
    `⏱️ <b>ʙᴏᴛ ᴜᴘᴛɪᴍᴇ</b>\n<blockquote>${d}d ${h}h ${m}m ${s}s\n\n⚡ Powered by DRS Network</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /rules ───
bot.onText(/\/rules/, async (msg) => {
  if (msg.chat.type !== "private") return;
  await bot.sendMessage(msg.chat.id,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n   📜  <b>ʙᴏᴛ ʀᴜʟᴇꜱ</b>\n✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>1️⃣ <b>Fair Play</b> — Vote manipulation strictly banned\n\n2️⃣ <b>No Spam</b> — Repeated commands = auto-rate-limit + warning\n\n3️⃣ <b>No Hacking</b> — API exploit / bot hack attempt = permanent ban\n\n4️⃣ <b>Payments</b> — Sirf verified screenshots accepted, fake = ban\n\n5️⃣ <b>Channel Membership</b> — Channel chhoda = votes auto-deduct\n\n6️⃣ <b>Respect</b> — Abusive language = warning + ban\n\n7️⃣ <b>VIP Features</b> — Premium features ke liye VIP plan chahiye\n\n⚠️ <i>Rules tod ne par warning aur phir ban — no notice.</i></blockquote>\n\n✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } });
});

// ─── /faq ───
bot.onText(/\/faq/, async (msg) => {
  if (msg.chat.type !== "private") return;
  await bot.sendMessage(msg.chat.id,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n   ❓  <b>ꜰᴀQ</b>\n✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote><b>Q: Giveaway kaise banate hain?</b>\n▸ /start → 🎁 New Giveaway → wizard follow karo\n\n<b>Q: Vote kaise milte hain?</b>\n▸ Free: Channel member bano aur vote karo\n▸ Extra: INR ya ⭐ Stars se kharido\n\n<b>Q: VIP ke kya fayde hain?</b>\n▸ Custom thumbnail, unlimited giveaways, extra force-join gate\n\n<b>Q: Vote kyu cut hue?</b>\n▸ Channel chhoda → votes auto-deduct hote hain\n\n<b>Q: Payment verify nahi hui?</b>\n▸ /support se admin ko screenshot bhejo\n\n<b>Q: Bot respond nahi kar raha?</b>\n▸ /start karo, ya /support se contact karo\n\n<b>Q: Winner kaise decide hota hai?</b>\n▸ Top vote wale participants auto-selected hote hain</blockquote>\n\n✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } });
});

// ─── /terms ───
bot.onText(/\/terms/, async (msg) => {
  if (msg.chat.type !== "private") return;
  await bot.sendMessage(msg.chat.id,
    `✦━━━━━━━━━━━━━━━━━━━━━✦\n   📄  <b>ᴛᴇʀᴍꜱ ᴏꜰ ꜱᴇʀᴠɪᴄᴇ</b>\n✦━━━━━━━━━━━━━━━━━━━━━✦\n\n` +
    `<blockquote>▸ Bot use karna = yeh terms accept karna\n▸ Payments non-refundable hain\n▸ Fake payments/screenshots = permanent ban\n▸ DRS Network kisi bhi time rules change kar sakta hai\n▸ Giveaway winners bot algorithm se decide hote hain\n▸ API abuse ya bot hack attempt → legal action possible\n▸ Admin ka decision final hoga</blockquote>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } });
});

// ─── /countdown ───
bot.onText(/\/countdown(.*)/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const candidates = [...giveaways.values()].filter(g =>
    g.active && g.autoEnd && g.endTime && (g.creatorId === userId || isAdmin(userId))
  );
  if (!candidates.length) return bot.sendMessage(chatId,
    `⏳ <b>ᴄᴏᴜɴᴛᴅᴏᴡɴ</b>\n<blockquote>Koi active auto-end giveaway nahi mila.</blockquote>`,
    { parse_mode: "HTML" });
  let text = `⏳━━━━━━━━━━━━━━━━━━━━━━⏳\n   ⏰  <b>ɢɪᴠᴇᴀᴡᴀʏ ᴄᴏᴜɴᴛᴅᴏᴡɴ</b>\n⏳━━━━━━━━━━━━━━━━━━━━━━⏳\n\n<blockquote>`;
  for (const g of candidates.slice(0, 5)) {
    const remaining = new Date(g.endTime).getTime() - Date.now();
    const h = Math.max(0, Math.floor(remaining / 3600000));
    const m = Math.max(0, Math.floor((remaining % 3600000) / 60000));
    const s = Math.max(0, Math.floor((remaining % 60000) / 1000));
    text += `🎁 <b>${g.title.slice(0, 30)}</b>\n   └ ⏱️ ${remaining > 0 ? `${h}h ${m}m ${s}s remaining` : "⌛ Ending soon..."}\n\n`;
  }
  text += `</blockquote>`;
  await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
});

// ─── /rank ───
bot.onText(/\/rank/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  const allCreators = {};
  for (const g of giveaways.values()) allCreators[g.creatorId] = (allCreators[g.creatorId] || 0) + 1;
  const sorted = Object.entries(allCreators).sort((a, b) => b[1] - a[1]);
  const rank = sorted.findIndex(([id]) => Number(id) === userId) + 1;
  const count = allCreators[userId] || 0;
  const u = botUsers.get(userId);
  await bot.sendMessage(msg.chat.id,
    `🏅━━━━━━━━━━━━━━━━━━━━━━🏅\n   <b>ᴜꜱᴇʀ ʀᴀɴᴋ</b>\n🏅━━━━━━━━━━━━━━━━━━━━━━🏅\n\n` +
    `<blockquote>◈ ɴᴀᴍᴇ       ▸  ${u?.firstName || "User"}\n◈ ɢɪᴠᴇᴀᴡᴀʏꜱ  ▸  ${count}\n◈ ɢʟᴏʙᴀʟ ʀᴀɴᴋ ▸  ${rank > 0 ? "#" + rank : "Unranked"}\n◈ ᴛᴏᴛᴀʟ ᴜꜱᴇʀꜱ  ▸  ${sorted.length}</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /invite ───
bot.onText(/\/invite/, async (msg) => {
  if (msg.chat.type !== "private") return;
  let botUsername = "";
  try { const me = await bot.getMe(); botUsername = me.username; } catch {}
  await bot.sendMessage(msg.chat.id,
    `🔗━━━━━━━━━━━━━━━━━━━━━━🔗\n   <b>ɪɴᴠɪᴛᴇ ʙᴏᴛ ᴛᴏ ᴄʜᴀɴɴᴇʟ</b>\n🔗━━━━━━━━━━━━━━━━━━━━━━🔗\n\n` +
    `<blockquote>Apne channel mein bot admin banao:\n\n1️⃣ Channel Settings → Administrators\n2️⃣ Add Admin → @${botUsername}\n3️⃣ Post Messages ✅ do\n4️⃣ /start → New Giveaway banao!</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /notify ───
bot.onText(/\/notify/, async (msg) => {
  if (msg.chat.type !== "private") return;
  await bot.sendMessage(msg.chat.id,
    `🔔 <b>ɴᴏᴛɪꜰɪᴄᴀᴛɪᴏɴꜱ</b>\n<blockquote>DRS Bot aapko in events pe notify karta hai:\n\n▸ Giveaway winners announce\n▸ VIP expiry warning (1 day pehle)\n▸ Payment approved/rejected\n▸ Support reply from admin\n▸ Vote panel alerts\n\nNotifications always on hain. Issue ho toh /support pe contact karo.</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /refer ───
bot.onText(/\/refer/, async (msg) => {
  if (msg.chat.type !== "private") return;
  let botUsername = "";
  try { const me = await bot.getMe(); botUsername = me.username; } catch {}
  const userId = msg.from.id;
  await bot.sendMessage(msg.chat.id,
    `🎁━━━━━━━━━━━━━━━━━━━━━━🎁\n   <b>ʀᴇꜰᴇʀʀᴀʟ ʟɪɴᴋ</b>\n🎁━━━━━━━━━━━━━━━━━━━━━━🎁\n\n` +
    `<blockquote>Apna referral link share karo:\n\n<code>https://t.me/${botUsername}?start=ref_${userId}</code>\n\nFriends ko DRS Bot invite karo aur network badhao! 🚀</blockquote>`,
    { parse_mode: "HTML" });
});

// ─── /feedback ───
bot.onText(/\/feedback/, async (msg) => {
  if (msg.chat.type !== "private") return;
  const userId = msg.from.id;
  userState.set(userId, { step: "awaiting_feedback_message" });
  await bot.sendMessage(msg.chat.id,
    `💬━━━━━━━━━━━━━━━━━━━━━━💬\n   <b>ꜱᴇɴᴅ ꜰᴇᴇᴅʙᴀᴄᴋ</b>\n💬━━━━━━━━━━━━━━━━━━━━━━💬\n\n` +
    `<blockquote>Apna feedback bhejo — improvements, bugs, suggestions sab welcome hain!\n\n` +
    `Aap bhej sakte ho:\n▸ Text message\n▸ Screenshot / Photo\n▸ Video ya Document\n\n` +
    `Admin dekh lega aur reply karega. 🙏</blockquote>`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard() });
});

// ============================================================
// CLEANDB CALLBACK HANDLER
// ============================================================

// Handled inside the main callback query handler via data.startsWith("cleandb:")
// Added below alongside existing callback handlers

// ============================================================
// UNKNOWN COMMAND HANDLER
// ============================================================

const KNOWN_COMMANDS = new Set([
  "start","help","membership","myplan","leaderboard","mystats","botstatus","ping","myid",
  "createpost","topvoters","active","winners","glink","support","adminhelp","stats",
  "broadcast","loud","send","sendloud","pin","allchannels","allgiveaways",
  "givemem","removemem","extendmem","deductmem","listmem","meminfo","setplan",
  "ban","unban","userinfo","listusers","dm","reply","exportusers",
  "addvotes","removevotes","setwinner","endgiveaway","cancelgiveaway","resetvotes",
  "clonegiveaway","giveawayreport","announce","remindvote","voteleaderboard",
  "setlbbroadcast","stoplbbroadcast","listlbbroadcast",
  "setstar","setinr","setpanelthreshold","schedule","schedulelist","cancelschedule",
  "setwelcomemsg","clearwelcomemsg","setwelcomeimageurl","clearwelcomeimage",
  "setmembershipqr","imageinfo","setforcejoin","forcejoininfo","setfreelimit",
  "perms","viewperms","setperms","paystats","removepay","clearallpending","maintenance",
  "cleandb","setstartimage","clearstates","gcount","topusers",
  "securityhelp","honeypot","honeytrap","removetrap","listtraps","honeypotlist","cleanhoneypot",
  "warnuser","warnings","clearwarnings","muteuser","unmuteuser","mutedlist",
  "shadowban","unshadowban","shadowlist","trustuser","untrustuser","trustedlist",
  "flaguser","unflaguser","flaggedlist","autoban","setmaxwarns","securitymode",
  "antispam","emergencylock","emergencyunlock","securitystats","suspicious","auditlog",
  "clearaudit","resetsecurity","userhistory","blockword","unblockword","blockedwords","ratelimitreset","securityreport",
  "previewwelcome",
  "addadmin","removeadmin","listadmins","editadminperms",
  "customize","settext","resettext","listtext","preview",
  "pushgithub","health",
  "about","version","uptime","rules","faq","terms","countdown","rank","invite","notify","refer","feedback",
  "autoclean","cloneui","resetui","memstats",
  "setownerid",
  "setlogdest"
]);

bot.on("message", async (msg) => {
  try {
    if (msg.chat.type !== "private") return;
    if (!msg.text?.startsWith("/")) return;
    const cmd = msg.text.split(" ")[0].split("@")[0].slice(1).toLowerCase();
    if (KNOWN_COMMANDS.has(cmd)) return;
    const userId = msg.from.id;
    await bot.sendMessage(msg.chat.id,
      `❓━━━━━━━━━━━━━━━━━━━━━━❓\n   <b>ᴜɴᴋɴᴏᴡɴ ᴄᴏᴍᴍᴀɴᴅ</b>\n❓━━━━━━━━━━━━━━━━━━━━━━❓\n\n` +
      `<blockquote>◈ Command <code>/${cmd}</code> exist nahi karta.\n\n📖 Saare commands:\n/help — User commands\n\n💡 Koi problem ho toh /support karo.</blockquote>`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "📖 ʜᴇʟᴘ", callback_data: "show_help" }, { text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } }
    ).catch(() => {});
  } catch (e) { console.error("unknown_cmd handler error:", e.message); }
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
// /health — Bot health status
// ============================================================
bot.onText(/\/health/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const upMs   = Date.now() - botStartTime;
  const upSecs = Math.floor(upMs / 1000);
  const upH    = Math.floor(upSecs / 3600);
  const upM    = Math.floor((upSecs % 3600) / 60);
  const upS    = upSecs % 60;
  const upStr  = `${upH}h ${upM}m ${upS}s`;

  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? "✅ Connected" : dbState === 2 ? "🔄 Connecting" : "❌ Disconnected";

  const activeG = [...giveaways.values()].filter(g => g.active).length;
  const totalG  = giveaways.size;
  const memMB   = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  const totalMB = (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(1);

  const text =
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🏥  <b>BOT HEALTH REPORT</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `<blockquote>` +
    `⏱️ Uptime      » <b>${upStr}</b>\n` +
    `💾 MongoDB     » <b>${dbStatus}</b>\n` +
    `🎁 Giveaways   » <b>${activeG} active / ${totalG} total</b>\n` +
    `👥 Users       » <b>${botUsers.size}</b>\n` +
    `👑 VIP         » <b>${vipUsers.size}</b>\n` +
    `🔧 Maintenance » <b>${maintenanceMode ? "🚫 ON" : "✅ OFF"}</b>\n` +
    `🔒 EmergencyLock» <b>${emergencyLocked ? "🚫 ON" : "✅ OFF"}</b>\n` +
    `🛡️ Security    » <b>${securityMode.toUpperCase()}</b>\n` +
    `🧠 Memory      » <b>${memMB} MB / ${totalMB} MB</b>\n` +
    `📋 Custom Texts» <b>${botCustomTexts.size} overrides</b>\n` +
    `⏰ Scheduled   » <b>${scheduledMessages.size} pending</b>\n` +
    `💳 Payments    » <b>${pendingPayments.size} pending</b>` +
    `</blockquote>\n\n` +
    `<i>Checked at ${new Date().toUTCString()}</i>`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// ============================================================
// /customize — Interactive UI text customizer
// ============================================================
const UI_KEYS = Object.keys(DEFAULT_UI_TEXTS);
const CUST_PAGE_SIZE = 8;

function custKeyboard(page) {
  const start  = page * CUST_PAGE_SIZE;
  const slice  = UI_KEYS.slice(start, start + CUST_PAGE_SIZE);
  const rows   = slice.map(k => [{
    text: (botCustomTexts.has(k) ? "✏️ " : "   ") + k,
    callback_data: `cust_edit:${k}`
  }]);
  const nav = [];
  if (page > 0) nav.push({ text: "⬅️ Prev", callback_data: `cust_page:${page - 1}` });
  nav.push({ text: `📄 ${page + 1}/${Math.ceil(UI_KEYS.length / CUST_PAGE_SIZE)}`, callback_data: "cust_noop" });
  if (start + CUST_PAGE_SIZE < UI_KEYS.length) nav.push({ text: "Next ➡️", callback_data: `cust_page:${page + 1}` });
  rows.push(nav);
  rows.push([{ text: "🔙 Close", callback_data: "cust_close" }]);
  return { inline_keyboard: rows };
}

bot.onText(/\/customize/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const text =
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n` +
    `  🎨  <b>UI TEXT CUSTOMIZER</b>\n` +
    `◈━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
    `Bot ke <b>${UI_KEYS.length}</b> customizable texts hain.\n` +
    `✏️ = already customized\n\n` +
    `Kisi bhi key par tap karo — phir naya text bhejo.\n` +
    `<code>/settext &lt;key&gt; &lt;new value&gt;</code> se bhi directly set kar sakte ho.\n` +
    `<code>/resettext &lt;key&gt;</code> se default restore hoga.`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML", reply_markup: custKeyboard(0) });
});


// /settext <key> <value>
bot.onText(/\/settext\s+(\S+)\s+([\s\S]+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const key      = match[1].trim();
  const rawMatch = match[2];           // untrimmed captured group
  const value    = rawMatch.trim();    // actual value text
  if (!DEFAULT_UI_TEXTS.hasOwnProperty(key)) {
    const validKeys = UI_KEYS.join("\n• ");
    return bot.sendMessage(msg.chat.id,
      `❌ Unknown key: <code>${h(key)}</code>\n\nValid keys:\n• ${validKeys}`,
      { parse_mode: "HTML" });
  }
  // Compute UTF-16 offset where value starts (prefix is ASCII so char = UTF-16 units)
  const prefixLen    = utf16Len(msg.text) - utf16Len(rawMatch) + (rawMatch.length - rawMatch.trimStart().length);
  const htmlValue    = buildHtmlValue(value, msg.entities, prefixLen);
  botCustomTexts.set(key, htmlValue);
  await BotConfigModel.findOneAndUpdate(
    { key: `ui:${key}` }, { key: `ui:${key}`, value: htmlValue }, { upsert: true }
  );
  await bot.sendMessage(msg.chat.id,
    `✅ <b>Text updated!</b>\n\n🔑 Key: <code>${h(key)}</code>\n\n` +
    `👁 <b>Aisa dikhega (premium emoji sahit):</b>\n` +
    `┌───────────────────────┐\n` +
    `  ${htmlValue}\n` +
    `└───────────────────────┘\n\n` +
    `<i>/previewwelcome se full welcome dekho</i>`,
    { parse_mode: "HTML" });
});

// /resettext <key>
bot.onText(/\/resettext\s+(\S+)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const key = match[1].trim();
  if (!DEFAULT_UI_TEXTS.hasOwnProperty(key)) {
    return bot.sendMessage(msg.chat.id, `❌ Unknown key: <code>${key}</code>`, { parse_mode: "HTML" });
  }
  botCustomTexts.delete(key);
  await BotConfigModel.deleteOne({ key: `ui:${key}` });
  await bot.sendMessage(msg.chat.id,
    `✅ <b>Reset to default!</b>\n\n🔑 Key: <code>${key}</code>\n📌 Default:\n<blockquote>${DEFAULT_UI_TEXTS[key]}</blockquote>`,
    { parse_mode: "HTML" });
});

// /listtext — show all keys with current values
bot.onText(/\/listtext/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const lines = UI_KEYS.map(k => {
    // Custom values are stored as HTML (may contain <tg-emoji>), render directly
    // Default values are plain text, escape for safety
    const val = botCustomTexts.has(k)
      ? `✏️ ${botCustomTexts.get(k)}`
      : `   ${h(DEFAULT_UI_TEXTS[k])}`;
    return `<code>${h(k)}</code>\n↳ ${val}`;
  }).join("\n\n");
  const chunks = [];
  let chunk = "";
  for (const line of lines.split("\n\n")) {
    if ((chunk + "\n\n" + line).length > 3800) {
      chunks.push(chunk);
      chunk = line;
    } else {
      chunk = chunk ? chunk + "\n\n" + line : line;
    }
  }
  if (chunk) chunks.push(chunk);
  for (const c of chunks) {
    await bot.sendMessage(msg.chat.id,
      `🎨 <b>All UI Texts</b> (✏️ = custom)\n\n${c}`,
      { parse_mode: "HTML" });
  }
});

// /preview <key> — show exactly what that UI text looks like
bot.onText(/\/preview(?:\s+(\S+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const key = match?.[1]?.trim();
  if (!key) {
    const keyList = UI_KEYS.map(k => `<code>/preview ${k}</code>`).join("\n");
    return bot.sendMessage(msg.chat.id,
      `🔍 <b>Preview kisi bhi UI key ka:</b>\n\n${keyList}`,
      { parse_mode: "HTML" });
  }
  if (!DEFAULT_UI_TEXTS.hasOwnProperty(key)) {
    return bot.sendMessage(msg.chat.id,
      `❌ Unknown key: <code>${h(key)}</code>\n\nSab keys dekhne ke liye: /listtext`,
      { parse_mode: "HTML" });
  }
  const isCustom   = botCustomTexts.has(key);
  const current    = getUI(key);
  const def        = DEFAULT_UI_TEXTS[key];
  const sameAsDefault = !isCustom;

  const msg2 =
    `🔍━━━━━━━━━━━━━━━━━━━━━━🔍\n` +
    `  👁  <b>UI KEY PREVIEW</b>\n` +
    `🔍━━━━━━━━━━━━━━━━━━━━━━🔍\n\n` +
    `🔑 <b>Key:</b> <code>${h(key)}</code>\n` +
    `📌 <b>Status:</b> ${isCustom ? "✏️ Custom set hai" : "🔄 Default use ho raha hai"}\n\n` +
    `🚀 <b>Default value:</b>\n<code>${h(def)}</code>\n\n` +
    (isCustom ?
      `✏️ <b>Current (custom) value:</b>\n` +
      `┌───────────────────────┐\n` +
      `  ${botCustomTexts.get(key)}\n` +
      `└───────────────────────┘\n\n` : ``) +
    `👁 <b>Exactly aisa dikhega (premium emoji sahit):</b>\n` +
    `┌───────────────────────┐\n` +
    `  ${current}\n` +
    `└───────────────────────┘\n\n` +
    `<i>Change: /customize → key tap karo, ya /settext ${h(key)} naya text</i>`;

  await bot.sendMessage(msg.chat.id, msg2, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [
      [{ text: "✏️ Edit This Key", callback_data: `cust_edit:${key}` }],
      ...(isCustom ? [[{ text: "🔄 Reset to Default", callback_data: `cust_reset:${key}` }]] : [])
    ]}
  });
});

// ============================================================
// /setlogdest — Change where user logs/notifications are sent
// ============================================================
bot.onText(/\/setlogdest(?:\s+(\S+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (userId !== ownerAdminId) return;

  const arg = match[1] ? match[1].trim() : null;

  if (!arg) {
    const currentDest = logDestId || ownerAdminId;
    const destType = logDestId
      ? (String(logDestId).startsWith("-") ? "📢 Channel" : "👤 User")
      : "👑 Owner (Default)";
    return bot.sendMessage(chatId,
      `📡━━━━━━━━━━━━━━━━━━━━━━━━📡\n` +
      `  🔧  <b>LOG DESTINATION</b>\n` +
      `📡━━━━━━━━━━━━━━━━━━━━━━━━📡\n\n` +
      `<blockquote>` +
      `◈ Current Dest  ▸  <code>${currentDest}</code>\n` +
      `◈ Type          ▸  ${destType}\n\n` +
      `📌 <b>Usage:</b>\n` +
      `Set user ID:  <code>/setlogdest 123456789</code>\n` +
      `Set channel:  <code>/setlogdest -1001234567890</code>\n` +
      `Reset to me:  <code>/setlogdest reset</code>\n\n` +
      `⚠️ <b>Channel ke liye:</b> Bot ko us channel ka admin banana padega.\n` +
      `✅ Private aur Public dono channels supported hain.` +
      `</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML" }
    );
  }

  if (arg.toLowerCase() === "reset") {
    logDestId = null;
    await BotConfigModel.findOneAndDelete({ key: "logDestId" }).catch(() => {});
    return bot.sendMessage(chatId,
      `✅━━━━━━━━━━━━━━━━━━━━━━━━✅\n` +
      `  <b>LOG DESTINATION RESET</b>\n` +
      `✅━━━━━━━━━━━━━━━━━━━━━━━━✅\n\n` +
      `<blockquote>◈ Logs ab dobara aapke paas aayenge.\n◈ Dest  ▸  <code>${ownerAdminId}</code> (Owner)</blockquote>\n\n` +
      `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
      { parse_mode: "HTML" }
    );
  }

  const newDest = arg.startsWith("-") ? arg : Number(arg);
  if (!newDest || (typeof newDest === "number" && isNaN(newDest))) {
    return bot.sendMessage(chatId,
      `❌ <b>Invalid ID!</b>\n\n<blockquote>User ID: positive number jaise <code>123456789</code>\nChannel ID: negative number jaise <code>-1001234567890</code>\nReset: <code>/setlogdest reset</code></blockquote>`,
      { parse_mode: "HTML" }
    );
  }

  // Test send to verify access
  try {
    await bot.sendMessage(newDest,
      `✅ <b>Log Destination Test</b>\n\n<blockquote>Yeh channel/user ab DRS bot ke logs receive karega.\n\n⚡ Powered by DRS NETWORK</blockquote>`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    return bot.sendMessage(chatId,
      `❌━━━━━━━━━━━━━━━━━━━━━━━━❌\n  <b>ACCESS FAILED</b>\n❌━━━━━━━━━━━━━━━━━━━━━━━━❌\n\n` +
      `<blockquote>◈ ID  ▸  <code>${newDest}</code>\n◈ Error  ▸  ${e.message}\n\n` +
      `⚠️ Channel ke liye bot ko admin banana padega.</blockquote>`,
      { parse_mode: "HTML" }
    );
  }

  const oldDest = logDestId || ownerAdminId;
  logDestId = newDest;
  await BotConfigModel.findOneAndUpdate(
    { key: "logDestId" },
    { key: "logDestId", value: newDest },
    { upsert: true }
  );
  const destType = String(newDest).startsWith("-") ? "📢 Channel" : "👤 User";

  await bot.sendMessage(chatId,
    `✅━━━━━━━━━━━━━━━━━━━━━━━━━━✅\n` +
    `  🔧  <b>LOG DESTINATION UPDATED</b>\n` +
    `✅━━━━━━━━━━━━━━━━━━━━━━━━━━✅\n\n` +
    `<blockquote>` +
    `◈ Purana Dest  ▸  <code>${oldDest}</code>\n` +
    `◈ Naya Dest    ▸  <code>${newDest}</code>\n` +
    `◈ Type         ▸  ${destType}\n\n` +
    `✅ Ab saare user logs, support messages, feedback aur payment notifications iss destination pe aayenge.\n` +
    `✅ DB mein save ho gaya — restart ke baad bhi yahi setting rahegi.` +
    `</blockquote>\n\n` +
    `✦ ─── <b>DRS NETWORK</b> ─── ✦`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 Home", callback_data: "main_menu" }]] } }
  );
});

bot.onText(/\/setownerid(?:\s+(\d+))?/, async (msg, match) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Only current owner can use this
  if (userId !== ownerAdminId) return;

  const newId = match[1] ? Number(match[1]) : null;
  if (!newId) {
    return bot.sendMessage(chatId,
      `👑━━━━━━━━━━━━━━━━━━━━━━👑\n` +
      `   <b>ꜱᴇᴛ ᴏᴡɴᴇʀ ɪᴅ</b>\n` +
      `👑━━━━━━━━━━━━━━━━━━━━━━👑\n\n` +
      `<blockquote>◈ ᴄᴜʀʀᴇɴᴛ ᴏᴡɴᴇʀ ɪᴅ  ▸  <code>${ownerAdminId}</code>\n\n` +
      `📌 Usage:\n<code>/setownerid &lt;new_user_id&gt;</code>\n\n` +
      `⚠️ <b>Dhyan rakho:</b> Ye change permanent hai (DB mein save hoga). Naya ID bot ka naya owner banega.</blockquote>`,
      { parse_mode: "HTML" }
    );
  }

  if (newId === ownerAdminId) {
    return bot.sendMessage(chatId,
      `⚠️ <b>Same ID</b> — Ye pehle se hi owner ID hai!`,
      { parse_mode: "HTML" }
    );
  }

  const oldId = ownerAdminId;
  ownerAdminId = newId;
  await BotConfigModel.findOneAndUpdate(
    { key: "ownerAdminId" },
    { key: "ownerAdminId", value: newId },
    { upsert: true }
  );

  await bot.sendMessage(chatId,
    `✅━━━━━━━━━━━━━━━━━━━━━━✅\n` +
    `   <b>ᴏᴡɴᴇʀ ɪᴅ ᴜᴘᴅᴀᴛᴇᴅ</b>\n` +
    `✅━━━━━━━━━━━━━━━━━━━━━━✅\n\n` +
    `<blockquote>◈ ᴘᴜʀᴀɴᴀ ɪᴅ  ▸  <code>${oldId}</code>\n` +
    `◈ ɴᴀʏᴀ ɪᴅ    ▸  <code>${newId}</code>\n\n` +
    `✅ DB mein save ho gaya. Restart ke baad bhi yahi ID owner rahega.</blockquote>\n\n` +
    `✈️━━━━<a href="https://t.me/rchiex">━ 𝐃𝐑𝐒 ━</a>━━━━✈️`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏠 ʜᴏᴍᴇ", callback_data: "main_menu" }]] } }
  );

  // Notify new owner
  try {
    await bot.sendMessage(newId,
      `👑 <b>ʙᴏᴛ ᴏᴡɴᴇʀꜱʜɪᴘ ᴛʀᴀɴꜱꜰᴇʀ</b>\n\n` +
      `<blockquote>Aapko is bot ka naya Owner banaya gaya hai!\n\n` +
      `◈ ᴘᴜʀᴀɴᴀ ᴏᴡɴᴇʀ  ▸  <code>${oldId}</code>\n` +
      `◈ ᴀᴀᴘᴋᴀ ɪᴅ       ▸  <code>${newId}</code></blockquote>`,
      { parse_mode: "HTML" }
    );
  } catch { /* new owner might not have started the bot yet */ }
});

// ============================================================
// /autoclean — Manually trigger memory eviction + DB cleanup
// ============================================================
bot.onText(/\/autoclean/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const statusMsg = await bot.sendMessage(chatId, "🧹 <b>Cleanup chal raha hai...</b>", { parse_mode: "HTML" });

  const beforeHeap = process.memoryUsage().heapUsed;
  const memEvicted = runMemoryEviction();
  const db = await runDBCleanup();
  const afterHeap = process.memoryUsage().heapUsed;
  const freed = Math.max(0, beforeHeap - afterHeap);

  await bot.editMessageText(
    `✅ <b>Cleanup Complete!</b>\n\n` +
    `🧠 <b>Memory (RAM):</b>\n` +
    `  • Giveaways evicted from RAM: <b>${memEvicted}</b>\n` +
    `  • Heap before: <b>${(beforeHeap / 1024 / 1024).toFixed(1)} MB</b>\n` +
    `  • Heap after:  <b>${(afterHeap / 1024 / 1024).toFixed(1)} MB</b>\n` +
    `  • Freed: <b>${(freed / 1024 / 1024).toFixed(2)} MB</b>\n\n` +
    `🗄️ <b>MongoDB:</b>\n` +
    `  • Security logs trimmed: <b>${db.secLogs}</b>\n` +
    `  • Old payments deleted: <b>${db.payments + db.membershipPayments}</b>\n` +
    `  • Old giveaways compressed: <b>${db.giveawaysCompressed}</b>\n\n` +
    `<blockquote>👥 User data · VIP records · Active giveaways — sab safe hain ✅\n` +
    `Auto-cleanup harta hai: RAM har 30 min, DB har 24 hrs</blockquote>`,
    { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" }
  );
});

// ============================================================
// /resetui — Reset ALL UI custom texts to default (with confirmation)
// ============================================================
bot.onText(/\/resetui/, async (msg) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const customCount = botCustomTexts.size;

  await bot.sendMessage(chatId,
    `⚠️ <b>Full UI Reset — Confirmation</b>\n\n` +
    `Ye command <b>saare ${customCount} custom UI text</b> delete kar dega aur sab kuch default pe wapas le aayega.\n\n` +
    `📦 <b>Pehle backup lo:</b> /cloneui export\n\n` +
    `<b>Kya aap sure hain?</b>`,
    {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[
        { text: "✅ Haan, sab reset karo", callback_data: "resetui_confirm" },
        { text: "❌ Cancel", callback_data: "resetui_cancel" }
      ]]}
    });
});

// ============================================================
// /cloneui — Export / Import all UI customizations as JSON
// ============================================================
bot.onText(/\/cloneui(?:\s+(export|import))?([\s\S]*)/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const action = match?.[1]?.trim().toLowerCase();
  const payload = match?.[2]?.trim();

  if (!action) {
    return bot.sendMessage(chatId,
      `📦 <b>CloneUI — Settings Backup & Restore</b>\n\n` +
      `<b>Export</b> (saari settings ka backup lo):\n` +
      `<code>/cloneui export</code>\n\n` +
      `<b>Import</b> (doosre bot pe restore karo):\n` +
      `<code>/cloneui import {"ui":{...},...}</code>\n\n` +
      `<i>Export karo → JSON copy karo → doosre bot pe import karo ✅</i>`,
      { parse_mode: "HTML" });
  }

  // ── EXPORT ──
  if (action === "export") {
    const uiTexts = {};
    for (const [k, v] of botCustomTexts.entries()) uiTexts[k] = v;

    const exportData = {
      version: 1,
      exported_at: new Date().toISOString(),
      ui: uiTexts,
      customWelcomeText: customWelcomeText || null,
      welcomeImageUrl: welcomeImageUrl || null,
      membershipPlans: membershipPlans,
      freeGiveawayLimit: freeGiveawayLimit ?? null,
      freeUnlimited: freeUnlimited ?? false,
    };

    const json = JSON.stringify(exportData, null, 2);
    const customCount = Object.keys(uiTexts).length;

    if (json.length <= 3800) {
      await bot.sendMessage(chatId,
        `📦 <b>CloneUI Export</b> ✅\n\n` +
        `✏️ Custom UI texts: <b>${customCount}</b>\n` +
        `📋 Ye JSON copy karo aur doosre bot pe <code>/cloneui import</code> se import karo:\n\n` +
        `<pre><code>${h(json)}</code></pre>`,
        { parse_mode: "HTML" });
    } else {
      // Send as file for large exports
      const buf = Buffer.from(json, "utf8");
      await bot.sendDocument(chatId, buf, {
        caption: `📦 <b>CloneUI Export</b> ✅\n✏️ Custom UI texts: <b>${customCount}</b>\n\n<i>File download karo, content copy karo, aur <code>/cloneui import &lt;json&gt;</code> se import karo.</i>`,
        parse_mode: "HTML"
      }, { filename: "cloneui-export.json", contentType: "application/json" });
    }
    return;
  }

  // ── IMPORT ──
  if (action === "import") {
    if (!payload) {
      return bot.sendMessage(chatId,
        `❌ JSON payload missing!\n\nUsage:\n<code>/cloneui import {"version":1,...}</code>`,
        { parse_mode: "HTML" });
    }

    let data;
    try {
      data = JSON.parse(payload);
    } catch (e) {
      return bot.sendMessage(chatId,
        `❌ <b>Invalid JSON!</b>\n\n<code>${h(e.message)}</code>\n\n<i>Export ka pura JSON paste karo.</i>`,
        { parse_mode: "HTML" });
    }

    if (!data || typeof data !== "object") {
      return bot.sendMessage(chatId, `❌ Invalid export data format.`, { parse_mode: "HTML" });
    }

    const statusMsg = await bot.sendMessage(chatId, "⏳ Import ho raha hai...", { parse_mode: "HTML" });
    let applied = 0;
    const errors = [];

    try {
      // Import UI texts
      if (data.ui && typeof data.ui === "object") {
        for (const [key, value] of Object.entries(data.ui)) {
          if (!DEFAULT_UI_TEXTS.hasOwnProperty(key)) continue;
          try {
            botCustomTexts.set(key, value);
            await BotConfigModel.findOneAndUpdate(
              { key: `ui:${key}` }, { key: `ui:${key}`, value }, { upsert: true }
            );
            applied++;
          } catch (e) { errors.push(`ui:${key}`); }
        }
      }

      // Import customWelcomeText
      if (typeof data.customWelcomeText === "string" && data.customWelcomeText) {
        customWelcomeText = data.customWelcomeText;
        await saveConfig("customWelcomeText", customWelcomeText);
      } else if (data.customWelcomeText === null) {
        customWelcomeText = null;
        await saveConfig("customWelcomeText", null);
      }

      // Import welcomeImageUrl
      if (typeof data.welcomeImageUrl === "string" && data.welcomeImageUrl) {
        welcomeImageUrl = data.welcomeImageUrl;
        await saveConfig("welcomeImageUrl", welcomeImageUrl);
      } else if (data.welcomeImageUrl === null) {
        welcomeImageUrl = null;
        await saveConfig("welcomeImageUrl", null);
      }

      // Import membershipPlans
      if (data.membershipPlans && typeof data.membershipPlans === "object") {
        Object.assign(membershipPlans, data.membershipPlans);
        await saveConfig("membershipPlans", membershipPlans);
      }

      // Import freeGiveawayLimit
      if (typeof data.freeGiveawayLimit === "number") {
        freeGiveawayLimit = data.freeGiveawayLimit;
        await saveConfig("freeGiveawayLimit", freeGiveawayLimit);
      }

      // Import freeUnlimited
      if (typeof data.freeUnlimited === "boolean") {
        freeUnlimited = data.freeUnlimited;
        await saveConfig("freeUnlimited", freeUnlimited);
      }

      const errText = errors.length > 0 ? `\n⚠️ Errors: ${errors.length} keys skip kiye` : "";
      await bot.editMessageText(
        `✅ <b>CloneUI Import Done!</b>\n\n` +
        `✏️ UI texts applied: <b>${applied}</b>${errText}\n` +
        `🖼️ Welcome image: ${welcomeImageUrl ? "✅ Set" : "❌ Not set"}\n` +
        `💬 Custom welcome: ${customWelcomeText ? "✅ Set" : "❌ Not set"}\n` +
        `💰 Membership plans: ✅ Updated\n\n` +
        `<i>Sab changes live ho gaye! /previewwelcome se check karo.</i>`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" }
      );
    } catch (e) {
      await bot.editMessageText(
        `❌ <b>Import failed!</b>\n\n<code>${h(e.message)}</code>`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" }
      );
    }
    return;
  }

  bot.sendMessage(chatId,
    `❓ Unknown action. Use:\n<code>/cloneui export</code>\n<code>/cloneui import &lt;json&gt;</code>`,
    { parse_mode: "HTML" });
});

// ============================================================
// /pushgithub — Push current vote-bot.mjs to GitHub
// ============================================================
bot.onText(/\/pushgithub(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (msg.chat.type !== "private" || !isAdmin(msg.from.id)) return;

  const ghToken = process.env.GITHUB_TOKEN;
  const ghRepo  = process.env.GITHUB_REPO_URL;

  if (!ghToken || !ghRepo) {
    return bot.sendMessage(msg.chat.id,
      `❌ <b>GitHub credentials missing!</b>\n\n` +
      `Railway pe ye environment variables set karo:\n` +
      `• <code>GITHUB_TOKEN</code> — GitHub Personal Access Token\n` +
      `• <code>GITHUB_REPO_URL</code> — Repo URL (https://github.com/user/repo)`,
      { parse_mode: "HTML" });
  }

  const commitMsg = match?.[1]?.trim() || `chore: bot update via /pushgithub [${new Date().toISOString()}]`;
  const repoPath  = ghRepo.replace("https://github.com/", "").replace(/\/$/, "");

  const statusMsg = await bot.sendMessage(msg.chat.id, "⏳ GitHub pe push ho raha hai...", { parse_mode: "HTML" });

  try {
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { dirname, join } = await import("path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const fileContent = readFileSync(join(__dirname, "vote-bot.mjs"), "utf8");
    const encoded     = Buffer.from(fileContent).toString("base64");

    // Get current SHA
    const getResp = await fetch(`https://api.github.com/repos/${repoPath}/contents/vote-bot.mjs`, {
      headers: { "Authorization": `token ${ghToken}`, "Accept": "application/vnd.github.v3+json" }
    });
    const getJson = await getResp.json();
    if (!getJson.sha) throw new Error(getJson.message || "Could not get file SHA");

    // Push update
    const putResp = await fetch(`https://api.github.com/repos/${repoPath}/contents/vote-bot.mjs`, {
      method: "PUT",
      headers: {
        "Authorization": `token ${ghToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: commitMsg,
        content: encoded,
        sha: getJson.sha,
        committer: { name: "mystricman0-cell", email: "mystricman0-cell@users.noreply.github.com" },
        author:    { name: "mystricman0-cell", email: "mystricman0-cell@users.noreply.github.com" }
      })
    });
    const putJson = await putResp.json();
    if (!putJson.commit) throw new Error(putJson.message || "Push failed");

    await bot.editMessageText(
      `✅ <b>GitHub pe push ho gaya!</b>\n\n` +
      `📁 File: <code>vote-bot.mjs</code>\n` +
      `💬 Commit: <code>${commitMsg}</code>\n` +
      `🔗 SHA: <code>${putJson.commit.sha.substring(0, 7)}</code>\n` +
      `🌐 Repo: <a href="${ghRepo}">${repoPath}</a>`,
      { chat_id: statusMsg.chat.id, message_id: statusMsg.message_id, parse_mode: "HTML", disable_web_page_preview: true }
    );
  } catch (e) {
    await bot.editMessageText(
      `❌ <b>Push failed!</b>\n\n<code>${e.message}</code>`,
      { chat_id: statusMsg.chat.id, message_id: statusMsg.message_id, parse_mode: "HTML" }
    );
  }
});

// ============================================================
// SUB-ADMIN MANAGEMENT COMMANDS
// /addadmin  /removeadmin  /listadmins  /editadminperms
// ============================================================

// /addadmin — MAIN ADMIN ONLY: Add a sub-admin with specific permissions
bot.onText(/\/addadmin(?:\s+(\d+))?(?:\s+([\w,]+))?/, async (msg, match) => {
  const userId = msg.from.id;
  if (userId !== ownerAdminId) return;
  const chatId = msg.chat.id;

  if (!match[1]) {
    const permList = Object.entries(ADMIN_PERMS)
      .map(([k, d]) => `  • <code>${k}</code> — ${d}`).join("\n");
    return bot.sendMessage(chatId,
      `✦━━━━━━━━━━━━━━━━━✦\n  👑  ADD SUB-ADMIN\n✦━━━━━━━━━━━━━━━━━✦\n\n` +
      `<b>Usage:</b>\n<code>/addadmin &lt;userId&gt; &lt;perms&gt;</code>\n\n` +
      `<b>Available permissions:</b>\n${permList}\n\n` +
      `<b>Examples:</b>\n` +
      `<code>/addadmin 123456789 all</code>\n` +
      `<code>/addadmin 123456789 approve_payments,broadcast</code>\n` +
      `<code>/addadmin 123456789 manage_giveaways,ban_users</code>`,
      { parse_mode: "HTML" }
    );
  }

  const targetId = Number(match[1]);
  if (targetId === ownerAdminId) {
    return bot.sendMessage(chatId, `❌ Main admin already has full access.`, { parse_mode: "HTML" });
  }

  const permsRaw = (match[2] || "all").toLowerCase().split(",").map(p => p.trim()).filter(p => ADMIN_PERMS[p]);
  if (permsRaw.length === 0) {
    return bot.sendMessage(chatId,
      `❌ <b>Invalid permissions.</b>\n\nValid: ${Object.keys(ADMIN_PERMS).map(k => `<code>${k}</code>`).join(", ")}`,
      { parse_mode: "HTML" }
    );
  }

  const targetUser = botUsers.get(targetId);
  const name  = targetUser?.name || targetUser?.firstName || `User ${targetId}`;
  const uname = targetUser?.username || null;
  const existing = subAdmins.get(targetId);

  subAdmins.set(targetId, {
    name, username: uname,
    addedAt: existing?.addedAt || new Date().toISOString(),
    permissions: new Set(permsRaw)
  });
  await saveSubAdmins();

  const permStr = permsRaw.map(p => `✅ <code>${p}</code>`).join("\n");
  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━✦\n  👑  SUB-ADMIN ADDED\n✦━━━━━━━━━━━━━━━━━✦\n\n` +
    `👤 <b>${h(name)}</b>${uname ? ` (@${uname})` : ""}\n` +
    `🆔 <code>${targetId}</code>\n\n` +
    `<b>Permissions:</b>\n${permStr}\n\n` +
    `<i>Use /editadminperms ${targetId} to modify.\nUse /removeadmin ${targetId} to revoke.</i>`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.sendMessage(targetId,
      `✦━━━━━━━━━━━━━━━━━✦\n  👑  ADMIN ACCESS\n✦━━━━━━━━━━━━━━━━━✦\n\n` +
      `✅ Tumhe is bot ka admin access diya gaya hai!\n\n` +
      `<b>Tumhare permissions:</b>\n${permStr}\n\n` +
      `<i>Type /adminhelp to see available commands.</i>`,
      { parse_mode: "HTML" }
    );
  } catch {}
});

// /removeadmin — MAIN ADMIN ONLY: Remove a sub-admin
bot.onText(/\/removeadmin\s+(\d+)/, async (msg, match) => {
  const userId = msg.from.id;
  if (userId !== ownerAdminId) return;
  const chatId = msg.chat.id;
  const targetId = Number(match[1]);

  if (!subAdmins.has(targetId)) {
    return bot.sendMessage(chatId, `❌ User <code>${targetId}</code> is not a sub-admin.`, { parse_mode: "HTML" });
  }

  const sa = subAdmins.get(targetId);
  subAdmins.delete(targetId);
  await saveSubAdmins();

  await bot.sendMessage(chatId,
    `✅ <b>Sub-admin removed.</b>\n\n` +
    `👤 ${h(sa.name || "Unknown")} (<code>${targetId}</code>) ka admin access hata diya gaya.`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.sendMessage(targetId,
      `⚠️ <b>Admin Access Revoked</b>\n\nTumhara is bot ka admin access hata diya gaya hai.`,
      { parse_mode: "HTML" }
    );
  } catch {}
});

// /listadmins — MAIN ADMIN ONLY: List all sub-admins
bot.onText(/\/listadmins/, async (msg) => {
  const userId = msg.from.id;
  if (userId !== ownerAdminId) return;
  const chatId = msg.chat.id;

  if (subAdmins.size === 0) {
    return bot.sendMessage(chatId,
      `<b>👑 Sub-Admins</b>\n\nAbhi koi sub-admin nahi hai.\n\n` +
      `<code>/addadmin &lt;userId&gt; &lt;perms&gt;</code> se add karo.`,
      { parse_mode: "HTML" }
    );
  }

  let text = `✦━━━━━━━━━━━━━━━━━✦\n  👑  SUB-ADMINS (${subAdmins.size})\n✦━━━━━━━━━━━━━━━━━✦\n\n`;
  let i = 1;
  for (const [uid, sa] of subAdmins) {
    const perms = [...sa.permissions].map(p => `<code>${p}</code>`).join(", ");
    const added = sa.addedAt ? new Date(sa.addedAt).toLocaleDateString("en-IN") : "?";
    text += `${i}. 👤 <b>${h(sa.name || "Unknown")}</b>${sa.username ? ` (@${sa.username})` : ""}\n` +
      `   🆔 <code>${uid}</code>  ·  Added: ${added}\n` +
      `   🔑 ${perms}\n\n`;
    i++;
  }
  text += `<i>Edit: /editadminperms &lt;userId&gt;\nRemove: /removeadmin &lt;userId&gt;</i>`;

  await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
});

// /editadminperms — MAIN ADMIN ONLY: Interactive permission editor
bot.onText(/\/editadminperms\s+(\d+)/, async (msg, match) => {
  const userId = msg.from.id;
  if (userId !== ownerAdminId) return;
  const chatId = msg.chat.id;
  const targetId = Number(match[1]);

  if (!subAdmins.has(targetId)) {
    return bot.sendMessage(chatId,
      `❌ <code>${targetId}</code> is not a sub-admin.\n\nPehle <code>/addadmin ${targetId}</code> se add karo.`,
      { parse_mode: "HTML" }
    );
  }

  const sa = subAdmins.get(targetId);
  const buttons = Object.keys(ADMIN_PERMS).map(perm => [{
    text: (sa.permissions.has(perm) ? "✅ " : "❌ ") + perm,
    callback_data: `sadm_perm:${targetId}:${perm}`
  }]);
  buttons.push([{ text: "🗑️ Remove Sub-Admin", callback_data: `sadm_remove:${targetId}` }]);
  buttons.push([{ text: "✖ Close", callback_data: "sadm_close" }]);

  await bot.sendMessage(chatId,
    `✦━━━━━━━━━━━━━━━━━✦\n  🔑  ADMIN PERMISSIONS\n✦━━━━━━━━━━━━━━━━━✦\n\n` +
    `👤 <b>${h(sa.name || "Unknown")}</b>\n` +
    `🆔 <code>${targetId}</code>\n\n` +
    `<i>Tap any permission to toggle it:</i>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
});

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
        { command: "active",       description: "✅ Show all live giveaways" },
        { command: "winners",      description: "🏆 View winners of your giveaway" },
        { command: "glink",        description: "🔗 Get participation link" },
        { command: "support",      description: "💬 Contact Support" }
      ]);

      // Register admin command list — exactly 100 commands (Telegram hard limit)
      await bot.setMyCommands([
        // ── User commands (15) ──
        { command: "start",             description: "🎁 Open DRS Giveaway Bot" },
        { command: "help",              description: "📖 Full user guide & all commands" },
        { command: "membership",        description: "👑 Get Premium Membership" },
        { command: "myplan",            description: "📋 Check my membership status" },
        { command: "leaderboard",       description: "🏆 Live leaderboard of active giveaway" },
        { command: "mystats",           description: "📊 Personal giveaway stats" },
        { command: "botstatus",         description: "🤖 Quick bot health & stats" },
        { command: "ping",              description: "🏓 Check bot response time" },
        { command: "myid",              description: "🪪 Your Telegram user ID" },
        { command: "createpost",        description: "📢 Create a channel post" },
        { command: "topvoters",         description: "🥇 Top participants ranking" },
        { command: "active",            description: "✅ Show all live giveaways" },
        { command: "winners",           description: "🏆 View winners of a giveaway" },
        { command: "glink",             description: "🔗 Get participation link" },
        { command: "support",           description: "💬 Contact Support — @drssupport" },
        // ── Admin core (6) ──
        { command: "adminhelp",         description: "👑 Admin command list (4 parts + security)" },
        { command: "stats",             description: "📊 Bot statistics dashboard" },
        { command: "broadcast",         description: "📢 Silent broadcast — Users/Channels/All" },
        { command: "loud",              description: "🔊 LOUD broadcast — Users/Channels/All" },
        { command: "send",              description: "📩 Send message to specific chat" },
        { command: "pin",               description: "📌 Send & pin in channel" },
        // ── Giveaway management (9) ──
        { command: "allgiveaways",      description: "🎁 List all giveaways (paginated)" },
        { command: "addvotes",          description: "➕ Manually add votes to participant" },
        { command: "removevotes",       description: "➖ Remove votes from participant" },
        { command: "endgiveaway",       description: "🏁 Force-close a giveaway + announce winners" },
        { command: "cancelgiveaway",    description: "🚫 Cancel giveaway silently (no winners)" },
        { command: "resetvotes",        description: "🔄 Reset all votes in a giveaway" },
        { command: "setwinner",         description: "🏆 Set winner count for giveaway" },
        { command: "clonegiveaway",     description: "📋 Clone a giveaway" },
        { command: "announce",          description: "📢 Message all giveaway participants" },
        // ── Membership (6) ──
        { command: "givemem",           description: "💳 Give membership to user" },
        { command: "removemem",         description: "🗑️ Revoke user membership" },
        { command: "extendmem",         description: "➕ Extend user membership" },
        { command: "listmem",           description: "📋 List active VIP members (paginated)" },
        { command: "meminfo",           description: "ℹ️ Check any user's membership" },
        { command: "setplan",           description: "💰 Update plan pricing" },
        // ── User management (7) ──
        { command: "ban",               description: "🚫 Ban a user" },
        { command: "unban",             description: "✅ Unban a user" },
        { command: "userinfo",          description: "👤 Full user profile" },
        { command: "listusers",         description: "👥 Paginated list of all users" },
        { command: "dm",                description: "📩 Direct message any user" },
        { command: "reply",             description: "↩️ Reply to a support ticket" },
        { command: "exportusers",       description: "📁 Download all users as .txt" },
        // ── Config & channels (9) ──
        { command: "allchannels",       description: "📋 List all registered channels" },
        { command: "setinr",            description: "₹ Set votes per INR paid" },
        { command: "schedule",          description: "⏰ Schedule a broadcast at IST time" },
        { command: "schedulelist",      description: "📋 View pending scheduled broadcasts" },
        { command: "cancelschedule",    description: "❌ Cancel a scheduled broadcast" },
        { command: "paystats",          description: "💰 Pending payments dashboard" },
        { command: "maintenance",       description: "🔧 Toggle maintenance mode on/off" },
        { command: "setwelcomemsg",     description: "✏️ Set custom welcome message" },
        { command: "setwelcomeimageurl",description: "🖼️ Set welcome image via URL (spoiler)" },
        // ── DB & utility (3) ──  [cleandb/removepay/clearallpending/setfreelimit/perms accessible via /adminhelp]
        { command: "setforcejoin",      description: "📢 Configure force join channel" },
        { command: "setmembershipqr",   description: "📸 Upload membership QR code" },
        { command: "setlogdest",        description: "📡 Set log destination (user/channel/reset)" },
        // ── Sub-admin management (4) ──
        { command: "addadmin",          description: "👑 Add a sub-admin with permissions" },
        { command: "removeadmin",       description: "🗑️ Remove a sub-admin" },
        { command: "listadmins",        description: "📋 List all sub-admins & permissions" },
        { command: "editadminperms",    description: "🔑 Edit sub-admin permissions (button UI)" },
        // ── Admin tools (9) ──  [setlbbroadcast/stoplbbroadcast/listlbbroadcast/preview accessible via /adminhelp]
        { command: "health",            description: "🏥 Bot health — uptime, DB, memory, stats" },
        { command: "customize",         description: "🎨 Interactive UI text & emoji customizer" },
        { command: "settext",           description: "✏️ Set any UI text/emoji/button label" },
        { command: "resettext",         description: "🔄 Reset a UI text to default" },
        { command: "listtext",          description: "📋 List all UI text keys & current values" },
        { command: "pushgithub",        description: "🚀 Push vote-bot.mjs to GitHub" },
        { command: "cloneui",           description: "📦 Export/Import all UI text settings" },
        { command: "resetui",           description: "🔄 Reset ALL UI texts to default" },
        { command: "autoclean",         description: "🧹 Manually trigger memory + DB cleanup" },
        { command: "memstats",          description: "📊 Live RAM breakdown — all Maps, heap, RSS" },
        // ── Security (31) ──
        { command: "securityhelp",      description: "🛡️ Full security command reference" },
        { command: "securitystats",     description: "📊 Full security dashboard" },
        { command: "emergencylock",     description: "🔒 Emergency lock — block all users" },
        { command: "emergencyunlock",   description: "🔓 Remove emergency lock" },
        { command: "securitymode",      description: "🌐 Set security mode (strict/normal/off)" },
        { command: "antispam",          description: "⚡ Toggle anti-spam protection" },
        { command: "honeypot",          description: "🍯 Enable/disable honeypot traps" },
        { command: "honeytrap",         description: "🍯 Add a honeypot trap command" },
        { command: "removetrap",        description: "🗑️ Remove a honeypot trap" },
        { command: "listtraps",         description: "📋 List traps (paginated) — /listtraps [page]" },
        { command: "honeypotlist",      description: "🍯 Users who triggered honeypot traps" },
        { command: "warnuser",          description: "⚠️ Warn a user (tracked in DB)" },
        { command: "warnings",          description: "⚠️ Check user warning count + reasons" },
        { command: "clearwarnings",     description: "✅ Clear all warnings for a user" },
        { command: "autoban",           description: "🚫 Toggle auto-ban on max warnings" },
        { command: "setmaxwarns",       description: "⚠️ Set auto-ban warning threshold" },
        { command: "muteuser",          description: "🔇 Mute a user (bot ignores them)" },
        { command: "unmuteuser",        description: "🔊 Unmute a user" },
        { command: "mutedlist",         description: "🔇 List all muted users" },
        { command: "shadowban",         description: "👻 Ghost ban (user unaware)" },
        { command: "unshadowban",       description: "👻 Remove shadow ban" },
        { command: "shadowlist",        description: "👻 List all shadow banned users" },
        { command: "trustuser",         description: "✅ Whitelist user (bypass rate limit)" },
        { command: "untrustuser",       description: "✅ Remove from trusted list" },
        { command: "trustedlist",       description: "✅ View all trusted users" },
        { command: "flaguser",          description: "🚩 Flag suspicious user for monitoring" },
        { command: "unflaguser",        description: "🚩 Remove user flag" },
        { command: "blockword",         description: "🚫 Block a word/phrase in messages" },
        { command: "unblockword",       description: "✅ Unblock a word/phrase" },
        { command: "blockedwords",      description: "🚫 List blocked words (paginated)" },
        { command: "suspicious",        description: "🛡️ Last 20 security events" }
      ], { scope: { type: "chat", chat_id: ownerAdminId } });

      console.log("✅ Bot commands registered!");
    } catch (e) { console.error("setMyCommands error:", e.message); }

    console.log(`
✅ DRS Giveaway Bot v3.0.8 Started!
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

    // 🧹 Memory Eviction — every 30 minutes (removes old ended giveaways from RAM)
    setInterval(() => runMemoryEviction(), 30 * 60 * 1000);

    // 🗄️ DB Auto-Cleanup — every 24 hours (trims logs, old payments, compresses old giveaways)
    setInterval(() => runDBCleanup(), 24 * 60 * 60 * 1000);

    // 🚀 Run cleanup once at startup (after 3 min delay to let bot settle)
    setTimeout(() => { runMemoryEviction(); runDBCleanup(); }, 3 * 60 * 1000);

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
