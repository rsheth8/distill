'use strict';

/**
 * Pure helpers for talking to the Groq API (OpenAI-compatible chat completions)
 * directly from the browser with a user-supplied key. No DOM, no chrome.* — unit testable.
 *
 * Groq has a genuinely free tier with broad availability, which makes it a good
 * BYOK option where Google's Gemini free tier isn't offered.
 */

/** Flatten one Anthropic-style `content` (string | array of text blocks) into a single OpenAI string. */
function distillGroqTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (block == null) continue;
      if (typeof block === 'string') { if (block.length) parts.push(block); continue; }
      if (typeof block.text === 'string' && block.text.length) parts.push(block.text);
    }
    return parts.join('\n\n');
  }
  return '';
}

/**
 * @param {{ systemPrompt?: string, messages?: Array, maxTokens?: number, temperature?: number, model: string }} p
 * @returns {object} OpenAI/Groq chat.completions request body (streaming).
 */
function distillBuildGroqRequestBody({ systemPrompt, messages, maxTokens, temperature, model } = {}) {
  const out = [];
  const sys = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  if (sys) out.push({ role: 'system', content: sys });
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m) continue;
    const content = distillGroqTextFromContent(m.content);
    if (!content) continue;
    const role = m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user';
    out.push({ role, content });
  }
  const body = { model, messages: out, stream: true };
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = Math.floor(maxTokens);
  if (Number.isFinite(temperature)) body.temperature = temperature;
  return body;
}

/**
 * Extract incremental text + control info from one parsed Groq/OpenAI stream chunk.
 * @param {object} obj parsed JSON from one SSE `data:` payload (not the literal `[DONE]`).
 * @returns {{ text: string, finishReason: (string|null) }}
 */
function distillParseGroqChunk(obj) {
  const out = { text: '', finishReason: null };
  if (!obj || typeof obj !== 'object') return out;
  const choice = Array.isArray(obj.choices) ? obj.choices[0] : null;
  if (!choice) return out;
  if (choice.finish_reason) out.finishReason = String(choice.finish_reason);
  const delta = choice.delta || {};
  if (typeof delta.content === 'string') out.text = delta.content;
  return out;
}

/**
 * Map a non-2xx Groq HTTP response to a user-facing message + stable code.
 * @param {number} status
 * @param {object|null} body parsed JSON error body (may be null)
 * @returns {{ code: string, message: string, retryable: boolean }}
 */
function distillClassifyGroqError(status, body) {
  const err = body && body.error ? body.error : null;
  const apiMsg = err && typeof err.message === 'string' ? err.message : '';
  const apiCode = err && typeof err.code === 'string' ? err.code : '';
  const lower = `${apiMsg} ${apiCode}`.toLowerCase();

  if (status === 401) {
    return { code: 'GROQ_KEY_INVALID', message: 'That Groq API key was rejected. Re-check it in Settings → AI key, or get a new one at console.groq.com/keys.', retryable: false };
  }
  if (status === 403) {
    return { code: 'GROQ_FORBIDDEN', message: 'This Groq key isn’t permitted to use the API. Create a fresh key at console.groq.com/keys.', retryable: false };
  }
  if (status === 429) {
    return { code: 'GROQ_RATE_LIMIT', message: 'Groq’s free-tier limit was reached.', retryable: true };
  }
  if (status === 404 || lower.includes('model_not_found') || lower.includes('does not exist')) {
    return { code: 'GROQ_MODEL', message: 'This Groq model isn’t available for your key. It may have been retired — try again later.', retryable: false };
  }
  if (status === 413 || lower.includes('too large') || lower.includes('context')) {
    return { code: 'GROQ_TOO_LARGE', message: 'That request was too large for the model. Try Ultra-lean mode or a shorter selection.', retryable: false };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { code: 'GROQ_OVERLOADED', message: 'Groq is temporarily busy. Please retry in a moment.', retryable: true };
  }
  if (status === 400) {
    return { code: 'GROQ_BAD_REQUEST', message: apiMsg ? `Groq rejected the request: ${apiMsg}` : 'Groq rejected the request.', retryable: false };
  }
  return { code: `GROQ_HTTP_${status}`, message: apiMsg || `Groq error ${status}.`, retryable: status >= 500 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    distillGroqTextFromContent,
    distillBuildGroqRequestBody,
    distillParseGroqChunk,
    distillClassifyGroqError
  };
}
