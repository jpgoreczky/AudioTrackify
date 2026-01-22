const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ytdl = require('@distube/ytdl-core');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

// Set the FFmpeg path explicitly for the Vercel environment
// This part is crucial and should remain
ffmpeg.setFfmpegPath(ffmpegPath);

class AudioProcessor {
    async downloadAndExtractAudio(url, tempDir) {
        const audioFilePath = path.join(tempDir, `${uuidv4()}.mp3`);
        
        console.log('[AudioProcessor] Starting download for URL:', url);
        
        // Validate URL first
        if (!ytdl.validateURL(url)) {
            console.error('[AudioProcessor] Invalid YouTube URL:', url);
            throw new Error('Invalid YouTube URL. Please provide a valid YouTube video URL.');
        }
        
        console.log('[AudioProcessor] URL validation passed');
        
        try {
            // Get video info first to verify access
            console.log('[AudioProcessor] Fetching video info...');
            const info = await ytdl.getInfo(url);
            console.log('[AudioProcessor] Video info retrieved:', {
                title: info.videoDetails.title,
                lengthSeconds: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name
            });
            
            // Create download stream with enhanced options
            console.log('[AudioProcessor] Creating download stream...');
            const stream = ytdl(url, { 
                quality: 'highestaudio',
                filter: 'audioonly',
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                    }
                }
            });

            return new Promise((resolve, reject) => {
                // Error handler for the ytdl stream
                stream.on('error', (err) => {
                    console.error('[AudioProcessor] ytdl stream error:', {
                        message: err.message,
                        statusCode: err.statusCode,
                        stack: err.stack
                    });
                    if (err.statusCode === 410) {
                        reject(new Error('Input video not found or has been removed. Please try a different URL.'));
                    } else if (err.message.includes('429') || err.message.includes('Too Many Requests')) {
                        reject(new Error('YouTube is rate limiting requests. Please try again in a few minutes.'));
                    } else {
                        reject(new Error(`Failed to download video: ${err.message}`));
                    }
                });
                
                // Log when download starts
                stream.on('progress', (chunkLength, downloaded, total) => {
                    if (total > 0) {
                        const percent = ((downloaded / total) * 100).toFixed(2);
                        console.log('[AudioProcessor] Download progress:', percent + '%');
                    }
                });

                console.log('[AudioProcessor] Starting FFmpeg conversion...');
                ffmpeg(stream)
                    .audioBitrate(128)
                    .save(audioFilePath)
                    .on('start', (commandLine) => {
                        console.log('[AudioProcessor] FFmpeg command:', commandLine);
                    })
                    .on('progress', (progress) => {
                        console.log('[AudioProcessor] FFmpeg progress:', progress.percent ? progress.percent.toFixed(2) + '%' : 'processing...');
                    })
                    .on('end', () => {
                        console.log('[AudioProcessor] FFmpeg conversion completed successfully');
                        console.log('[AudioProcessor] Audio file saved to:', audioFilePath);
                        resolve(audioFilePath);
                    })
                    .on('error', (err) => {
                        console.error('[AudioProcessor] FFmpeg error:', {
                            message: err.message,
                            stack: err.stack
                        });
                        reject(new Error(`Audio conversion failed: ${err.message}`));
                    });
            });
        } catch (err) {
            console.error('[AudioProcessor] Error in downloadAndExtractAudio:', {
                message: err.message,
                stack: err.stack
            });
            if (err.message.includes('Video unavailable')) {
                throw new Error('Input video not found or has been removed. Please try a different URL.');
            } else if (err.message.includes('Sign in to confirm your age')) {
                throw new Error('This video is age-restricted and cannot be processed.');
            } else if (err.message.includes('private video')) {
                throw new Error('This video is private and cannot be accessed.');
            } else {
                throw new Error(`Processing failed: ${err.message}`);
            }
        }
    }
}

module.exports = new AudioProcessor();