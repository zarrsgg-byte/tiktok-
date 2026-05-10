const { ttdl } = require('btch-downloader');
const fetch = require('node-fetch');
const { ApifyClient } = require('apify-client');
const tiktok_video = require('./plugins/tiktok_video');
const tiktok_photo = require('./plugins/tiktok_photo');
const queue = require('./utils/queue');
const sleep = require('./utils/sleep');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const { DEVELOPER_ID, GROUP_ID, COMMON_HEADERS, TIKWM_API, MAX_RETRIES, COOLDOWN_MS, APIFY_TOKEN } = require('./config');

const userRequestTimes = {};

const commonHeaders = COMMON_HEADERS;

const getCallerFile = () => {
  try {
    const lines = (new Error().stack || '').split('\n');
    for (const line of lines) {
      if (line.includes('handler.js') && line.includes('logs')) continue;
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

const logs = (type, message, details = {}) => {
  const time = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
  const file = getCallerFile();
  const fileTag = file ? ` (${file})` : '';
  console.log(`[${type.toUpperCase()}] [${time}]${fileTag} ${message}`);
  if (details && Object.keys(details).length) console.log(JSON.stringify(details, null, 2));
};

const MAX_TELEGRAM_FILE_MB = 48;

async function processVideoStream(videoUrl, retry480p = false) {
  const tempDir = path.join(__dirname, './temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
  const outputPath = path.join(tempDir, `video_fast${Date.now()}.mp4`);

  let sizeMB = 0;
  try {
    const headRes = await fetch(videoUrl, { method: 'HEAD', headers: commonHeaders, timeout: 15000 });
    if (!headRes.ok) throw new Error(`HEAD request failed: ${headRes.status} ${headRes.statusText}`);
    sizeMB = headRes.headers.get('content-length') ? headRes.headers.get('content-length') / (1024 * 1024) : 0;
  } catch (headErr) {
    logs('warn', 'HEAD request failed, proceeding without size info', { error: headErr.message });
  }

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
          '-crf 32',
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
        .on('end', () => {
          const stats = fs.statSync(outputPath);
          const outMB = stats.size / (1024 * 1024);
          if (outMB > MAX_TELEGRAM_FILE_MB && !retry480p) {
            fs.unlink(outputPath, () => {});
            reject(new Error('OUTPUT_TOO_LARGE'));
          } else {
            resolve(outputPath);
          }
        })
        .on('error', err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

function getSuggestedSolution(error) {
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('413') || msg.includes('request entity too large') || msg === 'output_too_large')
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
}

function extractFileInfo(error) {
  try {
    const stack = error?.stack || '';
    const lines = stack.split('\n');
    for (const line of lines) {
      const match = line.match(/at\s+(?:\S+\s+)?\(?([^)]+\.js):(\d+):(\d+)\)?/);
      if (match) {
        const fullPath = match[1];
        const lineNum = match[2];
        const fileName = fullPath.replace(/.*[\\/]/, '');
        return `${fileName}:${lineNum}`;
      }
    }
  } catch {}
  return 'unknown';
}

async function notifyDeveloper(bot, error, context = {}) {
  try {
    const { DEVELOPER_ID, GROUP_ID } = require('./config');
    const timestamp = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
    const escapeHtml = (t) => typeof t === 'string'
      ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : String(t || '');

    const fileInfo = extractFileInfo(error);
    const solution = getSuggestedSolution(error);
    const contextJson = JSON.stringify(context, null, 2);

    const htmlMessage = `🚨 <b>Bot Error Notification</b>\n\n` +
      `📌 <b>Error:</b> ${escapeHtml(error.message)}\n` +
      `📂 <b>File:</b> <code>${escapeHtml(fileInfo)}</code>\n` +
      `🕒 <b>Time:</b> ${timestamp}\n` +
      `💡 <b>Suggested Fix:</b> ${escapeHtml(solution)}\n` +
      `📄 <b>Context:</b>\n<pre>${escapeHtml(contextJson)}</pre>`;

    const plainMessage = `🚨 Bot Error Notification\n\n` +
      `📌 Error: ${error.message}\n` +
      `📂 File: ${fileInfo}\n` +
      `🕒 Time: ${timestamp}\n` +
      `💡 Suggested Fix: ${solution}\n` +
      `📄 Context:\n${contextJson}`;

    const sendReport = async (targetId) => {
      if (!targetId) return false;
      try {
        await bot.sendMessage(targetId, htmlMessage, { parse_mode: 'HTML' });
        return true;
      } catch (e) {
        try {
          await bot.sendMessage(targetId, plainMessage);
          return true;
        } catch (e2) {
          console.error(`[HANDLER ERROR] Failed to send report to ${targetId}:`, e2.message);
          return false;
        }
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
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Audio extraction skipped: source file not found — ${videoPath}`);
  }

  const stat = fs.statSync(videoPath);
  if (stat.size < 1000) {
    throw new Error('Audio extraction skipped: source file is too small or empty.');
  }

  const tempDir = path.join(__dirname, './temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const ts = Date.now();
  const mp3Path = path.join(tempDir, `audio_${ts}.mp3`);
  const m4aPath = path.join(tempDir, `audio_${ts}.m4a`);

  const tryExtract = (outputPath, outputOptions) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Audio extraction timed out after 60s'));
      }, 60000);

      ffmpeg(videoPath)
        .outputOptions(outputOptions)
        .on('end', () => {
          clearTimeout(timer);
          if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            resolve(outputPath);
          } else {
            reject(new Error('Audio output file is empty or missing'));
          }
        })
        .on('error', (err) => {
          clearTimeout(timer);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          reject(err);
        })
        .save(outputPath);
    });

  // Attempts in order: mp3 → mp3 with explicit map → m4a/aac → m4a copy
  const attempts = [
    [mp3Path, ['-map', '0:a:0', '-acodec', 'libmp3lame', '-q:a', '4']],
    [mp3Path, ['-vn', '-acodec', 'libmp3lame', '-q:a', '5']],
    [m4aPath, ['-map', '0:a:0', '-acodec', 'aac', '-b:a', '128k']],
    [m4aPath, ['-vn', '-acodec', 'copy']],
  ];

  let lastErr;
  for (const [outPath, opts] of attempts) {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      return await tryExtract(outPath, opts);
    } catch (err) {
      lastErr = err;
      const msg = (err.message || '').toLowerCase();
      // Only bail out early if FFmpeg explicitly says there's no audio stream
      const isDefinitelyNoAudio =
        msg.includes('no such stream') ||
        msg.includes('output file does not contain any stream') ||
        (msg.includes('no audio') && !msg.includes('codec'));
      if (isDefinitelyNoAudio) {
        return null;
      }
      console.warn(`[AUDIO] Attempt failed (${opts.join(' ')}): ${err.message}`);
    }
  }

  // All attempts failed — return null so caller skips silently
  console.warn(`[AUDIO] All extraction attempts failed for: ${videoPath} — ${lastErr?.message}`);
  return null;
}

async function fetchFromApify(url) {
  if (!APIFY_TOKEN) {
    logs('warn', 'Apify token not set, skipping Apify fallback');
    return null;
  }

  const client = new ApifyClient({ token: APIFY_TOKEN });

  const run = await client.actor('clockworks/free-tiktok-scraper').call(
    {
      postURLs: [url],
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
      maxRequestRetries: 2
    },
    { timeout: 90 }
  );

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  if (!items || items.length === 0) return null;

  const item = items[0];

  const normalizeUrl = (v) =>
    typeof v === 'string' && v.startsWith('//') ? `https:${v}` : v;

  const videoUrls = [
    item.videoUrlNoWatermark,
    item.videoUrl,
    item.webVideoUrl
  ].filter(Boolean).map(normalizeUrl);

  const images = (item.images || item.imageList || [])
    .filter(Boolean)
    .map(normalizeUrl);

  const audioUrl = item.musicMeta?.musicUrl
    ? normalizeUrl(item.musicMeta.musicUrl)
    : null;

  if (videoUrls.length === 0 && images.length === 0) return null;

  return {
    status: true,
    title: item.text || item.description || 'TikTok Video',
    images,
    video: videoUrls,
    audio: audioUrl ? [audioUrl] : [],
    title_audio: item.musicMeta?.musicName || 'TikTok Audio',
    transcript: null
  };
}

async function tryVideoUrls(urls, retry480p = false) {
  let lastErr;
  for (const url of urls) {
    if (!url) continue;
    try {
      const result = await processVideoStream(url, retry480p);
      return result;
    } catch (err) {
      lastErr = err;
      const is403 = err.message.includes('403') || err.message.includes('Forbidden');
      const isTooLarge = err.message === 'OUTPUT_TOO_LARGE' || err.message.includes('413');
      if (is403) {
        logs('warn', `403 on URL, trying next`, { url });
        continue;
      }
      if (isTooLarge && !retry480p) {
        logs('warn', 'Video too large, retrying with 480p');
        return await tryVideoUrls(urls, true);
      }
      throw err;
    }
  }
  throw lastErr || new Error('All video URLs failed');
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

    const deleteProcessingMsg = async () => {
      const msgId = processingMsgId || processingMsg.message_id;
      await bot.deleteMessage(chatId, msgId).catch(() => {});
    };

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const tikwmRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
          timeout: 20000,
          headers: {
            ...commonHeaders,
            'Referer': 'https://www.tikwm.com/',
            'Origin': 'https://www.tikwm.com'
          }
        });
        const tikwm = await tikwmRes.json().catch(() => null);
        if (tikwm?.code === 0 && tikwm.data) {
          const d = tikwm.data;
          const videoUrls = [d.hdplay, d.play, d.wmplay].filter(Boolean).map(v =>
            typeof v === 'string' && v.startsWith('//') ? `https:${v}` : v
          );
          data = {
            status: true,
            title: d.title,
            images: d.images || [],
            video: videoUrls,
            audio: d.music ? [d.music] : [],
            title_audio: d.music_info?.title || 'TikTok Audio',
            transcript: d.transcript || null
          };
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

        if (!data) {
          logs('info', 'Primary sources failed, trying Apify fallback');
          data = await fetchFromApify(url).catch((err) => {
            logs('warn', 'Apify fallback failed', { error: err.message });
            return null;
          });
        }

        if (!data) throw new Error('No data extracted');

        data.images = Array.isArray(data.images) ? data.images : [data.images].filter(Boolean);
        data.video = Array.isArray(data.video) ? data.video : [data.video].filter(Boolean);

        const images = data.images.filter(Boolean);
        const videos = data.video.filter(Boolean);

        // PHOTO MODE
        if (images.length > 0) {
          const seen = new Set();
          const finalImages = images.filter(img => {
            if (!img) return false;
            const match = img.match(/\/([^\/?#]+)(?:\?|$)/);
            const id = match ? match[1] : img;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });

          if (finalImages.length > 0) {
            logs('info', 'Attempting image extraction', { count: finalImages.length });
            await deleteProcessingMsg();
            return await tiktok_photo(
              bot,
              msg,
              { ...data, images: finalImages, isSlideshow: true },
              languages,
              userLanguage,
              processingMsgId
            );
          }
        }

        // VIDEO MODE
        if (videos.length > 0) {
          logs('info', 'Attempting video extraction', { urls: videos.length });
          let outputVideo;
          let videoTooLarge = false;

          try {
            outputVideo = await tryVideoUrls(videos);
          } catch (err) {
            const isTooLarge = err.message === 'OUTPUT_TOO_LARGE' || err.message.includes('413');
            if (isTooLarge) {
              videoTooLarge = true;
            } else {
              throw err;
            }
          }

          await deleteProcessingMsg();

          if (videoTooLarge || !outputVideo) {
            const directUrl = videos[0];
            return await tiktok_video(
              bot,
              msg,
              { ...data, video: [], original_video: directUrl, isSlideshowVideo: false, linkOnly: true },
              languages,
              userLanguage,
              processingMsgId
            );
          }

          try {
            return await tiktok_video(
              bot,
              msg,
              { ...data, video: [outputVideo], original_video: videos[0], isSlideshowVideo: false },
              languages,
              userLanguage,
              processingMsgId
            );
          } catch (sendErr) {
            const isSend413 = sendErr.message?.includes('413') || sendErr.response?.status === 413;
            if (isSend413) {
              logs('warn', 'Telegram 413 on send, falling back to link-only');
              fs.unlink(outputVideo, () => {});
              return await tiktok_video(
                bot,
                msg,
                { ...data, video: [], original_video: videos[0], isSlideshowVideo: false, linkOnly: true },
                languages,
                userLanguage,
                processingMsgId
              );
            }
            throw sendErr;
          }
        }

        // FALLBACK
        await deleteProcessingMsg();
        return bot.sendMessage(chatId, getMsg('invalid_url') || '❌ Cannot extract video or images from this link.');

      } catch (err) {
        logs('error', `TikTok Processing Error for ${chatId}`, { url, error: err.message, attempt: attempts });

        if (attempts < maxAttempts) {
          await sleep(1500 * attempts);
        } else {
          await notifyDeveloper(bot, err, { chatId, url, finalAttempt: true });
          await deleteProcessingMsg().catch(() => {});
          return bot.sendMessage(chatId, getMsg('generic_error') || '⚠️ A technical issue occurred. The developer will resolve it shortly.');
        }
      }
    }
  });
}

module.exports = { handler, extractAudio };
