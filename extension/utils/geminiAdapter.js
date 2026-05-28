'use strict';

/**
 * Pure helpers for talking to the Google Gemini (Generative Language) API directly
 * from the browser with a user-supplied key. No DOM, no chrome.* — unit testable.
 *
 * Anthropic-style inputs ({ systemPrompt, messages:[{role, content}] }) are converted
 * to Gemini's shape ({ systemInstruction, contents }) so existing task prompts are reused.
 */

/** Flatten one Anthropic-style message `content` (string | array of text blocks) into Gemini parts. */
function distillGeminiPartsFromContent(content) {
  if (typeof content === 'string') {
    const text = content.trim();
    return text ? [{ text }] : [];
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (block == null) continue;
      if (typeof block === 'string') {
        if (block.trim()) parts.push({ text: block });
        continue;
      }
      // Anthropic text blocks: { type: 'text', text, cache_control? }
      if (typeof block.text === 'string' && block.text.length) parts.push({ text: block.text });
    }
    return parts;
  }
  return [];
}

/**
 * @param {{ systemPrompt?: string, messages?: Array, maxTokens?: number, temperature?: number }} p
 * @returns {object} Gemini generateContent request body.
 */
function distillBuildGeminiRequestBody({ systemPrompt, messages, maxTokens, temperature } = {}) {
  const contents = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m) continue;
    const parts = distillGeminiPartsFromContent(m.content);
    if (!parts.length) continue;
    // Gemini uses 'model' for the assistant role; everything else maps to 'user'.
    const role = m.role === 'assistant' || m.role === 'model' ? 'model' : 'user';
    contents.push({ role, parts });
  }

  const generationConfig = {};
  if (Number.isFinite(maxTokens) && maxTokens > 0) generationConfig.maxOutputTokens = Math.floor(maxTokens);
  if (Number.isFinite(temperature)) generationConfig.temperature = temperature;

  const body = { contents };
  const sys = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  return body;
}

/**
 * Extract incremental text + control info from a single parsed Gemini stream chunk.
 * @param {object} obj parsed JSON from one SSE `data:` payload.
 * @returns {{ text: string, finishReason: (string|null), blockReason: (string|null) }}
 */
function distillParseGeminiChunk(obj) {
  const out = { text: '', finishReason: null, blockReason: null };
  if (!obj || typeof obj !== 'object') return out;

  // Prompt-level block (request refused before any candidate).
  const pf = obj.promptFeedback;
  if (pf && pf.blockReason) out.blockReason = String(pf.blockReason);

  const cand = Array.isArray(obj.candidates) ? obj.candidates[0] : null;
  if (cand) {
    if (cand.finishReason) out.finishReason = String(cand.finishReason);
    const parts = cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
    let text = '';
    for (const part of parts) {
      if (part && typeof part.text === 'string') text += part.text;
    }
    out.text = text;
  }
  return out;
}

/** Finish reasons that mean "model stopped without giving a usable answer". */
const DISTILL_GEMINI_HARD_STOPS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

function distillIsGeminiHardStop(finishReason) {
  return !!finishReason && DISTILL_GEMINI_HARD_STOPS.has(String(finishReason));
}

/** Friendly message for a safety/block stop. */
function distillGeminiBlockedMessage(reason) {
  const r = reason ? String(reason) : '';
  if (r === 'MAX_TOKENS') return 'The response was cut off (length limit). Try Ultra-lean mode or a shorter selection.';
  if (r === 'RECITATION') return 'Gemini stopped this response to avoid reciting copyrighted text. Try a different selection.';
  return "Gemini's safety filter declined this content. Try a different passage.";
}

/** Pull a retry delay (seconds) out of a Gemini error body's RetryInfo, if present. */
function distillParseGeminiRetrySeconds(body) {
  const details = body && body.error && Array.isArray(body.error.details) ? body.error.details : [];
  for (const d of details) {
    if (d && typeof d['@type'] === 'string' && d['@type'].includes('RetryInfo') && typeof d.retryDelay === 'string') {
      const m = d.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
      if (m) {
        const sec = Math.ceil(Number(m[1]));
        if (Number.isFinite(sec) && sec > 0) return Math.min(sec, 86400);
      }
    }
  }
  return null;
}

