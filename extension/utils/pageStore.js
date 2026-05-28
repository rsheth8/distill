'use strict';

/**
 * Pure helpers for Distill's per-page save/restore state. No DOM, no chrome.* —
 * unit testable. background.js loads this via importScripts and wraps the impure
 * storage I/O around these functions.
 *
 * Two URL-keyed stores in chrome.storage.local:
 *   distillPageState_<hash>  full snapshot (current format, v1)
 *   distillHist_<hash>       legacy minimal snapshot (back-compat)
 * Both keyed by a stable hash of the normalized page URL.
 *
 * Retention: at most DISTILL_MAX_SAVED_PAGES pages, each kept for DISTILL_PAGE_STATE_TTL_MS.
 */

const DISTILL_PAGE_STATE_PREFIX = 'distillPageState_';
const DISTILL_HISTORY_PREFIX = 'distillHist_';
const DISTILL_PAGE_STATE_VERSION = 1;
const DISTILL_MAX_SAVED_PAGES = 60;
const DISTILL_PAGE_STATE_TTL_MS = 1000 * 60 * 60 * 24 * 45; // 45 days

// Per-snapshot size caps (keep storage small + under quota).
const DISTILL_CAP_READ_UNITS = 24;
const DISTILL_CAP_SUMMARY_CHARS = 5000;
const DISTILL_CAP_HIGHLIGHTS = 8;
const DISTILL_CAP_QUIZ_HISTORY = 3;
const DISTILL_CAP_EXPLAIN_CHARS = 3500;

