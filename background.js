'use strict';

importScripts('shared.js');

// tabId -> AbortController (per-tab so a stop in one tab can't cancel another).
const abortControllers = new Map();

function abortTab(tabId) {
  if (tabId == null) {
    for (const c of abortControllers.values()) c.abort();
    abortControllers.clear();
    return;
  }
  const c = abortControllers.get(tabId);
  if (c) { c.abort(); abortControllers.delete(tabId); }
}

// Encode an ArrayBuffer as base64 — cheaper over the message port than a JSON
// number array (one number per byte).
function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const FORMAT_MIME = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/wav',
};

const OPENAI_COMPAT_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/audio/speech',
  openrouter: 'https://openrouter.ai/api/v1/audio/speech',
};

// ── Settings / config ─────────────────────────────────────────────────────────
function storageGetAll() {
  return new Promise((resolve) => chrome.storage.local.get(null, resolve));
}

// Normalize stored data into a config, migrating the legacy single-key schema.
function buildConfig(data) {
  const apiKeys = { ...(data.apiKeys || {}) };
  if (!apiKeys.openai && typeof data.apiKey === 'string' && data.apiKey) {
    apiKeys.openai = data.apiKey; // legacy single OpenAI key
  }

  const providers = {};
  for (const p of PROVIDER_ORDER) {
    providers[p] = { ...DEFAULT_PROVIDER_CONFIG[p], ...((data.providers || {})[p] || {}) };
  }
  if (data.settings && data.settings.voice && !(data.providers && data.providers.openai)) {
    providers.openai.voice = data.settings.voice; // legacy OpenAI voice
  }

  const globals = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const provider = PROVIDER_ORDER.includes(data.activeProvider) ? data.activeProvider : 'openai';
  return { provider, apiKeys, providers, globals };
}

async function getActiveConfig() {
  const cfg = buildConfig(await storageGetAll());
  return { provider: cfg.provider, key: cfg.apiKeys[cfg.provider] || '', pcfg: cfg.providers[cfg.provider], globals: cfg.globals };
}

// ── Request builder (one per provider family) ─────────────────────────────────
function buildRequest(provider, text, pcfg, key, globals) {
  if (provider === 'elevenlabs') {
    const voiceId = (pcfg.voiceId || '').trim();
    if (!voiceId) throw new Error('No ElevenLabs voice selected. Load your voices or enter a voice_id.');
    return {
      url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: pcfg.model || 'eleven_multilingual_v2' }),
      mime: 'audio/mpeg',
    };
  }

  // OpenAI-compatible: openai, openrouter
  const body = { model: pcfg.model, input: text, voice: pcfg.voice };
  let mime;
  let pcm = false;
  if (provider === 'openrouter') {
    if (/gemini/i.test(pcfg.model || '')) {
      // Gemini TTS on OpenRouter only supports PCM; wrap it into WAV after fetch.
      body.response_format = 'pcm';
      mime = 'audio/wav';
      pcm = true;
    } else {
      body.response_format = 'mp3';
      mime = 'audio/mpeg';
    }
  } else {
    body.response_format = globals.responseFormat || 'mp3';
    mime = FORMAT_MIME[body.response_format] || 'audio/mpeg';
  }

  // Instructions / speed only for gpt-4o-mini-tts family (others ignore them).
  const supportsInstructions =
    (provider === 'openai' && pcfg.model === 'gpt-4o-mini-tts') ||
    (provider === 'openrouter' && /gpt-4o-mini-tts/.test(pcfg.model || ''));
  if (supportsInstructions) {
    let instructions = (globals.instructions || '').trim();
    const speed = Number(globals.speed);
    if (speed && speed !== 1.0) {
      const x = speed.toFixed(2).replace(/\.?0+$/, '');
      const pace = speed > 1
        ? `Read faster, at about ${x}× normal speed.`
        : `Read slower, at about ${x}× normal speed.`;
      instructions = instructions ? `${instructions} ${pace}` : pace;
    }
    if (instructions) body.instructions = instructions;
  } else if (provider === 'openai' && (pcfg.model === 'tts-1' || pcfg.model === 'tts-1-hd')) {
    const speed = Number(globals.speed);
    if (speed && speed !== 1.0) body.speed = speed;
  }

  return {
    url: OPENAI_COMPAT_ENDPOINTS[provider],
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    mime,
    pcm,
  };
}

