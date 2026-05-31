'use strict';

// PROVIDERS, PROVIDER_ORDER, OPENAI_VOICES, DEFAULT_SETTINGS, DEFAULT_PROVIDER_CONFIG
// are provided by shared.js (loaded before this script).

const state = {
  activeProvider: 'openai',
  apiKeys: {},        // provider -> key
  providers: {},      // provider -> { model, voice } | { model, voiceId }
  elevenVoices: [],   // cached [{ id, name }]
  elevenModels: [],   // cached [{ id, label }]
  settings: {},       // global settings
};

const $ = (id) => document.getElementById(id);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const voiceLabel = (id) => { const ov = OPENAI_VOICES.find((v) => v.id === id); return ov ? `${cap(id)} — ${ov.desc}` : cap(id); };

function fillSelect(sel, items, selectedValue) {
  sel.innerHTML = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.value; o.textContent = it.label;
    if (it.value === selectedValue) o.selected = true;
    sel.appendChild(o);
  }
}

function fillDatalist(listEl, items) {
  listEl.innerHTML = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.value;
    if (it.label && it.label !== it.value) o.label = it.label;
    listEl.appendChild(o);
  }
}

// ── Storage → state (with legacy migration) ───────────────────────────────────
function buildStateFromStorage(data) {
  const apiKeys = { ...(data.apiKeys || {}) };
  if (!apiKeys.openai && typeof data.apiKey === 'string' && data.apiKey) apiKeys.openai = data.apiKey;

  const providers = {};
  for (const p of PROVIDER_ORDER) {
    providers[p] = { ...DEFAULT_PROVIDER_CONFIG[p], ...((data.providers || {})[p] || {}) };
  }
  if (data.settings && data.settings.voice && !(data.providers && data.providers.openai)) {
    providers.openai.voice = data.settings.voice;
  }

  state.apiKeys = apiKeys;
  state.providers = providers;
  state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  state.activeProvider = PROVIDER_ORDER.includes(data.activeProvider) ? data.activeProvider : 'openai';
  state.elevenVoices = providers.elevenlabs.voicesCache || [];
  state.elevenModels = providers.elevenlabs.modelsCache || [];
}

// ── Suggestions ────────────────────────────────────────────────────────────────
function modelSuggestions(p) {
  if (p === 'elevenlabs' && state.elevenModels.length) {
    return state.elevenModels.map((m) => ({ value: m.id, label: m.label }));
  }
  return PROVIDERS[p].models.map((m) => ({ value: m.id, label: m.label }));
}

function voiceSuggestions(p) {
  if (p === 'elevenlabs') {
    return state.elevenVoices.map((v) => ({ value: v.id, label: `${v.name} (${v.id.slice(0, 8)}…)` }));
  }
  if (p === 'openrouter') {
    return openrouterVoicesFor($('model').value).map((id) => ({ value: id, label: id }));
  }
  return OPENAI_VOICES.map((v) => ({ value: v.id, label: voiceLabel(v.id) }));
}

const MODEL_HINTS = {
  openai: '3 OpenAI models. Editable.',
  openrouter: 'Any OpenRouter model id (e.g. openai/gpt-4o-mini-tts). Voices depend on the model — type the correct one.',
  elevenlabs: 'Use ⟳ Models to load all TTS models in your account.',
};

// ── Render the active provider's fields ───────────────────────────────────────
function renderProvider() {
  const p = state.activeProvider;
  const meta = PROVIDERS[p];
  const cfg = state.providers[p];

  $('apiKey').value = state.apiKeys[p] || '';
  $('apiKey').placeholder = meta.keyPlaceholder || 'API key';
  $('keyHint').textContent = meta.keyHint || '';
  $('keyStatus').textContent = '';
  $('keyStatus').className = 'hint';

  fillDatalist($('modelList'), modelSuggestions(p));
  $('model').value = cfg.model || '';
  $('modelHint').textContent = MODEL_HINTS[p] || '';

  fillDatalist($('voiceList'), voiceSuggestions(p));
  $('voice').value = meta.dynamicVoices ? (cfg.voiceId || '') : (cfg.voice || '');
  $('voice').placeholder = meta.dynamicVoices ? 'voice_id (⟳ My voices) or paste' : 'pick from the list ▾ or type a voice';

  $('elevenVoiceRow').style.display = meta.dynamicVoices ? 'block' : 'none';
  $('voiceStatus').textContent = '';
}

