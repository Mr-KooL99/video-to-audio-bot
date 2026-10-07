const { Telegraf } = require('telegraf');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configure ffmpeg binary path
ffmpeg.setFfmpegPath(ffmpegPath);

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN environment variable is not set!');
  process.exit(1);
}

// Minimal HTTP server for Render's health check
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is live and running!');
}).listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply("👋 Welcome! Send or forward any video (or video document) to me, and I'll convert it to MP3 audio.");
});

async function downloadFile(fileUrl, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    url: fileUrl,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function convertToAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .audioBitrate('128k')          // Standard quality, much faster processing
      .outputOptions('-preset ultrafast') // Speed up encoding process
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}


async function handleVideoConversion(ctx) {
  const message = ctx.message;
  let fileId = null;

  if (message.video) {
    fileId = message.video.file_id;
  } else if (message.document && message.document.mime_type?.startsWith('video/')) {
    fileId = message.document.file_id;
  } else {
    return ctx.reply('⚠️ Please send a valid video file.');
  }

  const statusMsg = await ctx.reply('📥 Downloading video...');

  const videoPath = path.join(__dirname, `temp_${fileId}.mp4`);
  const audioPath = path.join(__dirname, `converted_${fileId}.mp3`);

  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    await downloadFile(fileLink.href, videoPath);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      '⚙️ Converting video to audio...'
    );

    await convertToAudio(videoPath, audioPath);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      '📤 Uploading MP3...'
    );

    await ctx.replyWithAudio(
      { source: audioPath, filename: 'audio.mp3' },
      { caption: 'Here is your converted audio file! 🎶' }
    );

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

  } catch (error) {
    console.error('Error processing video:', error);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `❌ Failed to convert video. Error: ${error.message}`
    );
  } finally {
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}

bot.on('video', handleVideoConversion);
bot.on('document', handleVideoConversion);

bot.launch().then(() => {
  console.log('Bot is running via polling...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
