# 🎧 Music Keeper

A lightweight Chrome extension that keeps your music playing on **TIDAL Web** and **Apple Music Web**.

It automatically resumes playback or skips to the next track if playback stops, gets stuck, or ends.

---

## 🚀 Features

- ▶️ Auto-resume when playback pauses unexpectedly  
- ⏭️ Auto-skip to next track if playback is stuck or ended  
- 🔁 Periodic health check (configurable interval)  
- 🎯 Smart targeting of the real player controls (avoids fake play buttons)  
- 🧠 Works with dynamic SPAs like TIDAL and Apple Music  

---

## 🌐 Supported Platforms

- https://tidal.com  
- https://listen.tidal.com  
- https://music.apple.com  

---

## 🧩 How It Works

The extension injects a **content script** into supported music sites.

It:

1. Locates the active `audio` / `video` element  
2. Checks if playback is:
   - paused  
   - ended  
   - not progressing  
3. Attempts recovery:
   - `media.play()`  
   - fallback: click Play button  
   - fallback: click Next  

To avoid incorrect clicks, it only interacts with controls located in the **bottom player area**.

---

## ⚙️ Installation (Developer Mode)

1. Open Chrome  
2. Navigate to:
chrome://extensions

3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `music-keeper` folder

---

## 🧪 Usage

1. Open TIDAL or Apple Music in your browser  
2. Start playing music  
3. Click the extension icon and ensure it's enabled  

### Settings

- **Check every X sec** → how often playback is monitored  
- **If paused for X sec, try Next** → fallback behavior  

---

## 🛠️ Configuration

All settings are stored via `chrome.storage.sync`:

| Setting        | Description                          | Default |
|----------------|--------------------------------------|---------|
| enabled        | Enable/disable extension             | true    |
| intervalSec    | Check interval (seconds)             | 5       |
| skipAfterSec   | Time before trying "Next"            | 5       |

---

## 🧠 Known Limitations

- Some browsers may block `media.play()` due to autoplay policies  
- UI selectors may change if TIDAL / Apple Music update their frontend  
- Works only on Chromium-based browsers  

---

## 🖥️ Compatibility

Works on:

- Google Chrome  
- Chromium  
- Microsoft Edge  
- Brave  

Not supported:

- Firefox (different extension API)

---

## 🐛 Debugging

Open DevTools (`F12`) → Console

Look for logs:
[Music Keeper]
 
Example:
[Music Keeper] Loop started with settings: ...
[Music Keeper] Detected paused/stalled media
[Music Keeper] media.play() succeeded


---

## 📦 Project Structure
music-keeper/
manifest.json
content.js
popup.html
popup.js
icons/


---

## 🔮 Future Improvements

- 📊 Debug panel inside popup  
- 🧠 Better stalled stream detection  
- 🔄 Cross-tab media management  
- 🌍 Multi-site support (Spotify Web, YouTube Music, etc.)  

---

## 🧑‍💻 Development

```bash
git clone <repo>
cd music-keeper

Load unpacked in Chrome and start testing.

📄 License

MIT (or whatever you choose)

