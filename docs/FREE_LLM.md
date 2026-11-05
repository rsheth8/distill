# Free LLM — two architectures

Distill supports two ways to run AI. **Model B (BYOK) is the shipped default** for the Web Store build (`npm run pack` strips the hosted-backend UI). **Model A (shared cloud)** remains in the repo for self-hosting via `backend/`.

| | **A. Shared Distill cloud** (opt-in / self-host) | **B. Per-user API key (BYOK)** — **default** |
|---|--------------------------------------------------|-----------------------------------------------|
| Who pays / limits | One key on Fly; **your** provider quota + Distill **daily credits** per install | Each user's **own** free-tier key; **their** provider RPM & RPD |
| User setup | None (if you operate the backend) | Free key from Groq / Gemini / etc. → paste in Settings |
| Where the key lives | Fly secrets only | `chrome.storage.local` on the user's machine |
| Who runs AI | Your `backend/` host → provider | Browser → provider directly |
| Good for | “Install and go” on your deployment | No shared quota; no LLM bill on your Fly app |

---

## Model B — BYOK (shipped)

```mermaid
sequenceDiagram
  participant User as User browser
  participant Ext as Distill extension
  participant LLM as Groq / Gemini / OpenAI / Anthropic

  Note over User,LLM: Key never sent to distill-api unless user enables hosted backend
  User->>Ext: Paste API key in Settings
  Ext->>Ext: Store in chrome.storage.local
  User->>Ext: Read paper / summary / explain
  Ext->>LLM: HTTPS + user's API key
  LLM-->>Ext: Streamed tokens (user's quota)
```

**Default provider:** Groq (`llama-3.1-8b-instant`) — free tier, broad availability. Alternatives: Gemini, OpenAI (`gpt-4o-mini`), Anthropic.

**Implementation (extension):**

| Piece | Location |
|-------|----------|
| Provider routing | `extension/background.js` |
| Gemini adapter | `extension/utils/geminiAdapter.js` |
| OpenAI-compatible (Groq, OpenAI) | `extension/utils/openaiCompatAdapter.js` |
| First-run onboarding | `extension/sidepanel.js` |
| Web Store build (no backend UI) | `npm run pack` → `DISTILL_INCLUDE_BACKEND = false` |

Optional **Sign in with Google** notes: [`GOOGLE_OAUTH.md`](GOOGLE_OAUTH.md).

### Privacy / security (BYOK)

- Do **not** POST user API keys to your backend for routine summaries.
- Keys stay in `chrome.storage.local`; calls go straight to the provider (same-origin policy / provider CORS rules apply).

### “Free” for you as the developer

- No LLM bill on Fly when users bring keys.
- You still pay for Fly + Supabase if you run guest auth / usage DB.
- CI eval uses a dedicated key in GitHub secrets (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`), not user keys.

---

## Model A — shared cloud (self-host)

One `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`) on Fly serves **all** users. Distill enforces **per-install daily credits** in Postgres or `state.json` — your fairness layer, not the provider's per-user limits.

```bash
fly secrets set GEMINI_API_KEY="AIza..." LLM_PROVIDER="gemini" -a distill-api
```

See [Gemini pricing / limits](https://ai.google.dev/gemini-api/docs/pricing). Operator docs: [`backend/README.md`](../backend/README.md), [`DEPLOY.md`](DEPLOY.md).

---

## Comparison

| Question | Model A (shared cloud) | Model B (BYOK) |
|----------|------------------------|----------------|
| Same API key for all users? | Yes | **No** |
| User gets provider free-tier limits? | No — shared pool | **Yes** |
| Extension default (store build) | Hidden | **Yes** |
| Best “free” for you | One free Gemini key on Fly (capped) | **$0 LLM** on your infrastructure |

---

## Model C — local model (no key)

The model runs on the user's computer through **Ollama** or **LM Studio**. Distill talks to it with the same OpenAI-compatible adapter it uses for Groq/OpenAI. There's no key and no quota, and article text never leaves the machine.

**Default:** `qwen3:4b` on `http://localhost:11434` (Ollama). It needs about 3 GB of RAM. `qwen3:8b` gives better answers if the machine has about 6 GB free. Avoid `deepseek-r1` distills: they "think out loud" and are slow for short summaries.

### Ollama (more technical)

```bash
ollama pull qwen3:4b
launchctl setenv OLLAMA_ORIGINS "chrome-extension://<distill-extension-id>"   # macOS; then quit + reopen Ollama
```

- Ollama rejects browser extensions by default (HTTP 403). Settings shows the exact command, with the extension ID filled in and a copy button.
- **Windows:** add `OLLAMA_ORIGINS` under Environment Variables. **Linux:** add `Environment="OLLAMA_ORIGINS=..."` via `systemctl edit ollama`.
- On macOS, `launchctl setenv` resets on reboot. Re-run it after a restart, or add it to a login item.

### LM Studio (easier, no terminal)

1. Install LM Studio and download **Qwen3 4B** in the app.
2. In the **Developer** tab, start the server and turn on **CORS**.
3. In Distill Settings, set the server address to `http://localhost:1234` and the model to the name LM Studio shows.

### Implementation notes

| Piece | Location |
|-------|----------|
| Provider `local`, config from `localBaseUrl` / `localModel` | `extension/background.js` (`localChatConfig`, `validateLocal`) |
| Strip `<think>…</think>` reasoning from Qwen3 / DeepSeek R1 | `distillMakeThinkFilter` in `extension/utils/openaiCompatAdapter.js` |
| Fix-it errors (not running / blocked / model missing) | `distillClassifyLocalError` |
| Settings fields + copy-command button | `extension/sidepanel.html`, `sidepanel.js` |

Local requests send `reasoning_effort: "none"` (Ollama) and end the system prompt with `/no_think` (Qwen3's switch, for LM Studio). Without them, thinking models like `qwen3.6` spend the whole token budget on hidden reasoning and return a blank answer.

**Known limit:** Ollama's default context window is small. "Explain this page" on very long articles may be cut off unless the context length is raised in Ollama's settings.
