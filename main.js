const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const chalk = require('chalk');
const axios = require('axios');
const { PassThrough } = require('stream');
const { BOT_TOKEN, AI_API_URL, AI_SYSTEM_PROMPT, DEVELOPER_ID, GROUP_ID, COOLDOWN_MS, ERROR_COOLDOWN_MS, AUDIO_CLEANUP_MS } = require('./config');
const { version } = require('./package.json');
const { handler } = require('./handler.js');
const { URL } = require('url');

// Load languages safely with fallback
const langDir = path.join(__dirname, 'lang');
const languages = {};
const fallbackLang = 'en';

const loadLanguages = () => {
  try {
    if (!fs.existsSync(langDir)) {
      throw new Error('Language directory not found');
    }
    const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      throw new Error('No language files found');
    }
    files.forEach(file => {
      const langCode = path.basename(file, '.json');
      try {
        languages[langCode] = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'));
      } catch (e) {
        console.error(`[ERROR] Failed to parse ${file}:`, e.message);
      }
    });
  } catch (err) {
    console.error('[ERROR] Language loading failed, using hardcoded fallback:', err.message);
  }

  if (!languages[fallbackLang]) {
    languages[fallbackLang] = {
      "start": "🌟 Welcome to *TikTok Downloader Bot*!\nSend me a TikTok link to start.",
      "help": "📚 *Help*\nSend a TikTok link to download video/audio.",
      "runtime": "🕒 Active for: {hours}h {minutes}m {seconds}s",
      "invalid_url": "❌ Invalid TikTok URL.",
      "processing": "⏳ Processing...",
      "processing_error": "⚠️ Error processing your request.",
      "generic_error": "⚠️ A technical issue occurred.",
      "banned_user": "🚫 You are banned from using this bot.",
      "audio": "Audio Track",
      "url_audio": "Direct Audio Link",
      "already_selected": "⚠️ This language is already selected.",
      "private_only_msg": "📵 Please send TikTok links in private chat only.",
      "strict_link_only": "🔗 Please send only TikTok links or use commands.", 
      "user_list": "👥 *Bot User List*\n\n",
"no_users": "No users found.",
"no_permission": "❌ You do not have permission to use this command." 
    };
  }
};

loadLanguages();

// Language helper
const getMessage = (lang, type) => {
  const langCode = languages[lang] ? lang : fallbackLang;
  return languages[langCode][type] || languages[fallbackLang][type] || type;
};

const allowedTikTokHosts = [
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
  'tiktokv.com',
  'vm.tiktokv.com',
  'vt.tiktokv.com',
  'tx.tiktok.com',
  'www.tx.tiktok.com',
  'lf16-tiktok-common.ttcdn.com',
  'lf77-tiktok-common.ttcdn.com',
  'app.tiktok.com',
  'm.app.tiktok.com',
  'click.tiktok.com',
  's.tiktok.com',
  'us.tiktok.com',
  'music.tiktok.com',
  'live.tiktok.com',
  'www.live.tiktok.com'
];

if (!BOT_TOKEN || BOT_TOKEN.trim() === '') {
  console.error(chalk.red.bold('[FATAL] BOT_TOKEN is not set. Please set the BOT_TOKEN environment variable.'));
  console.error(chalk.yellow('The bot will not start polling without a valid token.'));
  console.error(chalk.cyan('Get a token from @BotFather on Telegram.'));
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    interval: 500,
    autoStart: true,
    params: {
      timeout: 30
    }
  }
});
let Start = new Date();

const errorCache = new Map();
const ERROR_COOLDOWN_MS_VAL = ERROR_COOLDOWN_MS || 60000;

const userLanguagePath = path.join(__dirname, 'data/users.json');
const bannedUsersPath = path.join(__dirname, 'data/banned.json');
let userLanguage = {};
let bannedUsers = [];

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
const backupsDir = path.join(dataDir, 'backups');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

if (fs.existsSync(userLanguagePath)) {
  try {
    userLanguage = JSON.parse(fs.readFileSync(userLanguagePath, 'utf8'));
  } catch (e) {
    userLanguage = {};
  }
}

if (fs.existsSync(bannedUsersPath)) {
  try {
    bannedUsers = JSON.parse(fs.readFileSync(bannedUsersPath, 'utf8'));
  } catch (e) {
    bannedUsers = [];
  }
}

