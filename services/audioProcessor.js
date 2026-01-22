const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ytDlpExec = require('yt-dlp-exec');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

// Set the FFmpeg path explicitly for the Vercel environment
// This part is crucial and should remain
ffmpeg.setFfmpegPath(ffmpegPath);

class AudioProcessor {
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
            const ytDlpOptions = {
                extractAudio: true,
                audioFormat: 'mp3',
                audioQuality: '128K',
                output: tempVideoPath,
                noPlaylist: true,
                noWarnings: true,
                addHeader: [
                    'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language:en-US,en;q=0.9',
                    'Sec-Fetch-Dest:document',
                    'Sec-Fetch-Mode:navigate',
                    'Sec-Fetch-Site:none'
                ]
            };

            // Add cookies if available
            const cookiesPath = this._getYouTubeCookiesPath();
            if (cookiesPath) {
                ytDlpOptions.cookies = cookiesPath;
                console.log('[AudioProcessor] Using cookies for authentication');
            }

            console.log('[AudioProcessor] Executing yt-dlp...');
            
            // Execute yt-dlp
            try {
                const output = await ytDlpExec(url, ytDlpOptions);
                console.log('[AudioProcessor] yt-dlp execution completed');
                
                // Find the output file (yt-dlp adds .mp3 extension)
                const outputFile = path.join(path.dirname(tempVideoPath), path.basename(tempVideoPath) + '.mp3');
                
                if (fs.existsSync(outputFile)) {
                    // Move to final location
                    fs.moveSync(outputFile, audioFilePath, { overwrite: true });
                    console.log('[AudioProcessor] Audio file saved to:', audioFilePath);
                } else {
                    throw new Error('yt-dlp completed but output file not found');
                }
            } catch (execError) {
                console.error('[AudioProcessor] yt-dlp error:', {
                    message: execError.message,
                    stderr: execError.stderr,
                    stdout: execError.stdout
                });
                
                // Enhanced error messages
                const errorMessage = execError.message + (execError.stderr || '');
                
                if (errorMessage.includes('Sign in to confirm')) {
                    throw new Error('YouTube requires sign-in verification. Please set up YouTube cookies (see README) or try a different video.');
                } else if (errorMessage.includes('Video unavailable')) {
                    throw new Error('Input video not found or has been removed. Please try a different URL.');
                } else if (errorMessage.includes('age')) {
                    throw new Error('This video is age-restricted and cannot be processed.');
                } else if (errorMessage.includes('private')) {
                    throw new Error('This video is private and cannot be accessed.');
                } else if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
                    throw new Error('YouTube is rate limiting requests. Please try again in a few minutes.');
                } else {
                    throw new Error(`Failed to download video: ${execError.message}`);
                }
            }

            return audioFilePath;
        } catch (err) {
            console.error('[AudioProcessor] Error in downloadAndExtractAudio:', {
                message: err.message,
                stack: err.stack
            });
            
            // Clean up temp files
            try {
                if (fs.existsSync(tempVideoPath)) fs.removeSync(tempVideoPath);
                const outputFile = path.join(path.dirname(tempVideoPath), path.basename(tempVideoPath) + '.mp3');
                if (fs.existsSync(outputFile)) fs.removeSync(outputFile);
            } catch (cleanupErr) {
                console.warn('[AudioProcessor] Failed to clean up temp files:', cleanupErr.message);
            }
            
            throw err;
        }
    }
}

module.exports = new AudioProcessor();