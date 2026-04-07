(() => {
  const DEFAULTS = {
    enabled: true,
    intervalSec: 5,
    stallThresholdSec: 10,   // NEW - זמן לזיהוי תקיעה
    skipAfterSec: 20,        // זמן לפני NEXT
    debug: false
  };

  let settings = { ...DEFAULTS };
  let running = false;

  let lastPlayingAt = 0;
  let lastActionAt = 0;
  let lastCurrentTime = 0;
  let lastProgressAt = 0;
  let lastAppleUiPlayingAt = 0;

  let loopActive = false;

  const ACTION_COOLDOWN = 4000;

  function log(...args) {
    if (settings.debug) console.log("[MusicKeeper]", ...args);
  }

  async function showBadge(text) {
    try {
      await chrome.action.setBadgeText({ text });
      await chrome.action.setBadgeBackgroundColor({ color: "#1DB954" });
    } catch (e) {
      log("Badge failed:", e);
    }
  }

  function getSiteType() {
    if (location.hostname.includes("apple")) return "apple";
    if (location.hostname.includes("tidal")) return "tidal";
    return "unknown";
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findMedia() {
    const media = [...document.querySelectorAll("audio, video")];

    let best = null;
    let bestScore = -1;

    for (const m of media) {
      let score = 0;

      if (m.currentSrc) score += 5;
      if (!m.paused) score += 5;
      if (!m.ended) score += 3;
      if (m.readyState >= 2) score += 3;
      if (m.currentTime > 0) score += 2;

      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }

    return best;
  }

  function isActuallyPlaying(media) {
    return media && !media.paused && !media.ended && media.readyState >= 2;
  }

  function isPlaybackStalled(media, now) {
    if (!media || media.paused || media.ended) return false;

    if (media.currentTime !== lastCurrentTime) {
      lastCurrentTime = media.currentTime;
      lastProgressAt = now;
      return false;
    }

    return (now - lastProgressAt) >= settings.stallThresholdSec * 1000;
  }

  function getSelectors(site) {
    if (site === "tidal") {
      return {
        play: ['[aria-label="Play"]', '[title="Play"]'],
        pause: ['[aria-label="Pause"]', '[title="Pause"]'],
        next: ['[aria-label="Next"]', '[title="Next"]']
      };
    }

    return {
      play: [
        '.playback-play__play',
        '[aria-label*="Play"]'
      ],
      pause: [
        '.playback-play__pause',
        '[aria-label*="Pause"]'
      ],
      next: [
        '.playback-next__next',
        '[aria-label*="Next"]'
      ]
    };
  }

  function pickBest(selectors) {
    const candidates = [];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (isVisible(el)) candidates.push(el);
      });
    });

    return candidates[0] || null;
  }

  function click(selectors) {
    const btn = pickBest(selectors);
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  function isAppleUIPlaying(selectors) {
    const pauseBtn = pickBest(selectors.pause);
    return !!pauseBtn;
  }

  async function tryResume(media, selectors, site) {
    log("Trying resume...");

    if (site === "apple") {
      if (click(selectors.play)) return true;
    }

    try {
      await media?.play();
      return true;
    } catch {}

    return click(selectors.play);
  }

  async function tick() {
    if (!settings.enabled || document.hidden) return;

    const now = Date.now();
    const site = getSiteType();
    const media = findMedia();
    const selectors = getSelectors(site);

    const appleUIPlaying = site === "apple" && isAppleUIPlaying(selectors);

    if (appleUIPlaying) {
      lastAppleUiPlayingAt = now;
    }

    // ✅ FIXED LOGIC (UI priority)
    if (site === "apple" && appleUIPlaying && now - lastAppleUiPlayingAt >= 1500) {
      lastPlayingAt = now;

      if (media && media.currentTime !== lastCurrentTime) {
        lastCurrentTime = media.currentTime;
        lastProgressAt = now;
      }

      showBadge("");
      log("Apple UI stable playback");
      return;
    }

    const playing = isActuallyPlaying(media);
    const stalled = isPlaybackStalled(media, now);

    if ((playing && !stalled) || (site === "tidal" && playing)) {
      lastPlayingAt = now;
      showBadge("");
      return;
    }

    if (now - lastActionAt < ACTION_COOLDOWN) return;

    const resumed = await tryResume(media, selectors, site);

    lastActionAt = now;

    if (!resumed) {
      if (now - lastPlayingAt >= settings.skipAfterSec * 1000) {
        log("Trying NEXT...");
        click(selectors.next);
      }
    }
  }

  async function loop() {
    if (loopActive) return;
    loopActive = true;

    while (settings.enabled) {
      await tick();
      await new Promise(r => setTimeout(r, settings.intervalSec * 1000));
    }

    loopActive = false;
  }

  async function init() {
    const stored = await chrome.storage.sync.get();
    settings = { ...DEFAULTS, ...stored };

    if (settings.enabled) loop();
  }

  chrome.storage.onChanged.addListener((changes) => {
    Object.keys(changes).forEach(key => {
      settings[key] = changes[key].newValue;
    });

    if (settings.enabled) loop();
  });

  // ✅ MutationObserver now useful
  const observer = new MutationObserver(() => {
    // hint בלבד – מאיץ התאוששות
    lastProgressAt = Date.now();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  init();
})();