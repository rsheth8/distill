const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

const CONFIG = {
  port: Number(process.env.PORT || 8787),
  backendSecret: process.env.BACKEND_SECRET || 'dev-insecure-secret',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  /** auto | gemini | anthropic — auto prefers Gemini when GEMINI_API_KEY is set. */
  llmProvider: String(process.env.LLM_PROVIDER || 'auto').trim().toLowerCase(),
  geminiModel: String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim(),
  dailyCredits: Number(process.env.DAILY_CREDITS || 1200),
  usageResetHourUtc: Number(process.env.USAGE_RESET_HOUR_UTC || 0),
  enableAiRun: process.env.KILL_SWITCH_AI_RUN !== '1',
  enableGuestAuth: process.env.KILL_SWITCH_GUEST_AUTH !== '1',
  enableUsage: process.env.KILL_SWITCH_USAGE !== '1',
  perIpRateLimitPerMin: Number(process.env.RATE_LIMIT_IP_PER_MIN || 120),
  perUserRateLimitPerMin: Number(process.env.RATE_LIMIT_USER_PER_MIN || 90),
  /** When > 0, caps per-install (guest token sub) requests per minute at min(user, this). */
  perInstallRateLimitPerMin: Number(process.env.RATE_LIMIT_PER_INSTALL_PER_MIN || 0),
  guestAuthPerIpPerMin: Number(process.env.RATE_LIMIT_GUEST_AUTH_IP_PER_MIN || 40),
  guestAuthPerInstallPerMin: Number(process.env.RATE_LIMIT_GUEST_AUTH_PER_INSTALL_PER_MIN || 15),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  publicBackend: process.env.PUBLIC_BACKEND === '1',
  extensionCorsAllowlist: (() => {
    const raw = process.env.EXTENSION_CORS_ORIGINS || '';
    return new Set(String(raw).split(',').map(s => s.trim()).filter(Boolean));
  })(),
  stateFilePath: (() => {
    const raw = process.env.STATE_FILE_PATH;
    if (!raw) return path.join(__dirname, 'data', 'state.json');
    return path.isAbsolute(raw) ? raw : path.resolve(__dirname, raw);
  })(),
  tokenTtlSec: Number(process.env.TOKEN_TTL_SEC || 60 * 60 * 24 * 30),
  adminSecret: process.env.ADMIN_SECRET || '',
  enableAdminRoutes: process.env.ENABLE_ADMIN_ROUTES === '1',
  requestLogFile: (() => {
    const raw = process.env.REQUEST_LOG_FILE;
    if (!raw || !String(raw).trim()) return '';
    const s = String(raw).trim();
    return path.isAbsolute(s) ? s : path.resolve(__dirname, s);
  })(),
  requestLogMaxBytes: Math.max(1024, Number(process.env.REQUEST_LOG_MAX_BYTES || 10 * 1024 * 1024)),
  requestLogMaxFiles: Math.max(1, Math.min(100, Number(process.env.REQUEST_LOG_MAX_FILES || 5))),
  requestLogStdout: process.env.REQUEST_LOG_STDOUT === '1',
  requestLogSkipPaths: (() => {
    const raw = process.env.REQUEST_LOG_SKIP_PATHS;
    if (raw === undefined) {
      return new Set(['/healthz', '/health', '/metrics', '/metrics/prometheus']);
    }
    const trimmed = String(raw).trim();
    if (trimmed === '' || trimmed === '-') return new Set();
    return new Set(trimmed.split(',').map(p => p.trim()).filter(Boolean));
  })(),
  /** Supabase Postgres (pooler) or any Postgres. When set, usage + token_version persist in DB instead of STATE_FILE_PATH. */
  databaseUrl: String(process.env.DATABASE_URL || '').trim()
};

function validateSecretsOrExit() {
  const allowInsecure = process.env.ALLOW_INSECURE_SECRETS === '1';
  const isDefault = CONFIG.backendSecret === 'replace-with-random-secret' || CONFIG.backendSecret === 'dev-insecure-secret';
  const tooShort = !CONFIG.backendSecret || String(CONFIG.backendSecret).length < 24;
  if (!allowInsecure && (isDefault || tooShort)) {
    const onFly = String(process.env.FLY_APP_NAME || '').trim();
    const flyHint = onFly
      ? ` On Fly.io there is no .env in the image — run: fly secrets set BACKEND_SECRET="$(openssl rand -hex 32)" then fly deploy`
      : ' Set BACKEND_SECRET in backend/.env to a long random string (>=24 chars).';
    console.error(
      'BACKEND_SECRET is missing/weak.' +
        flyHint +
        ' For local throwaway testing only, set ALLOW_INSECURE_SECRETS=1.'
    );
    process.exit(1);
  }
}

