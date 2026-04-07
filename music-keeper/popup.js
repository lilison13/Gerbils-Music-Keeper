const defaults = {
  enabled: true,
  intervalSec: 5,
  stallThresholdSec: 12,
  skipAfterSec: 20,
  log: true,
  debug: false
};

async function loadSettings() {
  const data = await chrome.storage.sync.get(defaults);

  document.getElementById("enabled").checked = data.enabled;
  document.getElementById("intervalSec").value = data.intervalSec;
  document.getElementById("stallThresholdSec").value = data.stallThresholdSec;
  document.getElementById("skipAfterSec").value = data.skipAfterSec;
  document.getElementById("log").checked = data.log;
  document.getElementById("debug").checked = data.debug;
}

async function saveSettings() {
  const enabled = document.getElementById("enabled").checked;

  const intervalSec = Number(
    document.getElementById("intervalSec").value || defaults.intervalSec
  );

  const stallThresholdSec = Number(
    document.getElementById("stallThresholdSec").value || defaults.stallThresholdSec
  );

  let skipAfterSec = Number(
    document.getElementById("skipAfterSec").value || defaults.skipAfterSec
  );

  const log = document.getElementById("log").checked;
  const debug = document.getElementById("debug").checked;

  if (skipAfterSec < stallThresholdSec) {
    skipAfterSec = stallThresholdSec;
    document.getElementById("skipAfterSec").value = skipAfterSec;
  }

  await chrome.storage.sync.set({
    enabled,
    intervalSec,
    stallThresholdSec,
    skipAfterSec,
    log,
    debug
  });
}

document.getElementById("enabled").addEventListener("change", saveSettings);
document.getElementById("intervalSec").addEventListener("change", saveSettings);
document.getElementById("stallThresholdSec").addEventListener("change", saveSettings);
document.getElementById("skipAfterSec").addEventListener("change", saveSettings);
document.getElementById("log").addEventListener("change", saveSettings);
document.getElementById("debug").addEventListener("change", saveSettings);

loadSettings();