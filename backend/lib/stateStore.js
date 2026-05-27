'use strict';

const fs = require('fs');
const path = require('path');

function getUtcResetAt(usageResetHourUtc, now = new Date()) {
  const reset = new Date(now);
  reset.setUTCHours(usageResetHourUtc, 0, 0, 0);
  if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

function ensureStateDir(stateFilePath) {
  const dir = path.dirname(stateFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

class FileStateStore {
  constructor(cfg) {
    this.stateFilePath = cfg.stateFilePath;
    this.dailyCredits = cfg.dailyCredits;
    this.usageResetHourUtc = cfg.usageResetHourUtc;
    this.usageStore = new Map();
    this.tokenVersionByUser = new Map();
    this.persistTimer = null;
  }

  initSync() {
    this.load();
  }

  async init() {
    this.initSync();
  }

  load() {
    try {
      if (!fs.existsSync(this.stateFilePath)) return;
      const raw = fs.readFileSync(this.stateFilePath, 'utf8');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const usage = parsed.usage || {};
      const tokenVersions = parsed.tokenVersionByUser || {};
      for (const [k, v] of Object.entries(usage)) this.usageStore.set(k, v);
      for (const [k, v] of Object.entries(tokenVersions)) this.tokenVersionByUser.set(k, Number(v) || 1);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'load_state_failed', error: err.message }));
    }
  }

  schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 250);
  }

  persist() {
    try {
      ensureStateDir(this.stateFilePath);
      const data = {
        usage: Object.fromEntries(this.usageStore.entries()),
        tokenVersionByUser: Object.fromEntries(this.tokenVersionByUser.entries())
      };
      const tmpPath = `${this.stateFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data));
      fs.renameSync(tmpPath, this.stateFilePath);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'persist_state_failed', error: err.message }));
    }
  }

  getUsageRecordSync(userId) {
    const now = new Date();
    const existing = this.usageStore.get(userId);
    if (!existing || new Date(existing.resetAt) <= now) {
      const fresh = {
        remainingCredits: this.dailyCredits,
        dailyLimit: this.dailyCredits,
        resetAt: getUtcResetAt(this.usageResetHourUtc, now).toISOString()
      };
      this.usageStore.set(userId, fresh);
      this.schedulePersist();
      return fresh;
    }
    return existing;
  }

  async getUsageRecord(userId) {
    return this.getUsageRecordSync(userId);
  }

  async getTokenVersion(userId) {
    return this.tokenVersionByUser.get(userId) || 1;
  }

  async setTokenVersion(userId, version) {
    this.tokenVersionByUser.set(userId, version);
    this.schedulePersist();
  }

  async bumpTokenVersion(userId) {
    const current = this.tokenVersionByUser.get(userId) || 1;
    const next = current + 1;
    this.tokenVersionByUser.set(userId, next);
    this.schedulePersist();
    return next;
  }

  async applyDebit(_userId, cost, usageRecord) {
    usageRecord.remainingCredits = Math.max(0, usageRecord.remainingCredits - cost);
    this.usageStore.set(_userId, usageRecord);
    this.schedulePersist();
  }

  async resetUsage(userId) {
    const reset = {
      remainingCredits: this.dailyCredits,
      dailyLimit: this.dailyCredits,
      resetAt: getUtcResetAt(this.usageResetHourUtc, new Date()).toISOString()
    };
    this.usageStore.set(userId, reset);
    this.schedulePersist();
    return reset;
  }

  flushSync() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
  }

  async shutdown() {
    this.flushSync();
  }
}

const PG_ENSURE_SQL = `
CREATE TABLE IF NOT EXISTS public.distill_user_state (
  user_id TEXT PRIMARY KEY,
  token_version INTEGER NOT NULL DEFAULT 1,
  remaining_credits INTEGER NOT NULL,
  daily_limit INTEGER NOT NULL,
  credits_reset_at TIMESTAMPTZ NOT NULL
);
`;

class PgStateStore {
  constructor(cfg) {
    this.dailyCredits = cfg.dailyCredits;
    this.usageResetHourUtc = cfg.usageResetHourUtc;
    // Lazy require so tests without `pg` installed... we add pg to package.json always.
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString: cfg.databaseUrl,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000)
    });
  }

  async init() {
    await this.pool.query(PG_ENSURE_SQL);
    const { rows } = await this.pool.query('SELECT 1 AS ok');
    if (!rows[0]?.ok) throw new Error('Postgres health check failed.');
  }

  async getTokenVersion(userId) {
    const { rows } = await this.pool.query(
      'SELECT token_version FROM public.distill_user_state WHERE user_id = $1',
      [userId]
    );
    if (!rows[0]) return 1;
    return Number(rows[0].token_version) || 1;
  }

  async bumpTokenVersion(userId) {
    const resetAt = getUtcResetAt(this.usageResetHourUtc, new Date());
    const up = await this.pool.query(
      `UPDATE public.distill_user_state
       SET token_version = token_version + 1
       WHERE user_id = $1
       RETURNING token_version`,
      [userId]
    );
    if (up.rowCount > 0) return Number(up.rows[0].token_version) || 1;
    await this.pool.query(
      `INSERT INTO public.distill_user_state (user_id, token_version, remaining_credits, daily_limit, credits_reset_at)
       VALUES ($1, 2, $2, $2, $3)`,
      [userId, this.dailyCredits, resetAt]
    );
    return 2;
  }

  async getUsageRecord(userId) {
    const now = new Date();
    const resetAtFresh = getUtcResetAt(this.usageResetHourUtc, now);

    const { rows: existing } = await this.pool.query(
      'SELECT remaining_credits, daily_limit, credits_reset_at FROM public.distill_user_state WHERE user_id = $1',
      [userId]
    );

    if (!existing[0]) {
      await this.pool.query(
        `INSERT INTO public.distill_user_state (user_id, token_version, remaining_credits, daily_limit, credits_reset_at)
         VALUES ($1, 1, $2, $2, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, this.dailyCredits, resetAtFresh]
      );
      const { rows: again } = await this.pool.query(
        'SELECT remaining_credits, daily_limit, credits_reset_at FROM public.distill_user_state WHERE user_id = $1',
        [userId]
      );
      const row = again[0];
      return {
        remainingCredits: row.remaining_credits,
        dailyLimit: row.daily_limit,
        resetAt: new Date(row.credits_reset_at).toISOString()
      };
    }

    const row = existing[0];
    if (new Date(row.credits_reset_at) <= now) {
      await this.pool.query(
        `UPDATE public.distill_user_state
         SET remaining_credits = $2, daily_limit = $2, credits_reset_at = $3
         WHERE user_id = $1`,
        [userId, this.dailyCredits, resetAtFresh]
      );
      return {
        remainingCredits: this.dailyCredits,
        dailyLimit: this.dailyCredits,
        resetAt: resetAtFresh.toISOString()
      };
    }

    return {
      remainingCredits: row.remaining_credits,
      dailyLimit: row.daily_limit,
      resetAt: new Date(row.credits_reset_at).toISOString()
    };
  }

  async applyDebit(userId, cost, usageRecord) {
    const { rows } = await this.pool.query(
      `UPDATE public.distill_user_state
       SET remaining_credits = GREATEST(0, remaining_credits - $2)
       WHERE user_id = $1
       RETURNING remaining_credits`,
      [userId, cost]
    );
    if (rows[0]) {
      usageRecord.remainingCredits = Number(rows[0].remaining_credits) || 0;
    }
  }

  async resetUsage(userId) {
    const resetAt = getUtcResetAt(this.usageResetHourUtc, new Date());
    await this.pool.query(
      `INSERT INTO public.distill_user_state (user_id, token_version, remaining_credits, daily_limit, credits_reset_at)
       VALUES ($1, 1, $2, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         remaining_credits = EXCLUDED.remaining_credits,
         daily_limit = EXCLUDED.daily_limit,
         credits_reset_at = EXCLUDED.credits_reset_at`,
      [userId, this.dailyCredits, resetAt]
    );
    return {
      remainingCredits: this.dailyCredits,
      dailyLimit: this.dailyCredits,
      resetAt: resetAt.toISOString()
    };
  }

  async shutdown() {
    await this.pool.end();
  }
}

function createStateStore(cfg) {
  const databaseUrl = String(cfg.databaseUrl || '').trim();
  if (databaseUrl) {
    return new PgStateStore({ ...cfg, databaseUrl });
  }
  return new FileStateStore(cfg);
}

module.exports = {
  createStateStore,
  getUtcResetAt
};