/** True when the HTTP Host is loopback (local dev server). Not set on bare supertest req. */
function isLoopbackRequestHost(hostHeader) {
  const raw = String(hostHeader || '').trim().split(':')[0].toLowerCase();
  if (!raw) return false;
  return raw === 'localhost' || raw === '127.0.0.1' || raw === '::1' || raw === '[::1]';
}

function corsOptionsDelegate(req, callback) {
  const exposed = ['Retry-After'];
  const corsOriginRaw = String(CONFIG.corsOrigin || '').trim();
  if (corsOriginRaw && corsOriginRaw !== '*') {
    const allow = new Set(corsOriginRaw.split(',').map(s => s.trim()).filter(Boolean));
    const originHdr = req.headers.origin;
    if (!originHdr) return callback(null, { origin: true, exposedHeaders: exposed });
    return callback(null, { origin: allow.has(String(originHdr)), exposedHeaders: exposed });
  }

  const originHdr = req.headers.origin;
  if (!originHdr) {
    return callback(null, { origin: true, exposedHeaders: exposed });
  }
  const o = String(originHdr);
  if (o.startsWith('http://localhost') || o.startsWith('http://127.0.0.1')) {
    return callback(null, { origin: true, exposedHeaders: exposed });
  }
  if (o.startsWith('chrome-extension://')) {
    const strictExtensionCors = CONFIG.publicBackend && !isLoopbackRequestHost(req.headers.host);
    if (strictExtensionCors) {
      const ok = CONFIG.extensionCorsAllowlist.size > 0 && CONFIG.extensionCorsAllowlist.has(o);
      return callback(null, { origin: ok, exposedHeaders: exposed });
    }
    return callback(null, { origin: true, exposedHeaders: exposed });
  }
  return callback(null, { origin: false, exposedHeaders: exposed });
}

validateSecretsOrExit();

const { createStateStore } = require('./lib/stateStore');
const {
  resolveProvider,
  isAiConfigured,
  pickModelsForTask,
  streamLlm,
  consumeLlmStream
} = require('./lib/llmStream');
const stateStore = createStateStore({
  databaseUrl: CONFIG.databaseUrl,
  stateFilePath: CONFIG.stateFilePath,
  dailyCredits: CONFIG.dailyCredits,
  usageResetHourUtc: CONFIG.usageResetHourUtc
});

if (CONFIG.enableAiRun && !isAiConfigured(CONFIG)) {
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'AI enabled but no LLM key configured',
      hint: 'Set GEMINI_API_KEY (recommended) and/or ANTHROPIC_API_KEY in env or Fly secrets.'
    })
  );
}

if (CONFIG.publicBackend && CONFIG.extensionCorsAllowlist.size === 0 && String(CONFIG.corsOrigin).trim() === '*') {
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'PUBLIC_BACKEND with empty EXTENSION_CORS_ORIGINS: chrome-extension origins are blocked on non-loopback hosts when CORS_ORIGIN=*.',
      hint: 'Set EXTENSION_CORS_ORIGINS=chrome-extension://<extension-id>, or omit PUBLIC_BACKEND for local-only dev.'
    })
  );
}

app.use(cors(corsOptionsDelegate));
app.use(express.json({ limit: '1mb' }));
app.use(requestLifecycleMiddleware);

const TASK_COSTS = {
  now: 4,
  summary: 10,
  analysis: 12,
  quiz_question: 5,
  quiz_feedback: 7,
  quiz_skipped_review: 6,
  explain_page: 8
};

const TASK_MODEL_ROUTER = {
  now: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' },
  quiz_question: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' },
  quiz_feedback: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' },
  quiz_skipped_review: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' },
  summary: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' },
  analysis: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' },
  explain_page: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' }
};

const LLM_CONFIG = {
  get llmProvider() {
    return CONFIG.llmProvider;
  },
  get geminiApiKey() {
    return CONFIG.geminiApiKey;
  },
  get anthropicApiKey() {
    return CONFIG.anthropicApiKey;
  },
  get geminiModel() {
    return CONFIG.geminiModel;
  },
  get anthropicModelRouter() {
    return TASK_MODEL_ROUTER;
  }
};

