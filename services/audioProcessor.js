const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('ytdl-core');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

class AudioProcessor {
  /**
   * Extract audio from video file
   */
  async extractAudio(videoPath, outputDir) {
    return new Promise((resolve, reject) => {
      const audioFileName = `${uuidv4()}.wav`;
      const audioPath = path.join(outputDir, audioFileName);

      ffmpeg(videoPath)
        .audioCodec('pcm_s16le')
        .audioFrequency(44100)
        .audioChannels(2)
        .format('wav')
        .output(audioPath)
        .on('end', () => {
          console.log(`Audio extracted to: ${audioPath}`);
          resolve(audioPath);
        })
        .on('error', (err) => {
          console.error('Error extracting audio:', err);
          reject(err);
        })
        .run();
    });
  }

  /**
   * Download video from URL and extract audio
   */
  async downloadAndExtractAudio(url, outputDir) {
    return new Promise(async (resolve, reject) => {
      try {
        // Check if it's a YouTube URL
        if (this.isYouTubeUrl(url)) {
          await this.downloadYouTubeAudio(url, outputDir, resolve, reject);
        } else {
          // For other video URLs, try to download and process
          await this.downloadGenericVideoAudio(url, outputDir, resolve, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Check if URL is a YouTube URL
   */
  isYouTubeUrl(url) {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//;
    return youtubeRegex.test(url);
  }

  /**
   * Download audio from YouTube
   */
  async downloadYouTubeAudio(url, outputDir, resolve, reject) {
    try {
      const audioFileName = `${uuidv4()}.wav`;
      const audioPath = path.join(outputDir, audioFileName);

      const stream = ytdl(url, {
        quality: 'highestaudio',
        filter: 'audioonly',
      });

      ffmpeg(stream)
        .audioCodec('pcm_s16le')
        .audioFrequency(44100)
        .audioChannels(2)
        .format('wav')
        .save(audioPath)
        .on('end', () => {
          console.log(`YouTube audio downloaded to: ${audioPath}`);
          resolve(audioPath);
        })
        .on('error', (err) => {
          console.error('Error downloading YouTube audio:', err);
          reject(err);
        });
    } catch (error) {
      reject(error);
    }
  }

  /**
   * Download audio from generic video URL
   */
  async downloadGenericVideoAudio(url, outputDir, resolve, reject) {
    const audioFileName = `${uuidv4()}.wav`;
    const audioPath = path.join(outputDir, audioFileName);

    ffmpeg(url)
      .audioCodec('pcm_s16le')
      .audioFrequency(44100)
      .audioChannels(2)
      .format('wav')
      .output(audioPath)
      .on('end', () => {
        console.log(`Audio extracted from URL to: ${audioPath}`);
        resolve(audioPath);
      })
      .on('error', (err) => {
        console.error('Error extracting audio from URL:', err);
        reject(err);
      })
      .run();
  }

  /**
   * Split audio file into chunks for better song identification
   */
  async splitAudioIntoChunks(audioPath, outputDir, chunkDuration = 30) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const baseFileName = path.basename(audioPath, '.wav');

      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const duration = metadata.format.duration;
        const numChunks = Math.ceil(duration / chunkDuration);
        let completed = 0;

        for (let i = 0; i < numChunks; i++) {
          const startTime = i * chunkDuration;
          const chunkFileName = `${baseFileName}_chunk_${i}.wav`;
          const chunkPath = path.join(outputDir, chunkFileName);

          ffmpeg(audioPath)
            .seekInput(startTime)
            .duration(chunkDuration)
            .audioCodec('pcm_s16le')
            .audioFrequency(44100)
            .audioChannels(2)
            .format('wav')
            .output(chunkPath)
            .on('end', () => {
              chunks.push({
                path: chunkPath,
                startTime: startTime,
                duration: Math.min(chunkDuration, duration - startTime)
              });
              completed++;

              if (completed === numChunks) {
                resolve(chunks);
              }
            })
            .on('error', (err) => {
              console.error(`Error creating chunk ${i}:`, err);
              reject(err);
            })
            .run();
        }
      });
    });
  }

  /**
   * Clean up temporary files
   */
  async cleanup(filePaths) {
    try {
      for (const filePath of filePaths) {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          console.log(`Cleaned up: ${filePath}`);
        }
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

module.exports = new AudioProcessor();
