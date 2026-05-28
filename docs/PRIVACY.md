# Distill — Privacy Policy

_Last updated: 2026-05-27_

Distill is a Chrome extension that helps you read long articles with AI-assisted
summaries, comprehension check-ins, highlight analysis, and reading-time tools.

**Distill has no backend of its own in the default configuration.** It runs entirely
in your browser using an AI API key that **you** provide. We (the developers of
Distill) do not operate a server that receives your data in this mode, and we do not
collect, store, sell, or share your personal information.

## TL;DR

- Your AI API key is stored **only on your device** (Chrome local storage). It is never transmitted to us.
- When you ask for a summary/explanation/analysis, the relevant article text is sent **directly from your browser to your chosen AI provider** (Google Gemini or Anthropic), using your key. It does not pass through any Distill server.
- We do not run analytics, ad trackers, or telemetry.
- You can remove your key and all local data at any time.

## What data Distill handles

### 1. Your AI API key
- **Stored:** in `chrome.storage.local` on your computer only.
- **Used for:** authenticating requests you initiate to your AI provider.
- **Never:** sent to the Distill developers or any third party other than the AI provider the key belongs to.

### 2. Article and page content
- When you trigger an AI action (summary, "explain page", highlight analysis, comprehension check-in), the relevant text from the page you are reading is sent over HTTPS **directly to your selected AI provider** so it can generate a response.
- This content is processed by that provider under **their** privacy policy and terms (see "Third-party providers" below).
- Distill does not retain a server-side copy. Locally, Distill may cache recent summaries/analysis in `chrome.storage.local` so you can resume reading; this stays on your device and can be cleared.

### 3. Reading state and preferences
- Reading progress, per-site preferences (font size, theme), accent color, and similar settings are stored locally in `chrome.storage.local` to make the extension work across sessions. This never leaves your device.

## Third-party AI providers

Depending on the provider you choose in Settings, your article text and prompts are sent to:

- **Google Gemini (Generative Language API)** — see Google's privacy policy and the [Gemini API terms](https://ai.google.dev/gemini-api/terms). **Important:** content submitted on Google's **free tier** may be used by Google to improve its products. If you are reading sensitive material, use a paid key or choose a provider/plan that excludes your data from training.
- **Anthropic Claude** — see [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy). Anthropic does not train on API inputs/outputs by default.

You are sending data to these providers under your own account and key. Your relationship with them is governed by their terms, not ours.

## Optional self-hosted / "Distill cloud" backend (advanced, off by default)

Distill includes an optional advanced mode that routes AI requests through a
self-hosted or shared backend instead of your own key. **This is disabled by
default.** If *you* (or an operator you trust) enable it and point it at a server:

- A pseudonymous install id and a session token are sent to that backend for rate limiting and usage accounting.
- Article text for the requested task is sent to that backend, which forwards it to an AI provider using the operator's key.

Distill, as published, does not enable this mode and does not designate any default
server that the developers operate for end users. If you enable it, the privacy terms
of whoever runs that server apply. See `backend/README.md` for operator details.

## What we do **not** do

- We do not sell or rent your data.
- We do not use your data for advertising.
- We do not include third-party analytics or tracking SDKs.
- We do not collect your browsing history.

## Permissions, briefly

- **Host access to web pages** — so the reader can detect and process the article on the page you are actively reading.
- **`storage`** — to save your key, preferences, and reading progress locally.
- **`activeTab` / `scripting`** — to read the current article's text when you ask for AI help.
- **`tabs`** — to know which page the side panel is showing and apply per-site settings.
- **`sidePanel`** — to show the reader UI.
- **`alarms`** — to flush a local offline queue periodically.

See `docs/STORE_LISTING.md` for the full per-permission justification.

## Removing your data

- **Remove your key:** Settings → AI key → "Remove".
- **Clear everything:** remove the extension, or clear its storage from `chrome://extensions` → Distill → "Remove" (or use your browser's site/extension data controls).

## Children

Distill is not directed to children under 13 and does not knowingly collect data from them.

## Changes

If this policy changes materially, the "Last updated" date above will change and the
new version will ship with the extension and in this repository.

## Contact

Questions about privacy? Contact: **rahilsheth05@gmail.com**

> Maintainer note: host the companion `privacy.html` at a public URL (e.g. GitHub
> Pages) and use that URL as the Chrome Web Store "Privacy policy URL".
