# Chrome Web Store listing & review pack

Everything needed to submit Distill to the Chrome Web Store, plus the per-permission
justifications reviewers ask for. The extension ships as **bring-your-own-key (BYOK)**:
each user supplies a free AI key, AI runs browser → provider, and there is no
developer-operated backend in the default build.

## Pre-submission checklist

- [x] Contact email set to `rahilsheth05@gmail.com` in `docs/PRIVACY.md` and `docs/privacy.html`.
- [ ] Host `docs/privacy.html` at a public URL (e.g. GitHub Pages) → use as the **Privacy policy URL**.
- [ ] Confirm `extension/manifest.json` `version` is bumped and matches `CHANGELOG.md` (currently **2.4.0**).
- [ ] Build the store zip from the repo root (BYOK-only; strips hosted-backend UI):
  - `npm run pack` → `dist/distill-<version>.zip`
  - Or manually zip **`extension/`** only if you do not need the pack script's `buildConfig` rewrite.
- [ ] Verify icons are PNG (16/32/48/128) — done in `extension/icons/`.
- [ ] Create store assets (see below).
- [ ] Fill the Privacy practices / data-usage form (answers below).
- [ ] Test "Load unpacked" on a clean Chrome profile end-to-end before uploading.

## Single purpose (required field)

> Distill is a reading assistant for research papers. Its single purpose is to help the
> user read and understand the research paper on the current page, in plain language,
> through AI-generated progressive summaries, comprehension check-ins, highlight
> explanations, a whole-paper overview, and a clean reading view for PDF papers — using
> an AI key the user provides.

## Listing copy

**Name:** Distill

**Short description (≤132 chars):**
> Understand research papers without the jargon: plain-language summaries, explanations and check-ins as you read, in HTML or PDF.

**Detailed description (draft):**
> Research papers are written for experts. Distill helps everyone else read them. Open a
> paper on arXiv, PubMed Central, bioRxiv or a journal's site, or open a paper's PDF, and
> Distill sits beside it in a side panel: as you scroll, it builds a plain-language summary
> of what you've read so far, explains any passage you highlight with the jargon spelled
> out, and asks short check-in questions so the main ideas stick. PDF papers open in a
> clean, resizable reading view, with the original pages one click away.
>
> Distill is free and private by design: it uses **your own** AI key (a free **Groq**
> or **Google Gemini** key works — no credit card on those tiers), and the paper's
> text goes straight from your browser to the AI provider. There is no Distill server
> in the middle, no account, and no tracking.
>
> Getting started takes about a minute: open the side panel, get a free API key
> (Groq by default), paste it in, and open a paper.
>
> Features:
> • Plain-language "so far" summaries that never spoil what's ahead
> • Highlight any sentence for an explanation in everyday words
> • Overview and trust check when a paper opens: the question, findings and why they matter, plus the study's size and the authors' own limits
> • Section guides: a plain guide to each section, with jargon underlined and defined in a Glossary tab
> • Reading level: Simple, Everyday or Closer to the paper
> • Ask the paper: questions answered from the paper itself, naming the sections used
> • Optional comprehension check-ins
> • A reading view for PDF papers, plus reading time and focus mode
> • Bring your own key: Groq (free), Gemini (free where eligible), OpenAI, or Anthropic

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `host_permissions: http://*/*, https://*/*` | Distill's purpose is to help the user read the research paper on the page they are on. Papers are published on many journal, preprint and university domains, so the content script that recognizes a paper and extracts its text must be able to run on any site. Distill's PDF reader also needs host access to download the PDF the user chose to open. On pages that are not papers the content script stops after detection and sends nothing. |
| `storage` | Store the user's AI key, preferences (theme, accent, reader mode), and reading progress locally on the device. |
| `activeTab` | Access the content of the tab the user is actively reading when they request an AI action. |
| `tabs` | Determine which page the side panel currently reflects so per-site settings and reading state map to the right tab/URL. |
| `sidePanel` | The entire reader UI is a Chrome side panel. |
| `alarms` | A periodic alarm flushes a small local "offline queue" of pending actions; no network tracking. |

**Remote code:** Distill loads and executes **no remote code**. All logic ships in the
package, including the PDF renderer (Mozilla pdf.js, bundled under `extension/vendor/pdfjs`
and run with eval disabled). It makes HTTPS API calls (to the user's chosen AI provider)
and downloads PDFs the user opens, but does not download or `eval` external scripts.

## Data usage disclosures (Privacy practices form)

- **Does your item collect or use personally identifiable information?** No.
- **Health info / financial info / authentication info / personal communications / location / web history / user activity collected by the developer?** No — the developer operates no server in the default build.
- **What data leaves the device, and to whom?** Paper text needed for an AI action is
  sent **directly to the user's chosen AI provider** (Groq, Google, OpenAI or Anthropic) using
  the user's own key. This is disclosed in-app and in the privacy policy. It is not sent to
  the developer.
- **Is data sold to third parties?** No.
- **Is data used for purposes unrelated to the single purpose?** No.
- **Is data used for creditworthiness / lending?** No.
- Certify compliance with the **Limited Use** requirements: yes.

## Store assets to create

- [ ] **Icon:** 128×128 PNG — use `extension/icons/distill-128.png`.
- [ ] **Screenshots:** at least 1, ideally 3–5, at **1280×800** or 640×400 (PNG/JPEG). Suggested shots: a live "so far" summary beside an arXiv paper, a highlight explanation, the PDF reading view, onboarding card.
- [ ] **Small promo tile:** 440×280 PNG (optional but recommended).
- [ ] **Marquee promo tile:** 1400×560 PNG (optional).
- [ ] Category: **Productivity**. Language: English.

## Notes for reviewers (paste into the review notes field)

> Distill requires an AI API key supplied by the user (free Groq or Gemini works). To test:
> open the side panel on a research paper (for example https://arxiv.org/html/2310.06825v1),
> complete onboarding or open Settings, paste a Groq key (https://console.groq.com/keys)
> or Gemini key (https://aistudio.google.com/apikey), click Connect/Test key, then scroll
> the paper or open the Ask tab. For a PDF, open https://arxiv.org/pdf/1810.04805 and click
> "Open in Distill" in the side panel. Pages that are not research papers show a short
> "not a paper" message. The extension contacts only the chosen AI provider with the
> user's key; the Web Store build has no developer backend.
>
> Ask, guides and the overview send only excerpts of the open paper to the AI provider the user chose.
