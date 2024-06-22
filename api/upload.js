const multiparty = require('multiparty');
const fetch = require('node-fetch');
const FormData = require('form-data');

// Function to upload audio file to ACRCloud for song recognition
async function uploadToACRCloud(audioFile) {
    const formData = new FormData();
    formData.append('audio', audioFile, { filename: audioFile.originalFilename });

    const response = await fetch('https://api.acrcloud.com/v1/identify', {
        method: 'POST',
        body: formData,
        headers: {
            'Authorization': 'Bearer 13091d889a9884a928de42db6225564e',
            ...formData.getHeaders()
        }
    });

    if (!response.ok) {
        throw new Error('Failed to recognize audio file');
    }

    const result = await response.json();
    return result;
}

// Function to create a Spotify playlist
async function createSpotifyPlaylist(tracks) {
    // Fetch Spotify access token using client credentials flow
    const clientId = '9c5af20f940d45229772189489ae5ba8';
    const clientSecret = '9817c09888bd4a809553c95fa83a2ea5';

    const authResponse = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
        },
        body: 'grant_type=client_credentials'
    });

    if (!authResponse.ok) {
        throw new Error('Failed to authenticate with Spotify');
    }

    const authData = await authResponse.json();
    const accessToken = authData.access_token;

    // Create playlist
    const createPlaylistResponse = await fetch('https://api.spotify.com/v1/users/{user_id}/playlists', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken,
        },
        body: JSON.stringify({
            name: 'Uploaded Songs Playlist',
            public: true,
        }),
    });

    if (!createPlaylistResponse.ok) {
        throw new Error('Failed to create Spotify playlist');
    }

    const playlistData = await createPlaylistResponse.json();
    const playlistId = playlistData.id;

    // Add tracks to playlist
    const trackUris = tracks.map(track => track.spotify_uri); // Assuming tracks have Spotify URIs
    const addTracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken,
        },
        body: JSON.stringify({
            uris: trackUris,
        }),
    });

    if (!addTracksResponse.ok) {
        throw new Error('Failed to add tracks to Spotify playlist');
    }

    return `https://open.spotify.com/playlist/${playlistId}`;
}

// Example serverless function handler for file upload
module.exports = async (req, res) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const form = new multiparty.Form();

    form.parse(req, async (error, fields, files) => {
        if (error) {
            console.error('Error parsing form:', error);
            return res.status(500).json({ error: 'Server Error' });
        }

        try {
            // Assuming 'audio' is the field name in your FormData
            const audioFile = files.audio[0]; // Get the uploaded audio file

            // Upload audio file to ACRCloud for song recognition
            const acrCloudResult = await uploadToACRCloud(audioFile);

            // Extract tracks from ACRCloud result
            const tracks = acrCloudResult.metadata.music.map(track => ({
                artist: track.artists[0].name,
                title: track.title,
                // Spotify URI from ACRCloud 
                spotify_uri: track.external_metadata.spotify.track.href
            }));

            // Create Spotify playlist with identified tracks
            const playlistUrl = await createSpotifyPlaylist(tracks);

            // Return success response with playlist URL
            res.status(200).json({ playlist_url: playlistUrl });
        } catch (error) {
            console.error('Error handling upload:', error);
            res.status(500).json({ error: error.message });
        }
    });
};
