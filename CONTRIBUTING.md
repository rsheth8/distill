# Contributing to Distill

## Prerequisites
- Node.js + npm
- Chrome (load unpacked)

## Run the extension
```bash
git clone https://github.com/rsheth8/distill.git
# Chrome → chrome://extensions → Developer mode → Load unpacked → extension/
```

Paste a Groq (or other) key in the side panel. BYOK: the key stays in `chrome.storage.local`.

## Tests
```bash
npm install
npm test          # lint + smoke + vitest
npm run pack      # Web Store zip (BYOK-only)
```

## Optional backend
```bash
cp backend/.env.example backend/.env
npm install --prefix backend
npm start --prefix backend
```

## Secrets
Never commit provider keys. Content scripts skip Gmail/Docs/Drive on purpose — keep it that way.
