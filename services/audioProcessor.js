const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ytdl = require('ytdl-core');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

// Set the FFmpeg path explicitly for the Vercel environment
// This part is crucial and should remain
ffmpeg.setFfmpegPath(ffmpegPath);

class AudioProcessor {
    async downloadAndExtractAudio(url, tempDir) {
        const audioFilePath = path.join(tempDir, `${uuidv4()}.mp3`);
        
        return new Promise((resolve, reject) => {
            const stream = ytdl(url, { quality: 'highestaudio' });

            // Error handler for the ytdl stream
            stream.on('error', (err) => {
                console.error('ytdl stream error:', err);
                if (err.statusCode === 410) {
                    reject(new Error('Input video not found or has been removed. Please try a different URL.'));
                } else {
                    reject(new Error(`ytdl error: ${err.message}`));
                }
            });

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