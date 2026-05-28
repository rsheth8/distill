import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const {
  distillGeminiPartsFromContent,
  distillBuildGeminiRequestBody,
  distillParseGeminiChunk,
  distillIsGeminiHardStop,
  distillGeminiBlockedMessage,
  distillParseGeminiRetrySeconds,
  distillClassifyGeminiError
} = require(join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/geminiAdapter.js'));

describe('distillGeminiPartsFromContent', () => {
  it('wraps a non-empty string into one text part', () => {
    expect(distillGeminiPartsFromContent('hello')).toEqual([{ text: 'hello' }]);
  });
  it('drops empty strings', () => {
    expect(distillGeminiPartsFromContent('   ')).toEqual([]);
  });
  it('flattens an array of Anthropic text blocks, skipping nulls/non-text', () => {
    const parts = distillGeminiPartsFromContent([
      { type: 'text', text: 'a' },
      null,
      { type: 'image', source: {} },
      { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } },
      'c'
    ]);
    expect(parts).toEqual([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
  });
});

describe('distillBuildGeminiRequestBody', () => {
  it('maps system + user/assistant roles and token cap', () => {
    const body = distillBuildGeminiRequestBody({
      systemPrompt: 'You are a reading companion.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Q1' }] },
        { role: 'assistant', content: 'A1' }
      ],
      maxTokens: 120,
      temperature: 0.5
    });
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are a reading companion.' }] });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Q1' }] },
      { role: 'model', parts: [{ text: 'A1' }] }
    ]);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 120, temperature: 0.5 });
  });

  it('omits systemInstruction when prompt is blank and skips empty messages', () => {
    const body = distillBuildGeminiRequestBody({
      systemPrompt: '   ',
      messages: [{ role: 'user', content: [] }, { role: 'user', content: 'real' }],
      maxTokens: 0
    });
    expect(body.systemInstruction).toBeUndefined();
    expect(body.generationConfig).toBeUndefined(); // maxTokens 0 -> omitted
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'real' }] }]);
  });

  it('tolerates missing input', () => {
    expect(distillBuildGeminiRequestBody()).toEqual({ contents: [] });
  });
});

describe('distillParseGeminiChunk', () => {
  it('extracts streamed text from candidates', () => {
    const r = distillParseGeminiChunk({ candidates: [{ content: { parts: [{ text: 'hi ' }, { text: 'there' }] } }] });
    expect(r.text).toBe('hi there');
    expect(r.finishReason).toBeNull();
  });
  it('reports finishReason and prompt block reason', () => {
    expect(distillParseGeminiChunk({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }).finishReason).toBe('STOP');
    expect(distillParseGeminiChunk({ promptFeedback: { blockReason: 'SAFETY' } }).blockReason).toBe('SAFETY');
  });
  it('is safe on junk', () => {
    expect(distillParseGeminiChunk(null)).toEqual({ text: '', finishReason: null, blockReason: null });
    expect(distillParseGeminiChunk({})).toEqual({ text: '', finishReason: null, blockReason: null });
  });
});

describe('distillIsGeminiHardStop / blocked message', () => {
  it('flags safety-class stops only', () => {
    expect(distillIsGeminiHardStop('SAFETY')).toBe(true);
    expect(distillIsGeminiHardStop('RECITATION')).toBe(true);
    expect(distillIsGeminiHardStop('STOP')).toBe(false);
    expect(distillIsGeminiHardStop(null)).toBe(false);
  });
  it('returns tailored messages', () => {
    expect(distillGeminiBlockedMessage('MAX_TOKENS')).toMatch(/cut off/i);
    expect(distillGeminiBlockedMessage('RECITATION')).toMatch(/copyright/i);
    expect(distillGeminiBlockedMessage('SAFETY')).toMatch(/safety/i);
  });
});

describe('distillParseGeminiRetrySeconds', () => {
  it('reads RetryInfo.retryDelay', () => {
    const body = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }] } };
    expect(distillParseGeminiRetrySeconds(body)).toBe(17);
  });
  it('returns null when absent', () => {
    expect(distillParseGeminiRetrySeconds({ error: {} })).toBeNull();
    expect(distillParseGeminiRetrySeconds(null)).toBeNull();
  });
});

describe('distillClassifyGeminiError', () => {
  it('detects an invalid key', () => {
    const r = distillClassifyGeminiError(400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    expect(r.code).toBe('GEMINI_KEY_INVALID');
    expect(r.retryable).toBe(false);
  });
  it('maps 403 to a permissions hint', () => {
    expect(distillClassifyGeminiError(403, { error: { message: 'permission denied' } }).code).toBe('GEMINI_FORBIDDEN');
  });
  it('marks a transient per-minute 429 as retryable', () => {
    const r = distillClassifyGeminiError(429, { error: { message: 'Resource has been exhausted (per minute).' } });
    expect(r.code).toBe('GEMINI_RATE_LIMIT');
    expect(r.retryable).toBe(true);
  });
  it('detects a "limit: 0" no-free-quota account (not retryable)', () => {
    const r = distillClassifyGeminiError(429, { error: { message: 'Quota exceeded ... limit: 0, model: gemini-2.0-flash' } });
    expect(r.code).toBe('GEMINI_NO_FREE_QUOTA');
    expect(r.retryable).toBe(false);
    expect(r.message).toMatch(/no free-tier quota/i);
  });
  it('detects daily-quota exhaustion via quotaId (not retryable)', () => {
    const body = { error: { message: 'Quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } };
    const r = distillClassifyGeminiError(429, body);
    expect(r.code).toBe('GEMINI_DAILY_QUOTA');
    expect(r.retryable).toBe(false);
  });
  it('marks 5xx as retryable overload', () => {
    expect(distillClassifyGeminiError(503, null)).toMatchObject({ code: 'GEMINI_OVERLOADED', retryable: true });
  });
  it('falls back to the API message for other 400s', () => {
    const r = distillClassifyGeminiError(400, { error: { message: 'bad field' } });
    expect(r.code).toBe('GEMINI_BAD_REQUEST');
    expect(r.message).toMatch(/bad field/);
  });
});
