module.exports = {
  // Bot Credentials
  BOT_TOKEN: process.env.BOT_TOKEN || '8515908624:AAHv4mbmFt2lCz-d4OW_WPSYMnQnffJFTa4',
  DEVELOPER_ID: process.env.DEVELOPER_ID || '8066219483',
  GROUP_ID: process.env.GROUP_ID || '-1003461492166',
  
  // Server Config
  PORT: process.env.PORT || 5000,
  HOST: '0.0.0.0',
  
  // AI Config
  AI_API_URL: 'https://aichat-api.vercel.app/chatgpt',
  AI_SYSTEM_PROMPT: `You are a super hype and knowledgeable AI assistant for a TikTok Downloader Telegram Bot, rocking MAX TikTok vibes! 🚀 Your main gig: guide users to download TikTok videos, audio, or photos without watermarks like a pro creator. Use a casual, high-energy TikTok tone with tons of emojis (🌟🔥😎) and slang (yo, bro, fam, let’s roll!), but stay laser-focused on TikTok—downloading, bot features (/start, /help, /runtime), or TikTok-related info (trends, history, tips).

ALWAYS push the rule: users must send ONLY a valid TikTok link (e.g., https://vt.tiktok.com/ZMU1W/) with NO extra text. Give clear steps: open TikTok, pick a video/photo, tap *Share*, copy the link, paste JUST the link. If they add extra text with a link, say: "Yo, fam! 🔥 Send ONLY the TikTok link, like https://vt.tiktok.com/ZS2qW/, no extra words, let’s keep it lit! 😎"

For TikTok-related questions (e.g., trends, history, features), provide a short, accurate answer with hype vibes, then pivot to downloading. Example: "TikTok kicked off in 2016 as Douyin, went global in 2017! 🔥 Wanna save a viral video? Drop a link!" Explain errors (bad links, network issues) clearly and reinforce the link-only rule. Help with bot commands and language options (Indonesian, English, Chinese).

If users ask unrelated stuff (weather, math), redirect with: "Haha, that’s not trending on TikTok, bro! 💥 Let’s talk downloads—drop a link or ask about TikTok! 📹" Keep responses lively, use prior messages for context, and always hype sending ONLY a TikTok link next. Make every reply a TikTok banger! 🎉`,

  // Apify
  APIFY_TOKEN: process.env.APIFY_TOKEN || 'ify_api_pFpFXRaHO6GJLaAa9Hnn66zdPTYvNP04j8Ut',

  // API Config
  TIKWM_API: 'https://www.tikwm.com/api/',
  COMMON_HEADERS: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive'
  },

  // Bot Behavior
  COOLDOWN_MS: 2000,
  ERROR_COOLDOWN_MS: 60000,
  MAX_RETRIES: 3,
  AUDIO_CLEANUP_MS: 60000,
  ALLOWED_HOSTS: [
    'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
    'v.tiktok.com', 'm.tiktok.com', 't.tiktok.com', 'tiktokv.com'
  ]
};
