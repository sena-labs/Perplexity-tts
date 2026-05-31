# Chrome Web Store — listing copy

## Short description (≤132 chars — matches manifest)
Reads Perplexity.ai answers aloud with multi-provider TTS (OpenAI, OpenRouter, ElevenLabs). Listen button on every answer.

## Category
**Productivity** (primary). Also relevant: Accessibility.

## Detailed description
Listen to Perplexity.ai answers instead of reading them. Perplexity TTS adds a "Listen" button to every answer and reads it aloud using your own text-to-speech provider.

Key features
• Multi-provider — OpenAI, OpenRouter, and ElevenLabs, each with its own API key (stored locally, one per provider).
• Any model, any voice — editable Model and Voice fields with suggestions, so every model the providers offer works (including new ones). ElevenLabs models and voices are loaded live from your account.
• Low-latency streaming — audio starts after the first sentence while the rest is still being generated.
• Live read-along — optionally reads each new answer automatically, sentence by sentence, while Perplexity is still writing.
• Clean speech — strips citations, code blocks, markdown, and the "Related questions" section before reading.
• Adjustable speed, mini-player with progress bar, and a one-click stop.

Privacy
The answer text is sent only to the text-to-speech provider you choose, to generate the audio. Your API keys are stored locally in your browser (chrome.storage.local), one per provider — never synced and never sent to anyone else.

You need your own API key from OpenAI, OpenRouter, or ElevenLabs. Usage is billed by that provider, not by this extension.

## Permission justifications
• storage — saves your settings and API keys locally.
• host: www.perplexity.ai — inject the Listen button and read the answer text (content script).
• hosts: api.openai.com, openrouter.ai, api.elevenlabs.io — send the answer text to the selected TTS provider to generate audio (service worker).

## Asset files (this folder)
| Field | File | Size |
| --- | --- | --- |
| Store icon | store-icon-128x128.png | 128×128 |
| Screenshot 1 | screenshot-1-options-1280x800.png | 1280×800 |
| Screenshot 2 | screenshot-2-popup-1280x800.png | 1280×800 |
| Small promo tile | promo-small-440x280.png | 440×280 |
| Marquee promo tile | promo-marquee-1400x560.png | 1400×560 |

## Privacy policy
Required (extension handles API keys + sends text to third parties). Host a page (e.g. on sena-labs.dev) and paste its URL in the dashboard.
