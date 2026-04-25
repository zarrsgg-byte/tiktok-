const fetch = require('node-fetch');
const fs = require('fs');
const { PassThrough } = require('stream');
const sleep = require('../utils/sleep');

const commonHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'video/webm,video/any,video/*;q=0.9,audio/webm,audio/any,audio/*;q=0.8,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.tiktok.com/',
  'Connection': 'keep-alive'
};

/* ─────────────────────────────
   دالة إرسال تيك توك مباشرة عبر Stream
   Rate Limited Message Sender
───────────────────────────── */
async function sendWithRetry(bot, method, chatId, ...args) {
  let attempts = 0;
  const maxAttempts = 5;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      return await bot[method](chatId, ...args);
    } catch (e) {
      if (e.response?.body?.retry_after) {
        const delay = e.response.body.retry_after * 1000 + 1000;
        console.warn(`[RATE LIMIT] ${chatId} retrying after ${delay}ms`);
        await sleep(delay);
      } else if (e.message?.includes('429') || e.message?.includes('502') || e.message?.includes('503')) {
        const delay = attempts * 3000;
        console.warn(`[TEMP ERROR] ${chatId} retrying after ${delay}ms: ${e.message}`);
        await sleep(delay);
      } else {
        throw e;
      }
    }
  }
}

async function tiktok_video(bot, msg, data, languages, userLanguage) {
  const chatId = msg.chat.id;
  const lang = userLanguage[chatId] || 'en';
  const t = (k) => languages?.[lang]?.[k] || languages?.en?.[k] || k;

  const title = data?.title || 'TikTok Video';
  const titleAudio = data?.title_audio || 'TikTok Audio';
  const videoUrl = data?.video?.[0];
  const audioUrl = data?.audio?.[0];
  const isSlideshowVideo = data?.isSlideshowVideo || false;

  const escapeMarkdown = (text) => typeof text === 'string' ? text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : text;

  if (!videoUrl) return sendWithRetry(bot, 'sendMessage', chatId, '❌ No video found.');

  try {
    // 1️⃣ إرسال الفيديو مباشرة كـ Stream
    const finalVideoUrl = videoUrl.startsWith('//') ? `https:${videoUrl}` : videoUrl;
    const isLocalFile = !finalVideoUrl.startsWith('http');
    const buttonUrl = data?.original_video || (isLocalFile ? '' : finalVideoUrl);
    console.log('[DEBUG] Processing video from:', finalVideoUrl, 'isLocal:', isLocalFile, 'ButtonURL:', buttonUrl);
    
    let videoStream;
    if (isLocalFile) {
      if (!fs.existsSync(finalVideoUrl)) throw new Error('Local video file not found');
      videoStream = fs.createReadStream(finalVideoUrl);
    } else {
      const videoResponse = await fetch(finalVideoUrl, {
        headers: {
          ...commonHeaders,
          'Cookie': 'tt_webid_v2=7200000000000000000'
        },
        timeout: 180000
      });
      if (!videoResponse.ok) throw new Error(`Video fetch failed: ${videoResponse.status}`);
      videoStream = videoResponse.body;
    }

    const keyboard = [];
    if (buttonUrl && buttonUrl.startsWith('http')) {
      keyboard.push([{ text: `🎥 ${isSlideshowVideo ? t('url_slideshow_video') : t('url_video')}`, url: buttonUrl }]);
      keyboard.push([{ text: `📉 ${t('data_saver') || 'Data Saver Mode (SD)'}`, url: buttonUrl.replace('hd=1', 'hd=0') }]);
    }

    const botMe = await bot.getMe();
    if (audioUrl) {
      const { audioMap } = require('../utils/audioStore');
      const audioId = `video_${Date.now()}`;
      audioMap.set(audioId, audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl);
      keyboard.push([{ text: `🎵 ${t('audio')} (${t('original') || 'Original'}) | ${t('by') || 'By'} @${botMe.username}`, callback_data: `audio_${audioId}` }]);
    }

    // Extract audio from local video
    if (isLocalFile) {
      try {
        const { extractAudio } = require('../handler');
        const { audioMap } = require('../utils/audioStore');
        const extractedAudioPath = await extractAudio(finalVideoUrl);
        if (fs.existsSync(extractedAudioPath)) {
          const audioId = `video_ext_${Date.now()}`;
          audioMap.set(audioId, extractedAudioPath);
          keyboard.push([{ text: `🎵 ${t('audio')} (${t('extracted') || 'Extracted'}) | ${t('by') || 'By'} @${botMe.username}`, callback_data: `audio_${audioId}` }]);
        }
      } catch (audioErr) {
        console.error('[AUDIO EXTRACTION ERROR]', audioErr.message);
      }
    }

    keyboard.push([{ text: `🚀 ${t('powered_by')} @zamasuuuuuuu`, url: 'https://t.me/zamasuuuuuuu' }]);

    const captionText = `*${isSlideshowVideo ? '🖼️ ' + escapeMarkdown(t('slideshow_video')) : '🎥 ' + escapeMarkdown(t('video'))}*\n\n📌 *${escapeMarkdown(t('title'))}*: ${escapeMarkdown(title)}\n🎵 *${escapeMarkdown(t('audio'))}*: ${escapeMarkdown(titleAudio)}${data.transcript ? `\n\n📝 *${escapeMarkdown(t('transcript'))}*:\n${escapeMarkdown(data.transcript)}` : ''}`.substring(0, 1024);

    const attributionText = escapeMarkdown(`${t('by')} @${botMe.username}`);

    await sendWithRetry(bot, 'sendVideo', chatId, videoStream, {
      caption: captionText,
      parse_mode: 'Markdown',
      supports_streaming: true,
      reply_markup: {
        inline_keyboard: keyboard
      }
    });

    // Clean up local temp file
    if (isLocalFile) {
      fs.unlink(finalVideoUrl, () => {});
    }

    await sleep(1000);

  } catch (err) {
    // Log technical details exclusively to developer console
    console.error(`[TIKTOK ERROR] ${chatId}:`, {
      message: err.message,
      stack: err.stack,
      video_url: videoUrl
    });
    // Rethrow to ensure consistent user feedback from the handler
    throw err;
  }
}

module.exports = tiktok_video;
