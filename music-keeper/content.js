(() => {
  const DEFAULTS = {
    enabled: true,
    intervalSec: 5,
    skipAfterSec: 20
  };

  let settings = { ...DEFAULTS };
  let timer = null;
  let lastPlayingAt = Date.now();
  let lastActionAt = 0;

  function log(...args) {
    console.log("[Music Keeper]", ...args);
  }

  async function loadSettings() {
    const data = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...data };
    restartLoop();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    for (const [key, value] of Object.entries(changes)) {
      settings[key] = value.newValue;
    }

    restartLoop();
  });

  function getSiteType() {
    if (location.hostname.includes("music.apple.com")) return "apple";
    if (location.hostname.includes("listen.tidal.com")) return "tidal";
    return "unknown";
  }

  function findMedia() {
    return document.querySelector("audio, video");
  }

  function isActuallyPlaying(media) {
    return !!media && !media.paused && !media.ended && media.readyState >= 2;
  }

  function clickIfFound(selectors) {
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);

      for (const el of elements) {
        const rect = el.getBoundingClientRect();

        // Prefer the sticky bottom player controls over unrelated page buttons.
        if (rect.bottom > window.innerHeight - 200) {
          el.click();
          log("Clicked (player control):", selector);
          return true;
        }
      }
    }

    return false;
  }

  function getSelectors(site) {
    if (site === "tidal") {
      return {
        play: [
          'button[aria-label="Play"]',
          'button[aria-label="Pause"]'
        ],
        next: [
          'button[aria-label="Next"]'
        ]
      };
    }

    if (site === "apple") {
      return {
        play: [
          'button[aria-label="Play"]',
          'button[aria-label="Pause"]'
        ],
        next: [
          'button[aria-label="Next"]'
        ]
      };
    }

    return { play: [], next: [] };
  }

  async function tryResume(media, selectors) {
    if (media.ended) {
      log("Media ended -> skipping next");
      return clickIfFound(selectors.next);
    }

    try {
      await media.play();
      log("media.play() succeeded");
      return true;
    } catch (err) {
      log("media.play() failed:", err?.message || err);
    }

    return clickIfFound(selectors.play);
  }

  function tryNext(selectors) {
    return clickIfFound(selectors.next);
  }

  async function tick() {
    if (!settings.enabled) return;
    if (document.hidden) return;

    const now = Date.now();
    const media = findMedia();
    const site = getSiteType();
    const selectors = getSelectors(site);

    if (!media) {
      log("No media element found");
      return;
    }

    if (isActuallyPlaying(media)) {
      lastPlayingAt = now;
      return;
    }

    if (now - lastActionAt < 4000) {
      return;
    }

    log("Detected paused/stalled media");

    const resumed = await tryResume(media, selectors);
    lastActionAt = now;

    if (resumed) return;

    const pausedForMs = now - lastPlayingAt;
    if (pausedForMs >= settings.skipAfterSec * 1000) {
      const skipped = tryNext(selectors);
      if (skipped) {
        lastActionAt = Date.now();
      }
    }
  }

  function restartLoop() {
    if (timer) clearInterval(timer);
    if (!settings.enabled) return;

    timer = setInterval(tick, Math.max(2, settings.intervalSec) * 1000);
    log("Loop started with settings:", settings);
  }

  loadSettings();

  const observer = new MutationObserver(() => {
    // Useful because these sites are SPA-like and their DOM changes a lot.
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true
  });
})();
