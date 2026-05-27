/**
 * POST /v1/ai/run SSE integration tests with mocked LLM (no network).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  installLlmStreamMock,
  loadServerApp,
  parseSseBody,
  anthropicSseResponse
} from './helpers/mockLlmStream.mjs';

let app;

beforeAll(() => {
  const stateDir = mkdtempSync(join(tmpdir(), 'distill-be-sse-'));
  const statePath = join(stateDir, 'state.json');
  writeFileSync(statePath, JSON.stringify({ usage: {}, tokenVersionByUser: {} }));

  process.env.ALLOW_INSECURE_SECRETS = '1';
  process.env.BACKEND_SECRET = 'test-backend-secret-32chars-minimum!';
  process.env.STATE_FILE_PATH = statePath;
  process.env.KILL_SWITCH_AI_RUN = '0';
  process.env.KILL_SWITCH_USAGE = '0';
  process.env.KILL_SWITCH_GUEST_AUTH = '0';
  process.env.DAILY_CREDITS = '5000';
  process.env.CORS_ORIGIN = '*';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-mock-key';
  process.env.LLM_PROVIDER = 'anthropic';
  process.env.PORT = '59997';
  process.env.ENABLE_ADMIN_ROUTES = '0';

  installLlmStreamMock();
  app = loadServerApp();
});

async function guestToken(installId) {
  const res = await request(app).post('/v1/auth/guest').send({ installId }).expect(200);
  return res.body.token;
}

describe('POST /v1/ai/run SSE (mocked LLM)', () => {
  it('streams chunk and done events, debits credits', async () => {
    const installId = 'vitest-sse-ok-001';
    const token = await guestToken(installId);

    const usageBefore = await request(app)
      .get('/v1/usage')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const creditsBefore = usageBefore.body.remainingCredits;

    const res = await request(app)
      .post('/v1/ai/run')
      .set('Authorization', `Bearer ${token}`)
      .send({
        task: 'now',
        context: { recent: 'Some article context.' },
        input: { paragraph: 'A short paragraph.' }
      })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSseBody(res.text);
    const chunks = events.filter(e => e.event === 'chunk');
    const done = events.find(e => e.event === 'done');
    const err = events.find(e => e.event === 'error');

    expect(err).toBeUndefined();
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.map(c => c.data.text).join('')).toBe('Hello world');
    expect(done).toBeDefined();
    expect(done.data).toMatchObject({
      model: 'mock-haiku',
      provider: 'anthropic',
      cost: 4,
      aiMode: 'balanced'
    });
    expect(done.data.remainingCredits).toBe(creditsBefore - 4);

    const usageAfter = await request(app)
      .get('/v1/usage')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(usageAfter.body.remainingCredits).toBe(creditsBefore - 4);
  });

  it('emits error event when streamLlm fails', async () => {
    installLlmStreamMock({
      streamLlm: async () => {
        throw new Error('Mock provider unavailable');
      }
    });
    app = loadServerApp();

    const token = await guestToken('vitest-sse-err-001');

    const res = await request(app)
      .post('/v1/ai/run')
      .set('Authorization', `Bearer ${token}`)
      .send({
        task: 'now',
        context: { recent: 'ctx' },
        input: { paragraph: 'para' }
      })
      .expect(200);

    const events = parseSseBody(res.text);
    expect(events.some(e => e.event === 'chunk')).toBe(false);
    const err = events.find(e => e.event === 'error');
    expect(err).toBeDefined();
    expect(err.data.message).toContain('Mock provider unavailable');

    installLlmStreamMock();
    app = loadServerApp();
  });

  it('uses fallback model when primary stream fails once', async () => {
    let calls = 0;
    installLlmStreamMock({
      pickModelsForTask: () => ({
        provider: 'anthropic',
        primary: 'mock-primary',
        fallback: 'mock-fallback'
      }),
      streamLlm: async ({ model }) => {
        calls += 1;
        if (model === 'mock-primary') {
          throw new Error('Primary model down');
        }
        return anthropicSseResponse(['Fallback ', 'works.']);
      }
    });
    app = loadServerApp();

    const token = await guestToken('vitest-sse-fallback-001');

    const res = await request(app)
      .post('/v1/ai/run')
      .set('Authorization', `Bearer ${token}`)
      .send({
        task: 'now',
        context: { recent: 'ctx' },
        input: { paragraph: 'para' }
      })
      .expect(200);

    expect(calls).toBe(2);
    const events = parseSseBody(res.text);
    const text = events.filter(e => e.event === 'chunk').map(e => e.data.text).join('');
    expect(text).toBe('Fallback works.');
    const done = events.find(e => e.event === 'done');
    expect(done.data.model).toBe('mock-fallback');

    installLlmStreamMock();
    app = loadServerApp();
  });
});
