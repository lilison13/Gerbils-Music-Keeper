(() => {
  const DEFAULTS = {
    enabled: true,
    intervalSec: 5,
    skipAfterSec: 20,
    debug: false
  };

  let settings = { ...DEFAULTS };
  let timer = null;
  let lastPlayingAt = Date.now();
  let lastActionAt = 0;
  let actionCooldownMs = 4000;
  let lastCurrentTime = 0;
  let lastProgressAt = Date.now();
  let lastAppleUiPlayingAt = 0;

  function log(...args) {
    if (!settings.debug) return;
    console.log("[Music Keeper]", ...args);
  }

  function showBadge(text) {
    if (!settings.debug) return;
    log("Badge:", text);
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
    const site = getSiteType();
    if (site === "apple") {
      const primaryApplePlayer = document.querySelector("#apple-music-player");
      if (primaryApplePlayer instanceof HTMLMediaElement) {
        log("Using primary Apple Music player element");
        return primaryApplePlayer;
      }
    }

    const mediaElements = [...document.querySelectorAll("audio, video")];

    if (mediaElements.length === 0) {
      return null;
    }

    let best = null;
    let bestScore = -1;

    for (const media of mediaElements) {
      let score = 0;

      if (media.currentSrc) score += 20;
      if (media.src) score += 10;
      if (!media.paused) score += 30;
      if (!media.ended) score += 10;
      if (media.readyState >= 2) score += 20;
      if (Number.isFinite(media.duration) && media.duration > 0) score += 20;
      if (media.currentTime > 0) score += 15;

      if (score > bestScore) {
        bestScore = score;
        best = media;
      }
    }

    log("Selected media element:", {
      total: mediaElements.length,
      bestScore,
      paused: best?.paused,
      ended: best?.ended,
      readyState: best?.readyState,
      currentTime: best?.currentTime,
      duration: best?.duration,
      currentSrc: best?.currentSrc
    });

    return best;
  }

  function isActuallyPlaying(media) {
    return !!media && !media.paused && !media.ended && media.readyState >= 2;
  }

  function isPlaybackStalled(media, now) {
    if (!media || media.paused || media.ended) return false;

    if (media.currentTime !== lastCurrentTime) {
      lastCurrentTime = media.currentTime;
      lastProgressAt = now;
      return false;
    }

    return now - lastProgressAt >= settings.skipAfterSec * 1000;
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
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
    }
    return out;
  }

  function scoreAppleControl(el) {
    if (!isVisibleElement(el)) return -1;
    if (!el.closest(".chrome-player__playback-controls")) return -1;

    const rect = el.getBoundingClientRect();
    let score = 0;

    if (rect.top < 120) score += 50;
    if (rect.top < 80) score += 20;
    if (el.matches(".chrome-player__playback-controls button.playback-play__play")) score += 120;
    if (el.matches('.chrome-player__playback-controls button[class*="playback-play__play"]')) score += 100;
    if (el.matches(".chrome-player__playback-controls button.playback-play__pause")) score += 120;
    if (el.matches('.chrome-player__playback-controls button[class*="playback-play__pause"]')) score += 100;
    if (el.matches(".chrome-player__playback-controls button.playback-next__next")) score += 110;
    if (el.matches('.chrome-player__playback-controls button[class*="playback-next__next"]')) score += 90;

    const buttons = [
      ...document.querySelectorAll(
        '.chrome-player__playback-controls button[aria-label], .chrome-player__playback-controls button[title], .chrome-player__playback-controls button[class]'
      )
    ].filter(isVisibleElement);

    for (const b of buttons) {
      if (b === el) continue;
      const r = b.getBoundingClientRect();
      const dx = Math.abs(r.left - rect.left);
      const dy = Math.abs(r.top - rect.top);

      const aria = b.getAttribute("aria-label") || "";
      const title = b.getAttribute("title") || "";
      const label = `${aria} ${title} ${b.className}`;

      if (dy < 40 && dx < 160) {
        if (/Previous|prev/i.test(label)) score += 25;
        if (/Next|next/i.test(label)) score += 25;
        if (/Shuffle/i.test(label)) score += 10;
        if (/Repeat/i.test(label)) score += 10;
        if (/Pause|playback-play__pause/i.test(label)) score += 15;
        if (/Play|playback-play__play/i.test(label)) score += 15;
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

  function hasPrimaryPauseControl(site, selectors) {
    const pauseControl = pickBestControl(selectors.pause, site);
    const playControl = pickBestControl(selectors.play, site);

    if (!pauseControl) {
      return false;
    }

    if (!playControl) {
      return true;
    }

    return scoreAppleControl(pauseControl) >= scoreAppleControl(playControl);
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
          ".chrome-player__playback-controls button.playback-play__play",
          '.chrome-player__playback-controls button[class*="playback-play__play"]',
          "button.playback-play__play",
          'button[class*="playback-play__play"]',
          'button[aria-label="Play"]',
          'button[title="Play"]',
          'button[aria-label*="Play"]',
          'button[title*="Play"]'
        ],
        pause: [
          ".chrome-player__playback-controls button.playback-play__pause",
          '.chrome-player__playback-controls button[class*="playback-play__pause"]',
          "button.playback-play__pause",
          'button[class*="playback-play__pause"]',
          'button[aria-label="Pause"]',
          'button[title="Pause"]',
          'button[aria-label*="Pause"]',
          'button[title*="Pause"]'
        ],
        next: [
          ".chrome-player__playback-controls button.playback-next__next",
          '.chrome-player__playback-controls button[class*="playback-next__next"]',
          "button.skip-control__next",
          'button[class*="skip-control__next"]',
          "button.playback-controls__next",
          'button[class*="playback-controls__next"]',
          'button[aria-label="Next"]',
          'button[title="Next"]',
          'button[aria-label*="Next"]',
          'button[title*="Next"]'
        ]
      };
    }

    return { play: [], pause: [], next: [] };
  }

  async function tryResume(media, selectors, site) {
    if (media?.ended) {
      log("Media ended -> skipping next");
      return clickIfFound(selectors.next);
    }

    let activeMedia = media;
    const startTime = activeMedia?.currentTime || 0;

    if (site === "apple") {
      const clickedPlay = clickIfFound(selectors.play);
      if (clickedPlay) {
        log("Apple Music: tried player control before media.play()");
        const progressedAfterClick = await waitForPlaybackProgress(
          activeMedia,
          startTime,
          selectors,
          site
        );
        if (progressedAfterClick) {
          log("Playback progress confirmed after Apple player click");
          return true;
        }

        log("Apple player click did not produce playback progress");
      }
    }

    try {
      if (!activeMedia || !activeMedia.isConnected) {
        activeMedia = findMedia();
      }

      if (!activeMedia) {
        throw new Error("No media element available");
      }

      await activeMedia.play();
      log("media.play() succeeded");

      const progressed = await waitForPlaybackProgress(
        activeMedia,
        activeMedia.currentTime || startTime,
        selectors,
        site
      );
      if (progressed) {
        log("Playback progress confirmed after media.play()");
        return true;
      }

      log("media.play() resolved but playback did not progress");
    } catch (err) {
      log("media.play() failed:", err?.message || err);

      if (
        site === "apple" &&
        /removed from the document|The play\(\) request was interrupted/i.test(
          err?.message || ""
        )
      ) {
        const refreshedMedia = findMedia();
        if (refreshedMedia && refreshedMedia !== activeMedia) {
          try {
            await refreshedMedia.play();
            log("Retried media.play() with refreshed Apple player");

            const progressed = await waitForPlaybackProgress(
              refreshedMedia,
              refreshedMedia.currentTime || 0,
              selectors,
              site
            );
            if (progressed) {
              log("Playback progress confirmed after refreshed Apple player");
              return true;
            }
          } catch (retryErr) {
            log("Refreshed media.play() failed:", retryErr?.message || retryErr);
          }
        }
      }
    }

    return clickIfFound(selectors.play);
  }

  function tryNext(selectors) {
    return clickIfFound(selectors.next);
  }

  async function waitForPlaybackProgress(
    media,
    startTime,
    selectors,
    site,
    timeoutMs = 1200
  ) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));

      if (site === "apple" && hasPrimaryPauseControl(site, selectors)) {
        return true;
      }

      if (!media || media.ended) {
        return false;
      }

      if (!media.paused && media.currentTime > startTime + 0.05) {
        return true;
      }
    }

    return false;
  }

  async function tick() {
    if (!settings.enabled) return;
    if (document.hidden) return;

    const now = Date.now();
    const media = findMedia();
    const site = getSiteType();
    const selectors = getSelectors(site);
    const appleUiPlaying =
      site === "apple" && hasPrimaryPauseControl(site, selectors);

    if (appleUiPlaying) {
      if (lastAppleUiPlayingAt === 0) {
        lastAppleUiPlayingAt = now;
      }
    } else {
      lastAppleUiPlayingAt = 0;
    }

    if (!media && !appleUiPlaying) {
      showBadge("");
      log("No media element found");
      return;
    }

    const stalled = media ? isPlaybackStalled(media, now) : false;

    if (site === "apple" && appleUiPlaying && now - lastAppleUiPlayingAt >= 1500) {
      if (media && media.currentTime !== lastCurrentTime) {
        lastCurrentTime = media.currentTime;
        lastProgressAt = now;
      }
      lastPlayingAt = now;
      showBadge("");
      log("Apple player UI indicates stable playback");
      return;
    }

    if ((isActuallyPlaying(media) || appleUiPlaying) && !stalled) {
      if (media) {
        lastCurrentTime = media.currentTime;
        lastProgressAt = now;
      }
      lastPlayingAt = now;
      showBadge("");
      return;
    }

    if (stalled) {
      showBadge("STALL");
      log("Detected stalled playback");
    }

    if (now - lastActionAt < actionCooldownMs) {
      return;
    }

    showBadge("FIX");
    log("Detected paused/stalled media");

    const resumed = await tryResume(media, selectors, site);
    lastActionAt = now;
    actionCooldownMs = site === "apple" ? 8000 : 4000;

    if (resumed) return;

    const pausedForMs = now - Math.max(lastPlayingAt, lastProgressAt);
    if (pausedForMs >= settings.skipAfterSec * 1000) {
      const skipped = tryNext(selectors);
      if (skipped) {
        lastActionAt = Date.now();
        actionCooldownMs = 8000;
        showBadge("NEXT");
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