// Capture current form values into state for the active provider.
function captureForm() {
  const p = state.activeProvider;
  state.apiKeys[p] = $('apiKey').value.trim();
  const model = $('model').value.trim() || DEFAULT_PROVIDER_CONFIG[p].model;
  if (PROVIDERS[p].dynamicVoices) {
    state.providers[p] = { model, voiceId: $('voice').value.trim(), voicesCache: state.elevenVoices, modelsCache: state.elevenModels };
  } else {
    state.providers[p] = { model, voice: $('voice').value.trim() || DEFAULT_PROVIDER_CONFIG[p].voice };
  }
}

// ── Global settings UI ─────────────────────────────────────────────────────────
function loadGlobalSettings() {
  const s = state.settings;
  $('speed').value = s.speed;
  $('speedValue').textContent = `${parseFloat(s.speed).toFixed(2)}×`;
  $('instructions').value = s.instructions || '';
  $('instrCount').textContent = (s.instructions || '').length;
  $('cleanCitations').checked = s.cleanCitations;
  $('skipCodeBlocks').checked = s.skipCodeBlocks;
  $('skipRelated').checked = s.skipRelated;
  $('cleanMarkdown').checked = s.cleanMarkdown;
  $('autoRead').checked = s.autoRead;
  const fmt = document.querySelector(`input[name="format"][value="${s.responseFormat}"]`);
  if (fmt) fmt.checked = true;
  const stream = document.querySelector(`input[name="streaming"][value="${s.streamingMode}"]`);
  if (stream) stream.checked = true;
}

function gatherGlobalSettings() {
  return {
    speed: parseFloat($('speed').value),
    instructions: $('instructions').value.trim(),
    responseFormat: document.querySelector('input[name="format"]:checked')?.value || 'mp3',
    streamingMode: document.querySelector('input[name="streaming"]:checked')?.value || 'complete',
    cleanCitations: $('cleanCitations').checked,
    skipCodeBlocks: $('skipCodeBlocks').checked,
    skipRelated: $('skipRelated').checked,
    cleanMarkdown: $('cleanMarkdown').checked,
    autoRead: $('autoRead').checked,
  };
}

// ── Load / Save ────────────────────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.local.get(null, (data) => {
    buildStateFromStorage(data);
    fillSelect($('provider'), PROVIDER_ORDER.map((p) => ({ value: p, label: PROVIDERS[p].label })), state.activeProvider);
    renderProvider();
    loadGlobalSettings();
  });
}

function saveSettings() {
  captureForm();
  state.settings = gatherGlobalSettings();
  chrome.storage.local.remove('apiKey'); // drop legacy single-key field
  chrome.storage.local.set({
    activeProvider: state.activeProvider,
    apiKeys: state.apiKeys,
    providers: state.providers,
    settings: state.settings,
  }, () => {
    const el = $('saveStatus');
    el.textContent = '✓ Saved';
    el.className = 'hint hint--success';
    setTimeout(() => { el.textContent = ''; el.className = 'hint'; }, 2500);
  });
}

// ── Key verification ─────────────────────────────────────────────────────────
function setKeyStatus(msg, kind) {
  const el = $('keyStatus');
  el.textContent = msg;
  el.className = 'hint' + (kind ? ` hint--${kind}` : '');
}

function verifyKey() {
  const key = $('apiKey').value.trim();
  if (!key) { setKeyStatus('Enter the API key first.', 'error'); return; }
  const btn = $('verifyKey');
  btn.disabled = true; btn.textContent = '…';
  chrome.runtime.sendMessage({ action: 'verify_key', provider: state.activeProvider, apiKey: key }, (resp) => {
    btn.disabled = false; btn.textContent = 'Verify';
    if (chrome.runtime.lastError) { setKeyStatus(`✗ ${chrome.runtime.lastError.message}`, 'error'); return; }
    if (resp?.ok) setKeyStatus('✓ Valid API key!', 'success');
    else setKeyStatus(`✗ ${resp?.error || 'invalid response'}`, 'error');
  });
}

// ── ElevenLabs: fetch voices / models into the datalists ──────────────────────
function setVoiceStatus(msg, kind) {
  const el = $('voiceStatus');
  el.textContent = msg;
  el.className = 'hint' + (kind ? ` hint--${kind}` : '');
}

