// Shared catalog + defaults used by the service worker, content script and
// options/popup pages. Declared with `var` so each becomes a global in both
// the worker scope (via importScripts) and the page/content-script world.

// ── Global, provider-agnostic settings ───────────────────────────────────────
var DEFAULT_SETTINGS = {
  speed: 1.0,
  instructions: '',
  responseFormat: 'mp3',      // applies fully to OpenAI; other providers map/override
  streamingMode: 'complete',
  autoRead: false,            // auto-start reading each new answer (no click)
  cleanCitations: true,
  skipCodeBlocks: true,
  skipRelated: true,
  cleanMarkdown: true,
};

// ── OpenAI voice set (shared by OpenAI + OpenRouter openai-family models) ─────
var OPENAI_VOICES = [
  { id: 'alloy',   desc: 'Neutro, bilanciato' },
  { id: 'ash',     desc: 'Caldo, conversazionale' },
  { id: 'ballad',  desc: 'Melodioso, espressivo' },
  { id: 'coral',   desc: 'Luminoso, amichevole' },
  { id: 'echo',    desc: 'Pulito, preciso' },
  { id: 'fable',   desc: 'Narrativo, coinvolgente' },
  { id: 'nova',    desc: 'Moderno, nitido' },
  { id: 'onyx',    desc: 'Profondo, autorevole' },
  { id: 'sage',    desc: 'Calmo, riflessivo' },
  { id: 'shimmer', desc: 'Leggero, vivace' },
  { id: 'verse',   desc: 'Versatile, espressivo' },
];
var OPENAI_VOICE_IDS = OPENAI_VOICES.map((v) => v.id);

// Per-model voice namespaces for OpenRouter providers (verified working).
var GEMINI_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];
var KOKORO_VOICES = ['af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'];
var ORPHEUS_VOICES = ['tara', 'leah', 'jess', 'leo', 'dan', 'mia', 'zac'];
var GROK_VOICES = ['Eve', 'Rex', 'Gork', 'Ara', 'Sal', 'Leo', 'Una'];

// Map an OpenRouter model id to its voice set (by family substring).
function openrouterVoicesFor(modelId) {
  const m = (modelId || '').toLowerCase();
  if (m.includes('gemini')) return GEMINI_VOICES;
  if (m.includes('kokoro')) return KOKORO_VOICES;
  if (m.includes('orpheus')) return ORPHEUS_VOICES;
  if (m.includes('grok')) return GROK_VOICES;
  return OPENAI_VOICE_IDS; // openai, sesame, and unknown → OpenAI voice names
}

// ── Provider catalog ──────────────────────────────────────────────────────────
// Each model lists its own voices (voices can be model-dependent).
// ElevenLabs voices are fetched dynamically (dynamicVoices: true).
var PROVIDERS = {
  openai: {
    label: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keyHint: 'OpenAI key (platform.openai.com).',
    models: [
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts (instructions)', voices: OPENAI_VOICE_IDS },
      { id: 'tts-1',           label: 'tts-1 (fast)',                   voices: OPENAI_VOICE_IDS },
      { id: 'tts-1-hd',        label: 'tts-1-hd (high quality)',        voices: OPENAI_VOICE_IDS },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    keyPlaceholder: 'sk-or-...',
    keyHint: 'OpenRouter key (openrouter.ai/keys). Routes TTS models from several providers.',
    models: [
      { id: 'openai/gpt-4o-mini-tts-2025-12-15',   label: 'OpenAI gpt-4o-mini-tts' },
      { id: 'google/gemini-3.1-flash-tts-preview', label: 'Google Gemini Flash TTS' },
      { id: 'hexgrad/kokoro-82m',                   label: 'Kokoro 82M' },
      { id: 'canopylabs/orpheus-3b-0.1-ft',         label: 'Orpheus 3B' },
      { id: 'x-ai/grok-voice-tts-1.0',              label: 'xAI Grok Voice' },
      { id: 'sesame/csm-1b',                        label: 'Sesame CSM-1b' },
    ],
  },
  elevenlabs: {
    label: 'ElevenLabs',
    keyPlaceholder: 'xi-api-key',
    keyHint: 'ElevenLabs key (elevenlabs.io → Profile → API key).',
    dynamicVoices: true,
    models: [
      { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
      { id: 'eleven_flash_v2_5',      label: 'Flash v2.5 (fast)' },
      { id: 'eleven_turbo_v2_5',      label: 'Turbo v2.5' },
      { id: 'eleven_v3',              label: 'v3' },
    ],
  },
};

var PROVIDER_ORDER = ['openai', 'openrouter', 'elevenlabs'];

// ── Default per-provider configuration ────────────────────────────────────────
var DEFAULT_PROVIDER_CONFIG = {
  openai:     { model: 'gpt-4o-mini-tts', voice: 'nova' },
  openrouter: { model: 'openai/gpt-4o-mini-tts-2025-12-15', voice: 'nova' },
  elevenlabs: { model: 'eleven_multilingual_v2', voiceId: '' },
};
