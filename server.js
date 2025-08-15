const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs-extra');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const audioProcessor = require('./services/audioProcessor');
const songIdentifier = require('./services/songIdentifier');
const spotifyService = require('./services/spotifyService');

const app = express();

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      'https://audio-trackify.vercel.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'a-strong-and-unique-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Serve static files from the 'public' directory
app.use(express.static('public'));

// --- Routes ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/spotify', spotifyService.initiateAuth.bind(spotifyService));
app.get('/callback', spotifyService.handleCallback.bind(spotifyService));
app.get('/auth/status', spotifyService.getAuthStatus.bind(spotifyService));

app.post('/process-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    const jobId = uuidv4();
    processVideoUrl(url, jobId);
    res.json({
      message: 'URL processing started',
      jobId: jobId,
      url: url
    });
  } catch (error) {
    console.error('URL processing error:', error);
    res.status(500).json({ error: 'URL processing failed' });
  }
});

app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const status = getJobStatus(jobId);
  res.json(status);
});

app.post('/create-playlist', async (req, res) => {
  try {
    const { tracks, playlistName } = req.body;
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({ error: 'No tracks provided' });
    }
    const sessionId = req.sessionID || 'default';
    const result = await spotifyService.createPlaylist(tracks, playlistName, sessionId);
    res.json(result);
  } catch (error) {
    console.error('Playlist creation error:', error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// --- In-memory job storage ---
const jobs = new Map();

function getJobStatus(jobId) {
  return jobs.get(jobId) || { status: 'not_found' };
}

function updateJobStatus(jobId, status, data = {}) {
  jobs.set(jobId, { status, ...data, updatedAt: new Date() });
}

async function processVideoUrl(url, jobId) {
  try {
    const tempDir = path.join('/tmp', 'temp');
    await fs.ensureDir(tempDir);
    updateJobStatus(jobId, 'processing', { 
      step: 'downloading_video',
      url: url 
    });
    const audioPath = await audioProcessor.downloadAndExtractAudio(url, tempDir);
    updateJobStatus(jobId, 'processing', { 
      step: 'identifying_songs',
      url: url 
    });
    const identifiedTracks = await songIdentifier.identifyTracks(audioPath);
    await fs.remove(audioPath);
    updateJobStatus(jobId, 'completed', {
      url: url,
      tracks: identifiedTracks,
      totalTracks: identifiedTracks.length
    });
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    updateJobStatus(jobId, 'failed', {
      error: error.message,
      url: url
    });
  }
}

// Global error handling middleware for Multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }
  res.status(500).json({ error: error.message });
});

module.exports = app;