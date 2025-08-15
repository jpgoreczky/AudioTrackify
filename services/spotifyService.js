const axios = require('axios');
const crypto = require('crypto');

class SpotifyService {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    this.redirectUri = process.env.SPOTIFY_REDIRECT_URI;
    this.baseUrl = 'https://api.spotify.com/v1';
    this.authUrl = 'https://accounts.spotify.com/api/token';
    
    // In-memory storage for tokens
    this.userTokens = new Map();
  }

  /**
   * Generate authorization URL for Spotify OAuth
   */
  generateAuthUrl(state) {
    const scope = [
      'playlist-modify-public',
      'playlist-modify-private',
      'user-read-private',
      'user-read-email'
    ].join(' ');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: scope,
      redirect_uri: this.redirectUri,
      state: state,
      show_dialog: 'true'
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  /**
   * Initiate Spotify authentication
   */
  initiateAuth(req, res) {
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = this.generateAuthUrl(state);
    
    // Store state in a cookie
    res.cookie('spotify_auth_state', state, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'lax', // The key change here
      maxAge: 60 * 60 * 1000 // 1 hour
    });
    
    res.redirect(authUrl);
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(req, res) {
    const { code, state, error } = req.query;
    const storedState = req.cookies.spotify_auth_state; // Get state from cookie
    
    // Clear the cookie immediately to prevent replay attacks
    res.clearCookie('spotify_auth_state', { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'lax' 
    });

    if (error) return res.redirect('/?error=access_denied');
    // Compare the state from the URL with the state from the cookie
    if (!code || !state || state !== storedState) {
      return res.redirect('/?error=invalid_state');
    }

    try {
      // Exchange code for access token
      const tokenData = await this.exchangeCodeForToken(code);
      
      // Get user info
      const userInfo = await this.getUserInfo(tokenData.access_token);
      
      // Store tokens
      const sessionId = req.sessionID || 'default';
      this.userTokens.set(sessionId, {
        ...tokenData,
        userId: userInfo.id,
        displayName: userInfo.display_name,
        email: userInfo.email,
        timestamp: Date.now()
      });

      res.redirect('/?auth=success');
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.redirect('/?error=auth_failed');
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
  const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

  console.log("Attempting to exchange code for token..."); // Add this line

  try {
    const response = await axios.post(this.authUrl, new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: this.redirectUri
    }), {
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log("Token exchange successful."); // And this line
    return response.data;
  } catch (error) {
    console.error("Axios request failed:", error.response.status, error.response.data); // Crucial for debugging
    throw error;
  }
}

  /**
   * Get user information
   */
  async getUserInfo(accessToken) {
    const response = await axios.get(`${this.baseUrl}/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    return response.data;
  }

  /**
   * Get authentication status
   */
  getAuthStatus(req, res) {
    const sessionId = req.sessionID || 'default';
    const tokenData = this.userTokens.get(sessionId);

    if (tokenData) {
      res.json({
        authenticated: true,
        user: {
          id: tokenData.userId,
          displayName: tokenData.displayName,
          email: tokenData.email
        }
      });
    } else {
      res.json({
        authenticated: false
      });
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(sessionId) {
    const tokenData = this.userTokens.get(sessionId);
    if (!tokenData || !tokenData.refresh_token) {
      throw new Error('No refresh token available');
    }

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    const response = await axios.post(this.authUrl, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenData.refresh_token
    }), {
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    // Update stored tokens
    const newTokenData = {
      ...tokenData,
      ...response.data,
      timestamp: Date.now()
    };
    
    this.userTokens.set(sessionId, newTokenData);
    return newTokenData;
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidAccessToken(sessionId) {
    let tokenData = this.userTokens.get(sessionId);
    
    if (!tokenData) {
      throw new Error('User not authenticated');
    }

    // Check if token is expired (with 5 minute buffer)
    const expiresAt = tokenData.timestamp + (tokenData.expires_in * 1000) - (5 * 60 * 1000);
    
    if (Date.now() > expiresAt) {
      tokenData = await this.refreshAccessToken(sessionId);
    }

    return tokenData.access_token;
  }

  /**
   * Search for tracks on Spotify
   */
  async searchTracks(query, limit = 10, sessionId = 'default') {
    try {
      const accessToken = await this.getValidAccessToken(sessionId);
      
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: {
          q: query,
          type: 'track',
          limit: limit
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return response.data.tracks.items;
    } catch (error) {
      console.error('Error searching tracks:', error);
      throw error;
    }
  }

  /**
   * Create a new playlist
   */
  async createPlaylist(tracks, playlistName = 'AudioTrackify Playlist', sessionId = 'default') {
    try {
      const accessToken = await this.getValidAccessToken(sessionId);
      const tokenData = this.userTokens.get(sessionId);
      
      if (!tokenData) {
        throw new Error('User not authenticated');
      }

      // Filter tracks that have Spotify IDs
      const spotifyTracks = tracks.filter(track => track.spotify && track.spotify.id);
      
      if (spotifyTracks.length === 0) {
        throw new Error('No tracks with Spotify matches found');
      }

      // Create playlist
      const playlistResponse = await axios.post(`${this.baseUrl}/users/${tokenData.userId}/playlists`, {
        name: playlistName,
        description: `Playlist created by AudioTrackify - ${spotifyTracks.length} tracks identified from your audio`,
        public: false
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const playlist = playlistResponse.data;

      // Add tracks to playlist (Spotify allows max 100 tracks per request)
      const trackUris = spotifyTracks.map(track => track.spotify.uri);
      const batchSize = 100;
      
      for (let i = 0; i < trackUris.length; i += batchSize) {
        const batch = trackUris.slice(i, i + batchSize);
        
        await axios.post(`${this.baseUrl}/playlists/${playlist.id}/tracks`, {
          uris: batch
        }, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });
      }

      return {
        playlist: {
          id: playlist.id,
          name: playlist.name,
          url: playlist.external_urls.spotify,
          trackCount: spotifyTracks.length
        },
        addedTracks: spotifyTracks.length,
        totalTracks: tracks.length,
        skippedTracks: tracks.length - spotifyTracks.length
      };

    } catch (error) {
      console.error('Error creating playlist:', error);
      throw error;
    }
  }

  /**
   * Get user's playlists
   */
  async getUserPlaylists(sessionId = 'default') {
    try {
      const accessToken = await this.getValidAccessToken(sessionId);
      
      const response = await axios.get(`${this.baseUrl}/me/playlists`, {
        params: {
          limit: 50
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return response.data.items;
    } catch (error) {
      console.error('Error fetching playlists:', error);
      throw error;
    }
  }

  /**
   * Add tracks to existing playlist
   */
  async addTracksToPlaylist(playlistId, tracks, sessionId = 'default') {
    try {
      const accessToken = await this.getValidAccessToken(sessionId);
      
      // Filter tracks that have Spotify IDs
      const spotifyTracks = tracks.filter(track => track.spotify && track.spotify.id);
      const trackUris = spotifyTracks.map(track => track.spotify.uri);
      
      if (trackUris.length === 0) {
        throw new Error('No tracks with Spotify matches found');
      }

      // Add tracks in batches
      const batchSize = 100;
      
      for (let i = 0; i < trackUris.length; i += batchSize) {
        const batch = trackUris.slice(i, i + batchSize);
        
        await axios.post(`${this.baseUrl}/playlists/${playlistId}/tracks`, {
          uris: batch
        }, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });
      }

      return {
        addedTracks: spotifyTracks.length,
        totalTracks: tracks.length,
        skippedTracks: tracks.length - spotifyTracks.length
      };

    } catch (error) {
      console.error('Error adding tracks to playlist:', error);
      throw error;
    }
  }
}

module.exports = new SpotifyService();