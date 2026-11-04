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

/**
 * Streaming filter that drops `<think>…</think>` reasoning (Qwen3, DeepSeek R1) and the
 * whitespace before the real answer. Tags may arrive split across chunks.
 * @returns {(chunk: string, flush?: boolean) => string} feed text in, get visible text out.
 */
function distillMakeThinkFilter() {
  let buf = '';
  let inThink = false;
  let started = false;
  return function feed(chunk, flush = false) {
    buf += chunk || '';
    let out = '';
    for (;;) {
      const tag = inThink ? '</think>' : '<think>';
      const i = buf.indexOf(tag);
      if (i >= 0) {
        if (!inThink) out += buf.slice(0, i);
        buf = buf.slice(i + tag.length);
        inThink = !inThink;
        continue;
      }
      // Hold back a tail that could be the start of a split tag.
      let keep = 0;
      if (!flush) {
        for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) {
          if (buf.endsWith(tag.slice(0, k))) { keep = k; break; }
        }
      }
      if (!inThink) out += buf.slice(0, buf.length - keep);
      buf = buf.slice(buf.length - keep);
      break;
    }
    if (!started) {
      out = out.replace(/^\s+/, '');
      if (out) started = true;
    }
    return out;
  };
}

/**
 * Map a local-server (Ollama / LM Studio) failure to a fix-it message.
 * @param {number} status HTTP status, or 0 when the server could not be reached.
 * @param {{ baseUrl: string, model: string, extensionId?: string }} opts
 * @returns {{ code: string, message: string, retryable: boolean }}
 */
function distillClassifyLocalError(status, { baseUrl, model, extensionId = '<extension-id>' }) {
  if (status === 0) {
    return { code: 'LOCAL_UNREACHABLE', message: `Can’t reach your local model at ${baseUrl}. Is Ollama or LM Studio running?`, retryable: true };
  }
  if (status === 403) {
    return { code: 'LOCAL_FORBIDDEN', message: `Ollama blocked Distill. Allow it with OLLAMA_ORIGINS=chrome-extension://${extensionId}, then restart Ollama (see Settings).`, retryable: false };
  }
  if (status === 404) {
    return { code: 'LOCAL_NO_MODEL', message: `Model “${model}” isn’t installed. Run: ollama pull ${model} (or load it in LM Studio).`, retryable: false };
  }
  return { code: `LOCAL_HTTP_${status}`, message: `Local model error ${status}.`, retryable: status >= 500 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    distillChatTextFromContent,
    distillBuildChatRequestBody,
    distillParseChatChunk,
    distillClassifyChatError,
    distillMakeThinkFilter,
    distillClassifyLocalError
  };
}
