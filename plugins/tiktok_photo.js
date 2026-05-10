const fetch = require('node-fetch');
const fs = require('fs');
const sharp = require('sharp');
const sleep = require('../utils/sleep');

const commonHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.tiktok.com/'
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
        await sleep(delay);
      } else if (e.message?.includes('429') || e.message?.includes('502') || e.message?.includes('503')) {
        await sleep(attempts * 3000);
      } else {
        throw e;
      }
    }
  }
}

async function sendMessageSafe(bot, chatId, text, options = {}) {
  try {
    return await sendWithRetry(bot, 'sendMessage', chatId, text, options);
  } catch (e) {
    if (e.message?.includes('parse') || e.message?.includes('entities') || e.message?.includes('400')) {
      const fallback = { ...options };
      delete fallback.parse_mode;
      const plainText = text.replace(/<[^>]+>/g, '');
      return await sendWithRetry(bot, 'sendMessage', chatId, plainText, fallback);
    }
    throw e;
  }
}

async function tiktok_photo(bot, msg, data, languages, userLanguage) {
  const From = msg.chat.id;
  const userId = String(msg.from?.id || From);
  const lang = userLanguage[userId] || userLanguage[From] || 'en';
  const t = (type) => languages[lang]?.[type] || languages['en']?.[type] || type;

  const { title = '', title_audio = '', video = [], audio = [], images = [], isSlideshow = false } = data;

  const caption = [
    `<b>🖼️ ${isSlideshow ? escapeHtml(t('slideshow') || 'Slideshow') : escapeHtml(t('photo') || 'Photo')}</b>`,
    ``,
    `📌 <b>${escapeHtml(t('title') || 'Title')}</b>: ${escapeHtml(title)}`,
    `🎵 <b>${escapeHtml(t('audio') || 'Audio')}</b>: ${escapeHtml(title_audio)}`,
    data.transcript ? `\n📝 <b>${escapeHtml(t('transcript') || 'Transcript')}</b>:\n${escapeHtml(data.transcript)}` : ''
  ].join('\n').replace(/\n{3,}/g, '\n\n').substring(0, 1000);

  const photoUrls = images.length > 0 ? images : video;

  try {
    const media = [];
    const localFiles = [];

    for (let i = 0; i < photoUrls.length; i++) {
      try {
        const rawUrl = photoUrls[i];
        if (!rawUrl) continue;
        const photoUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
        const isLocalFile = !photoUrl.startsWith('http');

        let buffer;
        if (isLocalFile) {
          if (!fs.existsSync(photoUrl)) continue;
          buffer = fs.readFileSync(photoUrl);
          localFiles.push(photoUrl);
        } else {
          const res = await fetch(photoUrl, { headers: commonHeaders, timeout: 20000 });
          if (!res.ok) {
            console.warn(`[PHOTO SKIP] ${res.status} on ${photoUrl}`);
            continue;
          }
          buffer = await res.buffer();
        }

        if (buffer.length < 100) continue;

        const compressedBuffer = await sharp(buffer)
          .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 75, progressive: true, mozjpeg: true })
          .toBuffer()
          .catch(() => buffer);

        media.push({
          type: 'photo',
          media: compressedBuffer,
          caption: i === 0 ? caption : undefined,
          parse_mode: i === 0 ? 'HTML' : undefined
        });
      } catch (e) {
        console.warn(`[PHOTO SKIP] Photo processing error: ${e.message}`);
      }
    }

    const botInfo = await bot.getMe().catch(() => ({ username: 'bot' }));

    for (let i = 0; i < media.length; i += 10) {
      const group = media.slice(i, i + 10);
      try {
        await sendWithRetry(bot, 'sendMediaGroup', From, group);
      } catch (err) {
        if (err.message?.includes('parse') || err.message?.includes('entities') || err.message?.includes('400')) {
          const stripped = group.map(item => ({
            ...item,
            caption: item.caption ? item.caption.replace(/<[^>]+>/g, '') : undefined,
            parse_mode: undefined
          }));
          try {
            await sendWithRetry(bot, 'sendMediaGroup', From, stripped);
          } catch {
            for (const item of stripped) {
              await sendWithRetry(bot, 'sendPhoto', From, item.media, { caption: item.caption }).catch(() => {});
            }
          }
        } else {
          for (const item of group) {
            const plainCaption = item.caption ? item.caption.replace(/<[^>]+>/g, '') : undefined;
            await sendWithRetry(bot, 'sendPhoto', From, item.media, { caption: plainCaption }).catch(() => {});
          }
        }
      }
      await sleep(1500);
    }

    localFiles.forEach(file => fs.unlink(file, () => {}));

    const inline_keyboard = [];
    if (audio && audio.length > 0) {
      const { audioMap } = require('../utils/audioStore');
      audio.forEach((audioUrl, index) => {
        if (!audioUrl) return;
        const audioId = `photo_${Date.now()}_${index}`;
        audioMap.set(audioId, audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl);
        inline_keyboard.push([{
          text: `🎵 ${t('audio')} ${audio.length > 1 ? index + 1 : ''} | @${botInfo.username}`.trim(),
          callback_data: `audio_${audioId}`
        }]);
      });

      await sendMessageSafe(bot, From, `🎶 <b>${escapeHtml(t('audio_selection') || 'Select Audio')}</b>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard }
      });
    }

    inline_keyboard.push([{ text: `🚀 ${t('powered_by') || 'Powered by'} @zamasuuuuuuu`, url: 'https://t.me/zamasuuuuuuu' }]);

    await sendWithRetry(bot, 'sendMessage', From, '✅', {
      reply_markup: { inline_keyboard }
    });

  } catch (error) {
    console.error(`[PHOTO ERROR] ${From}:`, { message: error.message, data_title: title });
    throw error;
  }
}

module.exports = tiktok_photo;
