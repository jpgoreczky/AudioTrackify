const ACRCloud = require('acrcloud');
const fs = require('fs-extra');
const path = require('path');
const audioProcessor = require('./audioProcessor');

class SongIdentifier {
  constructor() {
    this.acr = new ACRCloud({
      host: process.env.ACRCLOUD_HOST,
      access_key: process.env.ACRCLOUD_ACCESS_KEY,
      access_secret: process.env.ACRCLOUD_ACCESS_SECRET
    });
  }

  /**
   * Identify tracks from audio file
   */
  async identifyTracks(audioPath, options = {}) {
    const {
      chunkSize = 30, // seconds
      maxRetries = 3,
      confidenceThreshold = 50
    } = options;

    try {
      // Split audio into chunks for better identification
      const tempDir = path.dirname(audioPath);
      const chunks = await audioProcessor.splitAudioIntoChunks(audioPath, tempDir, chunkSize);
      
      console.log(`Processing ${chunks.length} audio chunks...`);
      
      const identifiedTracks = [];
      const processedTracks = new Set(); // Avoid duplicates

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`Identifying chunk ${i + 1}/${chunks.length} (${chunk.startTime}s - ${chunk.startTime + chunk.duration}s)`);
        
        try {
          const result = await this.identifyChunk(chunk.path, maxRetries);
          
          if (result && result.confidence >= confidenceThreshold) {
            const trackKey = `${result.artist}-${result.title}`;
            
            if (!processedTracks.has(trackKey)) {
              processedTracks.add(trackKey);
              identifiedTracks.push({
                ...result,
                foundAt: chunk.startTime,
                duration: chunk.duration
              });
              console.log(`✓ Identified: ${result.artist} - ${result.title} (${result.confidence}% confidence)`);
            }
          } else {
            console.log(`✗ No match found for chunk ${i + 1}`);
          }
        } catch (error) {
          console.error(`Error identifying chunk ${i + 1}:`, error.message);
        }

        // Clean up chunk file
        await fs.remove(chunk.path);
      }

      console.log(`Total unique tracks identified: ${identifiedTracks.length}`);
      return identifiedTracks;

    } catch (error) {
      console.error('Error in track identification:', error);
      throw error;
    }
  }

  /**
   * Identify a single audio chunk
   */
  async identifyChunk(chunkPath, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const audioData = await fs.readFile(chunkPath);
        const result = await this.acr.identify(audioData);
        
        if (result.status.code === 0 && result.metadata && result.metadata.music && result.metadata.music.length > 0) {
          const music = result.metadata.music[0];
          
          return {
            title: music.title,
            artist: music.artists ? music.artists.map(a => a.name).join(', ') : 'Unknown Artist',
            album: music.album ? music.album.name : null,
            releaseDate: music.release_date || null,
            duration: music.duration_ms ? Math.round(music.duration_ms / 1000) : null,
            confidence: Math.round((music.score || 0) * 100),
            acrcloudId: music.acrid,
            externalIds: music.external_ids || {},
            playedDuration: music.play_offset_ms ? Math.round(music.play_offset_ms / 1000) : 0
          };
        }
        
        return null;

      } catch (error) {
        console.error(`Attempt ${attempt}/${maxRetries} failed:`, error.message);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retry
        await this.delay(1000 * attempt);
      }
    }
    
    return null;
  }

  /**
   * Search for tracks on Spotify using identified song information
   */
  async findSpotifyMatches(identifiedTracks) {
    const spotifyService = require('./spotifyService');
    const matchedTracks = [];

    for (const track of identifiedTracks) {
      try {
        const query = `track:"${track.title}" artist:"${track.artist}"`;
        const spotifyResults = await spotifyService.searchTracks(query, 1);
        
        if (spotifyResults && spotifyResults.length > 0) {
          const spotifyTrack = spotifyResults[0];
          matchedTracks.push({
            ...track,
            spotify: {
              id: spotifyTrack.id,
              uri: spotifyTrack.uri,
              external_urls: spotifyTrack.external_urls,
              preview_url: spotifyTrack.preview_url,
              popularity: spotifyTrack.popularity
            }
          });
        } else {
          console.log(`No Spotify match found for: ${track.artist} - ${track.title}`);
          matchedTracks.push({
            ...track,
            spotify: null
          });
        }
      } catch (error) {
        console.error(`Error finding Spotify match for ${track.artist} - ${track.title}:`, error.message);
        matchedTracks.push({
          ...track,
          spotify: null
        });
      }
    }

    return matchedTracks;
  }

  /**
   * Process single file upload
   */
  async processSingleFile(filePath, options = {}) {
    const tracks = await this.identifyTracks(filePath, options);
    return await this.findSpotifyMatches(tracks);
  }

  /**
   * Helper method to add delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get identification statistics
   */
  getStats(tracks) {
    const totalTracks = tracks.length;
    const tracksWithSpotify = tracks.filter(t => t.spotify && t.spotify.id).length;
    const averageConfidence = totalTracks > 0 
      ? tracks.reduce((sum, t) => sum + t.confidence, 0) / totalTracks 
      : 0;

    return {
      totalIdentified: totalTracks,
      spotifyMatches: tracksWithSpotify,
      averageConfidence: Math.round(averageConfidence),
      matchRate: totalTracks > 0 ? Math.round((tracksWithSpotify / totalTracks) * 100) : 0
    };
  }
}

module.exports = new SongIdentifier();
