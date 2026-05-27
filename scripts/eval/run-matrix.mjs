#!/usr/bin/env node
/**
 * Distill eval runner (backend proxy mode).
 *
 * Prereqs:
 * - Backend running locally (default http://localhost:8787)
 * - GEMINI_API_KEY and/or ANTHROPIC_API_KEY configured for the backend
 *
 * Usage (from repo root):
 *   node scripts/eval/run-matrix.mjs
 *   node scripts/eval/run-matrix.mjs --matrix scripts/eval/article-test-matrix.csv --out scripts/eval/article-test-matrix.out.csv
 *
 * Notes:
 * - This is intentionally "offline-ish": it fetches public HTML and approximates paragraph extraction.
 * - It mirrors extension task shapes sent to `/v1/ai/run` (task/context/input/meta).
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_URL = process.env.DISTILL_BACKEND_URL || 'http://localhost:8787';
const DEFAULT_MATRIX = path.join(SCRIPT_DIR, 'article-test-matrix.csv');
const DEFAULT_OUT = path.join(SCRIPT_DIR, 'article-test-matrix.out.csv');

const MAX_ARTICLE_FETCH_BYTES = 2_500_000;
const MIN_PARA_LEN = 50;

function parseArgs(argv) {
  const args = { matrix: DEFAULT_MATRIX, out: DEFAULT_OUT, baseUrl: DEFAULT_BASE_URL, start: 1, limit: 9999, paras: 8, installId: `distill-eval-${Date.now()}`, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--matrix') args.matrix = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--start') args.start = Number(argv[++i] || '1');
    else if (a === '--limit') args.limit = Number(argv[++i] || '9999');
    else if (a === '--paragraphs') args.paras = Number(argv[++i] || '8');
    else if (a === '--install-id') args.installId = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  // eslint-disable-next-line no-console
  console.log(`Usage: node scripts/eval/run-matrix.mjs [--matrix PATH] [--out PATH] [--base-url URL] [--start N] [--limit N] [--paragraphs N] [--install-id STR] [--dry-run]`);
}

function stripTagsToText(html) {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const text = noScripts
    .replace(/<\/(p|div|section|article|h1|h2|h3|h4|li|br)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
  return text.replace(/\r\n/g, '\n');
}

function extractParagraphsFromHtml(html) {
  const text = stripTagsToText(html);
  const rawParas = text
    .split(/\n+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return rawParas.filter(p => p.length >= MIN_PARA_LEN);
}

function clampText(text, maxChars) {
  const t = (text || '').trim();
  if (!maxChars || t.length <= maxChars) return t;
  return `${t.slice(0, maxChars).trim()}\n…`;
}

function tailJoin(paras, n) {
  const slice = paras.slice(Math.max(0, paras.length - n));
  return clampText(slice.join('\n\n'), 3200);
}

function parseCsvLine(line) {
  // Minimal CSV parser (supports quotes); good enough for our matrix file.
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function escapeCsvField(s) {
  const t = (s ?? '').toString();
  if (/[,"\n]/.test(t)) return `"${t.replaceAll('"', '""')}"`;
  return t;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'DistillEvalBot/1.0 (+https://example.invalid)',
      'accept-language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_ARTICLE_FETCH_BYTES) {
    throw new Error('fetch_too_large');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

async function guestToken(baseUrl, installId) {
  const res = await fetch(`${baseUrl}/v1/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installId })
  });
  if (!res.ok) throw new Error(`guest_auth_failed_${res.status}`);
  const j = await res.json();
  if (!j?.token) throw new Error('guest_auth_missing_token');
  return j.token;
}

async function readUsage(baseUrl, token) {
  const res = await fetch(`${baseUrl}/v1/usage`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`usage_failed_${res.status}`);
  return res.json();
}

async function runAi(baseUrl, token, body) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/v1/ai/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = `ai_run_failed_${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message || msg;
    } catch {}
    return { ok: false, text: '', latencyMs: Date.now() - started, err: msg, done: {} };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let donePayload = {};
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const lines = frame.split('\n');
      let evt = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event:')) evt = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }
      if (evt === 'chunk') text += payload.text || '';
      else if (evt === 'done') donePayload = payload || {};
      else if (evt === 'error') return { ok: false, text, latencyMs: Date.now() - started, err: payload.message || 'ai_error', done: donePayload };
    }
  }
  return { ok: true, text: text.trim(), latencyMs: Date.now() - started, err: '', done: donePayload };
}

function creditFeel(before, after, cost) {
  const delta = (before?.remainingCredits ?? null) != null && (after?.remainingCredits ?? null) != null
    ? (before.remainingCredits - after.remainingCredits)
    : null;
  if (delta == null) return '';
  if (delta <= 0) return 'none';
  if (delta <= Math.max(1, Math.floor((cost || 1) * 0.75))) return 'low';
  if (delta <= Math.max(2, Math.floor((cost || 1) * 1.25))) return 'medium';
  return 'high';
}

async function evalArticleRow({ baseUrl, token, url, titleGuess, parasToRead, aiMode }) {
  const html = await fetchText(url);
  const paras = extractParagraphsFromHtml(html);
  if (paras.length < 6) throw new Error('not_enough_paragraphs');

  const readN = Math.min(parasToRead, paras.length);
  const readParas = paras.slice(0, readN);
  const opener = readParas[0] || '';
  const recentForNow = tailJoin(readParas, 5);
  const nowPara = clampText(readParas[Math.min(readParas.length - 1, Math.max(0, Math.floor(readN * 0.65)))] || readParas[readParas.length - 1], 1300);

  const readSoFar = clampText(readParas.join('\n\n'), 12000);
  const mid = Math.max(3, Math.floor(readN * 0.55));
  const firstChunk = readParas.slice(0, mid);
  const secondChunk = readParas.slice(mid);
  const fresh1 = clampText(firstChunk.join('\n\n'), 3200);
  const fresh2 = clampText(secondChunk.join('\n\n'), 3200);

  const selection = clampText(readParas[Math.min(readParas.length - 1, 2)] || readParas[0], 900);

  const usageBefore = await readUsage(baseUrl, token);

  const now = await runAi(baseUrl, token, {
    task: 'now',
    articleId: url,
    meta: { aiMode, eval: true },
    context: { title: titleGuess, recent: recentForNow },
    input: { paragraph: nowPara }
  });
  const usageAfterNow = await readUsage(baseUrl, token);

  const sum1 = await runAi(baseUrl, token, {
    task: 'summary',
    articleId: url,
    meta: { aiMode, eval: true },
    context: {
      title: titleGuess,
      opener,
      priorGist: '',
      recent: tailJoin(firstChunk, 4),
      readCount: firstChunk.length,
      prevSummary: ''
    },
    input: { readSoFar: clampText(firstChunk.join('\n\n'), 12000), freshRead: fresh1 }
  });
  const usageAfterSum1 = await readUsage(baseUrl, token);

  const sum2 = await runAi(baseUrl, token, {
    task: 'summary',
    articleId: url,
    meta: { aiMode, eval: true },
    context: {
      title: titleGuess,
      opener,
      priorGist: '',
      recent: tailJoin(readParas, 4),
      readCount: readParas.length,
      prevSummary: sum1.text
    },
    input: { readSoFar, freshRead: fresh2 }
  });
  const usageAfterSum2 = await readUsage(baseUrl, token);

  const analysis = await runAi(baseUrl, token, {
    task: 'analysis',
    articleId: url,
    meta: { aiMode, eval: true },
    context: {
      title: titleGuess,
      opener,
      priorGist: '',
      recent: tailJoin(readParas, 8)
    },
    input: { selection }
  });
  const usageAfterAnalysis = await readUsage(baseUrl, token);

  const recentQuiz = tailJoin(readParas, 3);
  const q = await runAi(baseUrl, token, {
    task: 'quiz_question',
    articleId: url,
    meta: { aiMode, eval: true },
    context: { title: titleGuess, recent: recentQuiz },
    input: {}
  });
  const usageAfterQ = await readUsage(baseUrl, token);

  const fb = await runAi(baseUrl, token, {
    task: 'quiz_feedback',
    articleId: url,
    meta: { aiMode, eval: true },
    context: { title: titleGuess, recent: recentQuiz },
    input: { question: q.text || 'Question?', answer: 'I think it is mostly about the main claim in the section, but I am not fully sure.' }
  });
  const usageAfterFb = await readUsage(baseUrl, token);

  const latencyPack = {
    now_ms: now.latencyMs,
    summary1_ms: sum1.latencyMs,
    summary2_ms: sum2.latencyMs,
    analysis_ms: analysis.latencyMs,
    quiz_q_ms: q.latencyMs,
    quiz_fb_ms: fb.latencyMs
  };

  const costHints = {
    now_cost: now.done?.cost,
    summary1_cost: sum1.done?.cost,
    summary2_cost: sum2.done?.cost,
    analysis_cost: analysis.done?.cost,
    quiz_q_cost: q.done?.cost,
    quiz_fb_cost: fb.done?.cost
  };

  const creditPack = {
    now: creditFeel(usageBefore, usageAfterNow, now.done?.cost),
    summary: creditFeel(usageAfterNow, usageAfterSum2, (sum1.done?.cost || 0) + (sum2.done?.cost || 0)),
    analysis: creditFeel(usageAfterSum2, usageAfterAnalysis, analysis.done?.cost),
    quiz: creditFeel(usageAfterAnalysis, usageAfterFb, (q.done?.cost || 0) + (fb.done?.cost || 0))
  };

  const errs = [
    !now.ok ? `now:${now.err}` : '',
    !sum1.ok ? `sum1:${sum1.err}` : '',
    !sum2.ok ? `sum2:${sum2.err}` : '',
    !analysis.ok ? `analysis:${analysis.err}` : '',
    !q.ok ? `quiz_q:${q.err}` : '',
    !fb.ok ? `quiz_fb:${fb.err}` : ''
  ].filter(Boolean);

  return {
    ok: errs.length === 0,
    outputs: { now: now.text, summary1: sum1.text, summary2: sum2.text, analysis: analysis.text, quizQ: q.text, quizFb: fb.text },
    latencyJson: JSON.stringify(latencyPack),
    creditJson: JSON.stringify(creditPack),
    costsJson: JSON.stringify(costHints),
    regressionFlags: errs.join('|')
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const matrixPath = path.resolve(args.matrix);
  const outPath = path.resolve(args.out);
  const raw = fs.readFileSync(matrixPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('matrix_empty');

  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const required = ['article_id', 'url', 'type', 'length'];
  for (const k of required) {
    if (!(k in idx)) throw new Error(`matrix_missing_column:${k}`);
  }

  const outLines = [];
  outLines.push(lines[0]); // keep header

  if (args.dryRun) {
    fs.writeFileSync(outPath, outLines.join('\n') + '\n', 'utf8');
    // eslint-disable-next-line no-console
    console.log(`Dry run: wrote header-only -> ${outPath}`);
    return;
  }

  const balancedToken = await guestToken(args.baseUrl, `${args.installId}:balanced`);
  const ultraToken = await guestToken(args.baseUrl, `${args.installId}:ultra`);

  let rowNum = 0;
  for (const line of lines.slice(1)) {
    rowNum++;
    if (rowNum < args.start) continue;
    if (rowNum >= args.start + args.limit) break;

    const cols = parseCsvLine(line);
    const id = cols[idx.article_id] || '';
    const url = cols[idx.url] || '';
    if (!url) {
      outLines.push(line);
      continue;
    }

    // eslint-disable-next-line no-console
    console.log(`[${id}] ${url}`);

    const titleGuess = url;

    let balanced = null;
    let ultra = null;
    try {
      balanced = await evalArticleRow({ baseUrl: args.baseUrl, token: balancedToken, url, titleGuess, parasToRead: args.paras, aiMode: 'balanced' });
    } catch (e) {
      balanced = { ok: false, outputs: {}, latencyJson: '', creditJson: '', costsJson: '', regressionFlags: `balanced_throw:${e.message}` };
    }
    try {
      ultra = await evalArticleRow({ baseUrl: args.baseUrl, token: ultraToken, url, titleGuess, parasToRead: args.paras, aiMode: 'ultra-lean' });
    } catch (e) {
      ultra = { ok: false, outputs: {}, latencyJson: '', creditJson: '', costsJson: '', regressionFlags: `ultra_throw:${e.message}` };
    }

    const next = [...cols];
    const set = (key, val) => {
      if (!(key in idx)) return;
      next[idx[key]] = val;
    };

    set('balanced_now', balanced.outputs.now || '');
    set('balanced_summary', `${balanced.outputs.summary1 || ''}\n---\n${balanced.outputs.summary2 || ''}`.trim());
    set('balanced_analysis', balanced.outputs.analysis || '');
    set('balanced_quiz_q', balanced.outputs.quizQ || '');
    set('balanced_quiz_feedback', balanced.outputs.quizFb || '');
    set('balanced_latency', balanced.latencyJson || '');
    set('balanced_credit_feel', balanced.creditJson || '');

    set('ultra_now', ultra.outputs.now || '');
    set('ultra_summary', `${ultra.outputs.summary1 || ''}\n---\n${ultra.outputs.summary2 || ''}`.trim());
    set('ultra_analysis', ultra.outputs.analysis || '');
    set('ultra_quiz_q', ultra.outputs.quizQ || '');
    set('ultra_quiz_feedback', ultra.outputs.quizFb || '');
    set('ultra_latency', ultra.latencyJson || '');
    set('ultra_credit_feel', ultra.creditJson || '');

    const winner = (() => {
      if (!balanced.ok && !ultra.ok) return '';
      if (balanced.ok && !ultra.ok) return 'balanced';
      if (!balanced.ok && ultra.ok) return 'ultra-lean';
      // Both succeeded: leave blank for human scoring in the spreadsheet.
      return '';
    })();
    if ('winner' in idx) set('winner', winner);

    const flags = [balanced.regressionFlags, ultra.regressionFlags].filter(Boolean).join('|');
    set('regression_flags', flags);
    if ('notes' in idx) set('notes', cols[idx.notes] || '');

    outLines.push(next.map(escapeCsvField).join(','));
    fs.writeFileSync(outPath, outLines.join('\n') + '\n', 'utf8');
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote -> ${outPath}`);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
