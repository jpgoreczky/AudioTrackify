const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

// Set the FFmpeg path explicitly for the Vercel environment
// This part is crucial and should remain
ffmpeg.setFfmpegPath(ffmpegPath);

class AudioProcessor {
    constructor() {
        // Initialize yt-dlp wrapper
        this.ytDlp = new YTDlpWrap();
    }

    // Load YouTube cookies path if available
    _getYouTubeCookiesPath() {
        const cookiesPath = process.env.YOUTUBE_COOKIES_PATH || path.join(__dirname, '..', 'youtube-cookies.txt');
        
        if (fs.existsSync(cookiesPath)) {
            console.log('[AudioProcessor] Found YouTube cookies file at:', cookiesPath);
            return cookiesPath;
        }
        
        console.log('[AudioProcessor] No YouTube cookies file found - may encounter bot detection');
        return null;
    }

    async downloadAndExtractAudio(url, tempDir) {
        const audioFilePath = path.join(tempDir, `${uuidv4()}.mp3`);
        const tempVideoPath = path.join(tempDir, `${uuidv4()}.temp`);
        
        console.log('[AudioProcessor] Starting download for URL:', url);
        
        try {
            // Build yt-dlp options
            const ytDlpOptions = [
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '128K',
                '--output', tempVideoPath,
                '--no-playlist',
                '--no-warnings',
                '--no-check-certificate',
                '--prefer-insecure',
                '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                '--add-header', 'Accept-Language:en-US,en;q=0.9',
                '--add-header', 'Sec-Fetch-Dest:document',
                '--add-header', 'Sec-Fetch-Mode:navigate',
                '--add-header', 'Sec-Fetch-Site:none',
                '--no-check-formats'
            ];

            // Add cookies if available
            const cookiesPath = this._getYouTubeCookiesPath();
            if (cookiesPath) {
                ytDlpOptions.push('--cookies', cookiesPath);
                console.log('[AudioProcessor] Using cookies for authentication');
            }

            ytDlpOptions.push(url);

            console.log('[AudioProcessor] Executing yt-dlp with options');
            
            // Execute yt-dlp
            await new Promise((resolve, reject) => {
                const ytDlpProcess = this.ytDlp.exec(ytDlpOptions);
                
                let lastProgress = 0;
                
                ytDlpProcess.on('progress', (progress) => {
                    if (progress.percent) {
                        const percent = Math.floor(progress.percent);
                        if (percent >= lastProgress + 10 || percent >= 99) {
                            console.log('[AudioProcessor] Download progress:', percent + '%');
                            lastProgress = percent;
                        }
                    }
                });
                
                ytDlpProcess.on('ytDlpEvent', (eventType, eventData) => {
                    if (eventType === 'info') {
                        console.log('[AudioProcessor] Video info:', eventData);
                    }
                });
                
                ytDlpProcess.on('error', (error) => {
                    console.error('[AudioProcessor] yt-dlp error:', {
                        message: error.message,
                        stack: error.stack
                    });
                    
                    // Enhanced error messages
                    if (error.message.includes('Sign in to confirm')) {
                        reject(new Error('YouTube requires sign-in verification. Please set up YouTube cookies (see README) or try a different video.'));
                    } else if (error.message.includes('Video unavailable')) {
                        reject(new Error('Input video not found or has been removed. Please try a different URL.'));
                    } else if (error.message.includes('age')) {
                        reject(new Error('This video is age-restricted and cannot be processed.'));
                    } else if (error.message.includes('private')) {
                        reject(new Error('This video is private and cannot be accessed.'));
                    } else if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
                        reject(new Error('YouTube is rate limiting requests. Please try again in a few minutes.'));
                    } else {
                        reject(new Error(`Failed to download video: ${error.message}`));
                    }
                });
                
                ytDlpProcess.on('close', () => {
                    console.log('[AudioProcessor] yt-dlp download completed');
                    
                    // Find the output file (yt-dlp adds .mp3 extension)
                    const outputFile = tempVideoPath + '.mp3';
                    
                    if (fs.existsSync(outputFile)) {
                        // Move to final location
                        fs.moveSync(outputFile, audioFilePath, { overwrite: true });
                        console.log('[AudioProcessor] Audio file saved to:', audioFilePath);
                        resolve(audioFilePath);
                    } else {
                        reject(new Error('yt-dlp completed but output file not found'));
                    }
                });
            });

            return audioFilePath;
        } catch (err) {
            console.error('[AudioProcessor] Error in downloadAndExtractAudio:', {
                message: err.message,
                stack: err.stack
            });
            
            // Clean up temp files
            try {
                if (fs.existsSync(tempVideoPath)) fs.removeSync(tempVideoPath);
                if (fs.existsSync(tempVideoPath + '.mp3')) fs.removeSync(tempVideoPath + '.mp3');
            } catch (cleanupErr) {
                console.warn('[AudioProcessor] Failed to clean up temp files:', cleanupErr.message);
            }
            
            throw err;
        }
    }
}

module.exports = new AudioProcessor();