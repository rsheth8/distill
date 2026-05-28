import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const {
  distillChatTextFromContent,
  distillBuildChatRequestBody,
  distillParseChatChunk,
  distillClassifyChatError
} = require(join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/openaiCompatAdapter.js'));

describe('distillChatTextFromContent', () => {
  it('passes strings through', () => {
    expect(distillChatTextFromContent('hello')).toBe('hello');
  });
  it('joins text blocks, skipping nulls/non-text', () => {
    expect(distillChatTextFromContent([
      { type: 'text', text: 'a' },
      null,
      { type: 'image' },
      { type: 'text', text: 'b' },
      'c'
    ])).toBe('a\n\nb\n\nc');
  });
});

describe('distillBuildChatRequestBody', () => {
  it('builds OpenAI-style messages with system + roles + streaming', () => {
    const body = distillBuildChatRequestBody({
      systemPrompt: 'You are a reading companion.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Q1' }] },
        { role: 'assistant', content: 'A1' }
      ],
      maxTokens: 120,
      temperature: 0.5,
      model: 'gpt-4o-mini'
    });
    expect(body.model).toBe('gpt-4o-mini');
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
    const body = distillBuildChatRequestBody({
      systemPrompt: '  ',
      messages: [{ role: 'user', content: [] }, { role: 'user', content: 'real' }],
      maxTokens: 0,
      model: 'm'
    });
    expect(body.messages).toEqual([{ role: 'user', content: 'real' }]);
    expect(body.max_tokens).toBeUndefined();
  });
});

describe('distillParseChatChunk', () => {
  it('extracts delta content and finish_reason', () => {
    expect(distillParseChatChunk({ choices: [{ delta: { content: 'Hi' }, finish_reason: null }] }))
      .toEqual({ text: 'Hi', finishReason: null });
    expect(distillParseChatChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
      .toEqual({ text: '', finishReason: 'stop' });
  });
  it('is safe on junk', () => {
    expect(distillParseChatChunk(null)).toEqual({ text: '', finishReason: null });
    expect(distillParseChatChunk({})).toEqual({ text: '', finishReason: null });
  });
});

describe('distillClassifyChatError', () => {
  it('401 -> invalid key (not retryable), uses label + keyUrl', () => {
    const r = distillClassifyChatError(401, { error: { message: 'Invalid API Key' } }, { label: 'Groq', keyUrl: 'console.groq.com/keys' });
    expect(r.code).toBe('CHAT_KEY_INVALID');
    expect(r.retryable).toBe(false);
    expect(r.message).toMatch(/Groq/);
    expect(r.message).toMatch(/console\.groq\.com/);
  });
  it('429 insufficient_quota -> no-credit (not retryable)', () => {
    const r = distillClassifyChatError(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }, { label: 'OpenAI' });
    expect(r.code).toBe('CHAT_NO_CREDIT');
    expect(r.retryable).toBe(false);
  });
  it('429 plain -> retryable rate limit', () => {
    expect(distillClassifyChatError(429, { error: { message: 'rate limit exceeded' } }, { label: 'Groq' }))
      .toMatchObject({ code: 'CHAT_RATE_LIMIT', retryable: true });
  });
  it('404 / model_not_found -> model error', () => {
    expect(distillClassifyChatError(404, { error: { message: 'model_not_found' } }, { label: 'OpenAI' }).code).toBe('CHAT_MODEL');
  });
  it('5xx -> retryable overload', () => {
    expect(distillClassifyChatError(503, null, { label: 'Groq' })).toMatchObject({ code: 'CHAT_OVERLOADED', retryable: true });
  });
  it('400 -> surfaces api message', () => {
    const r = distillClassifyChatError(400, { error: { message: 'bad field' } }, { label: 'OpenAI' });
    expect(r.code).toBe('CHAT_BAD_REQUEST');
    expect(r.message).toMatch(/bad field/);
  });
});
