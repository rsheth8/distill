'use strict';

/**
 * Pure helpers for OpenAI-compatible chat-completions APIs (OpenAI, Groq, and other
 * drop-in providers) called directly from the browser with a user-supplied key.
 * No DOM, no chrome.* — unit testable. One adapter serves every provider that speaks
 * the OpenAI `chat/completions` wire format.
 */

/** Flatten one Anthropic-style `content` (string | array of text blocks) into a single string. */
function distillChatTextFromContent(content) {
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
 * @returns {object} OpenAI-compatible chat.completions request body (streaming).
 */
function distillBuildChatRequestBody({ systemPrompt, messages, maxTokens, temperature, model } = {}) {
  const out = [];
  const sys = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  if (sys) out.push({ role: 'system', content: sys });
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m) continue;
    const content = distillChatTextFromContent(m.content);
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
 * Extract incremental text + control info from one parsed chat stream chunk.
 * @param {object} obj parsed JSON from one SSE `data:` payload (not the literal `[DONE]`).
 * @returns {{ text: string, finishReason: (string|null) }}
 */
function distillParseChatChunk(obj) {
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
 * Map a non-2xx chat-completions HTTP response to a user-facing message + stable code.
 * @param {number} status
 * @param {object|null} body parsed JSON error body (may be null)
 * @param {{ label?: string, keyUrl?: string }} [opts] provider label + key console URL for messages
 * @returns {{ code: string, message: string, retryable: boolean }}
 */
function distillClassifyChatError(status, body, opts = {}) {
  const label = opts.label || 'The AI provider';
  const keyUrl = opts.keyUrl || '';
  const keyTail = keyUrl ? `, or get a new one at ${keyUrl}` : '';
  const err = body && body.error ? body.error : null;
  const apiMsg = err && typeof err.message === 'string' ? err.message : '';
  const apiCode = err && typeof err.code === 'string' ? err.code : '';
  const lower = `${apiMsg} ${apiCode}`.toLowerCase();

  if (status === 401) {
    return { code: 'CHAT_KEY_INVALID', message: `${label} rejected that API key. Re-check it in Settings → AI key${keyTail}.`, retryable: false };
  }
  if (status === 403) {
    return { code: 'CHAT_FORBIDDEN', message: `This ${label} key isn’t permitted to use the API${keyUrl ? `. Create a fresh key at ${keyUrl}` : '.'}`, retryable: false };
  }
  if (status === 429) {
    const insufficient = lower.includes('insufficient_quota') || lower.includes('exceeded your current quota') || lower.includes('billing');
    if (insufficient) {
      return { code: 'CHAT_NO_CREDIT', message: `Your ${label} account is out of credit/quota. Add billing or credits, or switch provider in Settings.`, retryable: false };
    }
    return { code: 'CHAT_RATE_LIMIT', message: `${label}’s rate limit was reached.`, retryable: true };
  }
  if (status === 404 || lower.includes('model_not_found') || lower.includes('does not exist')) {
    return { code: 'CHAT_MODEL', message: `This ${label} model isn’t available for your key. It may have been retired — try again later.`, retryable: false };
  }
  if (status === 413 || lower.includes('maximum context') || lower.includes('too large') || lower.includes('reduce the length')) {
    return { code: 'CHAT_TOO_LARGE', message: 'That request was too large for the model. Try Ultra-lean mode or a shorter selection.', retryable: false };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { code: 'CHAT_OVERLOADED', message: `${label} is temporarily busy. Please retry in a moment.`, retryable: true };
  }
  if (status === 400) {
    return { code: 'CHAT_BAD_REQUEST', message: apiMsg ? `${label} rejected the request: ${apiMsg}` : `${label} rejected the request.`, retryable: false };
  }
  return { code: `CHAT_HTTP_${status}`, message: apiMsg || `${label} error ${status}.`, retryable: status >= 500 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    distillChatTextFromContent,
    distillBuildChatRequestBody,
    distillParseChatChunk,
    distillClassifyChatError
  };
}