let saveUserTimeout;
const saveUserLanguage = () => {
  if (saveUserTimeout) clearTimeout(saveUserTimeout);
  saveUserTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(userLanguagePath, JSON.stringify(userLanguage, null, 2));
      // Backup logic
      const backupPath = path.join(backupsDir, 'users_backup.json');
      fs.writeFileSync(backupPath, JSON.stringify(userLanguage, null, 2));
    } catch (e) {
      logs('error', 'Failed to save user languages', { error: e.message });
    }
  }, 5000);
};

let saveBannedTimeout;
const saveBannedUsers = () => {
  if (saveBannedTimeout) clearTimeout(saveBannedTimeout);
  saveBannedTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(bannedUsersPath, JSON.stringify(bannedUsers, null, 2));
      // Backup logic
      const backupPath = path.join(backupsDir, 'banned_backup.json');
      fs.writeFileSync(backupPath, JSON.stringify(bannedUsers, null, 2));
    } catch (e) {
      logs('error', 'Failed to save banned users', { error: e.message });
    }
  }, 5000);
};

const conversationHistory = {};

const isPrivateChat = (msg) => {
  return msg.chat.type === 'private';
};

const displayBanner = () => {
  console.log(chalk.yellow.bold('TikTok Downloader Bot with Enhanced AI Assistant'));
  console.log(chalk.cyan('========================================'));
  console.log(chalk.green(`Version: ${version || '1.0.0'}`));
  console.log(chalk.green(`Developer ID: ${DEVELOPER_ID || 'Not set'}`));
  console.log(chalk.green(`Group ID: ${GROUP_ID || 'Not set'}`));
  console.log(chalk.cyan('========================================'));
};

const shouldSendError = (errorKey) => {
  const now = Date.now();
  const lastSent = errorCache.get(errorKey);
  if (lastSent && now - lastSent < ERROR_COOLDOWN_MS_VAL) {
    return false;
  }
  errorCache.set(errorKey, now);
  return true;
};

const escapeMarkdown = (text) => {
  if (!text || typeof text !== 'string') return text;
  // Escape for MarkdownV2 which is more strict or just use standard markdown escaping
  // The error "Can't find end of the entity" usually means a character like _ or * or [ is not closed or escaped
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
};

const getSuggestedSolution = (errorMsg = '') => {
  const msg = errorMsg.toLowerCase();
  if (msg.includes('413') || msg.includes('request entity too large') || msg.includes('output_too_large'))
    return '📦 الفيديو أكبر من 50MB — اضغط أكثر أو أرسله كرابط مباشر.';
  if (msg.includes('400') && (msg.includes('parse') || msg.includes('entities')))
    return '✏️ خطأ في تنسيق الرسالة — تحقق من escaping الكابشن أو استخدم HTML بدل Markdown.';
  if (msg.includes('403') || msg.includes('forbidden'))
    return '🔒 الرابط محجوب أو منتهي — جرب hdplay أو play أو wmplay بالترتيب.';
  if (msg.includes('eai_again') || msg.includes('enotfound'))
    return '🌐 فشل DNS — تحقق من الاتصال بالإنترنت وأعد المحاولة بعد قليل.';
  if (msg.includes('etimedout') || msg.includes('timeout'))
    return '⏱️ انتهت مهلة الاتصال — زد قيمة timeout أو تحقق من ضغط السيرفر.';
  if (msg.includes('504') || msg.includes('gateway timeout'))
    return '🔄 Telegram gateway timeout — أعد الإرسال مع exponential backoff.';
  if (msg.includes('429') || msg.includes('too many requests'))
    return '🚦 تجاوزت حد Rate Limit — قلل تكرار الرسائل وفعّل cooldown.';
  if (msg.includes('no data extracted') || msg.includes('all video urls failed'))
    return '🔍 فشل استخراج المحتوى — تحقق من صحة الرابط وحالة TikTok API.';
  if (msg.includes('local video file not found'))
    return '💾 الملف المؤقت مفقود — تحقق من المساحة الحرة ومجلد temp/.';
  if (msg.includes('ffmpeg') || msg.includes('transcod'))
    return '🎞️ خطأ FFmpeg — تحقق من تثبيت ffmpeg وصحة الفيديو المصدر.';
  if (msg.includes('econnreset') || msg.includes('econnrefused'))
    return '🔌 انقطع الاتصال — أعد المحاولة أو تحقق من إعدادات الشبكة.';
  if (msg.includes('sharp') || msg.includes('image'))
    return '🖼️ خطأ في معالجة الصورة — تحقق من صحة الصورة أو تخطَّها.';
  return '🔧 خطأ غير معروف — راجع اللوغات للحصول على مزيد من التفاصيل.';
};