// Keep in sync with extension `background.js` AI_TUNING tables.
const DEFAULT_AI_MODE = 'balanced';
const AI_TUNING = {
  balanced: {
    taskMaxTokens: {
      now: 70,
      summary: 280,
      quiz_question: 90,
      quiz_feedback: 180,
      quiz_skipped_review: 170,
      explain_page: 180,
      analysis: 260
    }
  },
  'ultra-lean': {
    taskMaxTokens: {
      now: 50,
      summary: 190,
      quiz_question: 70,
      quiz_feedback: 130,
      quiz_skipped_review: 120,
      explain_page: 130,
      analysis: 180
    }
  }
};

const userRateMap = new Map();
const ipRateMap = new Map();
const guestAuthIpRateMap = new Map();
const guestAuthInstallRateMap = new Map();

// Tiny in-process metrics (public-friendly; no PII beyond coarse counters).
const metrics = {
  requestsTotal: 0,
  aiRunsTotal: 0,
  aiRunErrors: 0,
  aiRunLatencyMsSum: 0,
  aiRunLatencyMsCount: 0
};

function maxTokensForTask(task, aiMode) {
  const mode = aiMode === 'ultra-lean' ? 'ultra-lean' : DEFAULT_AI_MODE;
  const n = AI_TUNING?.[mode]?.taskMaxTokens?.[task];
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 128;
  // Anthropic max_tokens is bounded; keep sane.
  return Math.max(16, Math.min(v, 4096));
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac('sha256', CONFIG.backendSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

async function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token shape.');
  const [headerB64, payloadB64, sig] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expected = crypto.createHmac('sha256', CONFIG.backendSecret).update(data).digest('base64url');
  if (sig !== expected) throw new Error('Invalid token signature.');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  if (!payload.sub || !payload.exp) throw new Error('Token missing required claims.');
  if (Math.floor(Date.now() / 1000) >= payload.exp) throw new Error('Token expired.');
  const currentVersion = await stateStore.getTokenVersion(payload.sub);
  if ((payload.ver || 1) !== currentVersion) throw new Error('Token revoked.');
  return payload;
}

function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function recordRateHit(map, key, limit) {
  const now = Date.now();
  const windowStart = now - 60000;
  const hits = (map.get(key) || []).filter(ts => ts > windowStart);
  hits.push(now);
  map.set(key, hits);
  if (hits.length <= limit) return { allowed: true, retryAfterSec: 0 };

  const oldest = hits[0] || now;
  const msLeft = Math.max(0, (oldest + 60000) - now);
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(msLeft / 1000)) };
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Missing bearer token.' });
  }
  try {
    req.auth = await verifyToken(authHeader.slice(7));
    return next();
  } catch (err) {
    return res.status(401).json({ code: 'AUTH_INVALID', message: err.message || 'Invalid token.' });
  }
}

function adminAuthMiddleware(req, res, next) {
  if (!CONFIG.enableAdminRoutes) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
  }
  if (!CONFIG.adminSecret) {
    return res.status(503).json({ code: 'ADMIN_DISABLED', message: 'Admin endpoints are enabled but ADMIN_SECRET is missing.' });
  }
  const provided = req.headers['x-admin-secret'];
  if (!provided || provided !== CONFIG.adminSecret) {
    return res.status(401).json({ code: 'ADMIN_UNAUTHORIZED', message: 'Invalid admin secret.' });
  }
  return next();
}

let requestLogWriteLock = Promise.resolve();

function rotateRequestLogIfNeeded() {
  const logPath = CONFIG.requestLogFile;
  if (!logPath || !fs.existsSync(logPath)) return;
  const st = fs.statSync(logPath);
  if (st.size < CONFIG.requestLogMaxBytes) return;
  const max = CONFIG.requestLogMaxFiles;
  const oldest = `${logPath}.${max}`;
  try {
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  } catch {
    /* ignore */
  }
  for (let i = max - 1; i >= 1; i--) {
    const from = `${logPath}.${i}`;
    const to = `${logPath}.${i + 1}`;
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.renameSync(logPath, `${logPath}.1`);
  } catch {
    /* ignore */
  }
}

function appendRequestLogLine(line) {
  const logPath = CONFIG.requestLogFile;
  if (!logPath) return;
  requestLogWriteLock = requestLogWriteLock.then(() => {
    try {
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      rotateRequestLogIfNeeded();
      fs.appendFileSync(logPath, line, { encoding: 'utf8' });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'request_log_write_failed', error: err.message }));
    }
  });
}

