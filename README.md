# Perplexity TTS

Chrome extension (Manifest V3) that reads [perplexity.ai](https://www.perplexity.ai)
answers aloud with **multi-provider** TTS. It injects a **▶ Listen** button into every
answer's action bar and streams the audio sentence by sentence, so it starts reading
almost immediately.

## Supported providers

| Provider | Models | Voices | Notes |
| --- | --- | --- | --- |
| **OpenAI** | `gpt-4o-mini-tts`, `tts-1`, `tts-1-hd` | 11 (alloy, nova, onyx, …) | `instructions` + full audio-format choice |
| **OpenRouter** | any model id — verified: `openai/gpt-4o-mini-tts`, `google/gemini-3.1-flash-tts-preview`, `hexgrad/kokoro-82m`, `canopylabs/orpheus-3b-0.1-ft`, `x-ai/grok-voice-tts-1.0`, `sesame/csm-1b` | complete per-model lists, verified via API: Gemini 30, Kokoro 28, Orpheus 7, Grok 7, OpenAI/Sesame 11 | MP3; Gemini → PCM auto-wrapped to WAV |
| **ElevenLabs** | **all** account TTS models (⟳ Models → `GET /v1/models`); the legacy v1 models are deprecated | loaded from your account (⟳ My voices → `GET /v1/voices`) or a `voice_id` | MP3 output |

The **Model** and **Voice** fields are editable: pick a suggestion or type any id, so every
model/voice offered by the providers is supported (including new ones).

> Voice retrieval: ElevenLabs exposes a `/v1/voices` endpoint → loaded **live**. OpenRouter
> does **not** expose a voices list via API and OpenAI has no voices endpoint — for those the
> voices shown per model are the complete sets verified directly against the TTS API.
>
> Azure and AWS Polly are not included: they require SigV4 signing / regional endpoints,
> which aren't suitable for a browser extension.

## Installation (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the folder that contains `manifest.json` (the folder, not a file)

## Configuration

1. Click the extension icon → **⚙ All settings**
2. Pick a **Provider**, paste that provider's **API Key**, and click **Verify**
3. Choose **Model** and **Voice** (for ElevenLabs: **My voices** or paste a `voice_id`)
4. **Save settings**

Where to get keys: OpenAI → platform.openai.com · OpenRouter → openrouter.ai/keys ·
ElevenLabs → elevenlabs.io (Profile → API key).

## Features

- **Low-latency streaming** — audio starts after the first sentence while the rest is
  generated in the background (long-lived service-worker ↔ page port).
- **Two reading modes** — *Full response* (larger, more coherent chunks) or
  *Read sentence by sentence* (live read-along: starts after the first sentence while
  Perplexity is still generating).
- **Auto-read** (optional) — automatically starts reading every new answer (no click).
  The browser allows audio once you've interacted with the page (e.g. typed a query).
- **Text cleanup** — removes citations (`[1]`, superscripts, numeric links), code blocks,
  markdown, and the "Related questions" section.
- **Speed** — applied via `instructions` on gpt-4o-mini-tts models (which ignore the numeric
  parameter) and via the numeric parameter on `tts-1`/`tts-1-hd`.
- **Mini-player** with a progress bar and stop; stop also available from the popup.
- **Separate keys per provider**, stored locally.

## Privacy

The answer text is sent **only** to the selected provider's endpoint to generate the audio.
API keys are stored in `chrome.storage.local` (local to the browser), one per provider —
never synced or sent to third parties.

## Permissions

- `storage` — saves settings and keys.
- hosts: `www.perplexity.ai` (content script), `api.openai.com`, `openrouter.ai`,
  `api.elevenlabs.io` (TTS calls from the service worker).

## Known limits

- `gpt-4o-mini-tts` ignores the numeric `speed` parameter → speed is approximate
  (applied as an instruction to the model).
- Per-call input is capped at ~4096 characters → long answers are split automatically
  and played back in sequence.
- ElevenLabs voice_ids and provider models/voices can change provider-side.

## Structure

```text
manifest.json     Manifest V3
shared.js         provider/model/voice catalog + defaults (SW + pages)
background.js     service worker: per-provider adapters, key verification, port streaming
content.js        button injection, text extraction/cleanup, streaming playback
options.*         full settings page
popup.*           quick popup: active provider + key
icons/            16/32/48/128
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Current version: **2.0.0**.

## License

[MIT](LICENSE) © sena-labs.