const getCallerFile = () => {
  try {
    const lines = (new Error().stack || '').split('\n');
    for (const line of lines) {
      if (line.includes('main.js') && line.includes('logs')) continue;
      if (line.includes('node_modules') || line.includes('node:')) continue;
      const match = line.match(/at\s+(?:\S+\s+)?\(?([^)]+\.js):(\d+):\d+\)?/);
      if (match) {
        const fileName = match[1].replace(/.*[\\/]/, '');
        return `${fileName}:${match[2]}`;
      }
    }
  } catch {}
  return '';
};

const logs = async (type, message, details = {}, skipTelegram = false) => {
  const timestamp = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
  let color, prefix;

  switch (type.toLowerCase()) {
    case 'info': color = chalk.cyan; prefix = '[INFO]'; break;
    case 'success': color = chalk.green; prefix = '[SUCCESS]'; break;
    case 'error': color = chalk.red; prefix = '[ERROR]'; break;
    case 'warning': color = chalk.yellow; prefix = '[WARNING]'; break;
    default: color = chalk.white; prefix = '[LOG]';
  }

  const file = getCallerFile();
  const fileTag = file ? ` (${file})` : '';
  const logMessage = `${prefix} [${timestamp}]${fileTag} ${message}`;
  console.log(color(logMessage));
  if (details && Object.keys(details).length) {
    console.log(color(Object.entries(details).map(([k, v]) => `  ${k}: ${v}`).join('\n')));
  }

  if (type.toLowerCase() === 'error' && !skipTelegram) {
    const errorKey = `${message}:${JSON.stringify(details)}`.slice(0, 200);
    if (!shouldSendError(errorKey)) {
      return;
    }

    const escapeHtmlLocal = (t) => typeof t === 'string' ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : String(t || '');

    const extractFileInfo = () => {
      try {
        const err = new Error();
        const lines = (err.stack || '').split('\n');
        for (const line of lines) {
          if (line.includes('node_modules') || line.includes('node:') || line.includes('logs (')) continue;
          const match = line.match(/at\s+(?:\S+\s+)?\(?([^)]+\.js):(\d+):(\d+)\)?/);
          if (match) {
            const fileName = match[1].replace(/.*[\\/]/, '');
            return `${fileName}:${match[2]}`;
          }
        }
      } catch {}
      return 'unknown';
    };

    const fileInfo = details?.File || extractFileInfo();
    const detailsJson = JSON.stringify(details, null, 2);

    const solution = getSuggestedSolution(message);

    const htmlNotify = `🚨 <b>SYSTEM ERROR</b>\n\n` +
      `📂 <b>File:</b> <code>${escapeHtmlLocal(fileInfo)}</code>\n` +
      `🕒 <b>Time:</b> ${timestamp}\n` +
      `📌 <b>Message:</b> ${escapeHtmlLocal(message)}\n` +
      `💡 <b>Suggested Fix:</b> ${escapeHtmlLocal(solution)}\n` +
      `📄 <b>Details:</b>\n<pre>${escapeHtmlLocal(detailsJson)}</pre>`;

    const plainNotify = `🚨 SYSTEM ERROR\n\n` +
      `📂 File: ${fileInfo}\n` +
      `🕒 Time: ${timestamp}\n` +
      `📌 Message: ${message}\n` +
      `💡 Suggested Fix: ${solution}\n` +
      `📄 Details:\n${detailsJson}`;

    const sendWithRetry = async (chatId, retries = 5) => {
      for (let i = 0; i < retries; i++) {
        try {
          await bot.sendMessage(chatId, htmlNotify, { parse_mode: 'HTML' });
          return true;
        } catch (e) {
          if (e.response?.body?.retry_after) {
            const delay = e.response.body.retry_after * 1000 + 1000;
            await new Promise(r => setTimeout(r, delay));
          } else if (e.message?.includes('429') || e.message?.includes('502') || e.message?.includes('503')) {
            await new Promise(r => setTimeout(r, (i + 1) * 3000));
          } else {
            try {
              await bot.sendMessage(chatId, plainNotify);
              return true;
            } catch {
              break;
            }
          }
        }
      }
      return false;
    };

    let sent = false;
    if (GROUP_ID) {
      sent = await sendWithRetry(GROUP_ID);
    }
    if (!sent && DEVELOPER_ID) {
      await sendWithRetry(DEVELOPER_ID);
    }
  }
};