function truncateAgent(ua, max = 200) {
  const s = String(ua || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function attachRequestAccessLogging(req, res) {
  const pathname = req.path || req.url?.split('?')[0] || '';
  if (CONFIG.requestLogSkipPaths.has(pathname)) return;
  if (!CONFIG.requestLogStdout && !CONFIG.requestLogFile) return;

  const finish = () => {
    if (res._accessLogged) return;
    res._accessLogged = true;
    const durationMs = Math.max(0, Date.now() - (req.requestStartedAt || Date.now()));
    const row = {
      level: 'access',
      ts: new Date().toISOString(),
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl?.split('?')[0] || req.path,
      statusCode: res.statusCode,
      durationMs,
      ip: getIp(req),
      userAgent: truncateAgent(req.headers['user-agent'])
    };
    const line = `${JSON.stringify(row)}\n`;
    if (CONFIG.requestLogStdout) process.stdout.write(line);
    if (CONFIG.requestLogFile) appendRequestLogLine(line);
  };

  res.on('finish', finish);
  res.on('close', finish);
}

function requestLifecycleMiddleware(req, res, next) {
  metrics.requestsTotal++;
  req.requestId = crypto.randomUUID();
  req.requestStartedAt = Date.now();
  attachRequestAccessLogging(req, res);
  next();
}

function guestAuthRateLimitMiddleware(req, res, next) {
  const ip = getIp(req);
  const ipStatus = recordRateHit(guestAuthIpRateMap, ip, CONFIG.guestAuthPerIpPerMin);
  if (!ipStatus.allowed) {
    res.setHeader('Retry-After', String(ipStatus.retryAfterSec));
    return res.status(429).json({
      code: 'RATE_LIMIT_GUEST_AUTH',
      message: `Too many guest auth requests from this network. Retry in ~${ipStatus.retryAfterSec}s.`,
      retryAfterSec: ipStatus.retryAfterSec
    });
  }
  const installId = req.body?.installId;
  if (typeof installId === 'string' && installId.length > 256) {
    return res.status(400).json({ code: 'INSTALL_ID_INVALID', message: 'installId is too long.' });
  }
  if (typeof installId === 'string' && installId.length > 0) {
    const inst = recordRateHit(guestAuthInstallRateMap, installId, CONFIG.guestAuthPerInstallPerMin);
    if (!inst.allowed) {
      res.setHeader('Retry-After', String(inst.retryAfterSec));
      return res.status(429).json({
        code: 'RATE_LIMIT_GUEST_AUTH',
        message: `Too many guest auth requests for this install. Retry in ~${inst.retryAfterSec}s.`,
        retryAfterSec: inst.retryAfterSec
      });
    }
  }
  return next();
}

function rateLimitMiddleware(req, res, next) {
  const ip = getIp(req);
  const ipStatus = recordRateHit(ipRateMap, ip, CONFIG.perIpRateLimitPerMin);
  if (!ipStatus.allowed) {
    res.setHeader('Retry-After', String(ipStatus.retryAfterSec));
    return res.status(429).json({
      code: 'RATE_LIMIT_IP',
      message: `Too many requests from this IP. Retry in ~${ipStatus.retryAfterSec}s.`,
      retryAfterSec: ipStatus.retryAfterSec
    });
  }
  const userKey = req.auth?.sub || `ip:${ip}`;
  const perInstallCap =
    CONFIG.perInstallRateLimitPerMin > 0
      ? Math.min(CONFIG.perUserRateLimitPerMin, CONFIG.perInstallRateLimitPerMin)
      : CONFIG.perUserRateLimitPerMin;
  const userStatus = recordRateHit(userRateMap, userKey, perInstallCap);
  if (!userStatus.allowed) {
    res.setHeader('Retry-After', String(userStatus.retryAfterSec));
    return res.status(429).json({
      code: 'RATE_LIMIT_USER',
      message: `Too many requests for this user. Retry in ~${userStatus.retryAfterSec}s.`,
      retryAfterSec: userStatus.retryAfterSec
    });
  }
  return next();
}

async function quotaMiddleware(req, res, next) {
  const task = req.body?.task;
  const aiMode = req.body?.meta?.aiMode === 'ultra-lean' ? 'ultra-lean' : 'balanced';
  const cost = calculateTaskCost(task, aiMode);
  if (!cost) {
    return res.status(400).json({ code: 'TASK_UNKNOWN', message: `Unknown task '${task}'.` });
  }
  try {
    const record = await stateStore.getUsageRecord(req.auth.sub);
    if (record.remainingCredits < cost) {
      return res.status(402).json({
        code: 'QUOTA_EXCEEDED',
        message: 'Daily credits exhausted.',
        remainingCredits: record.remainingCredits,
        dailyLimit: record.dailyLimit,
        resetAt: record.resetAt
      });
    }
    req.taskCost = cost;
    req.aiMode = aiMode;
    req.usageRecord = record;
    return next();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'quota_usage_read_failed', error: err.message }));
    return res.status(503).json({ code: 'USAGE_UNAVAILABLE', message: 'Usage store unavailable.' });
  }
}