function fetchVoices() {
  const key = $('apiKey').value.trim();
  if (!key) { setVoiceStatus('Enter the API key first.', 'error'); return; }
  const btn = $('fetchVoices');
  btn.disabled = true; const prev = btn.textContent; btn.textContent = '⏳';
  chrome.runtime.sendMessage({ action: 'fetch_voices', apiKey: key }, (resp) => {
    btn.disabled = false; btn.textContent = prev;
    if (chrome.runtime.lastError) { setVoiceStatus(chrome.runtime.lastError.message, 'error'); return; }
    if (resp?.error) { setVoiceStatus(`Error: ${resp.error}`, 'error'); return; }
    state.elevenVoices = resp.voices || [];
    fillDatalist($('voiceList'), voiceSuggestions('elevenlabs'));
    setVoiceStatus(`✓ ${state.elevenVoices.length} voices loaded`, 'success');
  });
}

function fetchModels() {
  const key = $('apiKey').value.trim();
  if (!key) { setVoiceStatus('Enter the API key first.', 'error'); return; }
  const btn = $('fetchModels');
  btn.disabled = true; const prev = btn.textContent; btn.textContent = '⏳';
  chrome.runtime.sendMessage({ action: 'fetch_models', provider: state.activeProvider, apiKey: key }, (resp) => {
    btn.disabled = false; btn.textContent = prev;
    if (chrome.runtime.lastError) { setVoiceStatus(chrome.runtime.lastError.message, 'error'); return; }
    if (resp?.error) { setVoiceStatus(`Error: ${resp.error}`, 'error'); return; }
    state.elevenModels = resp.models || [];
    fillDatalist($('modelList'), modelSuggestions('elevenlabs'));
    setVoiceStatus(`✓ ${state.elevenModels.length} models loaded`, 'success');
  });
}

// ── Preview ───────────────────────────────────────────────────────────────────
function playBase64(b64, mime) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }));
  const audio = new Audio(url);
  audio.addEventListener('ended', () => URL.revokeObjectURL(url));
  audio.play().catch(() => {});
}

function previewVoice() {
  captureForm();
  const p = state.activeProvider;
  const cfg = state.providers[p];
  const status = $('previewStatus');
  const btn = $('previewVoice');
  const messageCfg = PROVIDERS[p].dynamicVoices
    ? { provider: p, key: state.apiKeys[p], model: cfg.model, voiceId: cfg.voiceId }
    : { provider: p, key: state.apiKeys[p], model: cfg.model, voice: cfg.voice };

  btn.disabled = true; btn.textContent = '⏳ Loading…'; status.textContent = '';
  chrome.runtime.sendMessage({ action: 'preview_voice', cfg: messageCfg }, (resp) => {
    btn.disabled = false; btn.textContent = '▶ Preview voice';
    if (chrome.runtime.lastError) { status.textContent = chrome.runtime.lastError.message; status.className = 'hint hint--error'; return; }
    if (resp?.error) { status.textContent = `Error: ${resp.error}`; status.className = 'hint hint--error'; return; }
    if (resp?.audio) {
      playBase64(resp.audio, resp.mime);
      status.textContent = 'Playing…';
      status.className = 'hint hint--success';
    }
  });
}

// ── Event wiring ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  $('provider').addEventListener('change', (e) => {
    captureForm();
    state.activeProvider = e.target.value;
    renderProvider();
  });

  $('model').addEventListener('input', () => {
    if (state.activeProvider === 'openrouter') fillDatalist($('voiceList'), voiceSuggestions('openrouter'));
  });

  $('speed').addEventListener('input', (e) => { $('speedValue').textContent = `${parseFloat(e.target.value).toFixed(2)}×`; });
  $('instructions').addEventListener('input', (e) => { $('instrCount').textContent = e.target.value.length; });
  $('toggleKey').addEventListener('click', () => { const i = $('apiKey'); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('verifyKey').addEventListener('click', verifyKey);
  $('fetchVoices').addEventListener('click', fetchVoices);
  $('fetchModels').addEventListener('click', fetchModels);
  $('previewVoice').addEventListener('click', previewVoice);
  $('saveBtn').addEventListener('click', saveSettings);
});
