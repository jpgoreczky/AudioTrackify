const express = require('express');
const session = require('express-session');
const multer = require('multer');
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
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://audio-trackify.vercel.app']
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(cookieParser());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public')));

// Create necessary directories
const uploadsDir = path.join(__dirname, 'uploads');
const tempDir = path.join(__dirname, 'temp');
fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(tempDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /\.(mp4|avi|mov|mkv|webm|flv|wmv|m4v)$/i;
    if (allowedTypes.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'));
    }
  }
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Spotify OAuth routes
app.get('/auth/spotify', spotifyService.initiateAuth);
app.get('/callback', spotifyService.handleCallback);
app.get('/auth/status', spotifyService.getAuthStatus);

// File upload route
app.post('/upload', upload.single('videoFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const videoPath = req.file.path;
    const jobId = uuidv4();

    // Process video in background
    processVideo(videoPath, jobId, req.file.originalname);

    res.json({
      message: 'Video uploaded successfully',
      jobId: jobId,
      filename: req.file.originalname
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// URL processing route
app.post('/process-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const jobId = uuidv4();

    // Process URL in background
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

// Job status route
app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const status = getJobStatus(jobId);
  res.json(status);
});

// Create playlist route
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

// In-memory job storage (in production, use Redis or database)
const jobs = new Map();

function getJobStatus(jobId) {
  return jobs.get(jobId) || { status: 'not_found' };
}

function updateJobStatus(jobId, status, data = {}) {
  jobs.set(jobId, { status, ...data, updatedAt: new Date() });
}

async function processVideo(videoPath, jobId, originalName) {
  try {
    updateJobStatus(jobId, 'processing', { 
      step: 'extracting_audio',
      filename: originalName 
    });

    // Extract audio from video
    const audioPath = await audioProcessor.extractAudio(videoPath, tempDir);
    
    updateJobStatus(jobId, 'processing', { 
      step: 'identifying_songs',
      filename: originalName 
    });

    // Identify songs from audio
    const identifiedTracks = await songIdentifier.identifyTracks(audioPath);

    // Clean up files
    await fs.remove(videoPath);
    await fs.remove(audioPath);

    updateJobStatus(jobId, 'completed', {
      filename: originalName,
      tracks: identifiedTracks,
      totalTracks: identifiedTracks.length
    });

  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    updateJobStatus(jobId, 'failed', {
      error: error.message,
      filename: originalName
    });
  }
}

async function processVideoUrl(url, jobId) {
  try {
    updateJobStatus(jobId, 'processing', { 
      step: 'downloading_video',
      url: url 
    });

    // Download and extract audio from URL
    const audioPath = await audioProcessor.downloadAndExtractAudio(url, tempDir);
    
    updateJobStatus(jobId, 'processing', { 
      step: 'identifying_songs',
      url: url 
    });

    // Identify songs from audio
    const identifiedTracks = await songIdentifier.identifyTracks(audioPath);

    // Clean up audio file
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

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
  }
  res.status(500).json({ error: error.message });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;