function calculateTaskCost(task, aiMode) {
  const baseCost = TASK_COSTS[task];
  if (!baseCost) return 0;
  const multiplier = aiMode === 'ultra-lean' ? 0.6 : 1;
  return Math.max(1, Math.round(baseCost * multiplier));
}

function validateAiRunBody(req, res, next) {
  const task = req.body?.task;
  if (!task || typeof task !== 'string') {
    return res.status(400).json({ code: 'TASK_REQUIRED', message: 'task is required.' });
  }
  if (!TASK_COSTS[task]) {
    return res.status(400).json({ code: 'TASK_UNKNOWN', message: `Unknown task '${task}'.` });
  }
  if (req.body.context && typeof req.body.context !== 'object') {
    return res.status(400).json({ code: 'CONTEXT_INVALID', message: 'context must be an object.' });
  }
  if (req.body.input && typeof req.body.input !== 'object') {
    return res.status(400).json({ code: 'INPUT_INVALID', message: 'input must be an object.' });
  }
  if (req.body.meta != null && typeof req.body.meta !== 'object') {
    return res.status(400).json({ code: 'META_INVALID', message: 'meta must be an object.' });
  }
  return next();
}

function clampText(text, maxChars) {
  const t = (text || '').trim();
  if (!maxChars || t.length <= maxChars) return t;
  return `${t.slice(0, maxChars).trim()}\n…`;
}

function joinUserBlocks(blocks) {
  return blocks
    .filter(Boolean)
    .map(b => (typeof b === 'string' ? b : ''))
    .join('\n\n');
}

