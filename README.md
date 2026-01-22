# AudioTrackify
A website that extracts audio from video files, identifies the songs using ACRCloud, and automatically generates a Spotify playlist with the identified tracks.

## YouTube Bot Detection Fix

If you're experiencing "Sign in to confirm you're not a bot" errors on cloud servers (Render, Heroku, etc.), you need to provide YouTube cookies for authentication.

### How to Set Up YouTube Cookies

1. **Install a browser extension to export cookies:**
   - Chrome/Edge: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
   - Firefox: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)

2. **Export YouTube cookies:**
   - Sign in to YouTube in your browser
   - Navigate to `https://www.youtube.com`
   - Click the extension icon and export cookies
   - Save the file as `youtube-cookies.txt`

3. **Add cookies to your deployment:**

   **For Render:**
   - Go to your service settings
   - Add an environment variable: `YOUTUBE_COOKIES_PATH=/etc/secrets/youtube-cookies.txt`
   - Create a secret file named `youtube-cookies.txt` with your cookie content
   
   **For local development:**
   - Place `youtube-cookies.txt` in the root directory of the project
   - The file is git-ignored for security

4. **Cookie format:**
   The cookie file should contain your YouTube session cookies in Netscape format. The key cookies needed are:
   - `__Secure-1PSID`
   - `__Secure-3PSID`
   - `VISITOR_INFO1_LIVE`

**Note:** Cookies expire periodically (usually after a few months). If you start getting bot detection errors again, export fresh cookies.

## Environment Variables

- `YOUTUBE_COOKIES_PATH`: Path to YouTube cookies file (optional, for bot detection bypass)
- Other environment variables...
