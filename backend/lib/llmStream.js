'use strict';

/**
 * Streaming LLM adapters (Anthropic Messages API + Gemini generateContent SSE).
 * Returns a fetch Response body; callers parse SSE into text chunks.
 */

function resolveProvider(config) {
  const explicit = String(config.llmProvider || 'auto').trim().toLowerCase();
  const hasGemini = !!config.geminiApiKey;
  const hasAnthropic = !!config.anthropicApiKey;
  if (explicit === 'gemini') {
    if (!hasGemini) throw new Error('GEMINI_API_KEY not configured.');
    return 'gemini';
  }
  if (explicit === 'anthropic') {
    if (!hasAnthropic) throw new Error('ANTHROPIC_API_KEY not configured.');
    return 'anthropic';
  }
  if (hasGemini) return 'gemini';
  if (hasAnthropic) return 'anthropic';
  throw new Error('No LLM API key configured (set GEMINI_API_KEY and/or ANTHROPIC_API_KEY).');
}

function isAiConfigured(config) {
  return !!(config.geminiApiKey || config.anthropicApiKey);
}

function pickModelsForTask(task, provider, config) {
  if (provider === 'gemini') {
    const primary = config.geminiModel || 'gemini-2.0-flash';
    return { provider, primary, fallback: primary };
  }
  const anthropicRouter = config.anthropicModelRouter || {};
  const plan = anthropicRouter[task] || { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' };
  return { provider: 'anthropic', primary: plan.primary, fallback: plan.fallback };
}

async function callAnthropicStream({ model, systemPrompt, userMessage, maxTokens, apiKey }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic error ${response.status}: ${body || 'request failed'}`);
  }
  return response;
}

async function callGeminiStream({ model, systemPrompt, userMessage, maxTokens, apiKey }) {
  const modelId = String(model).replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens }
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini error ${response.status}: ${body || 'request failed'}`);
  }
  return response;
}

async function streamLlm({ provider, model, systemPrompt, userMessage, maxTokens, config }) {
  if (provider === 'gemini') {
    return callGeminiStream({
      model,
      systemPrompt,
      userMessage,
      maxTokens,
      apiKey: config.geminiApiKey
    });
  }
  return callAnthropicStream({
    model,
    systemPrompt,
    userMessage,
    maxTokens,
    apiKey: config.anthropicApiKey
  });
}

/** Consume provider SSE and invoke onChunk(text) for each text delta. */
async function consumeLlmStream(streamResponse, provider, onChunk) {
  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      let evt;
      try {
        evt = JSON.parse(raw);
      } catch {
        continue;
      }
      if (provider === 'anthropic') {
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const chunk = evt.delta.text || '';
          if (chunk) onChunk(chunk);
        }
        continue;
      }
      const parts = evt.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const text = part?.text;
        if (text) onChunk(text);
      }
    }
  }
}

module.exports = {
  resolveProvider,
  isAiConfigured,
  pickModelsForTask,
  streamLlm,
  consumeLlmStream
};