function buildPrompt(task, payload) {
  const context = payload.context || {};
  const input = payload.input || {};

  // Default system prompts mirror extension `background.js` streamTask usage.
  if (task === 'now') {
    const recent = clampText(context.recent || '(start of article)', 3200);
    const paragraph = clampText(input.paragraph || '', 1300);
    return {
      system: 'You are a reading companion. Give one crisp sentence that helps the reader keep momentum.',
      user: joinUserBlocks([
        `Recent context:\n\n${recent}`,
        `Current paragraph:\n\n"${paragraph}"\n\nIn ONE plain sentence (max 22 words), say what this means and why it matters.`
      ])
    };
  }

  if (task === 'summary') {
    const title = context.title || '(untitled)';
    const opener = context.opener || '(not available)';
    const recent = context.recent || '(none yet)';
    const readCount = typeof context.readCount === 'number' ? context.readCount : 0;
    const readSoFar = clampText(input.readSoFar || '', 12000);
    const freshRead = clampText(input.freshRead || '', 3200);
    const prevSummary = (context.prevSummary || input.prevSummary || '').trim();
    const isFirstSummary = !prevSummary;

    const system = 'You are a reading companion. Summarize only what the reader has read so far — never hint at what comes next.';
    const userBlocks = [
      `Article title: ${title}`,
      `Opening paragraph:\n\n${opener}`,
      !isFirstSummary ? `Previous summary:\n\n${prevSummary}` : null,
      `Most recent read context:\n\n${recent}`,
      isFirstSummary
        ? `Read so far (${readCount} paragraph(s)):\n\n${readSoFar}`
        : `Newly read section since last update:\n\n${freshRead || '(no significant change)'}`,
      isFirstSummary
        ? 'Write only what was read. Format exactly: one line "The gist: ..." plus up to 3 short bullets. No headings. No markdown.'
        : 'Continue the summary with 1-3 NEW bullets for the newly read section. Keep previous details intact, avoid repeated points, and do not add headings.'
    ];
    return { system, user: joinUserBlocks(userBlocks) };
  }

  if (task === 'quiz_question') {
    const recent = clampText(context.recent || '', 3200);
    return {
      system: 'You generate single, focused comprehension questions to test reading understanding.',
      user: joinUserBlocks([
        `The reader just finished:\n\n${recent}`,
        'Ask ONE short, specific comprehension question about this section only. Output only the question.'
      ])
    };
  }

  if (task === 'quiz_feedback') {
    const recent = clampText(context.recent || '', 3200);
    const question = input.question || '';
    const answer = clampText(input.answer || '', 700);
    return {
      system: 'You give brief, encouraging feedback on reading comprehension answers. Be warm and specific.',
      user: joinUserBlocks([
        `Recent section:\n\n${recent}`,
        `Question: ${question}\nReader answer: "${answer}"\n\nGive 2-3 supportive sentences: correctness + what was right/missed.`
      ])
    };
  }

  if (task === 'quiz_skipped_review') {
    const recent = clampText(context.recent || '', 3200);
    const question = input.question || '';
    return {
      system: 'You provide concise reading-comprehension coaching.',
      user: joinUserBlocks([
        `Recent section:\n\n${recent}`,
        `Question: ${question}\n\nThe reader skipped this check-in.\nProvide a short model answer and one key takeaway in 2-3 sentences.`
      ])
    };
  }

  if (task === 'analysis') {
    const title = context.title || '(untitled)';
    const opener = context.opener || '(not available)';
    const priorGist = (context.priorGist || '').trim();
    const recent = clampText(context.recent || '', 3200);
    const selection = clampText(input.selection || '', 900);
    const system = 'You add context and depth to highlighted text.';
    const userBlocks = [
      `Article title: ${title}`,
      `Opening paragraph:\n\n${opener}`,
      priorGist ? `Article gist so far:\n${priorGist}` : null,
      `Recent reading context:\n\n${recent}`,
      `Highlighted:\n\n"${selection}"\n\nExplain in context in 3-5 conversational sentences.`
    ];
    return { system, user: joinUserBlocks(userBlocks) };
  }

  if (task === 'explain_page') {
    const pageText = clampText(input.pageText || '', 7000);
    return {
      system: 'You explain web pages in plain, friendly language.',
      user: joinUserBlocks([
        `Page content:\n\n${pageText}`,
        'Explain this web page in plain, friendly language. Cover what kind of page it is, what it\'s about (2–3 sentences), and who it\'s for. Under 120 words. No bullet points.'
      ])
    };
  }

  // Safe fallback for unknown future tasks.
  return {
    system: 'You are a reading companion. Keep responses concise and accurate.',
    user: joinUserBlocks([
      `Task: ${task}`,
      `Title: ${context.title || '(untitled)'}`,
      `Context:\n${JSON.stringify(context)}`,
      `Input:\n${JSON.stringify(input)}`,
      'Return only useful reader-facing text.'
    ])
  };
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Alias for common probes/load balancers.
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function getMetricsSnapshot() {
  const avgLatencyMs = metrics.aiRunLatencyMsCount
    ? Math.round(metrics.aiRunLatencyMsSum / metrics.aiRunLatencyMsCount)
    : 0;
  return {
    ok: true,
    requestsTotal: metrics.requestsTotal,
    aiRunsTotal: metrics.aiRunsTotal,
    aiRunErrors: metrics.aiRunErrors,
    aiRunAvgLatencyMs: avgLatencyMs,
    aiRunLatencyMsSum: metrics.aiRunLatencyMsSum,
    aiRunLatencyMsCount: metrics.aiRunLatencyMsCount
  };
}

function formatPrometheusMetrics(snapshot) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return [
    '# HELP distill_requests_total HTTP requests since process start.',
    '# TYPE distill_requests_total counter',
    `distill_requests_total ${n(snapshot.requestsTotal)}`,
    '# HELP distill_ai_runs_total AI /v1/ai/run invocations since process start.',
    '# TYPE distill_ai_runs_total counter',
    `distill_ai_runs_total ${n(snapshot.aiRunsTotal)}`,
    '# HELP distill_ai_run_errors_total AI runs that emitted an SSE error event.',
    '# TYPE distill_ai_run_errors_total counter',
    `distill_ai_run_errors_total ${n(snapshot.aiRunErrors)}`,
    '# HELP distill_ai_run_latency_ms_sum Sum of AI run durations in milliseconds.',
    '# TYPE distill_ai_run_latency_ms_sum counter',
    `distill_ai_run_latency_ms_sum ${n(snapshot.aiRunLatencyMsSum)}`,
    '# HELP distill_ai_run_latency_ms_count AI runs included in latency sum.',
    '# TYPE distill_ai_run_latency_ms_count counter',
    `distill_ai_run_latency_ms_count ${n(snapshot.aiRunLatencyMsCount)}`,
    '# HELP distill_ai_run_latency_ms_avg Mean AI run latency (derived gauge).',
    '# TYPE distill_ai_run_latency_ms_avg gauge',
    `distill_ai_run_latency_ms_avg ${n(snapshot.aiRunAvgLatencyMs)}`,
    ''
  ].join('\n');
}

app.get('/metrics', (_req, res) => {
  res.json(getMetricsSnapshot());
});