bot.on('error', (err) => {
  const is429or502 = err.message?.includes('429') || err.message?.includes('502');
  logs('error', 'Global Bot Error', { message: err.message }, is429or502);
});

let pollingRestartTimeout = null;
bot.on('polling_error', (error) => {
  const msg = error.message || '';
  const is429or502 = msg.includes('429') || msg.includes('502');
  const isNetworkError = msg.includes('EAI_AGAIN') || msg.includes('ETIMEDOUT') ||
                         msg.includes('504') || msg.includes('ECONNRESET') ||
                         msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED');

  logs('error', 'Polling error', { Error: msg }, is429or502 || isNetworkError);

  if (isNetworkError && !pollingRestartTimeout) {
    const delay = 15000;
    console.warn(`[POLLING] Network error detected, restarting polling in ${delay / 1000}s...`);
    pollingRestartTimeout = setTimeout(async () => {
      pollingRestartTimeout = null;
      try {
        await bot.stopPolling();
        await new Promise(r => setTimeout(r, 3000));
        await bot.startPolling();
        console.log('[POLLING] Polling restarted successfully after network error.');
      } catch (e) {
        console.error('[POLLING] Failed to restart polling:', e.message);
      }
    }, delay);
  }
});

displayBanner();
logs('info', 'Bot started', { Token: (BOT_TOKEN || '').slice(0, 10) + '...' });

const updateBotBio = async () => {
  try {
    const userCount = Object.keys(userLanguage).length;
    const bioText = `TikTok Downloader Bot | Serving ${userCount} users 🚀`;
    await bot.setMyShortDescription({ short_description: bioText });
    logs('info', 'Bot bio updated', { userCount });
  } catch (error) {
    logs('error', 'Failed to update bot bio', { error: error.message });
  }
};

const commands = [
  { command: 'start', description: '🚀 Start your TikTok download journey' },
  { command: 'help', description: '📖 Learn how to use this bot' },
  { command: 'runtime', description: '⏰ Check bot uptime and stats' },
  { command: 'lang', description: '🌍 Switch bot language' },
  { command: 'ban', description: '🚫 [Dev Only] Ban a user' },
  { command: 'unban', description: '✅ [Dev Only] Unban a user' },
  { command: 'users', description: '👥 [Dev Only] List all users' },
];

bot.setMyCommands(commands).then(() => {
  logs('info', 'Bot commands registered successfully');
  updateBotBio();
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      const userCount = Object.keys(userLanguage).length;
      bot.sendMessage(DEVELOPER_ID, `📊 *Daily Report*\n\nTotal Users: ${userCount}\nUptime: ${process.uptime().toFixed(0)}s`, { parse_mode: 'Markdown' }).catch(() => {});
    }
  }, 60000);
}).catch((err) => {
  logs('error', 'Failed to register bot commands', { error: err.message });
});

const getMainKeyboard = (lang = 'en') => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: getMessage(lang, 'choose_language'), callback_data: 'lang_selection' },
        { text: getMessage(lang, 'help_label') || (lang === 'id' ? '📖 Panduan Penggunaan' : lang === 'zh' ? '📖 使用指南' : lang === 'ar' ? '📖 دليل الاستخدام' : '📖 Usage Guide'), callback_data: 'help' }
      ],
      [
        { text: getMessage(lang, 'bot_status') || (lang === 'id' ? '⚡ Status Bot' : lang === 'zh' ? '⚡ 机器人状态' : lang === 'ar' ? '⚡ حالة البوت' : '⚡ Bot Status'), callback_data: 'runtime' },
        { text: getMessage(lang, 'support_chat') || (lang === 'id' ? '💬 Dukungan' : lang === 'zh' ? '💬 技术支持' : lang === 'ar' ? '💬 الدعم الفني' : '💬 Support Chat'), url: 'https://t.me/zamasuuuuuuu' }
      ]
    ]
  }
});

