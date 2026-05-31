# Privacy Policy — Perplexity TTS

_Last updated: 2026-05-31_

Perplexity TTS ("the extension") is a Chrome extension that reads Perplexity.ai
answers aloud using a text-to-speech (TTS) provider that you configure with your
own API key. This policy explains exactly what data the extension handles.

## Summary

- The extension does **not** have its own servers and does **not** collect,
  store, or transmit your data to the developer.
- It contains **no** analytics, tracking, advertising, or telemetry.
- Your data stays between your browser and the TTS provider **you** choose.

## What data is processed

**1. Answer text (to generate audio).**
When you click "Listen" (or when auto-read is enabled), the text of the
Perplexity answer is sent to the text-to-speech provider you selected
(OpenAI, OpenRouter, or ElevenLabs) so it can return the spoken audio. The text
is sent directly from your browser to that provider's API over HTTPS. It is used
only to produce the audio and is not sent anywhere else.

**2. API keys (stored locally).**
The API key you enter for a provider is stored in `chrome.storage.local`, which
keeps it on your own device. Keys are used only to authenticate your requests to
that provider. They are never synced to other devices and never transmitted to
the developer or any third party other than the provider the key belongs to.

**3. Settings (stored locally).**
Your preferences (selected provider, model, voice, reading mode, speed,
auto-read) are stored locally in `chrome.storage.local` on your device.

## What data is NOT collected

- No personal information is collected by the developer.
- No browsing history, page content, or activity is logged or sent to the
  developer.
- No cookies, fingerprinting, analytics, or advertising identifiers are used.

## Third-party providers

When you use a provider, the answer text is processed under that provider's own
privacy policy and terms:

- OpenAI — https://openai.com/policies/privacy-policy
- OpenRouter — https://openrouter.ai/privacy
- ElevenLabs — https://elevenlabs.io/privacy

You are responsible for your account and API usage with the provider you choose.

## Permissions

- `storage` — to save your settings and API keys locally on your device.
- Host access to `www.perplexity.ai` — to add the Listen button and read the
  answer text on the page.
- Host access to `api.openai.com`, `openrouter.ai`, `api.elevenlabs.io` — to send
  the answer text to the TTS provider you selected and receive the audio.

## Data retention and deletion

The extension stores data only in your browser's local storage. To delete it,
remove your keys/settings in the extension, clear the extension's storage, or
uninstall the extension. Data sent to a provider is retained according to that
provider's policy, not by this extension.

## Children

The extension is not directed to children and does not knowingly process
children's data.

## Changes

This policy may be updated; the "Last updated" date above reflects the latest
version. Material changes will be noted in the repository.

## Contact

Questions: contact@sena-labs.dev
