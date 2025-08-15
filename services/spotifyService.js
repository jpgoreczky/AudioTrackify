const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class SpotifyService {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    this.redirectUri = process.env.SPOTIFY_REDIRECT_URI;
    this.baseUrl = 'https://api.spotify.com/v1';
    this.authUrl = 'https://accounts.spotify.com/api/token';
    this.jwtSecret = process.env.SESSION_SECRET || 'fallback-secret';
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

    return https://accounts.spotify.com/authorize?;
  }

  /**
   * Initiate Spotify authentication
   */
  initiateAuth(req, res) {
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = this.generateAuthUrl(state);
    
    // Store state in cookie for validation
    res.cookie('spotify_state', state, { 
      httpOnly: true, 
      maxAge: 10 * 60 * 1000, // 10 minutes
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.redirect(authUrl);
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(req, res) {
    const { code, state, error } = req.query;
    const storedState = req.cookies.spotify_state;

    if (error) {
      res.clearCookie('spotify_state');
      return res.redirect('/?error=access_denied');
    }

    if (!code || !state || !storedState || state !== storedState) {
      res.clearCookie('spotify_state');
      return res.redirect('/?error=invalid_request');
    }

    // Clear state cookie
    res.clearCookie('spotify_state');

    try {
      // Exchange code for access token
      const tokenData = await this.exchangeCodeForToken(code);
      
      // Get user info
      const userInfo = await this.getUserInfo(tokenData.access_token);
      
      // Create JWT token with user data
      const userToken = jwt.sign({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        userId: userInfo.id,
        displayName: userInfo.display_name,
        email: userInfo.email
      }, this.jwtSecret, { expiresIn: '7d' });

      // Store token in secure cookie
      res.cookie('spotify_token', userToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'lax'
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
    const authHeader = Buffer.from(${this.clientId}:).toString('base64');
    
    const response = await axios.post(this.authUrl, new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: this.redirectUri
    }), {
      headers: {
        'Authorization': Basic ,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response.data;
  }

  /**
   * Get user information
   */
  async getUserInfo(accessToken) {
    const response = await axios.get(${this.baseUrl}/me, {
      headers: {
        'Authorization': Bearer 
      }
    });

    return response.data;
  }

  /**
   * Get authentication status from cookie
   */
  getAuthStatus(req, res) {
    const token = req.cookies.spotify_token;

    if (!token) {
      return res.json({ authenticated: false });
    }

    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      res.json({
        authenticated: true,
        user: {
          id: decoded.userId,
          displayName: decoded.displayName,
          email: decoded.email
        }
      });
    } catch (error) {
      // Token is invalid or expired
      res.clearCookie('spotify_token');
      res.json({ authenticated: false });
    }
  }

  /**
   * Get user data from cookie
   */
  getUserFromCookie(req) {
    const token = req.cookies.spotify_token;
    if (!token) {
      throw new Error('User not authenticated');
    }

    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken) {
    const authHeader = Buffer.from(${this.clientId}:).toString('base64');
    
    const response = await axios.post(this.authUrl, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }), {
      headers: {
        'Authorization': Basic ,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response.data;
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidAccessToken(req, res) {
    const userData = this.getUserFromCookie(req);
    
    // Check if token is expired (with 5 minute buffer)
    const expiresAt = userData.expires_at - (5 * 60 * 1000);
    
    if (Date.now() > expiresAt) {
      // Refresh token
      const newTokenData = await this.refreshAccessToken(userData.refresh_token);
      
      // Update cookie with new token data
      const updatedUserToken = jwt.sign({
        ...userData,
        access_token: newTokenData.access_token,
        expires_at: Date.now() + (newTokenData.expires_in * 1000)
      }, this.jwtSecret, { expiresIn: '7d' });

      res.cookie('spotify_token', updatedUserToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'lax'
      });

      return newTokenData.access_token;
    }

    return userData.access_token;
  }

  /**
   * Create a new playlist
   */
  async createPlaylist(req, res, tracks, playlistName = 'AudioTrackify Playlist') {
    try {
      const accessToken = await this.getValidAccessToken(req, res);
      const userData = this.getUserFromCookie(req);
      
      // Filter tracks that have Spotify IDs
      const spotifyTracks = tracks.filter(track => track.spotify && track.spotify.id);
      
      if (spotifyTracks.length === 0) {
        throw new Error('No tracks with Spotify matches found');
      }

      // Create playlist
      const playlistResponse = await axios.post(${this.baseUrl}/users//playlists, {
        name: playlistName,
        description: Playlist created by AudioTrackify -  tracks identified from your audio,
        public: false
      }, {
        headers: {
          'Authorization': Bearer ,
          'Content-Type': 'application/json'
        }
      });

      const playlist = playlistResponse.data;

      // Add tracks to playlist (Spotify allows max 100 tracks per request)
      const trackUris = spotifyTracks.map(track => track.spotify.uri);
      const batchSize = 100;
      
      for (let i = 0; i < trackUris.length; i += batchSize) {
        const batch = trackUris.slice(i, i + batchSize);
        
        await axios.post(${this.baseUrl}/playlists//tracks, {
          uris: batch
        }, {
          headers: {
            'Authorization': Bearer ,
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
}

module.exports = new SpotifyService();