async function parseError(response) {
  const t = await response.text().catch(() => '');
  let msg = `HTTP ${response.status}`;
  try {
    const j = JSON.parse(t);
    msg = j.error?.message || j.detail?.message || (typeof j.detail === 'string' ? j.detail : null) || j.message || msg;
  } catch (_) {
    if (t) msg = t.slice(0, 200);
  }
  return msg;
}

// Wrap raw 16-bit PCM into a WAV container so the browser can play it
// (some providers, e.g. Gemini TTS via OpenRouter, only return PCM).
function pcmToWav(pcm, sampleRate, channels) {
  const dataLen = pcm.byteLength;
  const blockAlign = channels * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  let o = 0;
  const w = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
  w('RIFF'); dv.setUint32(o, 36 + dataLen, true); o += 4; w('WAVE');
  w('fmt '); dv.setUint32(o, 16, true); o += 4; dv.setUint16(o, 1, true); o += 2;
  dv.setUint16(o, channels, true); o += 2; dv.setUint32(o, sampleRate, true); o += 4;
  dv.setUint32(o, sampleRate * blockAlign, true); o += 4; dv.setUint16(o, blockAlign, true); o += 2; dv.setUint16(o, 16, true); o += 2;
  w('data'); dv.setUint32(o, dataLen, true); o += 4;
  new Uint8Array(buf, 44).set(new Uint8Array(pcm));
  return buf;
}

async function finishResponse(response, req) {
  const buffer = await response.arrayBuffer();
  if (!req.pcm) return { buffer, mime: req.mime };
  const ct = response.headers.get('content-type') || '';
  const rate = parseInt((ct.match(/rate=(\d+)/) || [])[1], 10) || 24000;
  const channels = parseInt((ct.match(/channels=(\d+)/) || [])[1], 10) || 1;
  return { buffer: pcmToWav(buffer, rate, channels), mime: 'audio/wav' };
}

async function fetchTTS(text, ctx, tabId) {
  const req = buildRequest(ctx.provider, text, ctx.pcfg, ctx.key, ctx.globals);
  const controller = new AbortController();
  if (tabId != null) abortControllers.set(tabId, controller);
  try {
    const response = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: controller.signal });
    if (!response.ok) throw new Error(await parseError(response));
    return await finishResponse(response, req);
  } finally {
    if (tabId != null && abortControllers.get(tabId) === controller) abortControllers.delete(tabId);
  }
}

// Fetch one chunk using a caller-supplied AbortController (used by the
// streaming Port so a single stop aborts the whole stream).
async function fetchWithController(text, ctx, controller) {
  const req = buildRequest(ctx.provider, text, ctx.pcfg, ctx.key, ctx.globals);
  const response = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: controller.signal });
  if (!response.ok) throw new Error(await parseError(response));
  return await finishResponse(response, req);
}

function noKeyError(provider) {
  return `No API key set for ${PROVIDERS[provider].label}. Open the settings.`;
}

// ── Message handlers ──────────────────────────────────────────────────────────
async function handleVerifyKey(provider, key, sendResponse) {
  const reqs = {
    openai:     { url: 'https://api.openai.com/v1/models', headers: { 'Authorization': `Bearer ${key}` } },
    openrouter: { url: 'https://openrouter.ai/api/v1/key', headers: { 'Authorization': `Bearer ${key}` } },
    elevenlabs: { url: 'https://api.elevenlabs.io/v1/user', headers: { 'xi-api-key': key } },
  };
  const r = reqs[provider];
  if (!r) { sendResponse({ error: 'Unknown provider.' }); return; }
  try {
    const response = await fetch(r.url, { headers: r.headers });
    if (response.ok) sendResponse({ ok: true });
    else sendResponse({ error: await parseError(response) });
  } catch (e) {
    sendResponse({ error: e.message });
  }
}

async function handleFetchModels(provider, key, sendResponse) {
  try {
    if (provider === 'elevenlabs') {
      const response = await fetch('https://api.elevenlabs.io/v1/models', { headers: { 'xi-api-key': key } });
      if (!response.ok) { sendResponse({ error: await parseError(response) }); return; }
      const data = await response.json();
      const list = Array.isArray(data) ? data : (data.models || []);
      const models = list.filter((m) => m.can_do_text_to_speech).map((m) => ({ id: m.model_id, label: m.name || m.model_id }));
      sendResponse({ models });
      return;
    }
    sendResponse({ error: 'Model loading not supported for this provider.' });
  } catch (e) {
    sendResponse({ error: e.message });
  }
}

