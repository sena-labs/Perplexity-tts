'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = __dirname;

// Glyph: rounded indigo tile + white play triangle + sound waves (matches extension icon).
const glyph = (size) => `
  <g transform="translate(${size * 0.16},${size * 0.16})">
    <rect width="${size * 0.68}" height="${size * 0.68}" rx="${size * 0.16}" fill="#fff" opacity="0.96"/>
    <path d="M ${size*0.30} ${size*0.24} L ${size*0.30} ${size*0.44} L ${size*0.46} ${size*0.34} Z" fill="#4f46e5"/>
    <g stroke="#4f46e5" stroke-width="${size*0.026}" stroke-linecap="round" fill="none" opacity="0.9">
      <path d="M ${size*0.50} ${size*0.30} q ${size*0.05} ${size*0.04} 0 ${size*0.08}"/>
      <path d="M ${size*0.55} ${size*0.27} q ${size*0.09} ${size*0.07} 0 ${size*0.14}"/>
    </g>
  </g>`;

function tile(w, h, opts) {
  const g = Math.round(h * (opts.glyph || 0.62));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4338ca"/>
        <stop offset="0.55" stop-color="#4f46e5"/>
        <stop offset="1" stop-color="#6366f1"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
    <circle cx="${w*0.9}" cy="${h*0.12}" r="${h*0.5}" fill="#fff" opacity="0.05"/>
    <circle cx="${w*0.05}" cy="${h*0.95}" r="${h*0.45}" fill="#fff" opacity="0.05"/>
    <g transform="translate(${opts.gx},${(h-g)/2})">${glyph(g)}</g>
    <g font-family="Inter,Segoe UI,system-ui,sans-serif" fill="#fff">
      <text x="${opts.tx}" y="${opts.ty}" font-size="${opts.title}" font-weight="800" letter-spacing="-0.5">Perplexity TTS</text>
      <text x="${opts.tx}" y="${opts.ty + opts.gap}" font-size="${opts.sub}" font-weight="500" opacity="0.92">${opts.subtitle}</text>
      ${opts.sub2 ? `<text x="${opts.tx}" y="${opts.ty + opts.gap + opts.gap2}" font-size="${opts.sub3size||opts.sub*0.8}" font-weight="400" opacity="0.78">${opts.sub2}</text>` : ''}
    </g>
  </svg>`;
}

const SMALL = tile(440, 280, {
  glyph: 0.5, gx: 28, tx: 168, ty: 128, gap: 34, title: 30,
  subtitle: 'Read answers aloud', sub: 19,
  sub2: 'OpenAI · OpenRouter · ElevenLabs', gap2: 30, sub3size: 15,
});

const MARQUEE = tile(1400, 560, {
  glyph: 0.46, gx: 120, tx: 470, ty: 250, gap: 70, title: 76,
  subtitle: 'Listen to Perplexity answers — multi-provider TTS', sub: 36,
  sub2: 'OpenAI · OpenRouter · ElevenLabs   •   live streaming read-along', gap2: 56, sub3size: 27,
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [name, svg, w, h] of [
    ['promo-small-440x280.png', SMALL, 440, 280],
    ['promo-marquee-1400x560.png', MARQUEE, 1400, 560],
  ]) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<style>html,body{margin:0}</style>${svg}`);
    await page.screenshot({ path: path.join(OUT, name) });
    await page.close();
    console.log('  ✓', name, `${w}x${h}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
