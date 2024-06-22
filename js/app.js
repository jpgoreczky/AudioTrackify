document.getElementById('upload-form').onsubmit = async function(event) {
    event.preventDefault();
    const fileInput = document.getElementById('video-file');
    const formData = new FormData();
    formData.append('video', fileInput.files[0]);
    
    const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
    
    const result = await response.json();
    document.getElementById('result').innerHTML = `Playlist created: <a href="${result.playlist_url}">${result.playlist_url}</a>`;
}