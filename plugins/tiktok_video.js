const fetch = require('node-fetch');
const fs = require('fs');
const sleep = require('../utils/sleep');

const commonHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'video/webm,video/any,video/*;q=0.9,audio/webm,audio/any,audio/*;q=0.8,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.tiktok.com/',
  'Connection': 'keep-alive'
};

const escapeHtml = (text) =>
  typeof text === 'string'
    ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    : String(text || '');

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

async function sendVideoSafe(bot, chatId, videoStream, options) {
  try {
    return await sendWithRetry(bot, 'sendVideo', chatId, videoStream, options);
  } catch (e) {
    if (e.message?.includes('parse') || e.message?.includes('entities') || e.message?.includes('400')) {
      const fallbackOptions = { ...options };
      delete fallbackOptions.parse_mode;
      fallbackOptions.caption = options.caption
        ? options.caption.replace(/<[^>]+>/g, '')
        : undefined;
      return await sendWithRetry(bot, 'sendVideo', chatId, videoStream, fallbackOptions);
    }
    throw e;
  }
}

async function tiktok_video(bot, msg, data, languages, userLanguage) {
  const chatId = msg.chat.id;
  const lang = userLanguage[String(msg.from?.id || chatId)] || userLanguage[chatId] || 'en';
  const t = (k) => languages?.[lang]?.[k] || languages?.en?.[k] || k;

  const title = data?.title || 'TikTok Video';
  const titleAudio = data?.title_audio || 'TikTok Audio';
  const videoUrl = data?.video?.[0];
  const audioUrl = data?.audio?.[0];
  const isSlideshowVideo = data?.isSlideshowVideo || false;
  const linkOnly = data?.linkOnly || false;

  if (!videoUrl && !linkOnly) return sendWithRetry(bot, 'sendMessage', chatId, '❌ No video found.');
  if (!videoUrl && !data?.original_video) return sendWithRetry(bot, 'sendMessage', chatId, '❌ No video found.');

  try {
    const finalVideoUrl = videoUrl
      ? (videoUrl.startsWith('//') ? `https:${videoUrl}` : videoUrl)
      : null;
    const isLocalFile = finalVideoUrl && !finalVideoUrl.startsWith('http');
    const buttonUrl = data?.original_video || (!isLocalFile ? finalVideoUrl : '');

    const keyboard = [];
    if (buttonUrl && buttonUrl.startsWith('http')) {
      keyboard.push([{ text: `🎥 ${isSlideshowVideo ? t('url_slideshow_video') : t('url_video') || 'Watch Video'}`, url: buttonUrl }]);
      const sdUrl = buttonUrl.replace('hd=1', 'hd=0');
      if (sdUrl !== buttonUrl) {
        keyboard.push([{ text: `📉 ${t('data_saver') || 'Data Saver Mode (SD)'}`, url: sdUrl }]);
      }
    }

    const botMe = await bot.getMe().catch(() => ({ username: 'bot' }));

    if (audioUrl) {
      const { audioMap } = require('../utils/audioStore');
      const audioId = `video_${Date.now()}`;
      audioMap.set(audioId, audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl);
      keyboard.push([{ text: `🎵 ${t('audio')} (${t('original') || 'Original'}) | @${botMe.username}`, callback_data: `audio_${audioId}` }]);
    }

    keyboard.push([{ text: `🚀 ${t('powered_by') || 'Powered by'} @zamasuuuuuuu`, url: 'https://t.me/zamasuuuuuuu' }]);

    const captionText = [
      `<b>${isSlideshowVideo ? '🖼️ ' + escapeHtml(t('slideshow_video') || 'Slideshow Video') : '🎥 ' + escapeHtml(t('video') || 'Video')}</b>`,
      ``,
      `📌 <b>${escapeHtml(t('title') || 'Title')}</b>: ${escapeHtml(title)}`,
      `🎵 <b>${escapeHtml(t('audio') || 'Audio')}</b>: ${escapeHtml(titleAudio)}`,
      data.transcript ? `\n📝 <b>${escapeHtml(t('transcript') || 'Transcript')}</b>:\n${escapeHtml(data.transcript)}` : ''
    ].join('\n').replace(/\n{3,}/g, '\n\n').substring(0, 1024);

    if (linkOnly || !finalVideoUrl) {
      return await sendWithRetry(bot, 'sendMessage', chatId, captionText, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }

    let videoStream;
    if (isLocalFile) {
      if (!fs.existsSync(finalVideoUrl)) throw new Error('Local video file not found');
      videoStream = fs.createReadStream(finalVideoUrl);
    } else {
      const videoResponse = await fetch(finalVideoUrl, {
        headers: { ...commonHeaders, 'Cookie': 'tt_webid_v2=7200000000000000000' },
        timeout: 180000
      });
      if (!videoResponse.ok) throw new Error(`Video fetch failed: ${videoResponse.status}`);
      videoStream = videoResponse.body;
    }

    if (isLocalFile) {
      try {
        const { extractAudio } = require('../handler');
        const { audioMap } = require('../utils/audioStore');
        const extractedAudioPath = await extractAudio(finalVideoUrl);
        if (extractedAudioPath && fs.existsSync(extractedAudioPath)) {
          const audioId = `video_ext_${Date.now()}`;
          audioMap.set(audioId, extractedAudioPath);
          keyboard.splice(keyboard.length - 1, 0, [{
            text: `🎵 ${t('audio')} (${t('extracted') || 'Extracted'}) | @${botMe.username}`,
            callback_data: `audio_${audioId}`
          }]);
        }
      } catch (audioErr) {
        console.warn('[AUDIO EXTRACTION SKIPPED]', audioErr.message);
      }
    }

    await sendVideoSafe(bot, chatId, videoStream, {
      caption: captionText,
      parse_mode: 'HTML',
      supports_streaming: true,
      reply_markup: { inline_keyboard: keyboard }
    });

    if (isLocalFile) {
      fs.unlink(finalVideoUrl, () => {});
    }

    await sleep(1000);

  } catch (err) {
    console.error(`[TIKTOK_VIDEO ERROR] ${chatId}:`, { message: err.message, video_url: videoUrl });
    throw err;
  }
}

module.exports = tiktok_video;