app.get('/metrics/prometheus', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(formatPrometheusMetrics(getMetricsSnapshot()));
});

// Minimal, non-sensitive config probe for UI/ops.
// Intentionally does NOT expose any secrets (only boolean flags).
app.get('/v1/config', (_req, res) => {
  const aiReady = isAiConfigured(CONFIG);
  let activeProvider = null;
  if (aiReady) {
    try {
      activeProvider = resolveProvider(CONFIG);
    } catch {
      activeProvider = null;
    }
  }
  res.json({
    ok: true,
    version: '0.1.0',
    aiReady,
    /** @deprecated use aiReady — kept for older extension builds */
    anthropicKeyConfigured: aiReady,
    geminiKeyConfigured: !!CONFIG.geminiApiKey,
    llmProvider: activeProvider || CONFIG.llmProvider,
    aiEnabled: !!CONFIG.enableAiRun,
    usageEnabled: !!CONFIG.enableUsage,
    guestAuthEnabled: !!CONFIG.enableGuestAuth
  });
});

app.post('/v1/auth/guest', guestAuthRateLimitMiddleware, async (req, res) => {
  if (!CONFIG.enableGuestAuth) {
    return res.status(503).json({ code: 'ENDPOINT_DISABLED', message: 'Guest auth is disabled.' });
  }
  const installId = req.body?.installId;
  if (!installId || typeof installId !== 'string') {
    return res.status(400).json({ code: 'INSTALL_ID_REQUIRED', message: 'installId is required.' });
  }
  if (installId.length > 256) {
    return res.status(400).json({ code: 'INSTALL_ID_INVALID', message: 'installId is too long.' });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const userId = `guest:${installId}`;
  try {
    const tokenVersion = await stateStore.getTokenVersion(userId);
    const payload = {
      sub: userId,
      iat: nowSec,
      exp: nowSec + CONFIG.tokenTtlSec,
      ver: tokenVersion
    };
    const token = signToken(payload);
    await stateStore.getUsageRecord(payload.sub);
    console.log(JSON.stringify({ level: 'info', requestId: req.requestId, route: '/v1/auth/guest', userId }));
    return res.json({ token, tokenType: 'Bearer', expiresInSec: CONFIG.tokenTtlSec });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'guest_auth_failed', error: err.message }));
    return res.status(503).json({ code: 'AUTH_STORE_UNAVAILABLE', message: 'Auth storage unavailable.' });
  }
});

app.post('/v1/auth/rotate', authMiddleware, async (req, res) => {
  const userId = req.auth.sub;
  try {
    const next = await stateStore.bumpTokenVersion(userId);
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      sub: userId,
      iat: nowSec,
      exp: nowSec + CONFIG.tokenTtlSec,
      ver: next
    };
    const token = signToken(payload);
    return res.json({ ok: true, token, tokenType: 'Bearer', expiresInSec: CONFIG.tokenTtlSec });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'token_rotate_failed', error: err.message }));
    return res.status(503).json({ code: 'AUTH_STORE_UNAVAILABLE', message: 'Auth storage unavailable.' });
  }
});

if (CONFIG.enableAdminRoutes) {
  app.post('/v1/admin/revoke-user', adminAuthMiddleware, async (req, res) => {
    const userId = req.body?.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ code: 'USER_ID_REQUIRED', message: 'userId is required.' });
    }
    try {
      const tokenVersion = await stateStore.bumpTokenVersion(userId);
      console.log(JSON.stringify({
        level: 'info',
        requestId: req.requestId,
        route: '/v1/admin/revoke-user',
        userId,
        tokenVersion
      }));
      return res.json({ ok: true, userId, tokenVersion });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'admin_revoke_failed', error: err.message }));
      return res.status(503).json({ code: 'AUTH_STORE_UNAVAILABLE', message: 'Auth storage unavailable.' });
    }
  });

  app.post('/v1/admin/reset-usage', adminAuthMiddleware, async (req, res) => {
    const userId = req.body?.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ code: 'USER_ID_REQUIRED', message: 'userId is required.' });
    }
    try {
      const reset = await stateStore.resetUsage(userId);
      console.log(JSON.stringify({
        level: 'info',
        requestId: req.requestId,
        route: '/v1/admin/reset-usage',
        userId,
        remainingCredits: reset.remainingCredits
      }));
      return res.json({ ok: true, userId, usage: reset });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'admin_reset_usage_failed', error: err.message }));
      return res.status(503).json({ code: 'USAGE_STORE_UNAVAILABLE', message: 'Usage store unavailable.' });
    }
  });

  app.get('/v1/admin/user-state/:userId', adminAuthMiddleware, async (req, res) => {
    const userId = req.params.userId;
    try {
      const usage = await stateStore.getUsageRecord(userId);
      const tokenVersion = await stateStore.getTokenVersion(userId);
      return res.json({
        userId,
        tokenVersion,
        usage
      });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'admin_user_state_failed', error: err.message }));
      return res.status(503).json({ code: 'USAGE_STORE_UNAVAILABLE', message: 'Usage store unavailable.' });
    }
  });
}

