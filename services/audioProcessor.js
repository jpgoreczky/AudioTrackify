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
    // Load and validate YouTube cookies if available
    _loadYouTubeCookies() {
        const cookiesPath = process.env.YOUTUBE_COOKIES_PATH || path.join(__dirname, '..', 'youtube-cookies.txt');
        
        if (!fs.existsSync(cookiesPath)) {
            return null;
        }
        
        try {
            const cookiesContent = fs.readFileSync(cookiesPath, 'utf8').trim();
            
            // Basic validation: check if it's not empty
            if (!cookiesContent || cookiesContent.length === 0) {
                console.warn('[AudioProcessor] Cookie file is empty');
                return null;
            }
            
            // Sanitize: remove any potential header injection characters
            // Only allow valid cookie characters (alphanumeric, spaces, hyphens, underscores, equals, semicolons)
            const sanitized = cookiesContent
                .replace(/[\r\n\0]/g, '') // Remove carriage return, newline, and null bytes
                .split(';')
                .map(cookie => cookie.trim())
                .filter(cookie => {
                    // Only keep cookies that match valid format: key=value
                    return /^[a-zA-Z0-9_-]+=.+$/.test(cookie);
                })
                .join('; ');
            
            if (!sanitized) {
                console.warn('[AudioProcessor] No valid cookies found after sanitization');
                return null;
            }
            
            console.log('[AudioProcessor] Using YouTube cookies for authentication');
            return sanitized;
        } catch (err) {
            console.warn('[AudioProcessor] Failed to load YouTube cookies:', err.message);
            return null;
        }
    }

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
            // Enhanced options to bypass bot detection
            const ytdlOptions = {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Cache-Control': 'max-age=0'
                    }
                }
            };

            // Add cookies if available
            const cookies = this._loadYouTubeCookies();
            if (cookies) {
                ytdlOptions.requestOptions.headers.Cookie = cookies;
                console.log('[AudioProcessor] Using cookies for request');
            } else {
                console.log('[AudioProcessor] No YouTube cookies available - may encounter bot detection');
            }
            
            // Get video info first to verify access
            console.log('[AudioProcessor] Fetching video info...');
            const info = await ytdl.getInfo(url, ytdlOptions);
            console.log('[AudioProcessor] Video info retrieved:', {
                title: info.videoDetails.title,
                lengthSeconds: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name
            });
            
            // Create download stream with enhanced options
            console.log('[AudioProcessor] Creating download stream...');
            const streamOptions = {
                ...ytdlOptions,
                quality: 'highestaudio',
                filter: 'audioonly'
            };
            
            const stream = ytdl(url, streamOptions);

            return new Promise((resolve, reject) => {
                let lastLoggedPercent = 0;
                
                // Error handler for the ytdl stream
                stream.on('error', (err) => {
                    console.error('[AudioProcessor] ytdl stream error:', {
                        message: err.message,
                        statusCode: err.statusCode,
                        stack: err.stack
                    });
                    
                    // Enhanced error messages for bot detection
                    if (err.statusCode === 410) {
                        reject(new Error('YouTube detected automated access. This may be due to: 1) Cloud server IP being blocked, 2) Missing YouTube cookies. See README for cookie setup instructions.'));
                    } else if (err.statusCode === 429 || err.message.includes('Too Many Requests')) {
                        reject(new Error('YouTube is rate limiting requests. Please try again in a few minutes or set up YouTube cookies for authentication.'));
                    } else if (err.message.includes('Sign in to confirm')) {
                        reject(new Error('YouTube requires sign-in verification. Please set up YouTube cookies (see README) or try a different video.'));
                    } else {
                        reject(new Error(`Failed to download video: ${err.message}`));
                    }
                });
                
                // Log download progress (throttled to every 10%)
                stream.on('progress', (chunkLength, downloaded, total) => {
                    if (total && typeof total === 'number' && total > 0) {
                        const percent = Math.floor((downloaded / total) * 100);
                        if (percent >= lastLoggedPercent + 10 || percent === 100) {
                            console.log('[AudioProcessor] Download progress:', percent + '%');
                            lastLoggedPercent = percent;
                        }
                    }
                });

                console.log('[AudioProcessor] Starting FFmpeg conversion...');
                let lastLoggedFfmpegPercent = 0;
                
                ffmpeg(stream)
                    .audioBitrate(128)
                    .save(audioFilePath)
                    .on('start', (commandLine) => {
                        console.log('[AudioProcessor] FFmpeg command:', commandLine);
                    })
                    .on('progress', (progress) => {
                        // Log FFmpeg progress (throttled to every 10%)
                        if (progress.percent) {
                            const percent = Math.floor(progress.percent);
                            if (percent >= lastLoggedFfmpegPercent + 10 || percent >= 99) {
                                console.log('[AudioProcessor] FFmpeg progress:', percent + '%');
                                lastLoggedFfmpegPercent = percent;
                            }
                        }
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
            } else if (err.message.includes('Sign in to confirm')) {
                throw new Error('YouTube requires sign-in verification. Please set up YouTube cookies (see README) or try a different video.');
            } else if (err.message.includes('private video')) {
                throw new Error('This video is private and cannot be accessed.');
            } else {
                throw new Error(`Processing failed: ${err.message}`);
            }
        }
    }
}

module.exports = new AudioProcessor();