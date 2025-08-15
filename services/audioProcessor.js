const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const ytdl = require('ytdl-core');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

// Use the new, reliable path for the FFmpeg binary
const ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg');

// Set the FFmpeg path explicitly for the Vercel environment
ffmpeg.setFfmpegPath(ffmpegPath);

class AudioProcessor {
    /**
     * Downloads and extracts audio from a given URL.
     * @param {string} url - The video URL.
     * @param {string} tempDir - The temporary directory for files.
     * @returns {Promise<string>} Path to the extracted audio file.
     */
    async downloadAndExtractAudio(url, tempDir) {
        const audioFilePath = path.join(tempDir, `${uuidv4()}.mp3`);

        return new Promise((resolve, reject) => {
            const stream = ytdl(url, { quality: 'highestaudio' });

            ffmpeg(stream)
                .audioBitrate(128)
                .save(audioFilePath)
                .on('end', () => {
                    resolve(audioFilePath);
                })
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    reject(new Error(`FFmpeg error: ${err.message}`));
                });
        });
    }
}

module.exports = new AudioProcessor();