async function queryAI(chatId, userMessage, lang = 'en') {
  try {
    const localizedPrompt = getMessage(lang, 'ai_system_prompt') || AI_SYSTEM_PROMPT;
    const languageMap = {
      'id': 'Indonesian',
      'en': 'English',
      'zh': 'Chinese',
      'ar': 'Arabic'
    };
    const targetLanguage = languageMap[lang] || 'English';
    
    if (!conversationHistory[chatId]) {
      conversationHistory[chatId] = [
        {
          role: 'system',
          content: `${localizedPrompt}\n\nCRITICAL INSTRUCTION: You MUST respond in ${targetLanguage}. Do not use any other language for your response. Maintain the hype TikTok persona in ${targetLanguage}.`,
        },
      ];
    } else {
      // Update system prompt if language changed
      conversationHistory[chatId][0].content = `${localizedPrompt}\n\nCRITICAL INSTRUCTION: You MUST respond in ${targetLanguage}. Do not use any other language for your response. Maintain the hype TikTok persona in ${targetLanguage}.`;
    }
    conversationHistory[chatId].push({ role: 'user', content: userMessage });
    if (conversationHistory[chatId].length > 100) conversationHistory[chatId].splice(1, conversationHistory[chatId].length - 100);

    const response = await axios.post(AI_API_URL, { messages: conversationHistory[chatId] }, {
      headers: { 'Content-Type': 'application/json', 'User-Agent': `TeleBot/${version || '1.0.0'}`, accept: 'application/json' },
      timeout: 60000,
    });

    if (response.data.error) throw new Error(response.data.error);
    const ai_response = response.data.content || response.data.message || JSON.stringify(response.data);
    conversationHistory[chatId].push({ role: 'assistant', content: ai_response });
    
    return ai_response;
  } catch (error) {
    logs('error', 'AI API request failed', { ChatID: chatId, Error: error.message });
    return escapeMarkdown(getMessage(lang, 'processing_error'));
  }
}

