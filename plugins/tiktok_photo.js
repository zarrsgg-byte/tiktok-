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

async function tiktok_photo(bot, msg, data, languages, userLanguage) {
  const From = msg.chat.id;
  const lang = userLanguage[From] || 'id';
  const getMsg = (type) => languages[lang]?.[type] || languages['en']?.[type] || type;
  const t = getMsg;

  const { title = '', title_audio = '', video = [], audio = [], images = [], isSlideshow = false } = data;

  const escapeMarkdown = (text) => typeof text === 'string' ? text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : text;

  const caption = `*🖼️ ${isSlideshow ? escapeMarkdown(t('slideshow')) : escapeMarkdown(t('photo'))}*\n\n📌 *${escapeMarkdown(t('title'))}*: ${escapeMarkdown(title)}\n🎵 *${escapeMarkdown(t('audio'))}*: ${escapeMarkdown(title_audio)}${data.transcript ? `\n\n📝 *${escapeMarkdown(t('transcript'))}*:\n${escapeMarkdown(data.transcript)}` : ''}`;
  const escapedCaption = caption.substring(0, 1000);
  const photoUrls = images.length > 0 ? images : video;

  try {
    const media = [];
    const localFiles = [];
    
    for (let i = 0; i < photoUrls.length; i++) {
      try {
        const photoUrl = photoUrls[i].startsWith('//') ? `https:${photoUrls[i]}` : photoUrls[i];
        const isLocalFile = !photoUrl.startsWith('http');
        
        let buffer;
        if (isLocalFile) {
          if (!fs.existsSync(photoUrl)) continue;
          buffer = fs.readFileSync(photoUrl);
          localFiles.push(photoUrl);
        } else {
          const res = await fetch(photoUrl, { 
            headers: commonHeaders,
            timeout: 15000
          });
          if (!res.ok) continue;
          buffer = await res.buffer();
        }

        // Advanced optimization & corruption check
        if (buffer.length < 100) continue;

        const compressedBuffer = await sharp(buffer)
          .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ 
            quality: 75, 
            progressive: true,
            mozjpeg: true 
          })
          .toBuffer()
          .catch(err => {
            return buffer; 
          });

        media.push({
          type: 'photo',
          media: compressedBuffer,
          caption: i === 0 ? escapedCaption : undefined,
          parse_mode: 'Markdown'
        });
      } catch (e) {
        console.log(`[WARNING] Photo processing skipped: ${e.message}`);
      }
    }

    const botInfo = await bot.getMe();
    const attributionText = escapeMarkdown(`${t('by')} @${botInfo.username}`);
    
    // Send in groups of 10
    for (let i = 0; i < media.length; i += 10) {
      const group = media.slice(i, i + 10);
      try {
        await sendWithRetry(bot, 'sendMediaGroup', From, group);
      } catch (err) {
        // Fallback: send individually if group fails
        for (const item of group) {
           await sendWithRetry(bot, 'sendPhoto', From, item.media, { caption: item.caption, parse_mode: 'Markdown' }).catch(() => {});
        }
      }
      await sleep(1500); 
    }
    
    localFiles.forEach(file => fs.unlink(file, () => {}));

    const inline_keyboard = [];
    if (audio && audio.length > 0) {
      const { audioMap } = require('../utils/audioStore');
      
      audio.forEach((audioUrl, index) => {
        const audioId = `photo_${Date.now()}_${index}`;
        audioMap.set(audioId, audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl);
        inline_keyboard.push([{ 
          text: `🎵 ${t('audio')} ${index + 1} | ${t('by') || 'By'} @${botInfo.username}`, 
          callback_data: `audio_${audioId}` 
        }]);
      });

      await sendWithRetry(bot, 'sendMessage', From, `🎶 *${escapeMarkdown(t('audio_selection')) || 'Select Audio'}*`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
      });
    }

    inline_keyboard.push([{ text: `🚀 ${t('powered_by')} @zamasuuuuuuu`, url: 'https://t.me/zamasuuuuuuu' }]);
    
    await sendWithRetry(bot, 'sendMessage', From, '✅', {
      reply_markup: { inline_keyboard }
    });
  } catch (error) {
    // Log technical details exclusively to developer console
    console.error(`[PHOTO ERROR] ${From}:`, {
      message: error.message,
      stack: error.stack,
      data_title: title
    });
    // Let handler handle the user feedback to maintain consistency
    throw error;
  }
}

module.exports = tiktok_photo;
