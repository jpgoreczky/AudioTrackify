// Frontend Application
class AudioTrackifyApp {
    constructor() {
        this.currentJobId = null;
        this.identifiedTracks = [];
        this.selectedTracks = new Set();
        this.isAuthenticated = false;
        
        this.initializeEventListeners();
        this.checkAuthStatus();
        this.checkUrlParams();
    }

    initializeEventListeners() {
        // Form submissions
        document.getElementById('urlForm').addEventListener('submit', (e) => this.handleUrlSubmit(e));
        
        // Authentication
        document.getElementById('spotifyAuthBtn').addEventListener('click', () => this.handleSpotifyAuth());
        
        // Track selection
        document.getElementById('selectAllBtn').addEventListener('click', () => this.toggleSelectAll());
        document.getElementById('createPlaylistBtn').addEventListener('click', () => this.showPlaylistModal());
        
        // Playlist creation
        document.getElementById('confirmCreatePlaylist').addEventListener('click', () => this.createPlaylist());
    }

    checkUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        
        if (urlParams.get('auth') === 'success') {
            this.showAlert('Successfully connected to Spotify!', 'success');
            this.checkAuthStatus();
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (urlParams.has('error')) {
            const error = urlParams.get('error');
            this.showAlert(`Authentication error: ${error}`, 'danger');
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    async checkAuthStatus() {
        try {
            const response = await fetch('/auth/status');
            const data = await response.json();
            
            if (data.authenticated) {
                this.isAuthenticated = true;
                this.updateAuthUI(data.user);
            } else {
                this.isAuthenticated = false;
                this.updateAuthUI(null);
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
        }
    }

    updateAuthUI(user) {
        const authStatus = document.getElementById('authStatus');
        const spotifyAuthBtn = document.getElementById('spotifyAuthBtn');
        
        if (user) {
            authStatus.innerHTML = `
                <div class="d-flex align-items-center">
                    <span class="text-success me-2">
                        <i class="fas fa-check-circle me-1"></i>Connected as ${user.displayName || user.id}
                    </span>
                </div>
            `;
        } else {
            authStatus.innerHTML = `
                <button id="spotifyAuthBtn" class="btn btn-success btn-sm">
                    <i class="fab fa-spotify me-1"></i>Connect Spotify
                </button>
            `;
            // Re-add event listener
            document.getElementById('spotifyAuthBtn').addEventListener('click', () => this.handleSpotifyAuth());
        }
        
        // Update create playlist button state
        this.updateCreatePlaylistButton();
    }

    handleSpotifyAuth() {
        window.location.href = '/auth/spotify';
    }

    async handleFileUpload(e) {
        e.preventDefault();
        
        const formData = new FormData();
        const fileInput = document.getElementById('videoFile');
        const file = fileInput.files[0];
        
        if (!file) {
            this.showAlert('Please select a file', 'warning');
            return;
        }
        
        if (file.size > 100 * 1024 * 1024) {
            this.showAlert('File size must be less than 100MB', 'danger');
            return;
        }
        
        formData.append('videoFile', file);
        
        try {
            this.showProgress();
            this.updateProgress(10, 'Uploading file...');
            
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.currentJobId = data.jobId;
                this.updateProgress(30, 'File uploaded. Processing...');
                this.pollJobStatus();
            } else {
                throw new Error(data.error || 'Upload failed');
            }
        } catch (error) {
            this.hideProgress();
            this.showAlert(`Upload error: ${error.message}`, 'danger');
        }
    }

    async handleUrlSubmit(e) {
        e.preventDefault();
        
        const url = document.getElementById('videoUrl').value;
        
        if (!url) {
            this.showAlert('Please enter a URL', 'warning');
            return;
        }
        
        try {
            this.showProgress();
            this.updateProgress(10, 'Starting URL processing...');
            
            const response = await fetch('/process-url', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.currentJobId = data.jobId;
                this.updateProgress(30, 'URL processing started...');
                this.pollJobStatus();
            } else {
                throw new Error(data.error || 'URL processing failed');
            }
        } catch (error) {
            this.hideProgress();
            this.showAlert(`URL processing error: ${error.message}`, 'danger');
        }
    }

    async pollJobStatus() {
        if (!this.currentJobId) return;
        
        try {
            const response = await fetch(`/status/${this.currentJobId}`);
            const status = await response.json();
            
            switch (status.status) {
                case 'processing':
                    this.handleProcessingStatus(status);
                    setTimeout(() => this.pollJobStatus(), 2000);
                    break;
                    
                case 'completed':
                    this.handleCompletedStatus(status);
                    break;
                    
                case 'failed':
                    this.handleFailedStatus(status);
                    break;
                    
                case 'not_found':
                    this.showAlert('Job not found', 'danger');
                    this.hideProgress();
                    break;
                    
                default:
                    setTimeout(() => this.pollJobStatus(), 2000);
            }
        } catch (error) {
            console.error('Error polling job status:', error);
            setTimeout(() => this.pollJobStatus(), 5000);
        }
    }

    handleProcessingStatus(status) {
        let progress = 30;
        let message = 'Processing...';
        
        if (status.step === 'extracting_audio' || status.step === 'downloading_video') {
            progress = 50;
            message = status.step === 'extracting_audio' ? 'Extracting audio from video...' : 'Downloading video...';
        } else if (status.step === 'identifying_songs') {
            progress = 75;
            message = 'Identifying songs with ACRCloud...';
        }
        
        this.updateProgress(progress, message);
    }

    async handleCompletedStatus(status) {
        this.updateProgress(100, 'Processing complete!');
        
        setTimeout(() => {
            this.hideProgress();
            this.displayResults(status.tracks);
        }, 1000);
    }

    handleFailedStatus(status) {
        this.hideProgress();
        this.showAlert(`Processing failed: ${status.error}`, 'danger');
    }

    displayResults(tracks) {
        this.identifiedTracks = tracks;
        this.selectedTracks.clear();
        
        const tracksContainer = document.getElementById('tracksContainer');
        const resultsSection = document.getElementById('resultsSection');
        const statsSection = document.getElementById('statsSection');
        
        if (tracks.length === 0) {
            tracksContainer.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="fas fa-search fa-3x mb-3"></i>
                    <h5>No tracks identified</h5>
                    <p>No songs were found in the audio. Try with a different video or check if the audio contains recognizable music.</p>
                </div>
            `;
        } else {
            tracksContainer.innerHTML = tracks.map((track, index) => this.createTrackCard(track, index)).join('');
            
            // Add event listeners to track cards
            tracksContainer.querySelectorAll('.track-card').forEach((card, index) => {
                card.addEventListener('click', () => this.toggleTrackSelection(index));
            });
        }
        
        this.updateStatistics(tracks);
        this.updateCreatePlaylistButton();
        
        resultsSection.style.display = 'block';
        statsSection.style.display = 'block';
        
        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    createTrackCard(track, index) {
        const hasSpotify = track.spotify && track.spotify.id;
        const confidenceClass = track.confidence >= 80 ? 'success' : track.confidence >= 60 ? 'warning' : 'secondary';
        
        return `
            <div class="track-card" data-index="${index}">
                <div class="d-flex align-items-center">
                    <input type="checkbox" class="form-check-input me-3" ${hasSpotify ? '' : 'disabled'}>
                    <div class="track-info">
                        <div class="track-title">${this.escapeHtml(track.title)}</div>
                        <div class="track-artist">${this.escapeHtml(track.artist)}</div>
                        <div class="track-details">
                            ${track.album ? `Album: ${this.escapeHtml(track.album)} • ` : ''}
                            Found at: ${this.formatTime(track.foundAt)} • 
                            Duration: ${track.duration ? this.formatTime(track.duration) : 'Unknown'}
                        </div>
                    </div>
                    <div class="d-flex flex-column align-items-end">
                        <span class="badge bg-${confidenceClass} confidence-badge mb-2">
                            ${track.confidence}% confidence
                        </span>
                        <div class="${hasSpotify ? 'spotify-available' : 'spotify-unavailable'}">
                            <i class="fab fa-spotify me-1"></i>
                            ${hasSpotify ? 'Available' : 'Not found'}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    toggleTrackSelection(index) {
        const track = this.identifiedTracks[index];
        const card = document.querySelector(`[data-index="${index}"]`);
        const checkbox = card.querySelector('input[type="checkbox"]');
        
        if (!track.spotify || !track.spotify.id) return;
        
        if (this.selectedTracks.has(index)) {
            this.selectedTracks.delete(index);
            card.classList.remove('selected');
            checkbox.checked = false;
        } else {
            this.selectedTracks.add(index);
            card.classList.add('selected');
            checkbox.checked = true;
        }
        
        this.updateCreatePlaylistButton();
    }

    toggleSelectAll() {
        const availableTracks = this.identifiedTracks
            .map((track, index) => ({ track, index }))
            .filter(({ track }) => track.spotify && track.spotify.id);
        
        const allSelected = availableTracks.every(({ index }) => this.selectedTracks.has(index));
        
        if (allSelected) {
            // Deselect all
            availableTracks.forEach(({ index }) => {
                this.selectedTracks.delete(index);
                const card = document.querySelector(`[data-index="${index}"]`);
                card.classList.remove('selected');
                card.querySelector('input[type="checkbox"]').checked = false;
            });
            document.getElementById('selectAllBtn').textContent = 'Select All';
        } else {
            // Select all
            availableTracks.forEach(({ index }) => {
                this.selectedTracks.add(index);
                const card = document.querySelector(`[data-index="${index}"]`);
                card.classList.add('selected');
                card.querySelector('input[type="checkbox"]').checked = true;
            });
            document.getElementById('selectAllBtn').textContent = 'Deselect All';
        }
        
        this.updateCreatePlaylistButton();
    }

    updateCreatePlaylistButton() {
        const createPlaylistBtn = document.getElementById('createPlaylistBtn');
        const hasSelectedTracks = this.selectedTracks.size > 0;
        
        createPlaylistBtn.disabled = !hasSelectedTracks || !this.isAuthenticated;
        
        if (!this.isAuthenticated) {
            createPlaylistBtn.title = 'Connect to Spotify first';
        } else if (!hasSelectedTracks) {
            createPlaylistBtn.title = 'Select tracks to create playlist';
        } else {
            createPlaylistBtn.title = `Create playlist with ${this.selectedTracks.size} tracks`;
        }
    }

    showPlaylistModal() {
        if (!this.isAuthenticated) {
            this.showAlert('Please connect to Spotify first', 'warning');
            return;
        }
        
        if (this.selectedTracks.size === 0) {
            this.showAlert('Please select tracks first', 'warning');
            return;
        }
        
        document.getElementById('selectedTracksCount').textContent = this.selectedTracks.size;
        const modal = new bootstrap.Modal(document.getElementById('playlistModal'));
        modal.show();
    }

    async createPlaylist() {
        const playlistName = document.getElementById('playlistName').value;
        const selectedTracksArray = Array.from(this.selectedTracks).map(index => this.identifiedTracks[index]);
        
        try {
            const confirmBtn = document.getElementById('confirmCreatePlaylist');
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Creating...';
            
            const response = await fetch('/create-playlist', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tracks: selectedTracksArray,
                    playlistName: playlistName
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Hide playlist modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('playlistModal'));
                modal.hide();
                
                // Show success modal
                this.showSuccessModal(data);
            } else {
                throw new Error(data.error || 'Failed to create playlist');
            }
        } catch (error) {
            this.showAlert(`Error creating playlist: ${error.message}`, 'danger');
        } finally {
            const confirmBtn = document.getElementById('confirmCreatePlaylist');
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fab fa-spotify me-1"></i>Create Playlist';
        }
    }

    showSuccessModal(data) {
        const successContent = document.getElementById('successContent');
        const openPlaylistBtn = document.getElementById('openPlaylistBtn');
        
        successContent.innerHTML = `
            <h6>Playlist Created Successfully!</h6>
            <p><strong>Playlist:</strong> ${this.escapeHtml(data.playlist.name)}</p>
            <p><strong>Added Tracks:</strong> ${data.addedTracks}</p>
            ${data.skippedTracks > 0 ? `<p class="text-warning"><strong>Skipped Tracks:</strong> ${data.skippedTracks} (not available on Spotify)</p>` : ''}
        `;
        
        openPlaylistBtn.href = data.playlist.url;
        
        const modal = new bootstrap.Modal(document.getElementById('successModal'));
        modal.show();
    }

    updateStatistics(tracks) {
        const stats = this.calculateStats(tracks);
        
        document.getElementById('totalTracks').textContent = stats.totalIdentified;
        document.getElementById('spotifyMatches').textContent = stats.spotifyMatches;
        document.getElementById('avgConfidence').textContent = `${stats.averageConfidence}%`;
        document.getElementById('matchRate').textContent = `${stats.matchRate}%`;
    }

    calculateStats(tracks) {
        const totalTracks = tracks.length;
        const tracksWithSpotify = tracks.filter(t => t.spotify && t.spotify.id).length;
        const averageConfidence = totalTracks > 0 
            ? Math.round(tracks.reduce((sum, t) => sum + t.confidence, 0) / totalTracks)
            : 0;

        return {
            totalIdentified: totalTracks,
            spotifyMatches: tracksWithSpotify,
            averageConfidence: averageConfidence,
            matchRate: totalTracks > 0 ? Math.round((tracksWithSpotify / totalTracks) * 100) : 0
        };
    }

    showProgress() {
        document.getElementById('progressSection').style.display = 'block';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('statsSection').style.display = 'none';
    }

    hideProgress() {
        document.getElementById('progressSection').style.display = 'none';
    }

    updateProgress(percentage, message) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        
        progressBar.style.width = `${percentage}%`;
        progressBar.setAttribute('aria-valuenow', percentage);
        progressText.innerHTML = `<p class="mb-0">${message}</p>`;
    }

    showAlert(message, type) {
        // Remove existing alerts
        const existingAlerts = document.querySelectorAll('.alert');
        existingAlerts.forEach(alert => alert.remove());
        
        const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        document.querySelector('.container').insertAdjacentHTML('afterbegin', alertHtml);
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            const alert = document.querySelector('.alert');
            if (alert) {
                const bsAlert = new bootstrap.Alert(alert);
                bsAlert.close();
            }
        }, 5000);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioTrackifyApp();
});