const audioStore = require('./utils/audioStore');
const audioMap = audioStore.audioMap;

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = query.from.id;
  const lang = userLanguage[userId] || 'en';

  await bot.answerCallbackQuery(query.id).catch(() => {});

  try {
    if (data === 'lang_selection') {
      const promptText = getMessage(lang, 'choose_language');
      const reply_markup = {
        inline_keyboard: [
          [
            { text: '🇮🇩 Indonesia', callback_data: 'lang_id' },
            { text: '🇬🇧 English', callback_data: 'lang_en' },
            { text: '🇨🇳 Chinese', callback_data: 'lang_zh' },
            { text: '🇸🇦 Arabic', callback_data: 'lang_ar' },
          ],
          [{ text: getMessage(lang, 'back'), callback_data: 'back_to_main' }]
        ]
      };
      await bot.editMessageText(promptText, { 
        chat_id: chatId, 
        message_id: messageId, 
        parse_mode: 'Markdown', 
        reply_markup 
      });
    } else if (data.startsWith('lang_')) {
      const newLang = data.split('_')[1];
      if (newLang === (userLanguage[userId] || 'en')) {
        const msg = await bot.sendMessage(chatId, getMessage(newLang, 'already_selected'));
        setTimeout(() => bot.deleteMessage(chatId, msg.message_id).catch(() => {}), 5000);
        return;
      }
      userLanguage[userId] = newLang;
      saveUserLanguage();
      await bot.editMessageText(getMessage(newLang, 'start'), { 
        chat_id: chatId, 
        message_id: messageId, 
        parse_mode: 'Markdown', 
        ...getMainKeyboard(newLang) 
      });
    } else if (data === 'runtime') {
      const up = new Date() - Start;
      const h = Math.floor(up / 3600000);
      const m = Math.floor((up % 3600000) / 60000);
      const s = Math.floor((up % 60000) / 1000);
      const text = getMessage(lang, 'runtime')
        .replace('{hours}', h)
        .replace('{minutes}', m)
        .replace('{seconds}', s);
      await bot.editMessageText(text, { 
        chat_id: chatId, 
        message_id: messageId, 
        parse_mode: 'Markdown', 
        reply_markup: { 
          inline_keyboard: [[{ 
            text: getMessage(lang, 'back'), 
            callback_data: 'back_to_main' 
          }]] 
        } 
      });
    } else if (data === 'help') {
      await bot.editMessageText(getMessage(lang, 'help'), { 
        chat_id: chatId, 
        message_id: messageId, 
        parse_mode: 'Markdown', 
        reply_markup: { 
          inline_keyboard: [[{ 
            text: getMessage(lang, 'back'), 
            callback_data: 'back_to_main' 
          }]] 
        } 
      });
    } else if (data === 'back_to_main') {
      await bot.editMessageText(getMessage(lang, 'start'), { 
        chat_id: chatId, 
        message_id: messageId, 
        parse_mode: 'Markdown', 
        ...getMainKeyboard(lang) 
      });
    } else if (data.startsWith('audio_')) {
      const audioId = data.replace('audio_', '');
      const audioUrl = audioStore.audioMap.get(audioId);
      if (!audioUrl) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Audio link expired.' });
      }

      let audioSource;
      if (fs.existsSync(audioUrl)) {
        // Local file (extracted audio)
        audioSource = fs.createReadStream(audioUrl);
      } else {
        // URL (original audio)
        const audioResponse = await axios.get(audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl, {
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/'
          },
          maxRedirects: 10,
          timeout: 180000
        });
        audioSource = audioResponse.data;
      }

      const botInfo = await bot.getMe();
      const attributionText = `${getMessage(lang, 'by')} @${botInfo.username}`;

      await bot.sendAudio(chatId, audioSource, {
        caption: `🎵 ${getMessage(lang, 'audio')}\n\n${attributionText}`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: fs.existsSync(audioUrl) ? [] : [[{ 
            text: `🎵 ${getMessage(lang, 'url_audio')}`, 
            url: audioUrl 
          }]]
        }
      });

      // Cleanup if it's a local file
      if (fs.existsSync(audioUrl)) {
        setTimeout(() => {
          fs.unlink(audioUrl, () => {});
          audioStore.audioMap.delete(audioId);
        }, AUDIO_CLEANUP_MS || 60000);
      }
    }
  } catch (error) {
    if (!error.message?.includes('message is not modified')) {
      logs('error', 'Callback query failed', { 
        ChatID: chatId, 
        Error: error.message,
        CallbackData: data 
      });
      await bot.sendMessage(chatId, getMessage(lang, 'generic_error'));
    }
  }
});

bot.onText(/^\/start$/, async (msg) => {
  const uid = String(msg.from.id);
  logs('info', 'Slash command received', { 
    ChatID: msg.chat.id, 
    Command: '/start', 
    User: uid 
  });
  if (msg.chat.type !== 'private') return;
  const lang = userLanguage[uid] || 'en';
  if (bannedUsers.includes(uid)) {
    return bot.sendMessage(msg.chat.id, getMessage(lang, 'banned_user'));
  }
  try {
    await bot.sendMessage(msg.chat.id, getMessage(lang, 'start'), { 
      parse_mode: 'Markdown', 
      ...getMainKeyboard(lang) 
    });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, getMessage(lang, 'generic_error'));
  }
});

bot.onText(/^\/help$/, async (msg) => {
  const uid = String(msg.from.id);
  logs('info', 'Slash command received', { 
    ChatID: msg.chat.id, 
    Command: '/help', 
    User: uid 
  });
  if (msg.chat.type !== 'private') return;
  const lang = userLanguage[uid] || 'en';
  if (bannedUsers.includes(uid)) {
    return bot.sendMessage(msg.chat.id, getMessage(lang, 'banned_user'));
  }
  try {
    await bot.sendMessage(msg.chat.id, getMessage(lang, 'help'), { 
      parse_mode: 'Markdown', 
      ...getMainKeyboard(lang) 
    });
  } catch (error) {
    await bot.sendMessage(msg.chat.id, getMessage(lang, 'generic_error'));
  }
});

