from flask import Flask, request, jsonify
import requests
import os
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import base64
import hmac
import hashlib
import time

app = Flask(__name__)

# Spotify API credentials
SPOTIPY_CLIENT_ID = '9c5af20f940d45229772189489ae5ba8'
SPOTIPY_CLIENT_SECRET = '9817c09888bd4a809553c95fa83a2ea5'
SPOTIPY_REDIRECT_URI = 'https://github.com/jpgoreczky/AudioTrackify'

sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
    client_id=SPOTIPY_CLIENT_ID,
    client_secret=SPOTIPY_CLIENT_SECRET,
    redirect_uri=SPOTIPY_REDIRECT_URI,
    scope="playlist-modify-public"))

# ACRCloud credentials
ACR_CLOUD_HOST = 'https://identify-eu-west-1.acrcloud.com/v1/identify'
ACR_CLOUD_ACCESS_KEY = '13091d889a9884a928de42db6225564e'
ACR_CLOUD_ACCESS_SECRET = 'LemWHcJFdSF9Y8wiv3iRlrq0nRBe5lUUfxzDSyuw'

def identify_song(audio_file_path):
    data = {
        'access_key': ACR_CLOUD_ACCESS_KEY,
        'sample_bytes': os.path.getsize(audio_file_path),
        'data_type': 'audio',
        'signature_version': '1',
        'timestamp': str(int(time.time()))
    }

    # Generate HMAC-SHA1 signature
    string_to_sign = f"POST\n/v1/identify\n{data['access_key']}\n{data['data_type']}\n{data['sample_bytes']}\n{data['timestamp']}"
    data['signature'] = base64.b64encode(hmac.new(ACR_CLOUD_ACCESS_SECRET.encode(), string_to_sign.encode(), hashlib.sha1).digest()).decode()

    files = {
        'sample': open(audio_file_path, 'rb')
    }

    response = requests.post(ACR_CLOUD_HOST, data=data, files=files)
    return response.json()

@app.route('/upload', methods=['POST'])
def upload_file():
    video = request.files['video']
    video_path = os.path.join('/tmp', video.filename)
    video.save(video_path)
    
    # Extract audio (using ffmpeg or similar)
    audio_path = extract_audio(video_path)
    
    # Identify songs
    songs = identify_songs(audio_path)
    
    # Create Spotify playlist
    track_uris = [song['spotify_uri'] for song in songs]
    playlist_url = create_playlist("My Movie Playlist", track_uris)
    
    return jsonify({'playlist_url': playlist_url})

def extract_audio(video_path):
    audio_path = video_path.replace('.mp4', '.mp3')
    os.system(f'ffmpeg -i {video_path} -q:a 0 -map a {audio_path}')
    return audio_path

def identify_songs(audio_path):
    result = identify_song(audio_path)
    songs = []
    for song in result['metadata']['music']:
        track = sp.search(q=f"{song['title']} {song['artists'][0]['name']}", type='track')
        if track['tracks']['items']:
            track_uri = track['tracks']['items'][0]['uri']
            songs.append({'title': song['title'], 'spotify_uri': track_uri})
    return songs

def create_playlist(name, track_uris):
    user_id = sp.current_user()['id']
    playlist = sp.user_playlist_create(user_id, name)
    sp.playlist_add_items(playlist['id'], track_uris)
    return playlist['external_urls']['spotify']

if __name__ == '__main__':
    app.run(debug=True)
