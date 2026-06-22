# Changelog

All notable changes to Perplexity TTS are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/); this project
follows [Semantic Versioning](https://semver.org/).

## [2.0.2] — 2026-06-22

### Fixed
- Blob object URLs are now revoked when a clip fails to play (`error` event), not
  only on `ended`. In streaming playback a failed clip previously leaked its
  object URL and audio element because `pump()` advanced to the next clip and
  overwrote the tracked URL before it could be revoked.
- The `chrome.storage.onChanged` listener now filters by storage area (`local`)
  and tolerates settings removal, avoiding spurious settings resets from
  unrelated storage-area changes.

## [2.0.1] — 2026-06-18

### Fixed
- Stream producer is now torn down when reading is stopped externally (e.g. from
  another tab or on navigation), preventing a detached stream from continuing to
  push audio after stop.

## [2.0.0] — 2026-05-31

Major release: multi-provider TTS, live streaming read-along, and a redesigned UI.

### Added
- **Multi-provider TTS**: OpenAI, OpenRouter, and ElevenLabs, each with its own
  API key (stored locally, one per provider) and per-provider Verify.
- **Editable Model / Voice fields** with suggestions — any model or voice id works,
  so all models offered by the providers are supported (including new ones).
  - OpenRouter verified models: `openai/gpt-4o-mini-tts`, `google/gemini-3.1-flash-tts-preview`,
    `hexgrad/kokoro-82m`, `canopylabs/orpheus-3b-0.1-ft`, `x-ai/grok-voice-tts-1.0`, `sesame/csm-1b`.
  - Per-model voice lists for OpenRouter (Gemini 30, Kokoro 28, Orpheus 7, Grok 7, OpenAI/Sesame 11).
  - ElevenLabs models and voices fetched live from your account (`/v1/models`, `/v1/voices`).
- **Live streaming read-along** (Read sentence by sentence): begins reading after the
  first sentence while Perplexity is still generating, via an incremental
  service-worker ↔ page port.
- **Auto-read**: optionally starts reading every new answer automatically (detected by
  text growth, so existing answers on load/navigation are not read).
- **Gemini PCM → WAV**: OpenRouter Gemini returns PCM only; it is wrapped into a WAV
  container so it plays in the browser.
- Enterprise UI redesign: neutral slate + indigo, automatic light/dark theme, focus
  states, refined typography; redesigned icon.
- Documentation: README, LICENSE (MIT), this changelog.

### Changed
- Entire UI and spoken text (incl. the voice-preview sample) are now in English.
- Audio is transferred to the page as base64 instead of a JSON byte array.
- Long answers (> ~4096 chars) are split automatically and played in sequence.
- Speed is applied via voice `instructions` on gpt-4o-mini-tts models (numeric `speed`
  is ignored by that model) and via the numeric parameter on `tts-1`/`tts-1-hd`.
- Key verification uses lightweight endpoints (no audio generation / no cost).
- Mutation scanning is throttled (not debounced) so it runs during continuous streaming.
- Citation cleanup also removes bare numeric superscripts and numeric links (DOM-level).

### Fixed
- Fallback button-injection path threw a `ReferenceError` (undefined `answerEl`).
- Second-play race: a redundant `stop` message could abort a freshly started stream.
- Streaming failures are surfaced instead of going silent.
- Per-tab abort so a stop in one tab can't cancel another tab's request.
- Auto-read now fires in both reading modes (a `waitForStable` guard collision
  previously blocked it in "Full response" mode).
- Streaming Port worker reports an error instead of hanging if configuration load fails.

### Security / privacy
- `tabs` permission dropped (only `storage`); host permissions limited to perplexity.ai
  and the provider API hosts.
- Answer text is sent only to the selected provider's endpoint; keys never synced.

## [1.0.0]

- Initial release: single-provider (OpenAI `gpt-4o-mini-tts`) read-aloud button on
  Perplexity answers with a settings page.