async function handleFetchVoices(key, sendResponse) {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    if (!response.ok) { sendResponse({ error: await parseError(response) }); return; }
    const data = await response.json();
    sendResponse({ voices: (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name })) });
  } catch (e) {
    sendResponse({ error: e.message });
  }
}

async function handlePreviewVoice(cfg, sendResponse) {
  try {
    if (!cfg || !cfg.key) { sendResponse({ error: 'Enter the API key first.' }); return; }
    const pcfg = cfg.provider === 'elevenlabs'
      ? { model: cfg.model, voiceId: cfg.voiceId }
      : { model: cfg.model, voice: cfg.voice };
    const ctx = { provider: cfg.provider, key: cfg.key, pcfg, globals: { ...DEFAULT_SETTINGS } };
    const { buffer, mime } = await fetchTTS('Hi! This is the selected voice for Perplexity TTS.', ctx, null);
    sendResponse({ audio: bufToBase64(buffer), mime });
  } catch (e) {
    sendResponse({ error: e.message });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? null;
  switch (message.action) {
    case 'stop':
      abortTab(tabId);
      sendResponse({ ok: true });
      return false;
    case 'verify_key':
      handleVerifyKey(message.provider, message.apiKey, sendResponse);
      return true;
    case 'fetch_voices':
      handleFetchVoices(message.apiKey, sendResponse);
      return true;
    case 'fetch_models':
      handleFetchModels(message.provider, message.apiKey, sendResponse);
      return true;
    case 'preview_voice':
      handlePreviewVoice(message.cfg, sendResponse);
      return true;
    case 'get_status':
      getActiveConfig().then((ctx) =>
        sendResponse({ provider: ctx.provider, providerLabel: PROVIDERS[ctx.provider].label, hasKey: !!ctx.key }));
      return true;
    default:
      return false;
  }
});

// ── Streaming Port ────────────────────────────────────────────────────────────
// Incremental: the page pushes sentences (`tts_chunk`) as they're produced — for
// stream mode, as soon as Perplexity finishes each sentence — and the worker
// fetches them in order, posting audio the moment it's ready. `speak_stream`
// enqueues a whole batch at once (complete mode). `tts_end` signals no more input.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'tts') return;
  const tabId = port.sender?.tab?.id ?? null;
  const controller = new AbortController();
  if (tabId != null) abortControllers.set(tabId, controller);

  const queue = [];
  let aborted = false, ended = false, working = false, finished = false;
  let produced = 0, lastError = null, ctx = null;

  const cleanup = () => { if (tabId != null && abortControllers.get(tabId) === controller) abortControllers.delete(tabId); };
  const safePost = (m) => { try { port.postMessage(m); } catch (_) {} };
  const finishOnce = (m) => { if (!finished) { finished = true; safePost(m); cleanup(); } };

  async function worker() {
    if (working || finished) return;
    working = true;
    try {
      if (!ctx) ctx = await getActiveConfig();
      if (!ctx.key) { aborted = true; finishOnce({ error: noKeyError(ctx.provider) }); return; }
      while (!aborted && !finished) {
        if (queue.length === 0) {
          if (ended) finishOnce(produced ? { done: true } : { error: lastError || 'No audio generated.' });
          return;
        }
        const text = queue.shift();
        try {
          const r = await fetchWithController(text, ctx, controller);
          if (aborted) return;
          produced++;
          safePost({ audio: bufToBase64(r.buffer), mime: r.mime });
        } catch (e) {
          if (e.name === 'AbortError' || aborted) return;
          lastError = e.message; // skip and continue
        }
      }
    } catch (e) {
      if (!aborted) finishOnce({ error: e.message }); // e.g. getActiveConfig failed
    } finally {
      working = false;
    }
  }

  port.onDisconnect.addListener(() => { aborted = true; controller.abort(); cleanup(); });

  port.onMessage.addListener((msg) => {
    if (!msg || aborted) return;
    switch (msg.action) {
      case 'stop': aborted = true; controller.abort(); cleanup(); return;
      case 'tts_chunk': if (msg.text && msg.text.trim()) queue.push(msg.text.trim()); worker(); return;
      case 'tts_end': ended = true; worker(); return;
      case 'speak_stream':
        for (const s of (msg.sentences || [])) if (s && s.trim()) queue.push(s.trim());
        ended = true; worker(); return;
    }
  });
});
