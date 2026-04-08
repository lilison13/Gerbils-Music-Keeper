(() => {
  const DEFAULTS = {
  enabled: true,
  intervalSec: 5,
  stallThresholdSec: 12,
  skipAfterSec: 20,
  log: true,
  debug: false
  };

  let settings = { ...DEFAULTS };

  let loopRunning = false;
  let stopLoop = false;
  let tickInFlight = false;
  let wakeSoon = false;

  let lastPlayingAt = Date.now();
  let lastActionAt = 0;
  let actionCooldownMs = 4000;

  let lastCurrentTime = 0;
  let lastProgressAt = Date.now();
  let lastUiPlayingAt = 0;
  let lastKnownMediaSignature = null;

  function log(...args) {
  if (!settings.log) return;
  console.log("[MusicKeeper]", ...args);
  }

  function debug(...args) {
  if (!settings.log || !settings.debug) return;
  console.log("[MusicKeeper:debug]", ...args);
  }

  function showBadge(text) {
  debug("Badge:", text);
  }

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeSettings(raw) {
    const normalized = {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
      log: typeof raw.log === "boolean" ? raw.log : DEFAULTS.log,
      debug: typeof raw.debug === "boolean" ? raw.debug : DEFAULTS.debug,
      intervalSec: clampNumber(raw.intervalSec, DEFAULTS.intervalSec, 1, 300),
      stallThresholdSec: clampNumber(
        raw.stallThresholdSec,
        DEFAULTS.stallThresholdSec,
        2,
        3600
      ),
      skipAfterSec: clampNumber(raw.skipAfterSec, DEFAULTS.skipAfterSec, 3, 3600)
    };

    if (normalized.skipAfterSec < normalized.stallThresholdSec) {
      normalized.skipAfterSec = normalized.stallThresholdSec;
    }

    return normalized;
  }

  async function loadSettings() {
    try {
      const data = await chrome.storage.sync.get(DEFAULTS);
      settings = normalizeSettings({ ...DEFAULTS, ...data });
      restartLoop();
    } catch (err) {
      log("Failed to load settings:", err);
      settings = { ...DEFAULTS };
      restartLoop();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    const updated = { ...settings };
    for (const [key, value] of Object.entries(changes)) {
      updated[key] = value.newValue;
    }

    settings = normalizeSettings(updated);
    restartLoop();
  });

  function getSiteType() {
    const host = location.hostname;
    if (host.includes("music.apple.com")) return "apple";
    if (host.includes("listen.tidal.com") || host.includes("tidal.com")) return "tidal";
    return "unknown";
  }

  function getMediaSignature(media) {
    if (!media) return null;
    const src = media.currentSrc || media.src || "";
    const dur = Number.isFinite(media.duration) ? media.duration.toFixed(2) : "na";
    const tag = media.tagName || "media";
    return `${tag}|${src}|${dur}`;
  }

  function rememberMedia(media) {
    const sig = getMediaSignature(media);
    if (sig && sig !== lastKnownMediaSignature) {
      lastKnownMediaSignature = sig;
      debug("Media switched:", {
        sig,
        paused: media?.paused,
        ended: media?.ended,
        readyState: media?.readyState,
        currentTime: media?.currentTime,
        duration: media?.duration,
        currentSrc: media?.currentSrc
      });
    }
  }

  function findMedia() {
    const site = getSiteType();

    if (site === "apple") {
      const primaryApplePlayer = document.querySelector("#apple-music-player");
      if (primaryApplePlayer instanceof HTMLMediaElement) {
        const sig = getMediaSignature(primaryApplePlayer);

        if (sig && sig !== lastKnownMediaSignature) {
          debug("Using primary Apple Music player element");
        }

        rememberMedia(primaryApplePlayer);
        return primaryApplePlayer;
      }
    }

    const mediaElements = [...document.querySelectorAll("audio, video")];
    if (mediaElements.length === 0) return null;

    let best = null;
    let bestScore = -1;

    for (const media of mediaElements) {
      let score = 0;

      if (media.currentSrc) score += 25;
      if (media.src) score += 10;
      if (!media.paused) score += 30;
      if (!media.ended) score += 10;
      if (media.readyState >= 2) score += 20;
      if (media.readyState >= 3) score += 5;
      if (Number.isFinite(media.duration) && media.duration > 0) score += 20;
      if (media.currentTime > 0) score += 15;
      if (media.volume > 0) score += 5;
      if (media.muted === false) score += 3;
      if (media.isConnected) score += 5;
      if (site === "apple" && media.id === "apple-music-player") score += 100;

      if (score > bestScore) {
        bestScore = score;
        best = media;
      }
    }

    if (best) rememberMedia(best);
    return best;
  }

  function isActuallyPlaying(media) {
    return !!media && !media.paused && !media.ended && media.readyState >= 2;
  }

  function updateProgressState(media, now) {
    if (!media) return false;

    const changed = media.currentTime !== lastCurrentTime;
    if (changed) {
      lastCurrentTime = media.currentTime;
      lastProgressAt = now;
    }
    return changed;
  }

  function isPlaybackStalled(media, now) {
    if (!media || media.paused || media.ended) return false;

    if (updateProgressState(media, now)) {
      return false;
    }

    // grace period כדי לא להיבהל ממיקרו-buffering
    if (now - lastProgressAt < 3000) {
      return false;
    }

    const noProgressMs = now - lastProgressAt;
    const stalled = noProgressMs >= settings.stallThresholdSec * 1000;

    if (stalled) {
      log("Playback stall detected:", {
        paused: media.paused,
        ended: media.ended,
        readyState: media.readyState,
        currentTime: media.currentTime,
        lastCurrentTime,
        noProgressMs
      });
    }

    return stalled;
  }

  function isVisibleElement(el) {
    if (!el) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;

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

  function hasAppleTopPlayerBar() {
    return !!document.querySelector(".chrome-player__playback-controls");
  }

  function scoreAppleControl(el) {
    if (!isVisibleElement(el)) return -1;

    const rect = el.getBoundingClientRect();
    const topPlayerBarPresent = hasAppleTopPlayerBar();
    const inTopControls = !!el.closest(".chrome-player__playback-controls");
    let score = 0;

    // אם יש top player bar, לא נוגעים בכפתורי רשימה/preview
    if (topPlayerBarPresent && !inTopControls) return -1;

    if (rect.top < 120) score += 50;
    if (rect.top < 80) score += 20;

    if (!topPlayerBarPresent) {
      if (rect.top > 80 && rect.top < window.innerHeight * 0.8) score += 25;
      if (rect.left > 180) score += 20;
      if (rect.width >= 24 && rect.height >= 24) score += 10;
    }

    if (el.matches(".chrome-player__playback-controls button.playback-play__play")) score += 120;
    if (el.matches('.chrome-player__playback-controls button[class*="playback-play__play"]')) score += 100;
    if (el.matches(".chrome-player__playback-controls button.playback-play__pause")) score += 120;
    if (el.matches('.chrome-player__playback-controls button[class*="playback-play__pause"]')) score += 100;
    if (el.matches(".chrome-player__playback-controls button.playback-next__next")) score += 110;
    if (el.matches('.chrome-player__playback-controls button[class*="playback-next__next"]')) score += 90;

    const label =
      `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.className || ""}`;

    if (/Play/i.test(label)) score += 35;
    if (/Pause/i.test(label)) score += 35;
    if (/Next|Skip/i.test(label)) score += 30;
    if (/Previous|Prev/i.test(label)) score += 20;
    if (/playback-play/i.test(label)) score += 25;
    if (/playback-next/i.test(label)) score += 20;

    const buttons = [
      ...document.querySelectorAll(
        topPlayerBarPresent
          ? '.chrome-player__playback-controls button[aria-label], .chrome-player__playback-controls button[title], .chrome-player__playback-controls button[class]'
          : 'button[aria-label], button[title], button[class]'
      )
    ].filter(isVisibleElement);

    for (const b of buttons) {
      if (b === el) continue;

      const r = b.getBoundingClientRect();
      const dx = Math.abs(r.left - rect.left);
      const dy = Math.abs(r.top - rect.top);

      const aria = b.getAttribute("aria-label") || "";
      const title = b.getAttribute("title") || "";
      const nearbyLabel = `${aria} ${title} ${b.className || ""}`;

      if (dy < 40 && dx < 180) {
        if (/Previous|prev/i.test(nearbyLabel)) score += 25;
        if (/Next|next|Skip/i.test(nearbyLabel)) score += 25;
        if (/Shuffle/i.test(nearbyLabel)) score += 10;
        if (/Repeat/i.test(nearbyLabel)) score += 10;
        if (/Pause|playback-play__pause/i.test(nearbyLabel)) score += 15;
        if (/Play|playback-play__play/i.test(nearbyLabel)) score += 15;
      }
    }

    return score;
  }

  function scoreTidalControl(el) {
    if (!isVisibleElement(el)) return -1;

    const rect = el.getBoundingClientRect();
    let score = 0;

    if (rect.bottom > window.innerHeight - 220) score += 100;
    if (rect.bottom > window.innerHeight - 140) score += 35;
    if (rect.width >= 20 && rect.height >= 20) score += 10;

    const label =
      `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.className || ""}`;

    if (/Play/i.test(label)) score += 25;
    if (/Pause/i.test(label)) score += 25;
    if (/Next|Skip/i.test(label)) score += 25;
    if (/Previous|Prev/i.test(label)) score += 10;
    if (/player|transport|controls/i.test(label)) score += 10;

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

    if (best) {
    debug("Best control picked:", {
    site,
    bestScore,
    aria: best.getAttribute("aria-label"),
    title: best.getAttribute("title"),
    className: best.className
    });
    }

    return best;
  }

  function hasPrimaryPauseControl(site, selectors) {
    const pauseControl = pickBestControl(selectors.pause, site);
    const playControl = pickBestControl(selectors.play, site);

    if (!pauseControl) return false;
    if (!playControl) return true;

    if (site === "apple") {
      return scoreAppleControl(pauseControl) >= scoreAppleControl(playControl);
    }

    if (site === "tidal") {
      return scoreTidalControl(pauseControl) >= scoreTidalControl(playControl);
    }

    return true;
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

    debug("No suitable control found for click");
    return false;
  }

  function getSelectors(site) {
    if (site === "tidal") {
      return {
        play: [
          'button[aria-label="Play"]',
          'button[title="Play"]',
          'button[aria-label*="Play"]',
          'button[title*="Play"]',
          '[data-test*="play"] button',
          '[data-testid*="play"]',
          'button[class*="play"]'
        ],
        pause: [
          'button[aria-label="Pause"]',
          'button[title="Pause"]',
          'button[aria-label*="Pause"]',
          'button[title*="Pause"]',
          '[data-test*="pause"] button',
          '[data-testid*="pause"]',
          'button[class*="pause"]'
        ],
        next: [
          'button[aria-label="Next"]',
          'button[title="Next"]',
          'button[aria-label*="Next"]',
          'button[title*="Next"]',
          '[data-test*="next"] button',
          '[data-testid*="next"]',
          'button[class*="next"]',
          'button[aria-label*="Skip"]'
        ]
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

  async function waitForPlaybackProgress(media, startTime, selectors, site, timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));

      const currentMedia =
        media && media.isConnected ? media : findMedia();

      if (!currentMedia || currentMedia.ended) {
        return false;
      }

      if ((site === "apple" || site === "tidal") && hasPrimaryPauseControl(site, selectors)) {
        if (!currentMedia.paused && currentMedia.currentTime > startTime + 0.05) {
          return true;
        }
      }

      if (!currentMedia.paused && currentMedia.currentTime > startTime + 0.05) {
        return true;
      }
    }

    return false;
  }

  async function tryResume(media, selectors, site) {
    if (media?.ended) {
      log("Media ended -> trying NEXT");
      return clickIfFound(selectors.next);
    }

    let activeMedia = media;

    if (site === "apple") {
      activeMedia = findMedia() || activeMedia;
    } else if (!activeMedia || !activeMedia.isConnected) {
      activeMedia = findMedia();
    }

    const startTime = activeMedia?.currentTime || 0;

    // Apple: קודם מנסים UI control מדויק
    if (site === "apple") {
      const clickedPlay = clickIfFound(selectors.play);
      if (clickedPlay) {
        log("Apple: tried player control before media.play()");
        const progressedAfterClick = await waitForPlaybackProgress(
          activeMedia,
          startTime,
          selectors,
          site
        );
        if (progressedAfterClick) {
          log("Playback progress confirmed after Apple control click");
          return true;
        }
        log("Apple control click did not produce playback progress");
      }
    }

    try {
      if (!activeMedia || !activeMedia.isConnected) {
        activeMedia = findMedia();
      }

      if (!activeMedia) {
        throw new Error("No media element available");
      }

      const beforePlayTime = activeMedia.currentTime || startTime;
      await activeMedia.play();
      log("media.play() resolved");

      const progressed = await waitForPlaybackProgress(
        activeMedia,
        beforePlayTime,
        selectors,
        site
      );

      if (progressed) {
        log("Playback progress confirmed after media.play()");
        return true;
      }

      log("media.play() resolved but no playback progress detected");
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
            const refreshedStartTime = refreshedMedia.currentTime || 0;
            await refreshedMedia.play();
            log("Retried media.play() with refreshed Apple media");

            const progressed = await waitForPlaybackProgress(
              refreshedMedia,
              refreshedStartTime,
              selectors,
              site
            );
            if (progressed) {
              log("Playback progress confirmed after refreshed Apple media");
              return true;
            }
          } catch (retryErr) {
            log("Refreshed media.play() failed:", retryErr?.message || retryErr);
          }
        }
      }
    }

    // fallback גם ל-TIDAL וגם ל-Apple אחרי כל הניסיונות
    const clickedFallback = clickIfFound(selectors.play);
    if (clickedFallback) {
      const currentMedia = findMedia();
      const fallbackStartTime = currentMedia?.currentTime || 0;
      const progressed = await waitForPlaybackProgress(
        currentMedia,
        fallbackStartTime,
        selectors,
        site
      );
      if (progressed) {
        log("Playback progress confirmed after fallback play click");
        return true;
      }
    }

    return false;
  }

  function tryNext(selectors) {
    return clickIfFound(selectors.next);
  }

  async function tick() {
    if (tickInFlight) {
      debug("Skipping tick: previous tick still running");
      return;
    }

    if (!settings.enabled) return;
    if (document.hidden) return;

    tickInFlight = true;

    try {
      const now = Date.now();
      const site = getSiteType();
      let media = findMedia();
      const selectors = getSelectors(site);

      const primaryUiPlaying =
        (site === "apple" || site === "tidal") &&
        hasPrimaryPauseControl(site, selectors);

      if (primaryUiPlaying) {
        if (lastUiPlayingAt === 0) {
          lastUiPlayingAt = now;
        }
      } else {
        lastUiPlayingAt = 0;
      }

      if (!media && !primaryUiPlaying) {
        showBadge("");
        log("No media element and no UI-playing signal");
        return;
      }

      const uiLooksPlaying =
        (site === "apple" || site === "tidal") &&
        primaryUiPlaying &&
        now - lastUiPlayingAt >= 1500;

      // UI הוא hint בלבד. מעדכנים progress אם באמת זז, אבל לא עושים return רק בגלל UI.
      if (uiLooksPlaying && media) {
        updateProgressState(media, now);
      }

      const stalled = media ? isPlaybackStalled(media, now) : false;
      const actuallyPlaying = isActuallyPlaying(media);
      const noProgressMs = now - lastProgressAt;
      const hardStall =
        site === "apple" &&
        uiLooksPlaying &&
        noProgressMs >= settings.stallThresholdSec * 1000;

      if ((actuallyPlaying || uiLooksPlaying) && !stalled && !hardStall) {
        if (media) {
          updateProgressState(media, now);
        }
        lastPlayingAt = now;
        showBadge("");
        return;
      }

      if (uiLooksPlaying && stalled) {
        log(`${site} UI says playing, but playback appears stalled`);
      }

      if (hardStall) {
        log(`apple hard stall detected: UI says playing, but no progress for ${noProgressMs}ms`);
      }

      if (stalled) {
        showBadge("STALL");
      }

      if (now - lastActionAt < actionCooldownMs) {
        return;
      }

      showBadge("FIX");
      log("Detected paused/stalled media");

      if (!media || now - lastProgressAt > settings.stallThresholdSec * 1000) {
        media = findMedia();
      }

      const resumed = await tryResume(media, selectors, site);
      lastActionAt = Date.now();
      actionCooldownMs = site === "apple" ? 8000 : 4000;

      if (resumed) {
        return;
      }

      if (site === "apple" && hardStall) {
        log("Apple hard stall persists after resume attempt, trying NEXT early");
        const skippedEarly = tryNext(selectors);
        if (skippedEarly) {
          lastActionAt = Date.now();
          actionCooldownMs = 8000;
          showBadge("NEXT");
          return;
        }
      }

      const pausedForMs = now - Math.max(lastPlayingAt, lastProgressAt);
      if (pausedForMs >= settings.skipAfterSec * 1000) {
        const skipped = tryNext(selectors);
        if (skipped) {
          lastActionAt = Date.now();
          actionCooldownMs = 8000;
          showBadge("NEXT");
          log("Fallback NEXT clicked after prolonged no-progress state");
        }
      }
    } finally {
      tickInFlight = false;
    }
  }

  async function loop() {
    if (loopRunning) return;
    loopRunning = true;
    stopLoop = false;

    debug("Loop started with settings:", settings);

    while (!stopLoop) {
      await tick();

      let sleepMs = Math.max(1000, settings.intervalSec * 1000);
      if (wakeSoon) {
        wakeSoon = false;
        sleepMs = Math.min(sleepMs, 1000);
      }

      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }

    loopRunning = false;
  }

  function restartLoop() {
    stopLoop = true;

    if (!settings.enabled) {
      debug("Loop stopped: extension disabled");
      return;
    }

    setTimeout(() => {
      if (!loopRunning && settings.enabled) {
        loop();
      }
    }, 0);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        if (m.addedNodes.length || m.removedNodes.length) {
          wakeSoon = true;
          return;
        }
      }

      if (
        m.type === "attributes" &&
        m.target instanceof Element &&
        (
          m.target.matches("audio, video, button") ||
          m.target.closest?.(".chrome-player__playback-controls")
        )
      ) {
        wakeSoon = true;
        return;
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-label", "title", "aria-hidden", "disabled"]
  });

  loadSettings();
})();