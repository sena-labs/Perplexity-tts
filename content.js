'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  currentAudio: null,
  currentObjectURL: null,
  currentPort: null,
  isPlaying: false,
  activeButton: null,
  settings: null,
};

let autoplayWarned = false;

// ─── Settings ─────────────────────────────────────────────────────────────────
// DEFAULT_SETTINGS is provided by shared.js (injected before this script).

function loadSettings() {
  chrome.storage.local.get({ settings: DEFAULT_SETTINGS }, (data) => {
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    state.settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  }
});

// ─── Text Cleaning ────────────────────────────────────────────────────────────
function cleanText(raw, settings) {
  let text = raw;

  if (settings.skipRelated) {
    // Cut at "Related / Sources / Fonti / Domande correlate" sections
    const idx = text.search(/\n(domande correlate|related|altre domande|people also ask|sources|fonti)\b/gi);
    if (idx > 0) text = text.slice(0, idx);
  }

  if (settings.skipCodeBlocks) {
    text = text.replace(/```[\s\S]*?```/g, ' code block ');
    text = text.replace(/`[^`\n]+`/g, ' code ');
  }

  if (settings.cleanCitations) {
    text = text.replace(/\[\d+(?:[\s,]+\d+)*\]/g, '');           // [1] [1,2] [1 2 3]
    text = text.replace(/[¹²³⁰-⁹]+/g, ''); // superscript digits ¹²³⁴…
  }

  if (settings.cleanMarkdown) {
    text = text.replace(/#{1,6}\s+/g, '');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    text = text.replace(/\*([^*\n]+)\*/g, '$1');
    text = text.replace(/__([^_\n]+)__/g, '$1');
    text = text.replace(/_([^_\n]+)_/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/^[-*+]\s+/gm, '');
    text = text.replace(/^\d+\.\s+/gm, '');
    text = text.replace(/^>\s*/gm, '');
  }

  // Collapse whitespace, keep single newlines as pauses
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/[ \t]+([.,;:!?])/g, '$1'); // drop space left before punctuation (e.g. after citation removal)
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  return text;
}

function splitIntoSentences(text) {
  // Split on sentence-ending punctuation followed by space/newline
  const parts = text.match(/[^.!?\n]+[.!?]*[\n]?/g) || [text];
  return parts.map((s) => s.trim()).filter((s) => s.length > 3);
}

// Provider input cap for /audio/speech is 4096 chars — stay safely under.
const MAX_TTS_CHARS = 4000;

// ─── Audio Playback ───────────────────────────────────────────────────────────
function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (typeof data === 'string') return base64ToBuffer(data);
  return new Uint8Array(data).buffer;
}

function stopCurrentAudio() {
  if (state.currentPort) {
    try { state.currentPort.disconnect(); } catch (_) {}
    state.currentPort = null;
  }
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.src = '';
    state.currentAudio = null;
  }
  if (state.currentObjectURL) {
    URL.revokeObjectURL(state.currentObjectURL);
    state.currentObjectURL = null;
  }
  state.isPlaying = false;

  if (state.activeButton) {
    setButtonState(state.activeButton, 'idle');
    state.activeButton = null;
  }

  hideMiniPlayer();
}

function playArrayBuffer(buffer, mimeType, onEnded) {
  const blob = new Blob([toArrayBuffer(buffer)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  state.currentObjectURL = url;

  const audio = new Audio(url);
  state.currentAudio = audio;

  audio.addEventListener('ended', () => {
    URL.revokeObjectURL(url);
    if (state.currentObjectURL === url) state.currentObjectURL = null;
    if (state.currentAudio === audio) state.currentAudio = null;
    if (onEnded) onEnded();
  });

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      updateMiniPlayerProgress(audio.currentTime / audio.duration);
    }
  });

  audio.play().catch((e) => {
    console.error('[PTTS] play error:', e);
    if (e && e.name === 'NotAllowedError' && !autoplayWarned) {
      autoplayWarned = true;
      showError('Auto-read blocked by the browser. Click the page (or the ▶ button) once to enable it.');
    }
  });
  return audio;
}

// Stream chunks over a Port: play each chunk as soon as it arrives while the
// service worker prefetches the next one — minimizes time-to-first-audio.
// Open a streaming port and play audio chunks as they arrive. `startProducer(port)`
// begins sending text to the service worker and may return a cleanup function
// (e.g. to stop a live sentence feeder) that runs when playback ends.
function playStreamed(button, fallbackMime, startProducer) {
  const port = chrome.runtime.connect({ name: 'tts' });
  state.currentPort = port;

  const queue = [];
  let done = false;
  let started = false;
  let busy = false;
  let finished = false;
  let producerCleanup = null;

  function finish() {
    if (finished) return;
    finished = true;
    if (typeof producerCleanup === 'function') { try { producerCleanup(); } catch (_) {} }
    try { port.disconnect(); } catch (_) {}
    if (state.currentPort === port) state.currentPort = null;
    if (state.activeButton === button) { setButtonState(button, 'idle'); state.activeButton = null; }
    state.isPlaying = false;
    hideMiniPlayer();
  }

  function pump() {
    if (busy || finished) return;
    if (!state.isPlaying || state.currentPort !== port) return;
    const next = queue.shift();
    if (!next) { if (done) finish(); return; }
    if (!started) { started = true; setButtonState(button, 'playing'); }
    busy = true;
    // Guard: a single clip must advance the queue only once, even if both
    // 'ended' and 'error' fire for it — otherwise pump() could skip/overlap.
    let settled = false;
    const advance = () => { if (settled) return; settled = true; busy = false; pump(); };
    const audio = playArrayBuffer(next.audio, next.mime || fallbackMime, advance);
    audio.addEventListener('error', advance, { once: true });
  }

  port.onMessage.addListener((msg) => {
    if (state.currentPort !== port) return;
    if (msg.error) { showError(msg.error); finish(); return; }
    if (msg.aborted) { finish(); return; }
    if (msg.audio) { queue.push({ audio: msg.audio, mime: msg.mime }); pump(); return; }
    if (msg.done) { done = true; pump(); }
  });

  producerCleanup = startProducer(port);
}

// Live "read-along" feeder for stream mode: watches the answer while it is being
// generated and posts each completed sentence to the service worker as soon as
// it's ready — so reading starts after the first sentence, not the whole answer.
function startSentenceFeeder(answerEl, port) {
  const settings = state.settings || DEFAULT_SETTINGS;
  let emitted = 0;
  let endedSent = false;
  let stableTimer = null;

  function currentSentences() {
    return splitIntoSentences(cleanText(extractText(answerEl, settings.cleanCitations), settings));
  }
  function flush(upTo) {
    const sentences = currentSentences();
    const limit = Math.min(upTo, sentences.length);
    for (let i = emitted; i < limit; i++) {
      try { port.postMessage({ action: 'tts_chunk', text: sentences[i] }); } catch (_) {}
    }
    if (limit > emitted) emitted = limit;
  }
  // Send every sentence except the last (still in progress); hold the tail back.
  function feed() { flush(Math.max(0, currentSentences().length - 1)); }
  function finalize() {
    if (endedSent) return;
    flush(currentSentences().length); // flush the final sentence(s)
    endedSent = true;
    try { port.postMessage({ action: 'tts_end' }); } catch (_) {}
  }

  const observer = new MutationObserver(() => {
    feed();
    clearTimeout(stableTimer);
    stableTimer = setTimeout(finalize, 1000); // ~1s without growth → generation finished
  });
  observer.observe(answerEl, { childList: true, subtree: true, characterData: true });

  feed(); // initial pass (answer may already be partly/fully generated)
  stableTimer = setTimeout(finalize, 1000);
  const hardTimer = setTimeout(finalize, 90000);

  return function cleanup() {
    observer.disconnect();
    clearTimeout(stableTimer);
    clearTimeout(hardTimer);
  };
}

// Build playback chunks. Stream mode → one chunk per sentence (fastest start).
// Complete mode → a small first chunk (fast start) then larger ~600-char
// coherent chunks. All chunks stay under the provider input cap.
function buildPlaybackChunks(text, mode) {
  const sentences = splitIntoSentences(text);
  const hardSplit = (s, out) => { for (let i = 0; i < s.length; i += MAX_TTS_CHARS) out.push(s.slice(i, i + MAX_TTS_CHARS)); };

  if (mode === 'stream') {
    const out = [];
    for (const s of sentences) { if (s.length > MAX_TTS_CHARS) hardSplit(s, out); else out.push(s); }
    return out.length ? out : [text.slice(0, MAX_TTS_CHARS)];
  }

  if (sentences.length === 0) return [text.slice(0, MAX_TTS_CHARS)];
  const chunks = [];
  let first = '';
  let idx = 0;
  while (idx < sentences.length && (`${first} ${sentences[idx]}`).trim().length <= 160) {
    first = first ? `${first} ${sentences[idx]}` : sentences[idx];
    idx++;
    if (first.length >= 60) break;
  }
  if (!first) { first = sentences[0].slice(0, MAX_TTS_CHARS); idx = 1; }
  chunks.push(first);

  const GROUP = 600;
  let cur = '';
  for (; idx < sentences.length; idx++) {
    const s = sentences[idx];
    if (s.length > MAX_TTS_CHARS) { if (cur) { chunks.push(cur); cur = ''; } hardSplit(s, chunks); continue; }
    if ((`${cur} ${s}`).trim().length > GROUP) { if (cur) chunks.push(cur); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ─── Text Extraction (safe clone — strips injected UI + media) ────────────────
function extractText(el, stripCitations) {
  const clone = el.cloneNode(true);

  clone.querySelectorAll(
    '.ptts-play-btn, .ptts-btn-wrapper, .ptts-icon, .ptts-label, #ptts-mini-player, .ptts-toast'
  ).forEach((n) => n.remove());

  clone.querySelectorAll('img, svg, figure, picture, canvas, video, audio, [role="img"]').forEach((n) => n.remove());

  if (stripCitations) {
    // Perplexity renders citations as bare/bracketed numeric superscripts or
    // numeric links — strip them at the DOM level (textContent loses brackets).
    clone.querySelectorAll('sup, a').forEach((n) => {
      const t = (n.textContent || '').replace(/\s+/g, '');
      if (/^\[?\d{1,3}\]?$/.test(t)) n.remove();
    });
    clone.querySelectorAll('[class*="citation" i], [class*="cite" i], [class*="footnote" i], [data-citation]').forEach((n) => n.remove());
  }

  // Use prose descendants when available — avoids pulling in action-bar button text
  // Use textContent (not innerText) since clone is detached and has no layout context
  const proseEls = clone.querySelectorAll('[class*="prose"]');
  if (proseEls.length > 0) {
    return Array.from(proseEls)
      .map((p) => (p.textContent || '').trim())
      .filter((t) => t.length > 0)
      .join('\n\n')
      .trim();
  }

  return (clone.textContent || '').trim();
}

// ─── MIME type helper ─────────────────────────────────────────────────────────
function getMimeType(format) {
  const map = {
    mp3: 'audio/mpeg',
    opus: 'audio/ogg; codecs=opus',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wav: 'audio/wav',
  };
  return map[format] || 'audio/mpeg';
}

// ─── Button State ─────────────────────────────────────────────────────────────
function setButtonState(btn, state_) {
  btn.dataset.state = state_;
  const icon = btn.querySelector('.ptts-icon');
  if (!icon) return;
  switch (state_) {
    case 'loading':
      icon.textContent = '⏳';
      btn.title = 'Loading audio…';
      btn.disabled = true;
      break;
    case 'playing':
      icon.textContent = '⏸';
      btn.title = 'Pause / Stop';
      btn.disabled = false;
      break;
    default:
      icon.textContent = '▶';
      btn.title = 'Read answer';
      btn.disabled = false;
  }
}

// ─── Handle Play Click ────────────────────────────────────────────────────────
async function handlePlayClick(btn, answerEl) {
  // Toggle: if this button is playing → stop.
  // stopCurrentAudio() disconnects the port; the service worker aborts the
  // stream on disconnect, so no separate 'stop' message is needed (sending one
  // would race the next connect and abort the freshly-started stream).
  if (state.activeButton === btn && state.isPlaying) {
    stopCurrentAudio();
    return;
  }

  // Stop any other active audio first
  if (state.isPlaying) {
    stopCurrentAudio();
  }

  const settings = state.settings || DEFAULT_SETTINGS;
  const rawText = extractText(answerEl, settings.cleanCitations);
  const cleanedText = cleanText(rawText, settings);

  if (!cleanedText) {
    showError('No text to read in this answer.');
    return;
  }

  setButtonState(btn, 'loading');
  state.activeButton = btn;
  state.isPlaying = true;
  showMiniPlayer();

  const fallbackMime = getMimeType(settings.responseFormat);
  if (settings.streamingMode === 'stream') {
    // Live read-along: read each sentence as Perplexity finishes generating it.
    playStreamed(btn, fallbackMime, (port) => startSentenceFeeder(answerEl, port));
  } else {
    const chunks = buildPlaybackChunks(cleanedText, 'complete');
    playStreamed(btn, fallbackMime, (port) => {
      port.postMessage({ action: 'speak_stream', sentences: chunks });
      return null;
    });
  }
}

// ─── Create Play Button ───────────────────────────────────────────────────────
// textEl = element used for text extraction (block or prose, NOT contentEl)
function createPlayButton(textEl) {
  const btn = document.createElement('button');
  btn.className = 'ptts-play-btn';
  btn.dataset.state = 'idle';
  btn.title = 'Read answer';
  btn.setAttribute('aria-label', 'Read answer with TTS');

  const icon = document.createElement('span');
  icon.className = 'ptts-icon';
  icon.textContent = '▶';
  btn.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'ptts-label';
  label.textContent = 'Listen';
  btn.appendChild(label);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handlePlayClick(btn, textEl);
  });

  return btn;
}

// ─── Perplexity DOM Detection ─────────────────────────────────────────────────
// Confirmed DOM structure (May 2026):
//   div[class*="gap-y-sm"][class*="flex-col"]   ← answer block
//   ├── div                                      ← answer content (text extraction target)
//   │   └── div[class*="prose"][class*="prose-invert"]  ← actual rendered text
//   ├── div[class*="flex"][class*="justify-between"]    ← action bar (inject here)
//   └── div[class*="mt-md"]                     ← follow-up questions

function findAnswerBlocks() {
  const blocks = [];
  const seenBlocks = new Set();

  // Primary: prose-invert is the confirmed selector for Perplexity answer text
  document.querySelectorAll('[class*="prose"][class*="prose-invert"]').forEach((prose) => {
    if ((prose.textContent || '').length < 40) return;

    // Walk up to find the gap-y-sm container block (depth varies — keep generous)
    let block = prose.parentElement;
    for (let i = 0; i < 12; i++) {
      if (!block || block.tagName === 'MAIN' || block.tagName === 'BODY') return;
      if (block.className?.includes('gap-y-sm')) {
        if (!seenBlocks.has(block)) {
          seenBlocks.add(block);
          // child[0] = answer content div, child[1] = action bar
          const contentEl = block.children[0] || prose;
          blocks.push({ block, contentEl, prose });
        }
        return;
      }
      block = block.parentElement;
    }
  });

  // Fallback: any substantial prose container when primary not found
  if (blocks.length === 0) {
    document.querySelectorAll('[class*="prose"]').forEach((prose) => {
      if ((prose.textContent || '').length > 100 && !seenBlocks.has(prose)) {
        seenBlocks.add(prose);
        blocks.push({ block: null, contentEl: prose, prose });
      }
    });
  }

  return blocks;
}

function findActionBar(answerContentEl) {
  // answerContentEl is child[0] of the gap-y-sm block; action bar is a sibling
  const block = answerContentEl.parentElement;
  if (!block) return null;

  for (const child of block.children) {
    if (child === answerContentEl) continue;
    if (
      child.className?.includes('flex') &&
      (child.className?.includes('justify-between') || child.className?.includes('items-center')) &&
      child.querySelector('button') &&
      !child.dataset.pttsInjected
    ) {
      return child;
    }
  }

  // Fallback: walk 2 levels up looking for sibling button groups
  let cursor = block.parentElement;
  for (let i = 0; i < 2; i++) {
    if (!cursor || cursor.tagName === 'MAIN') break;
    for (const child of cursor.children) {
      if (!child.contains(answerContentEl) && child.querySelector('button') && !child.dataset.pttsInjected) {
        return child;
      }
    }
    cursor = cursor.parentElement;
  }
  return null;
}

// contentEl = tracking element (receives data-ptts-injected, used to find action bar)
// textEl    = text extraction source (block or prose — the full answer container)
function injectButton(contentEl, textEl) {
  if (contentEl.dataset.pttsInjected) return null;

  const text = extractText(textEl || contentEl);
  if (text.length < 50) return null;
  // Mark injected only after passing the length gate, so a still-streaming
  // short answer isn't marked-and-skipped forever once it grows.
  contentEl.dataset.pttsInjected = 'true';

  const btn = createPlayButton(textEl || contentEl);
  const actionBar = findActionBar(contentEl);

  if (actionBar) {
    actionBar.dataset.pttsInjected = 'true';
    actionBar.insertBefore(btn, actionBar.firstChild);
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'ptts-btn-wrapper';
    wrapper.appendChild(btn);
    (textEl || contentEl).insertAdjacentElement('beforebegin', wrapper);
  }
  return btn;
}

// Auto-read answers that are actively being generated. "Generating" is detected
// by text GROWTH across scans (a streaming answer grows; a pre-existing/static one
// doesn't) — so it works regardless of any spinner markup, and answers loaded on
// page open or SPA navigation (which appear already complete) are never auto-read.
const btnByContent = new WeakMap();
const autoReadTrack = new WeakMap();

function fireAutoRead(contentEl, textEl) {
  if (!document.contains(contentEl)) return; // answer removed (e.g. SPA navigation)
  const btn = btnByContent.get(contentEl) || injectButton(contentEl, textEl);
  if (!btn) return;
  btnByContent.set(contentEl, btn);
  if (state.activeButton !== btn) handlePlayClick(btn, textEl);
}

function trackAutoRead(contentEl, textEl, len) {
  const settings = state.settings || DEFAULT_SETTINGS;
  if (!settings.autoRead) return;
  let rec = autoReadTrack.get(contentEl);
  if (!rec) { autoReadTrack.set(contentEl, { base: len, max: len, fired: false }); return; }
  if (rec.fired) return;
  if (len > rec.max) rec.max = len;
  if (rec.max < rec.base + 24) return; // hasn't grown yet → not (yet) generating

  rec.fired = true;
  if (settings.streamingMode === 'stream') {
    fireAutoRead(contentEl, textEl); // live read-along handles ongoing growth
  } else {
    // Complete mode: wait until the text stops growing, then read the full answer.
    // Uses an independent timer — NOT waitForStable, whose single-pending guard is
    // already held by the button-injection path for this same element.
    let last = -1;
    const tick = () => {
      const cur = (textEl.textContent || '').length;
      if (cur === last) fireAutoRead(contentEl, textEl);
      else { last = cur; setTimeout(tick, 900); }
    };
    setTimeout(tick, 900);
  }
}

// ─── Response Complete Detection ──────────────────────────────────────────────
const pendingElements = new WeakMap();

function waitForStable(el, onStable) {
  if (pendingElements.has(el)) return;
  pendingElements.set(el, true);

  let lastText = el.innerText || '';
  let stableTimer = null;

  const tryStable = () => {
    const current = el.innerText || '';
    if (current === lastText && current.length > 50) {
      // Text hasn't changed — response is complete
      observer.disconnect();
      pendingElements.delete(el);
      onStable(el);
    } else {
      lastText = current;
    }
  };

  const observer = new MutationObserver(() => {
    clearTimeout(stableTimer);
    stableTimer = setTimeout(tryStable, 900);
  });

  observer.observe(el, { childList: true, subtree: true, characterData: true });

  // Hard timeout: inject after 12s regardless
  setTimeout(() => {
    clearTimeout(stableTimer);
    observer.disconnect();
    pendingElements.delete(el);
    onStable(el);
  }, 12000);
}

// ─── Mini Player ──────────────────────────────────────────────────────────────
let miniPlayer = null;

function showMiniPlayer() {
  if (miniPlayer) {
    miniPlayer.style.display = 'flex';
    return;
  }

  miniPlayer = document.createElement('div');
  miniPlayer.id = 'ptts-mini-player';
  miniPlayer.innerHTML = `
    <div class="ptts-player-inner">
      <span class="ptts-player-label">▶ TTS</span>
      <div class="ptts-player-progress-wrap">
        <div class="ptts-player-progress-bar">
          <div class="ptts-player-progress-fill" id="ptts-progress-fill"></div>
        </div>
      </div>
      <button class="ptts-ctrl-btn" id="ptts-ctrl-stop" title="Stop">⏹</button>
    </div>
  `;

  document.body.appendChild(miniPlayer);

  miniPlayer.querySelector('#ptts-ctrl-stop').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stop' });
    stopCurrentAudio();
  });
}

function hideMiniPlayer() {
  if (miniPlayer) miniPlayer.style.display = 'none';
}

function updateMiniPlayerProgress(fraction) {
  const fill = document.getElementById('ptts-progress-fill');
  if (fill) fill.style.width = `${Math.min(1, fraction) * 100}%`;
}

// ─── Error Toast ──────────────────────────────────────────────────────────────
function showError(message) {
  const existing = document.querySelector('.ptts-toast-error');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'ptts-toast ptts-toast-error';
  toast.setAttribute('role', 'alert');
  toast.textContent = `Perplexity TTS: ${message}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─── Scan & Inject ────────────────────────────────────────────────────────────
function scanAndInject() {
  const streamMode = (state.settings || DEFAULT_SETTINGS).streamingMode === 'stream';
  for (const { block, contentEl, prose } of findAnswerBlocks()) {
    // textEl = the widest available container for text extraction
    const textEl = block || prose;
    const len = (textEl.textContent || '').length;

    if (!contentEl.dataset.pttsInjected && len >= 50) {
      const hasSpinner = contentEl.querySelector(
        '[class*="loading"], [class*="spinner"], [class*="skeleton"], [class*="pulse"], [class*="shimmer"]'
      );
      // Stream mode injects the button immediately (so the user can start a live
      // read-along); complete mode waits until the answer is stable (full text).
      if (hasSpinner && !streamMode) {
        waitForStable(contentEl, () => { const b = injectButton(contentEl, textEl); if (b) btnByContent.set(contentEl, b); });
      } else {
        const b = injectButton(contentEl, textEl);
        if (b) btnByContent.set(contentEl, b);
      }
    }

    // Auto-read tracking runs for every block (even already-injected ones) so
    // growth during streaming is observed.
    trackAutoRead(contentEl, textEl, len);
  }
}

// ─── Single MutationObserver (handles both DOM changes + SPA nav) ─────────────
// Throttled (not debounced) so scanAndInject runs *during* continuous streaming —
// otherwise it would only fire once generation pauses, defeating live read-along
// and growth-based auto-read.
let lastScan = 0;
let scanTimer = null;
let lastHref = location.href;
const SCAN_INTERVAL = 500;

function scheduleScan() {
  const since = Date.now() - lastScan;
  if (since >= SCAN_INTERVAL) {
    lastScan = Date.now();
    scanAndInject();
  } else {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { lastScan = Date.now(); scanAndInject(); }, SCAN_INTERVAL - since);
  }
}

const domObserver = new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    stopCurrentAudio();
  }
  scheduleScan();
});

domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

// ─── Message Handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'stop_from_popup') {
    chrome.runtime.sendMessage({ action: 'stop' });
    stopCurrentAudio();
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === 'get_playing_state') {
    sendResponse({ isPlaying: state.isPlaying });
    return true;
  }
  return false;
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadSettings();
// Delay first scan slightly to let React hydrate
setTimeout(scanAndInject, 800);
