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
    if (
      location.hostname.includes("tidal.com") ||
      location.hostname.includes("listen.tidal.com")
    ) {
      return "tidal";
    }
    return "unknown";
  }

  function findMedia() {
    return document.querySelector("audio, video");
  }

  function isActuallyPlaying(media) {
    return !!media && !media.paused && !media.ended && media.readyState >= 2;
  }

  function isVisibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function getCandidateButtons(selectors) {
    const out = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        out.push(el);
      }
    }
    return out;
  }

  function scoreAppleControl(el) {
    if (!isVisibleElement(el)) return -1;

    const rect = el.getBoundingClientRect();
    let score = 0;

    // עדיפות גבוהה לאזור העליון של הנגן
    if (rect.top < 120) score += 50;
    if (rect.top < 80) score += 20;

    // בדיקה אם יש לידו כפתורי נגן נוספים
    const buttons = [
      ...document.querySelectorAll('button[aria-label], button[title]')
    ].filter(isVisibleElement);

    for (const b of buttons) {
      if (b === el) continue;
      const r = b.getBoundingClientRect();
      const dx = Math.abs(r.left - rect.left);
      const dy = Math.abs(r.top - rect.top);

      const aria = b.getAttribute("aria-label") || "";
      const title = b.getAttribute("title") || "";
      const label = `${aria} ${title}`;

      if (dy < 40 && dx < 160) {
        if (/Previous/i.test(label)) score += 25;
        if (/Next/i.test(label)) score += 25;
        if (/Shuffle/i.test(label)) score += 10;
        if (/Repeat/i.test(label)) score += 10;
        if (/Pause/i.test(label)) score += 15;
        if (/Play/i.test(label)) score += 15;
      }
    }

    return score;
  }

  function scoreTidalControl(el) {
    if (!isVisibleElement(el)) return -1;
    const rect = el.getBoundingClientRect();
    let score = 0;

    if (rect.bottom > window.innerHeight - 220) score += 100;
    return score;
  }

  function pickBestControl(selectors, site) {
    const candidates = getCandidateButtons(selectors);

    let best = null;
    let bestScore = -1;

    for (const el of candidates) {
      let score = -1;

      if (site === "apple") {
        score = scoreAppleControl(el);
      } else if (site === "tidal") {
        score = scoreTidalControl(el);
      } else {
        score = isVisibleElement(el) ? 1 : -1;
      }

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  }

  function clickIfFound(selectors) {
    const site = getSiteType();
    const best = pickBestControl(selectors, site);

    if (best) {
      best.click();
      log("Clicked best player control:", {
        site,
        aria: best.getAttribute("aria-label"),
        title: best.getAttribute("title"),
        className: best.className
      });
      return true;
    }

    return false;
  }

  function getSelectors(site) {
    if (site === "tidal") {
      return {
        play: ['button[aria-label="Play"]', 'button[title="Play"]'],
        pause: ['button[aria-label="Pause"]', 'button[title="Pause"]'],
        next: ['button[aria-label="Next"]', 'button[title="Next"]']
      };
    }

    if (site === "apple") {
      return {
        play: [
          'button[aria-label="Play"]',
          'button[title="Play"]',
          'button[aria-label*="Play"]',
          'button[title*="Play"]'
        ],
        pause: [
          'button[aria-label="Pause"]',
          'button[title="Pause"]',
          'button[aria-label*="Pause"]',
          'button[title*="Pause"]'
        ],
        next: [
          'button[aria-label="Next"]',
          'button[title="Next"]',
          'button[aria-label*="Next"]',
          'button[title*="Next"]'
        ]
      };
    }

    return { play: [], pause: [], next: [] };
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
