'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = __dirname;
const fileUrl = (p) => 'file:///' + path.resolve(p).replace(/\\/g, '/');

// Prefilled fake storage so the real UI renders in a "configured" state.
const STORAGE = {
  activeProvider: 'openai',
  apiKeys: { openai: 'sk-proj-************************', openrouter: '', elevenlabs: '' },
  providers: {
    openai: { model: 'gpt-4o-mini-tts', voice: 'nova' },
    openrouter: { model: 'google/gemini-3.1-flash-tts-preview', voice: 'Zephyr' },
    elevenlabs: { model: 'eleven_multilingual_v2', voiceId: '' },
  },
  readingMode: 'stream',
  streamingMode: true,
  autoRead: true,
  speed: 1,
};

const CHROME_STUB = (storage) => {
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => { if (cb) setTimeout(() => cb({ ok: true }), 0); },
      connect: () => ({ postMessage() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} }),
      getURL: (p) => p,
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        _d: JSON.parse(JSON.stringify(storage)),
        get(keys, cb) {
          const d = this._d;
          if (typeof keys === 'function') { keys(JSON.parse(JSON.stringify(d))); return; }
          if (keys === null || keys === undefined) { cb(JSON.parse(JSON.stringify(d))); return; }
          const out = {};
          const arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
          for (const k of arr) out[k] = (k in d) ? d[k] : (typeof keys === 'object' && !Array.isArray(keys) ? keys[k] : undefined);
          cb(out);
        },
        set(obj, cb) { Object.assign(this._d, obj); if (cb) cb(); },
        remove(k, cb) { (Array.isArray(k) ? k : [k]).forEach((x) => delete this._d[x]); if (cb) cb(); },
      },
    },
  };
};

async function shoot(ctx, url, file, w, h) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log('  ✓', file, `${w}x${h}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  await ctx.addInitScript(CHROME_STUB, STORAGE);

  console.log('Screenshots:');
  await shoot(ctx, fileUrl(path.join(ROOT, 'options.html')), 'screenshot-1-options-1280x800.png', 1280, 800);
  await shoot(ctx, fileUrl(path.join(OUT, '_popup-frame.html')), 'screenshot-2-popup-1280x800.png', 1280, 800);

  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
