# Chrome Web Store listing & review pack

Everything needed to submit Distill to the Chrome Web Store, plus the per-permission
justifications reviewers ask for. The extension ships as **bring-your-own-key (BYOK)**:
each user supplies a free AI key, AI runs browser → provider, and there is no
developer-operated backend in the default build.

## Pre-submission checklist

- [ ] Replace `<CONTACT_EMAIL>` in `docs/PRIVACY.md` and `docs/privacy.html` with a real address.
- [ ] Host `docs/privacy.html` at a public URL (e.g. GitHub Pages) → use as the **Privacy policy URL**.
- [ ] Confirm `extension/manifest.json` `version` is bumped (currently `2.0.0`) and matches `CHANGELOG.md`.
- [ ] Zip the **contents of `extension/`** (so `manifest.json` is at the zip root) — do **not** zip the repo root.
  - `cd extension && zip -r ../distill-<version>.zip . -x '*.DS_Store'`
- [ ] Verify icons are PNG (16/32/48/128) — done in `extension/icons/`.
- [ ] Create store assets (see below).
- [ ] Fill the Privacy practices / data-usage form (answers below).
- [ ] Test "Load unpacked" on a clean Chrome profile end-to-end before uploading.

## Single purpose (required field)

> Distill is a reading assistant for long-form articles. Its single purpose is to help
> the user read and understand the article on the current page through AI-generated
> progressive summaries, comprehension check-ins, highlight explanations, and
> reading-time/focus tools — using an AI key the user provides.

## Listing copy

**Name:** Distill

**Short description (≤132 chars):**
> Read long articles better: progressive summaries, highlight analysis & reading tools — powered by your own free AI key.

**Detailed description (draft):**
> Distill turns any long article into a guided read. As you scroll, it builds a running
> summary of what you've read so far, offers optional comprehension check-ins, explains
> highlighted passages, and shows reading-time and focus affordances.
>
> Distill is free and private by design: it uses **your own** AI key (a free Google
> Gemini key works great — no credit card required), and your article text goes straight
> from your browser to the AI provider. There is no Distill server in the middle, no
> account, and no tracking.
>
> Getting started takes about a minute: open the side panel, click "Get a free Gemini
> key", paste it in, and read.
>
> Features:
> • Progressive "so far" summaries that never spoil what's ahead
> • One-tap "explain this page" and highlight analysis
> • Optional comprehension check-ins
> • Reading time, focus mode, and per-site preferences
> • Bring your own key: Google Gemini (free tier) or Anthropic Claude

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `host_permissions: http://*/*, https://*/*` | Distill's purpose is to read the article on whatever page the user is on. Articles live on arbitrary domains, so the content script that detects and extracts the article must be allowed to run on any site the user chooses to read. No data is collected from pages the user does not actively open the reader on. |
| `storage` | Store the user's AI key, preferences (theme, accent, reader mode), and reading progress locally on the device. |
| `activeTab` | Access the content of the tab the user is actively reading when they request an AI action. |
| `scripting` | Inject/extract the article text and apply focus/reader affordances on the active page. |
| `tabs` | Determine which page the side panel currently reflects so per-site settings and reading state map to the right tab/URL. |
| `sidePanel` | The entire reader UI is a Chrome side panel. |
| `alarms` | A periodic alarm flushes a small local "offline queue" of pending actions; no network tracking. |

**Remote code:** Distill loads and executes **no remote code**. All logic ships in the
package. It makes HTTPS API calls (to the user's chosen AI provider) but does not
download or `eval` external scripts.

## Data usage disclosures (Privacy practices form)

- **Does your item collect or use personally identifiable information?** No.
- **Health info / financial info / authentication info / personal communications / location / web history / user activity collected by the developer?** No — the developer operates no server in the default build.
- **What data leaves the device, and to whom?** Article text the user submits for an AI
  action is sent **directly to the user's chosen AI provider** (Google or Anthropic) using
  the user's own key. This is disclosed in-app and in the privacy policy. It is not sent to
  the developer.
- **Is data sold to third parties?** No.
- **Is data used for purposes unrelated to the single purpose?** No.
- **Is data used for creditworthiness / lending?** No.
- Certify compliance with the **Limited Use** requirements: yes.

## Store assets to create

- [ ] **Icon:** 128×128 PNG — use `extension/icons/distill-128.png`.
- [ ] **Screenshots:** at least 1, ideally 3–5, at **1280×800** or 640×400 (PNG/JPEG). Suggested shots: onboarding card, a live "so far" summary, highlight analysis, settings (AI key) screen.
- [ ] **Small promo tile:** 440×280 PNG (optional but recommended).
- [ ] **Marquee promo tile:** 1400×560 PNG (optional).
- [ ] Category: **Productivity**. Language: English.

## Notes for reviewers (paste into the review notes field)

> Distill requires an AI API key supplied by the user (free Google Gemini works). To test:
> open the side panel on any article, expand the onboarding card or Settings, paste a
> Gemini API key (from https://aistudio.google.com/apikey), click Connect/Test key, then
> use "Summary"/"Explain page". The extension contacts only the chosen AI provider's API
> with the user's key; there is no developer backend in this build.