app.get('/v1/usage', authMiddleware, rateLimitMiddleware, async (req, res) => {
  if (!CONFIG.enableUsage) {
    return res.status(503).json({ code: 'ENDPOINT_DISABLED', message: 'Usage endpoint is disabled.' });
  }
  try {
    const usage = await stateStore.getUsageRecord(req.auth.sub);
    return res.json({
      remainingCredits: usage.remainingCredits,
      dailyLimit: usage.dailyLimit,
      resetAt: usage.resetAt
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'usage_read_failed', error: err.message }));
    return res.status(503).json({ code: 'USAGE_UNAVAILABLE', message: 'Usage store unavailable.' });
  }
});

app.post('/v1/ai/run', authMiddleware, rateLimitMiddleware, validateAiRunBody, quotaMiddleware, async (req, res) => {
  if (!CONFIG.enableAiRun) {
    return res.status(503).json({ code: 'ENDPOINT_DISABLED', message: 'AI endpoint is disabled.' });
  }

  const task = req.body?.task;
  const startedAt = Date.now();
  const aiMode = req.aiMode || 'balanced';
  const tokenBudget = maxTokensForTask(task, aiMode);
  const prompt = buildPrompt(task, req.body);
  metrics.aiRunsTotal++;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const writeEvent = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let chosenModel = '';
  let chosenProvider = '';
  let emittedChars = 0;
  try {
    const provider = resolveProvider(CONFIG);
    let modelPlan = pickModelsForTask(task, provider, LLM_CONFIG);
    chosenProvider = modelPlan.provider;
    chosenModel = modelPlan.primary;
    let streamResponse;
    try {
      streamResponse = await streamLlm({
        provider: modelPlan.provider,
        model: modelPlan.primary,
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        maxTokens: tokenBudget,
        config: CONFIG
      });
    } catch (firstErr) {
      if (modelPlan.fallback && modelPlan.fallback !== modelPlan.primary) {
        chosenModel = modelPlan.fallback;
        streamResponse = await streamLlm({
          provider: modelPlan.provider,
          model: modelPlan.fallback,
          systemPrompt: prompt.system,
          userMessage: prompt.user,
          maxTokens: tokenBudget,
          config: CONFIG
        });
      } else {
        throw firstErr;
      }
    }

    await consumeLlmStream(streamResponse, chosenProvider, chunk => {
      emittedChars += chunk.length;
      writeEvent('chunk', { text: chunk });
    });

    await stateStore.applyDebit(req.auth.sub, req.taskCost, req.usageRecord);
    writeEvent('done', {
      model: chosenModel,
      provider: chosenProvider,
      cost: req.taskCost,
      aiMode,
      remainingCredits: req.usageRecord.remainingCredits
    });
    res.end();
  } catch (err) {
    metrics.aiRunErrors++;
    writeEvent('error', { message: err.message || 'AI request failed.' });
    res.end();
  } finally {
    const latencyMs = Date.now() - startedAt;
    metrics.aiRunLatencyMsSum += latencyMs;
    metrics.aiRunLatencyMsCount++;
    console.log(JSON.stringify({
      level: 'info',
      requestId: req.requestId,
      route: '/v1/ai/run',
      userId: req.auth.sub,
      task,
      aiMode,
      provider: chosenProvider,
      model: chosenModel,
      latencyMs,
      emittedChars,
      taskCost: req.taskCost,
      remainingCredits: req.usageRecord.remainingCredits
    }));
  }
});

if (!CONFIG.databaseUrl) {
  stateStore.initSync();
}

function gracefulShutdown() {
  void stateStore.shutdown().finally(() => process.exit(0));
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

if (require.main === module) {
  (async () => {
    try {
      if (CONFIG.databaseUrl) {
        await stateStore.init();
      }
      app.listen(CONFIG.port, () => {
        console.log(`Distill backend listening on http://localhost:${CONFIG.port}`);
      });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'startup_failed', error: err.message }));
      process.exit(1);
    }
  })();
}

/** Used by integration tests (Supertest); avoids binding a port when imported. */
module.exports = { app };
