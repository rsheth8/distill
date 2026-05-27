/**
 * Backend security: PUBLIC_BACKEND CORS allowlist + guest auth rate limits.
 * Loads server in its own process env (separate vitest worker from other integration tests).
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
  const stateDir = mkdtempSync(join(tmpdir(), 'distill-be-sec-'));
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
  process.env.PUBLIC_BACKEND = '1';
  process.env.EXTENSION_CORS_ORIGINS = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  process.env.RATE_LIMIT_GUEST_AUTH_PER_INSTALL_PER_MIN = '3';
  process.env.RATE_LIMIT_GUEST_AUTH_IP_PER_MIN = '500';
  process.env.ANTHROPIC_API_KEY = '';
  process.env.PORT = '59998';
  process.env.ENABLE_ADMIN_ROUTES = '0';

  const serverPath = require.resolve('../../backend/server.js');
  delete require.cache[serverPath];
  ({ app } = require(serverPath));
});

describe('backend security (public CORS + guest auth limits)', () => {
  const prodHost = 'distill-test.example';

  it('reflects allowed chrome-extension Origin on GET /v1/config when PUBLIC_BACKEND (non-loopback Host)', async () => {
    const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const res = await request(app)
      .get('/v1/config')
      .set('Host', prodHost)
      .set('Origin', origin)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('does not allow a chrome-extension Origin missing from EXTENSION_CORS_ORIGINS (non-loopback Host)', async () => {
    const origin = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const res = await request(app)
      .get('/v1/config')
      .set('Host', prodHost)
      .set('Origin', origin)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows any chrome-extension Origin on loopback Host even when PUBLIC_BACKEND (local dev)', async () => {
    const origin = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const res = await request(app)
      .get('/v1/config')
      .set('Host', 'localhost:8787')
      .set('Origin', origin)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('returns 429 on guest auth after per-install burst', async () => {
    const installId = 'vitest-guest-burst-001';
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/v1/auth/guest')
        .send({ installId })
        .expect(200);
    }
    const res = await request(app).post('/v1/auth/guest').send({ installId }).expect(429);
    expect(res.body.code).toBe('RATE_LIMIT_GUEST_AUTH');
    expect(res.body.retryAfterSec).toBeGreaterThan(0);
  });
});