/** Lightweight deterministic FNV-1a hash → hex. */
function distillStableHash(text) {
  let h = 2166136261;
  const input = text || '';
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function distillPageStateKey(pageUrl) { return `${DISTILL_PAGE_STATE_PREFIX}${distillStableHash(pageUrl || '')}`; }
function distillHistoryKey(pageUrl) { return `${DISTILL_HISTORY_PREFIX}${distillStableHash(pageUrl || '')}`; }

function distillClampList(list, max) { return Array.isArray(list) ? list.slice(0, Math.max(0, max)) : []; }
function distillClampString(s, maxChars) {
  const raw = typeof s === 'string' ? s : '';
  return raw.length <= maxChars ? raw : raw.slice(0, maxChars);
}

function distillDefaultQuiz() {
  return { status: 'idle', question: '', answer: '', feedback: '', history: [] };
}

/** Build the compact, URL-keyed page snapshot from an in-memory tab state object. */
function distillBuildPageStatePayload(s, now) {
  const src = s || {};
  const readUnits = Array.isArray(src.readUnits) && src.readUnits.length
    ? src.readUnits
    : (Array.isArray(src.readParagraphs) ? src.readParagraphs : []);
  const readCount = Array.isArray(src.readParagraphs) ? src.readParagraphs.length : readUnits.length;
  const q = src.quiz;
  return {
    v: DISTILL_PAGE_STATE_VERSION,
    pageUrl: src.pageUrl || '',
    title: src.title || '',
    updatedAt: typeof now === 'number' ? now : Date.now(),
    totalParagraphs: src.totalParagraphs || 0,
    totalWords: src.totalWords || 0,
    wordsRead: src.wordsRead || 0,
    readCount,
    readUnits: distillClampList(readUnits.slice(-DISTILL_CAP_READ_UNITS), DISTILL_CAP_READ_UNITS),
    lastSummary: distillClampString(src.lastSummary || '', DISTILL_CAP_SUMMARY_CHARS),
    lastSummaryUnitCount: typeof src.lastSummaryUnitCount === 'number' ? src.lastSummaryUnitCount : 0,
    highlightHistory: distillClampList(src.highlightHistory || [], DISTILL_CAP_HIGHLIGHTS),
    quiz: q
      ? {
          status: q.status || 'idle',
          question: q.question || '',
          answer: q.answer || '',
          feedback: q.feedback || '',
          history: distillClampList(q.history || [], DISTILL_CAP_QUIZ_HISTORY)
        }
      : distillDefaultQuiz(),
    explainCache: src.explainCache && typeof src.explainCache === 'object'
      ? {
          pageUrl: src.explainCache.pageUrl || '',
          contentHash: src.explainCache.contentHash || '',
          text: distillClampString(src.explainCache.text || '', DISTILL_CAP_EXPLAIN_CHARS)
        }
      : null
  };
}

/** Rehydrate an in-memory tab state from a full page snapshot (v1). */
function distillPagePayloadToState(payload) {
  const quiz = (payload && payload.quiz) || distillDefaultQuiz();
  const readUnits = Array.isArray(payload && payload.readUnits) ? payload.readUnits : [];
  const lastSummary = typeof (payload && payload.lastSummary) === 'string' ? payload.lastSummary : '';
  return {
    articleText: '',
    totalParagraphs: (payload && payload.totalParagraphs) || 0,
    totalWords: (payload && payload.totalWords) || 0,
    wordsRead: (payload && payload.wordsRead) || 0,
    title: (payload && payload.title) || '',
    readParagraphs: [...readUnits],
    readUnits: [...readUnits],
    pendingUnitParas: [],
    pendingUnitWords: 0,
    wordsSinceSummary: 0,
    lastSummaryUnitCount: typeof (payload && payload.lastSummaryUnitCount) === 'number' ? payload.lastSummaryUnitCount : readUnits.length,
    lastUpdateCount: readUnits.length,
    isUpdating: false,
    currentSelection: null,
    currentQuestion: '',
    lastSummary,
    highlightHistory: Array.isArray(payload && payload.highlightHistory) ? payload.highlightHistory : [],
    pageUrl: (payload && payload.pageUrl) || '',
    quiz: {
      status: quiz.status || 'idle',
      question: quiz.question || '',
      answer: quiz.answer || '',
      feedback: quiz.feedback || '',
      history: Array.isArray(quiz.history) ? quiz.history : []
    },
    explainCache: (payload && payload.explainCache) || null
  };
}

/** Best-effort rehydrate from the legacy minimal history snapshot (migration path). */
function distillHistoryPayloadToState(payload) {
  const lastSummary = typeof (payload && payload.lastSummary) === 'string' ? payload.lastSummary : '';
  return {
    articleText: '',
    totalParagraphs: (payload && payload.totalParagraphs) || 0,
    totalWords: (payload && payload.totalWords) || 0,
    wordsRead: (payload && payload.wordsRead) || 0,
    title: (payload && payload.title) || '',
    readParagraphs: [],
    readUnits: [],
    pendingUnitParas: [],
    pendingUnitWords: 0,
    wordsSinceSummary: 0,
    lastSummaryUnitCount: 0,
    lastUpdateCount: 0,
    isUpdating: false,
    currentSelection: null,
    currentQuestion: '',
    lastSummary,
    highlightHistory: [],
    pageUrl: (payload && payload.pageUrl) || '',
    quiz: distillDefaultQuiz(),
    explainCache: null
  };
}

/**
 * Decide which page hashes to evict.
 * @param {Array<{hash:string, updatedAt:number}>} entries one per page (deduped by hash)
 * @param {{maxPages?:number, ttlMs?:number, now?:number}} opts
 * @returns {string[]} hashes to remove
 */
function distillSelectPrunedKeys(entries, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const ttlMs = opts.ttlMs;
  const maxPages = opts.maxPages;
  const list = Array.isArray(entries) ? entries.slice() : [];
  const remove = new Set();

  if (ttlMs) {
    for (const e of list) {
      if (e && typeof e.updatedAt === 'number' && now - e.updatedAt > ttlMs) remove.add(e.hash);
    }
  }
  const survivors = list
    .filter(e => e && !remove.has(e.hash))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (maxPages && survivors.length > maxPages) {
    for (const e of survivors.slice(maxPages)) remove.add(e.hash);
  }
  return [...remove];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DISTILL_PAGE_STATE_PREFIX,
    DISTILL_HISTORY_PREFIX,
    DISTILL_PAGE_STATE_VERSION,
    DISTILL_MAX_SAVED_PAGES,
    DISTILL_PAGE_STATE_TTL_MS,
    distillStableHash,
    distillPageStateKey,
    distillHistoryKey,
    distillClampList,
    distillClampString,
    distillDefaultQuiz,
    distillBuildPageStatePayload,
    distillPagePayloadToState,
    distillHistoryPayloadToState,
    distillSelectPrunedKeys
  };
}
