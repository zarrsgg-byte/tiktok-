const { ttdl } = require('btch-downloader');
const fetch = require('node-fetch');
const tiktok_video = require('./plugins/tiktok_video');
const tiktok_photo = require('./plugins/tiktok_photo');
const queue = require('./utils/queue');
const sleep = require('./utils/sleep');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const { DEVELOPER_ID, GROUP_ID, COMMON_HEADERS, TIKWM_API, MAX_RETRIES, COOLDOWN_MS } = require('./config');

const userRequestTimes = {};

const commonHeaders = COMMON_HEADERS;

const logs = (type, message, details = {}) => {
  const time = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log(`[${type.toUpperCase()}] [${time}] ${message}`);
  if (details && Object.keys(details).length) console.log(JSON.stringify(details, null, 2));
};

async function processVideoStream(videoUrl, retry480p = false) {
  const tempDir = path.join(__dirname, './temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
  const outputPath = path.join(tempDir, `video_fast${Date.now()}.mp4`);

  let sizeMB = 0;
  try {
    const headRes = await fetch(videoUrl, { method: 'HEAD', headers: commonHeaders });
    sizeMB = headRes.headers.get('content-length') ? headRes.headers.get('content-length') / (1024 * 1024) : 0;
  } catch {}

  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(videoUrl, { headers: commonHeaders, timeout: 60000 });
      if (!response.ok) throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
      
      const inputStream = response.body;
      const cmd = ffmpeg(inputStream);

      if (retry480p) {
        cmd.outputOptions([
          '-c:v libx264',
          '-preset ultrafast',
          '-crf 30',
          '-vf scale=-2:480',
          '-c:a aac',
          '-b:a 64k',
          '-movflags +faststart',
          '-pix_fmt yuv420p'
        ]);
      } else if (sizeMB < 15) {
        cmd.outputOptions(['-c copy', '-movflags +faststart']);
      } else if (sizeMB < 45) {
        cmd.outputOptions(['-c:v libx264', '-preset ultrafast', '-crf 28', '-c:a aac', '-b:a 128k', '-movflags +faststart', '-pix_fmt yuv420p']);
      } else {
        cmd.outputOptions(['-c:v libx264', '-preset ultrafast', '-crf 32', '-vf scale=-2:480', '-c:a aac', '-b:a 64k', '-movflags +faststart', '-pix_fmt yuv420p']);
      }

      cmd.save(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

async function notifyDeveloper(bot, error, context = {}) {
  try {
    const { DEVELOPER_ID, GROUP_ID } = require('./config');
    const timestamp = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
    const escapeMarkdown = (text) => {
      if (!text || typeof text !== 'string') return text;
      return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
    };

    const errorMessage = `🚨 Bot Error Notification\n\n` +
      `📌 Error: ${escapeMarkdown(error.message)}\n` +
      `🕒 Time: ${timestamp}\n` +
      `📄 Context: \n\`\`\`json\n${escapeMarkdown(JSON.stringify(context, null, 2))}\n\`\`\``;

    const sendReport = async (targetId) => {
      if (!targetId) return false;
      try {
        await bot.sendMessage(targetId, errorMessage);
        return true;
      } catch (e) {
        console.error(`[HANDLER ERROR] Failed to send report to ${targetId}:`, e.message);
        return false;
      }
    };

    let sent = await sendReport(GROUP_ID);
    if (!sent) {
      await sendReport(DEVELOPER_ID);
    }
  } catch (e) {
    console.error('[HANDLER NOTIFY ERROR]', e);
  }
}

async function extractAudio(videoPath) {
  const tempDir = path.dirname(videoPath);
  const audioPath = path.join(tempDir, `audio_${Date.now()}.mp3`);
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .toFormat('mp3')
      .on('end', () => resolve(audioPath))
      .on('error', (err) => reject(err))
      .save(audioPath);
  });
}

async function handler(bot, msg, languages, userLanguage, processingMsgId) {
  const chatId = msg.chat.id;
  const url = msg.text?.trim().split(/\s+/)[0];
  const lang = userLanguage[msg.from?.id ? String(msg.from.id) : chatId] || 'en';
  const getMsg = (t) => languages[lang]?.[t] || languages.en?.[t] || t;

  const tiktokRegex = /https?:\/\/(?:www\.|vm\.|vt\.|v\.|m\.|t\.)?tiktok\.com\//i;
  if (!tiktokRegex.test(url || '')) return;

  const now = Date.now();
  const lastUserRequest = userRequestTimes[chatId] || 0;
  if (now - lastUserRequest < 2000) {
    await sleep(1500);
  }
  userRequestTimes[chatId] = Date.now();

  await queue.add(async () => {
    let attempts = 0;
    const maxAttempts = 3;
    let data = null;

    const processingMsg = processingMsgId
      ? { message_id: processingMsgId }
      : await bot.sendMessage(chatId, getMsg('processing') || '⏳ Processing TikTok...');

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const tikwmRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, { 
          timeout: 15000,
          headers: {
            ...commonHeaders,
            'Referer': 'https://www.tikwm.com/',
            'Origin': 'https://www.tikwm.com'
          }
        });
        const tikwm = await tikwmRes.json().catch(() => null);
        if (tikwm?.code === 0) {
          data = {
            status: true,
            title: tikwm.data?.title,
            images: tikwm.data?.images || [],
            video: tikwm.data?.play || tikwm.data?.hdplay || tikwm.data?.wmplay || [],
            audio: tikwm.data?.music ? [tikwm.data.music] : [],
            title_audio: tikwm.data?.music_info?.title || 'TikTok Audio',
            transcript: tikwm.data?.transcript || null
          };
          if (data.video && !Array.isArray(data.video)) data.video = [data.video];
          data.video = data.video.map(v => (typeof v === 'string' && v.startsWith('//')) ? `https:${v}` : v);
        }

        if (!data) {
          const res = await ttdl(url).catch(() => null);
          if (res) {
            data = {
              status: true,
              title: res.title,
              images: res.images || [],
              video: res.video || res.play || [],
              audio: res.audio || res.music || []
            };
            if (data.video && !Array.isArray(data.video)) data.video = [data.video];
            if (data.audio && !Array.isArray(data.audio)) data.audio = [data.audio];
            if (data.images && !Array.isArray(data.images)) data.images = [data.images];
            data.video = data.video.map(v => (typeof v === 'string' && v.startsWith('//')) ? `https:${v}` : v);
          }
        }

        if (!data) throw new Error('No data extracted');

        data = data || {};
        data.images = Array.isArray(data.images) ? data.images : [data.images].filter(Boolean);
        data.video = Array.isArray(data.video) ? data.video : [data.video].filter(Boolean);

        const images = data.images.filter(Boolean);
        const videos = data.video.filter(Boolean);
        const firstVideo = videos[0];

        // PHOTO MODE
        if (images.length > 0) {
          let finalImages = [];
          if (images.length > 0) {
            const seen = new Set();
            finalImages = images.filter(img => {
              if (!img) return false;
              const match = img.match(/\/([^\/?#]+)(?:\?|$)/);
              const id = match ? match[1] : img;
              if (seen.has(id)) return false;
              seen.add(id);
              return true;
            });
          }

          if (finalImages.length > 0) {
            try {
              finalImages = await Promise.all(finalImages.map(async (img, i) => {
                const isLocal = !img.startsWith('http');
                console.log(`[DEBUG] Processing photo ${i} from: ${img} | isLocal: ${isLocal}`);
                return img;
              }));

              logs('info', 'Attempting image extraction', { count: finalImages.length });
              
            if (processingMsgId) {
              await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
            } else {
              await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
            }
            
            return await tiktok_photo(
                bot,
                msg,
                { ...data, images: finalImages, isSlideshow: true },
                languages,
                userLanguage,
                processingMsgId
              );
            } catch (imgErr) {
              logs('warn', 'Image extraction failed', imgErr.message);
              await notifyDeveloper(bot, imgErr, { chatId, url, type: 'photo' });
            }
          }
        }

        // VIDEO MODE
        if (firstVideo) {
          try {
            logs('info', 'Attempting video extraction');
            let outputVideo;
            try {
              outputVideo = await processVideoStream(firstVideo);
            } catch (err) {
              const isEntityTooLarge = err.message.includes('413') || (err.response && err.response.status === 413);
              if (isEntityTooLarge) {
                logs('warn', '413 Error detected, retrying with 480p optimization');
                outputVideo = await processVideoStream(firstVideo, true);
              } else {
                throw err;
              }
            }
            
            if (processingMsgId) {
              await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
            } else {
              await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
            }
            
            try {
              return await tiktok_video(
                bot,
                msg,
                {
                  ...data,
                  video: [outputVideo],
                  original_video: firstVideo,
                  isSlideshowVideo: false
                },
                languages,
                userLanguage,
                processingMsgId
              );
            } catch (sendErr) {
              const isSendEntityTooLarge = sendErr.message.includes('413') || (sendErr.response && sendErr.response.status === 413);
              if (isSendEntityTooLarge && outputVideo && !outputVideo.includes('_optimized')) {
                logs('warn', 'Telegram 413 during send, retrying with 480p optimization');
                const optimizedVideo = await processVideoStream(firstVideo, true);
                return await tiktok_video(
                  bot,
                  msg,
                  {
                    ...data,
                    video: [optimizedVideo],
                    original_video: firstVideo,
                    isSlideshowVideo: false
                  },
                  languages,
                  userLanguage,
                  processingMsgId
                );
              }
              throw sendErr;
            }
          } catch (vidErr) {
            logs('error', 'Video extraction failed', vidErr.message);
            await notifyDeveloper(bot, vidErr, { chatId, url, type: 'video' });
          }
        }

        // FALLBACK - NO CONTENT FOUND
        if (processingMsgId) {
          await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
        } else {
          await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
        }
        
        return bot.sendMessage(chatId, getMsg('invalid_url') || '❌ Cannot extract video or images from this link.');

      } catch (err) {
        logs('error', `TikTok Processing Error for ${chatId}`, { url, error: err.message, attempt: attempts });
        
        if (attempts < maxAttempts) {
          await sleep(1000);
        } else {
          await notifyDeveloper(bot, err, { chatId, url, finalAttempt: true });
          
          if (processingMsgId) {
            await bot.deleteMessage(chatId, processingMsgId).catch(() => {});
          } else {
            await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
          }
          
          return bot.sendMessage(chatId, getMsg('generic_error') || '⚠️ A technical issue occurred. The developer will resolve it shortly.');
        }
      }
    }
  });
}

module.exports = { handler, extractAudio };
