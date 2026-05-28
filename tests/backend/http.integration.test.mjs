/**
 * HTTP integration tests for the Express backend (no running server process).
 * Loads `backend/server.js` as a module so `app.listen` is skipped.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let app;

beforeAll(() => {
  const stateDir = mkdtempSync(join(tmpdir(), 'distill-be-int-'));
  const statePath = join(stateDir, 'state.json');
  writeFileSync(statePath, JSON.stringify({ usage: {}, tokenVersionByUser: {} }));

  process.env.ALLOW_INSECURE_SECRETS = '1';
  process.env.BACKEND_SECRET = 'test-backend-secret-32chars-minimum!';
  process.env.STATE_FILE_PATH = statePath;
  process.env.KILL_SWITCH_AI_RUN = '1';
  process.env.KILL_SWITCH_USAGE = '0';
  process.env.KILL_SWITCH_GUEST_AUTH = '0';
  process.env.DAILY_CREDITS = '5000';
  process.env.CORS_ORIGIN = '*';
  // Neutralize BOTH provider keys so a developer's local backend/.env (loaded by
  // dotenv in server.js) can't leak a real key and flip the aiReady/config flags.
  process.env.ANTHROPIC_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
  process.env.PORT = '59999';
  process.env.ENABLE_ADMIN_ROUTES = '0';

  const serverPath = require.resolve('../../backend/server.js');
  delete require.cache[serverPath];
  ({ app } = require(serverPath));
});

describe('backend HTTP', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /metrics returns JSON counters', async () => {
    const res = await request(app).get('/metrics').expect(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.requestsTotal).toBe('number');
    expect(typeof res.body.aiRunsTotal).toBe('number');
    expect(typeof res.body.aiRunErrors).toBe('number');
    expect(typeof res.body.aiRunAvgLatencyMs).toBe('number');
  });

  it('GET /metrics/prometheus returns text exposition', async () => {
    const res = await request(app).get('/metrics/prometheus').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('distill_requests_total');
    expect(res.text).toContain('# TYPE distill_ai_runs_total counter');
  });

  it('GET /v1/config exposes safe flags', async () => {
    const res = await request(app).get('/v1/config').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toMatchObject({
      aiReady: false,
      anthropicKeyConfigured: false,
      aiEnabled: false,
      usageEnabled: true,
      guestAuthEnabled: true
    });
  });

  it('POST /v1/auth/guest rejects missing installId', async () => {
    const res = await request(app).post('/v1/auth/guest').send({}).expect(400);
    expect(res.body.code).toBe('INSTALL_ID_REQUIRED');
  });

  it('POST /v1/auth/guest returns bearer token', async () => {
    const res = await request(app)
      .post('/v1/auth/guest')
      .send({ installId: 'vitest-install-001' })
      .expect(200);
    expect(res.body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(res.body.tokenType).toBe('Bearer');
    expect(typeof res.body.expiresInSec).toBe('number');
  });

  it('GET /v1/usage requires auth', async () => {
    const res = await request(app).get('/v1/usage').expect(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('GET /v1/usage returns credits with valid token', async () => {
    const auth = await request(app)
      .post('/v1/auth/guest')
      .send({ installId: 'vitest-install-usage' })
      .expect(200);
    const token = auth.body.token;
    const res = await request(app).get('/v1/usage').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.remainingCredits).toBeGreaterThan(0);
    expect(res.body.dailyLimit).toBe(5000);
    expect(res.body.resetAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('POST /v1/ai/run returns 503 when AI kill switch is on', async () => {
    const auth = await request(app)
      .post('/v1/auth/guest')
      .send({ installId: 'vitest-install-ai' })
      .expect(200);
    const token = auth.body.token;
    const res = await request(app)
      .post('/v1/ai/run')
      .set('Authorization', `Bearer ${token}`)
      .send({
        task: 'now',
        context: { recent: 'hello' },
        input: { paragraph: 'world' }
      })
      .expect(503);
    expect(res.body.code).toBe('ENDPOINT_DISABLED');
  });

  it('POST /v1/ai/run rejects unknown task (validation before AI handler)', async () => {
    const auth = await request(app)
      .post('/v1/auth/guest')
      .send({ installId: 'vitest-install-bad-task' })
      .expect(200);

    const res = await request(app)
      .post('/v1/ai/run')
      .set('Authorization', `Bearer ${auth.body.token}`)
      .send({ task: 'not_a_real_task', context: {}, input: {} })
      .expect(400);
    expect(res.body.code).toBe('TASK_UNKNOWN');
  });

  it('allows chrome-extension Origin on /health when CORS is *', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .expect(200);
    expect(res.body.ok).toBe(true);
  });
});