bot.onText(/^\/runtime$/, async (msg) => {
  const uid = String(msg.from.id);
  logs('info', 'Slash command received', { 
    ChatID: msg.chat.id, 
    Command: '/runtime', 
    User: uid 
  });
  if (msg.chat.type !== 'private') return;
  const lang = userLanguage[uid] || 'en';
  if (bannedUsers.includes(uid)) {
    return bot.sendMessage(msg.chat.id, getMessage(lang, 'banned_user'));
  }
  const up = new Date() - Start;
  const h = Math.floor(up / 3600000);
  const m = Math.floor((up % 3600000) / 60000);
  const s = Math.floor((up % 60000) / 1000);
  const text = getMessage(lang, 'runtime')
    .replace('{hours}', h)
    .replace('{minutes}', m)
    .replace('{seconds}', s);
  await bot.sendMessage(msg.chat.id, `⚡ *Bot Status*\n\n${text}`, { 
    parse_mode: 'Markdown' 
  });
});

bot.onText(/^\/ban (\d+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  logs('info', 'Slash command received', { 
    ChatID: chatId, 
    Command: '/ban', 
    User: userId 
  });
  
  // Restriction: Group context only
  if (msg.chat.type === 'private') return;

  // Permission check: only developer can ban
  if (userId !== String(DEVELOPER_ID)) {
    return bot.sendMessage(chatId, getMessage(lang, 'no_permission'));
  }
  
  const tid = match[1];
  if (!bannedUsers.includes(tid)) {
    bannedUsers.push(tid);
    saveBannedUsers();
    bot.sendMessage(chatId, `🚫 Banned user: ${tid}`);
  } else {
    bot.sendMessage(chatId, `ℹ️ User ${tid} is already banned.`);
  }
});

bot.onText(/^\/unban (\d+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  logs('info', 'Slash command received', { 
    ChatID: chatId, 
    Command: '/unban', 
    User: userId 
  });
  
  if (msg.chat.type === 'private') return;

  if (userId !== String(DEVELOPER_ID)) {
    return bot.sendMessage(chatId, getMessage(lang, 'no_permission'));
  }
  
  const tid = match[1];
  if (bannedUsers.includes(tid)) {
    bannedUsers = bannedUsers.filter(id => id !== tid);
    saveBannedUsers();
    bot.sendMessage(chatId, `✅ Unbanned user: ${tid}`);
  } else {
    bot.sendMessage(chatId, `ℹ️ User ${tid} is not currently banned.`);
  }
});

bot.onText(/^\/users$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  logs('info', 'Slash command received', { 
    ChatID: chatId, 
    Command: '/users', 
    User: userId 
  });
  
  if (msg.chat.type === 'private') return;

  if (userId !== String(DEVELOPER_ID)) {
    return bot.sendMessage(chatId, getMessage(lang, 'no_permission'));
  }

  const userIds = Object.keys(userLanguage);
  if (userIds.length === 0) return bot.sendMessage(chatId, "No users found.");

  let message = "👥 *Bot User List*\n\n";
  for (const id of userIds) {
    try {
      const chat = await bot.getChat(id);
      const username = chat.username ? `@${chat.username}` : "No Username";
      const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "No Name";
      message += `ID: \`${id}\`\nUser: [${escapeMarkdown(fullName)}](tg://user?id=${id})\nUsername: ${escapeMarkdown(username)}\n\n`;
    } catch (e) {
      message += `ID: \`${id}\` (Unable to fetch details)\n\n`;
    }

    if (message.length > 3500) {
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      message = "";
    }
  }

  if (message) {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }
});

