const { Telegraf } = require('telegraf');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configure ffmpeg binary path
ffmpeg.setFfmpegPath(ffmpegPath);

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN environment variable is not set!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Start command
bot.start((ctx) => {
  ctx.reply("👋 Welcome! Send or forward any video (or video document) to me, and I'll convert it to MP3 audio.");
});

// Download helper function using streams
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

// Convert video file to MP3
function convertToAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

// Handle video & document uploads
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
    // Get file download link from Telegram
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Download video locally
    await downloadFile(fileLink.href, videoPath);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      '⚙️ Converting video to audio...'
    );

    // Convert video to MP3
    await convertToAudio(videoPath, audioPath);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      '📤 Uploading MP3...'
    );

    // Send converted audio file to user
    await ctx.replyWithAudio(
      { source: audioPath, filename: 'audio.mp3' },
      { caption: 'Here is your converted audio file! 🎶' }
    );

    // Clean up status message
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
    // Cleanup temporary local files
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}

// Attach message handlers
bot.on('video', handleVideoConversion);
bot.on('document', handleVideoConversion);

// Launch bot using polling
bot.launch().then(() => {
  console.log('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
