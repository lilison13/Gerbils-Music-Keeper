const defaults = {
  enabled: true,
  intervalSec: 5,
  skipAfterSec: 20
};

async function loadSettings() {
  const data = await chrome.storage.sync.get(defaults);
  document.getElementById("enabled").checked = data.enabled;
  document.getElementById("intervalSec").value = data.intervalSec;
  document.getElementById("skipAfterSec").value = data.skipAfterSec;
}

async function saveSettings() {
  const enabled = document.getElementById("enabled").checked;
  const intervalSec = Number(
    document.getElementById("intervalSec").value || defaults.intervalSec
  );
  const skipAfterSec = Number(
    document.getElementById("skipAfterSec").value || defaults.skipAfterSec
  );

  await chrome.storage.sync.set({
    enabled,
    intervalSec,
    skipAfterSec
  });
}

document.getElementById("enabled").addEventListener("change", saveSettings);
document.getElementById("intervalSec").addEventListener("change", saveSettings);
document.getElementById("skipAfterSec").addEventListener("change", saveSettings);

loadSettings();