bot.onText(/^\/lang$/, async (msg) => {
  const uid = String(msg.from.id);
  logs('info', 'Slash command received', { 
    ChatID: msg.chat.id, 
    Command: '/lang', 
    User: uid 
  });
  if (msg.chat.type !== 'private') return;
  const lang = userLanguage[uid] || 'en';
  if (bannedUsers.includes(uid)) {
    return bot.sendMessage(msg.chat.id, getMessage(lang, 'banned_user'));
  }
  const prompt = lang === 'id' ? 'Pilih bahasa:' : lang === 'en' ? 'Choose language:' : lang === 'zh' ? '选择语言：' : lang === 'ar' ? 'اختر اللغة:' : 'Choose language:';
  await bot.sendMessage(msg.chat.id, prompt, { 
    parse_mode: 'Markdown', 
    reply_markup: { 
      inline_keyboard: [[
        { text: '🇮🇩 Indonesia', callback_data: 'lang_id' }, 
        { text: '🇬🇧 English', callback_data: 'lang_en' }, 
        { text: '🇨🇳 Chinese', callback_data: 'lang_zh' }, 
        { text: '🇸🇦 Arabic', callback_data: 'lang_ar' }
      ]] 
    } 
  });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ? String(msg.from.id) : null;
  
  if (userId && !userLanguage[userId]) { 
    userLanguage[userId] = 'en'; 
    saveUserLanguage(); 
    updateBotBio(); 
  }
  
  const currentLang = (userId && userLanguage[userId]) || 'en';
  
  if (userId && bannedUsers.includes(userId)) {
    return bot.sendMessage(chatId, getMessage(currentLang, 'banned_user'));
  }
  
  let text = msg.text || '';
  
  // Handle commands with bot username
  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    let command = parts[0];
    
    // Remove bot username suffix if present
    if (command.includes('@')) {
      command = command.split('@')[0];
      text = [command, ...parts.slice(1)].join(' ');
      msg.text = text;
    }
    
    const isRegistered = commands.some(c => `/${c.command}` === command);
    if (!isRegistered) {
      logs('info', 'Unknown slash command received', { 
        ChatID: chatId, 
        Command: text, 
        User: userId 
      });
    }
    // Let onText handlers process registered commands
    return;
  }
  
  const effectiveLang = userLanguage[userId] || 'en';
  const tiktokMatch = text.match(/^(https?:\/\/.*tiktok\.com\/[^\s]+)(?:\s+(@\w+|\d+))?$/i);

  try {
    if (tiktokMatch) {
      if (!isPrivateChat(msg)) {
        await bot.sendMessage(chatId, getMessage(effectiveLang, 'private_only_msg'), { 
          parse_mode: 'Markdown' 
        });
        logs('info', 'TikTok download attempt in group chat (Blocked)', { 
          ChatID: chatId, 
          User: userId 
        });
        return;
      }
      
      const url = tiktokMatch[1];
      const target = tiktokMatch[2] || chatId;
      let valid = false;
      try { 
        const urlObj = new URL(url);
        valid = allowedTikTokHosts.some(host => 
          urlObj.host === host || urlObj.host.endsWith('.' + host)
        );
      } catch (e) {
        valid = false;
      }
      
      if (!valid) {
        return bot.sendMessage(chatId, getMessage(effectiveLang, 'invalid_url'));
      }

      logs('success', 'TikTok link received and validated', {
        ChatID: chatId,
        URL: url,
        Target: target === chatId ? 'Self' : target
      });

      const proc = await bot.sendMessage(chatId, getMessage(effectiveLang, 'processing'));
      const originalChatId = msg.chat.id;
      
      if (tiktokMatch[2]) {
        msg.chat.id = target;
      }
      
      try {
        await handler(bot, msg, languages, userLanguage, proc.message_id);
        if (tiktokMatch[2]) {
          await bot.sendMessage(originalChatId, `✅ Sent to ${target}`);
        }
      } catch (e) {
        logs('error', 'Handler failed', { 
          ChatID: chatId, 
          Error: e.message 
        });
        await bot.sendMessage(originalChatId, getMessage(effectiveLang, 'generic_error'));
      } finally { 
        msg.chat.id = originalChatId; 
      }
    } else if (isPrivateChat(msg)) {
      if (text.match(/https?:\/\/.*tiktok\.com\//i)) {
        return bot.sendMessage(chatId, getMessage(effectiveLang, 'strict_link_only'));
      }
      
      const res = await queryAI(chatId, text, effectiveLang);
      logs('success', 'AI handled text message', {
        ChatID: chatId,
        Query: text,
        Response: res.length > 50 ? res.slice(0, 47) + '...' : res
      });
      
      await bot.sendMessage(chatId, res).catch(async () => {
        await bot.sendMessage(chatId, res.replace(/[*_`[\]]/g, ''));
      });
    }
  } catch (e) {
    logs('error', 'Message handling failed', { 
      ChatID: chatId, 
      Error: e.message,
      Text: text 
    });
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  logs('error', 'Unhandled Promise Rejection', { 
    Error: error.message,
    Stack: error.stack 
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logs('error', 'Uncaught Exception', { 
    Error: error.message,
    Stack: error.stack 
  });
});

module.exports = { 
  bot, 
  getMessage, 
  getMainKeyboard, 
  queryAI, 
  userLanguage, 
  languages,
  escapeMarkdown
};
