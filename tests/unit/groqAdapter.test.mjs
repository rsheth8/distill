import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const {
  distillGroqTextFromContent,
  distillBuildGroqRequestBody,
  distillParseGroqChunk,
  distillClassifyGroqError
} = require(join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/groqAdapter.js'));

describe('distillGroqTextFromContent', () => {
  it('passes strings through', () => {
    expect(distillGroqTextFromContent('hello')).toBe('hello');
  });
  it('joins text blocks, skipping nulls/non-text', () => {
    expect(distillGroqTextFromContent([
      { type: 'text', text: 'a' },
      null,
      { type: 'image' },
      { type: 'text', text: 'b' },
      'c'
    ])).toBe('a\n\nb\n\nc');
  });
});

describe('distillBuildGroqRequestBody', () => {
  it('builds OpenAI-style messages with system + roles + streaming', () => {
    const body = distillBuildGroqRequestBody({
      systemPrompt: 'You are a reading companion.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Q1' }] },
        { role: 'assistant', content: 'A1' }
      ],
      maxTokens: 120,
      temperature: 0.5,
      model: 'llama-3.1-8b-instant'
    });
    expect(body.model).toBe('llama-3.1-8b-instant');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(120);
    expect(body.temperature).toBe(0.5);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a reading companion.' },
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' }
    ]);
  });
  it('omits system when blank, skips empty messages, omits max_tokens when 0', () => {
    const body = distillBuildGroqRequestBody({
      systemPrompt: '  ',
      messages: [{ role: 'user', content: [] }, { role: 'user', content: 'real' }],
      maxTokens: 0,
      model: 'm'
    });
    expect(body.messages).toEqual([{ role: 'user', content: 'real' }]);
    expect(body.max_tokens).toBeUndefined();
  });
});

describe('distillParseGroqChunk', () => {
  it('extracts delta content and finish_reason', () => {
    expect(distillParseGroqChunk({ choices: [{ delta: { content: 'Hi' }, finish_reason: null }] }))
      .toEqual({ text: 'Hi', finishReason: null });
    expect(distillParseGroqChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      .toEqual({ text: '', finishReason: 'stop' });
  });
  it('is safe on junk', () => {
    expect(distillParseGroqChunk(null)).toEqual({ text: '', finishReason: null });
    expect(distillParseGroqChunk({})).toEqual({ text: '', finishReason: null });
  });
});

describe('distillClassifyGroqError', () => {
  it('401 -> invalid key (not retryable)', () => {
    const r = distillClassifyGroqError(401, { error: { message: 'Invalid API Key' } });
    expect(r.code).toBe('GROQ_KEY_INVALID');
    expect(r.retryable).toBe(false);
  });
  it('429 -> retryable rate limit', () => {
    expect(distillClassifyGroqError(429, { error: { message: 'rate limit' } }))
      .toMatchObject({ code: 'GROQ_RATE_LIMIT', retryable: true });
  });
  it('404 / model_not_found -> model error', () => {
    expect(distillClassifyGroqError(404, { error: { message: 'model_not_found' } }).code).toBe('GROQ_MODEL');
  });
  it('5xx -> retryable overload', () => {
    expect(distillClassifyGroqError(503, null)).toMatchObject({ code: 'GROQ_OVERLOADED', retryable: true });
  });
  it('400 -> surfaces api message', () => {
    const r = distillClassifyGroqError(400, { error: { message: 'bad field' } });
    expect(r.code).toBe('GROQ_BAD_REQUEST');
    expect(r.message).toMatch(/bad field/);
  });
});
