'use strict';

// PROVIDERS / PROVIDER_ORDER provided by shared.js (loaded before this script).

let currentProvider = 'openai';

// ─── Key UI ───────────────────────────────────────────────────────────────────
function loadActiveProvider() {
  chrome.storage.local.get(null, (data) => {
    currentProvider = PROVIDER_ORDER.includes(data.activeProvider) ? data.activeProvider : 'openai';
    const apiKeys = data.apiKeys || {};
    let key = apiKeys[currentProvider] || '';
    if (!key && currentProvider === 'openai' && typeof data.apiKey === 'string') key = data.apiKey; // legacy

    const meta = PROVIDERS[currentProvider];
    document.getElementById('popupProvider').textContent = meta.label;
    const input = document.getElementById('popupApiKey');
    input.value = key;
    input.placeholder = meta.keyPlaceholder || 'API key';

    setKeyIndicator(!!key);
    setKeyStatusText(key ? '✓ Configured' : '', key ? 'ok' : '');
  });
}

function setKeyIndicator(hasKey) {
  const el = document.getElementById('keyIndicator');
  el.textContent = hasKey ? '●' : '○';
  el.className = 'key-indicator ' + (hasKey ? 'key-ok' : 'key-missing');
  el.title = hasKey ? 'API key configured' : 'API key missing';
}

function setKeyStatusText(msg, state) {
  const el = document.getElementById('popupKeyStatus');
  el.textContent = msg;
  el.className = 'key-status-text' + (state ? ` key-status-${state}` : '');
}

function saveApiKey() {
  const key = document.getElementById('popupApiKey').value.trim();
  chrome.storage.local.get(null, (data) => {
    const apiKeys = { ...(data.apiKeys || {}) };
    apiKeys[currentProvider] = key;
    chrome.storage.local.set({ apiKeys, activeProvider: currentProvider }, () => {
      setKeyIndicator(!!key);
      setKeyStatusText(key ? '✓ Saved' : 'Removed', key ? 'ok' : '');
      setTimeout(() => setKeyStatusText(key ? '✓ Configured' : '', key ? 'ok' : ''), 2000);
    });
  });
}

function verifyApiKey() {
  const key = document.getElementById('popupApiKey').value.trim();
  if (!key) { setKeyStatusText('Enter the key first', 'err'); return; }
  const btn = document.getElementById('popupVerifyKey');
  btn.disabled = true;
  btn.textContent = '…';
  setKeyStatusText('Verifying…', '');

  chrome.runtime.sendMessage({ action: 'verify_key', provider: currentProvider, apiKey: key }, (resp) => {
    btn.disabled = false;
    btn.textContent = 'Verify';
    if (resp?.ok) setKeyStatusText('✓ Valid!', 'ok');
    else setKeyStatusText(`✗ ${resp?.error || 'Error'}`, 'err');
  });
}

// ─── Playback Status ──────────────────────────────────────────────────────────
function updatePlaybackStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'get_playing_state' }, (resp) => {
      if (chrome.runtime.lastError) return;
      const el = document.getElementById('statusText');
      if (resp?.isPlaying) {
        el.textContent = 'Playing…';
        el.className = 'status-text status-text--playing';
      } else {
        el.textContent = 'No active playback';
        el.className = 'status-text';
      }
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadActiveProvider();
  updatePlaybackStatus();

  document.getElementById('popupToggleKey').addEventListener('click', () => {
    const input = document.getElementById('popupApiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('popupSaveKey').addEventListener('click', saveApiKey);
  document.getElementById('popupVerifyKey').addEventListener('click', verifyApiKey);

  document.getElementById('popupApiKey').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveApiKey();
  });

  document.getElementById('btnStop').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stop' });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stop_from_popup' }, () => {
          chrome.runtime.lastError;
          updatePlaybackStatus();
        });
      }
    });
  });

  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
