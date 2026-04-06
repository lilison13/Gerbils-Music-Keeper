# Music Keeper

Music Keeper is a Chrome extension for Apple Music Web and TIDAL Web.

It checks playback every few seconds and tries to recover if playback pauses, gets stuck, or stops progressing.

## Supported Sites

- `https://music.apple.com/*`
- `https://tidal.com/*`
- `https://listen.tidal.com/*`

## Current Version

- `1.3.2`

## What It Does

- Monitors playback on supported sites
- Detects paused playback
- Detects stalled playback when `currentTime` stops progressing
- Tries to resume playback automatically
- Can try `Next` as a fallback after enough time has passed
- Uses smarter Apple Music control targeting to avoid clicking content play buttons by mistake
- Stores settings with `chrome.storage.sync`

## How Recovery Works

The content script runs a loop every `intervalSec` seconds.

On each tick it:

1. Finds the active media element
2. Checks whether playback is healthy
3. Detects stalled playback if time is not moving forward
4. Tries to recover by clicking the player controls or calling `media.play()`
5. Optionally tries `Next` if playback has been paused or stalled long enough

### Apple Music

- Prefers the top player bar controls
- Prefers `#apple-music-player` when available
- Uses the top player UI as a playback signal
- Supports bootstrap behavior when the top player bar is not visible yet

### TIDAL

- Keeps the simpler control targeting logic
- Uses bottom-player style scoring for control selection

## Settings

The popup exposes these settings:

- `enabled`: turns the extension on or off
- `intervalSec`: how often the extension checks playback
- `skipAfterSec`: how long playback can stay paused/stalled before trying `Next`
- `debug`: enables console logging

Default values:

| Setting | Default |
|---|---:|
| `enabled` | `true` |
| `intervalSec` | `5` |
| `skipAfterSec` | `20` |
| `debug` | `false` |

## Debug Logging

When `debug` is enabled in the popup, the extension logs messages to the page console.

Open:

1. The Apple Music or TIDAL tab
2. DevTools
3. `Console`

Look for messages starting with:

```text
[Music Keeper]
```

Examples:

```text
[Music Keeper] Loop started with settings: ...
[Music Keeper] Detected paused/stalled media
[Music Keeper] media.play() succeeded
```

## Installation

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `music-keeper` folder

## Project Structure

```text
music-keeper/
  manifest.json
  content.js
  popup.html
  popup.js
  icons/
```

## Development Notes

- Apple Music and TIDAL are dynamic SPAs, so selectors can change over time
- Some playback states differ between preview/free and full subscription modes
- `media.play()` may succeed even when the UI still needs a control click fallback
- Apple Music may re-render its media element, so recovery logic includes re-query behavior

## Local Git Workflow

```powershell
git add .
git commit -m "Your message"
git push
```
