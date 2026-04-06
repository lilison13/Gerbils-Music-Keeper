const defaults = {
  enabled: true,
  intervalSec: 5,
  skipAfterSec: 20,
  debug: false
};

async function loadSettings() {
  const data = await chrome.storage.sync.get(defaults);
  document.getElementById("enabled").checked = data.enabled;
  document.getElementById("intervalSec").value = data.intervalSec;
  document.getElementById("skipAfterSec").value = data.skipAfterSec;
  document.getElementById("debug").checked = data.debug;
}

async function saveSettings() {
  const enabled = document.getElementById("enabled").checked;
  const intervalSec = Number(
    document.getElementById("intervalSec").value || defaults.intervalSec
  );
  const skipAfterSec = Number(
    document.getElementById("skipAfterSec").value || defaults.skipAfterSec
  );
  const debug = document.getElementById("debug").checked;

  await chrome.storage.sync.set({
    enabled,
    intervalSec,
    skipAfterSec,
    debug
  });
}

document.getElementById("enabled").addEventListener("change", saveSettings);
document.getElementById("intervalSec").addEventListener("change", saveSettings);
document.getElementById("skipAfterSec").addEventListener("change", saveSettings);
document.getElementById("debug").addEventListener("change", saveSettings);

loadSettings();