/**
 * Map a non-2xx Gemini HTTP response to a user-facing message + stable code.
 * @param {number} status
 * @param {object|null} body parsed JSON error body (may be null)
 * @returns {{ code: string, message: string, retryable: boolean }}
 */
function distillClassifyGeminiError(status, body) {
  const apiMsg = body && body.error && typeof body.error.message === 'string' ? body.error.message : '';
  const apiStatus = body && body.error && typeof body.error.status === 'string' ? body.error.status : '';
  const lower = apiMsg.toLowerCase();

  const keyLooksInvalid =
    lower.includes('api key not valid') ||
    lower.includes('api_key_invalid') ||
    lower.includes('invalid api key') ||
    apiStatus === 'UNAUTHENTICATED';

  if (status === 400 && keyLooksInvalid) {
    return { code: 'GEMINI_KEY_INVALID', message: 'That Gemini API key was rejected. Re-check it in Settings → AI key, or get a fresh one at aistudio.google.com/apikey.', retryable: false };
  }
  if (status === 401 || status === 403) {
    if (keyLooksInvalid) {
      return { code: 'GEMINI_KEY_INVALID', message: 'That Gemini API key was rejected. Re-check it in Settings → AI key.', retryable: false };
    }
    return { code: 'GEMINI_FORBIDDEN', message: 'This key can’t access the Gemini API. Enable the Generative Language API for it, or create a new key at aistudio.google.com/apikey.', retryable: false };
  }
  if (status === 429) {
    const violations =
      (body && body.error && Array.isArray(body.error.details)
        ? body.error.details.find(d => d && typeof d['@type'] === 'string' && d['@type'].includes('QuotaFailure'))
        : null)?.violations || [];
    const quotaIds = violations.map(v => (v && v.quotaId) || '').join(' ');

    // "limit: 0" means this project/account has NO free-tier allowance at all
    // (billing required, or region/account not eligible). Retrying never helps.
    if (/limit:\s*0\b/.test(apiMsg)) {
      return {
        code: 'GEMINI_NO_FREE_QUOTA',
        retryable: false,
        message: 'This Gemini key has no free-tier quota (limit 0). Your Google account/region likely isn’t eligible for the free tier, or the project needs billing. In Settings, switch the provider to Groq (also free) — or enable billing for this Gemini key.'
      };
    }
    // Daily quota exhausted — resets in hours, not seconds; don't busy-retry.
    if (/PerDay/i.test(quotaIds) || /per[- ]?day/i.test(apiMsg)) {
      return {
        code: 'GEMINI_DAILY_QUOTA',
        retryable: false,
        message: 'Your Gemini free daily limit is used up (resets about once every 24h). Try again later, or switch provider / use Ultra-lean mode in Settings.'
      };
    }
    // Genuine transient per-minute limit — safe to wait out and retry.
    return { code: 'GEMINI_RATE_LIMIT', message: 'Gemini’s per-minute free limit was reached.', retryable: true };
  }
  if (status === 404) {
    return { code: 'GEMINI_MODEL', message: 'This Gemini model isn’t available for your key right now. Try again later.', retryable: false };
  }
  if (status === 500 || status === 503 || status === 502 || status === 504) {
    return { code: 'GEMINI_OVERLOADED', message: 'Gemini is temporarily busy. Please retry in a moment.', retryable: true };
  }
  if (status === 400) {
    return { code: 'GEMINI_BAD_REQUEST', message: apiMsg ? `Gemini rejected the request: ${apiMsg}` : 'Gemini rejected the request.', retryable: false };
  }
  return { code: `GEMINI_HTTP_${status}`, message: apiMsg || `Gemini error ${status}.`, retryable: status >= 500 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    distillGeminiPartsFromContent,
    distillBuildGeminiRequestBody,
    distillParseGeminiChunk,
    distillIsGeminiHardStop,
    distillGeminiBlockedMessage,
    distillParseGeminiRetrySeconds,
    distillClassifyGeminiError,
    DISTILL_GEMINI_HARD_STOPS
  };
}
