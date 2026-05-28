'use strict';

importScripts('utils/pageUrlKey.js', 'utils/backendEnv.js', 'utils/aiResultCache.js', 'utils/geminiAdapter.js', 'utils/openaiCompatAdapter.js', 'utils/pageStore.js');

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const SITE_PREFS_KEY = 'distillSitePrefsMap';
const OFFLINE_QUEUE_KEY = 'distillOfflineQueue';
let offlineFlushRunning = false;
const focusModeByTab = new Map();

function safeOriginFromUrl(href) {
  if (!href) return '';
  try {
    return new URL(href).origin;
  } catch {
    return '';
  }
}

async function getSitePrefsMap() {
  const bag = await chrome.storage.local.get(SITE_PREFS_KEY).catch(() => ({}));
  const m = bag[SITE_PREFS_KEY];
  return m && typeof m === 'object' ? m : {};
}

async function getSitePrefsForOrigin(origin) {
  if (!origin) return {};
  const map = await getSitePrefsMap();
  return map[origin] && typeof map[origin] === 'object' ? map[origin] : {};
}

async function getSiteBackendOnly(pageUrl) {
  const o = safeOriginFromUrl(pageUrl);
  if (!o) return false;
  const p = await getSitePrefsForOrigin(o);
  return !!p.backendOnly;
}

async function publishSitePrefs(tabId) {
  const s = tabState.get(tabId);
  let origin = '';
  if (s?.pageUrl) origin = safeOriginFromUrl(s.pageUrl);
  else {
    try {
      const tab = await chrome.tabs.get(tabId);
      origin = safeOriginFromUrl(tab?.url || '');
    } catch {}
  }
  const prefs = origin ? await getSitePrefsForOrigin(origin) : {};
  toPanel({ type: 'SITE_PREFS', tabId, origin, prefs });
}

function stableJobDedupeKey(job) {
  return `${job.task}|${job.tabId}|${stableStringHash(JSON.stringify(job.payload || {}))}`;
}

async function enqueueOfflineJob(job) {
  const bag = await chrome.storage.local.get(OFFLINE_QUEUE_KEY).catch(() => ({}));
  const q = Array.isArray(bag[OFFLINE_QUEUE_KEY]) ? bag[OFFLINE_QUEUE_KEY] : [];
  if (q.length >= 30) return;
  const key = stableJobDedupeKey(job);
  const recent = q.slice(-6).some(j => stableJobDedupeKey(j) === key);
  if (recent) return;
  q.push({ ...job, v: 1, createdAt: Date.now() });
  await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: q }).catch(() => {});
}

function isBackendUnreachableError(err) {
  const c = err?.code || '';
  if (c === 'BACKEND_DOWN') return true;
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('backend is down') || msg.includes('backend is reachable') || msg.includes('failed to fetch');
}

async function openSidePanelForTab(tabId) {
  try {
    await chrome.sidePanel.open({ tabId });
  } catch {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch {}
  }
}

chrome.commands.onCommand.addListener(command => {
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const tabId = tab.id;
    const u = (tab.url || '').toLowerCase();
    if (!u.startsWith('http://') && !u.startsWith('https://')) return;

    try {
      if (command === 'open_reader') {
        await openSidePanelForTab(tabId);
        return;
      }
      if (command === 'toggle_focus') {
        const next = !focusModeByTab.get(tabId);
        focusModeByTab.set(tabId, next);
        await chrome.tabs.sendMessage(tabId, { type: 'FOCUS_MODE', on: next }).catch(() => {});
        toPanel({ type: 'FOCUS_SYNC', tabId, on: next });
        return;
      }

      await openSidePanelForTab(tabId);
      await ensureTabHydrated(tabId);

      if (command === 'explain_page') {
        explainPage(tabId);
        return;
      }
      if (command === 'analyze_selection') {
        analyzeSelection(tabId);
        return;
      }
    } catch {}
  })();
});

const tabState   = new Map();
const quizNextAt = new Map(); // tabId → paragraph count at which to next quiz
const lastAiRetryByTab = new Map(); // tabId -> () => Promise<void>
const QUIZ_EVERY = 5;
const QUIZ_ARCHIVE_DELAY_MS = 7000;
const RECENT_CONTEXT_PARAS = 8;
const USE_BACKEND_PROXY_KEY = 'useBackendProxy';

// ── AI provider (bring-your-own-key) ──────────────────────────────────────────
// Default product is BYOK: the user pastes their own free Gemini key and AI runs
// browser → provider. The hosted "Distill cloud" backend is an opt-in advanced path.
const AI_PROVIDER_KEY = 'aiProvider';
const GEMINI_API_KEY_STORAGE = 'geminiApiKey';
const ANTHROPIC_API_KEY_STORAGE = 'anthropicApiKey';
const GROQ_API_KEY_STORAGE = 'groqApiKey';
const OPENAI_API_KEY_STORAGE = 'openaiApiKey';
// Groq is the default: genuinely free tier with broad availability. Gemini/OpenAI/
// Anthropic are quick-switch options for users who prefer them.
const DEFAULT_AI_PROVIDER = 'groq';
const AI_PROVIDERS = ['groq', 'openai', 'gemini', 'anthropic'];
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Groq + OpenAI share the OpenAI-compatible chat/completions wire format.
const GROQ_MODEL = 'llama-3.1-8b-instant';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/** Endpoint/model/label/keyUrl for OpenAI-compatible providers (Groq, OpenAI). */
function chatProviderConfig(provider) {
  if (provider === 'openai') {
    return { url: OPENAI_API_URL, model: OPENAI_MODEL, label: 'OpenAI', keyUrl: 'platform.openai.com/api-keys' };
  }
  return { url: GROQ_API_URL, model: GROQ_MODEL, label: 'Groq', keyUrl: 'console.groq.com/keys' };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Backend routing behavior:
// - Default (useBackendProxy unset or false) → direct BYOK mode only.
// - If `useBackendProxy === true` → prefer backend when reachable, fallback to direct.
const BACKEND_PROBE_CACHE_MS = 5000;
let backendProbeCache = { checkedAt: 0, result: null };

async function fetchWithTimeout(url, init = {}, timeoutMs = 900) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function probeBackend() {
  const now = Date.now();
  if (backendProbeCache.result && now - backendProbeCache.checkedAt < BACKEND_PROBE_CACHE_MS) {
    return backendProbeCache.result;
  }
  const base = await distillResolveBackendBaseUrl();
  const out = { ok: false, reachable: false, status: 'unreachable', config: null };
  try {
    const r = await fetchWithTimeout(`${base}/v1/config`, { method: 'GET' }, 900);
    if (!r.ok) {
      out.ok = false;
      out.reachable = true;
      out.status = `error_${r.status}`;
    } else {
      const body = await r.json().catch(() => null);
      out.ok = !!body?.ok;
      out.reachable = true;
      out.config = body || null;
      if (!body?.ok) out.status = 'not_ready';
      else if (!body?.aiEnabled) out.status = 'ai_disabled';
      else if (!body?.aiReady && !body?.anthropicKeyConfigured) out.status = 'missing_key';
      else out.status = 'ok';
    }
  } catch {
    out.ok = false;
    out.reachable = false;
    out.status = 'unreachable';
  }
  backendProbeCache = { checkedAt: now, result: out };
  return out;
}

/** True only when the user explicitly opts into the hosted Distill cloud backend. Default is direct BYOK mode. */
async function useBackendProxy() {
  const r = await chrome.storage.local.get(USE_BACKEND_PROXY_KEY);
  return r[USE_BACKEND_PROXY_KEY] === true;
}
const AI_MODE_KEY = 'aiMode';
const DEFAULT_AI_MODE = 'balanced';
const MAX_READ_SO_FAR_CHARS = 12000;
const MAX_CONTEXT_CHARS = 3200;
const MAX_SELECTION_CHARS = 900;
const MAX_PAGE_EXPLAIN_CHARS = 7000;
// Full article text is only used for lightweight UI/heuristics; keep it bounded so
// snapshots + memory stay stable on enormous pages.
const MAX_ARTICLE_TEXT_CHARS = 240_000;
const SMALL_PARAGRAPH_MAX_WORDS = 55;
const UNIT_TARGET_MIN_WORDS = 140;
const SUMMARY_MIN_NEW_WORDS = 85;
const SUMMARY_MIN_INTERVAL_MS = 9000;
const SUMMARY_FORCE_INTERVAL_WORDS = 180;
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

const SESSION_TAB_KEY = tabId => `dTab_${tabId}`;
const PERSIST_DEBOUNCE_MS = 300;
const persistTimers = new Map();
const quizArchiveTimers = new Map();
const INSTALL_ID_KEY = 'distillInstallId';
const BACKEND_TOKEN_KEY = 'distillBackendToken';
const AUTO_NOW_MODE_KEY = 'autoNowMode';
const READER_MODE_KEY = 'readerMode';
const NOW_COOLDOWN_MS = 9000;
const PAUSE_TO_EXPLAIN_MIN_MS = 3500;
const PAUSE_TO_EXPLAIN_MAX_MS = 14000;
const ESTIMATED_READING_WPM = 220;
// Persistence prefixes + retention come from utils/pageStore.js (single source of truth).
const HISTORY_KEY_PREFIX = DISTILL_HISTORY_PREFIX;
const PAGE_STATE_KEY_PREFIX = DISTILL_PAGE_STATE_PREFIX;

let sidePanelPort = null;
const nowAssistState = new Map();
const summaryCadenceState = new Map();
const pauseExplainTimers = new Map();
// Tabs whose state was just loaded from persistent (chrome.storage.local) save-state,
// i.e. a genuine "restored from last time" — used to show the restore notice once.
const restoredFromStorageTabs = new Set();

let readerMode = 'skim';
chrome.storage.local.get(READER_MODE_KEY, r => {
  readerMode = r?.[READER_MODE_KEY] === 'study' ? 'study' : (r?.[READER_MODE_KEY] === 'research' ? 'research' : 'skim');
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[READER_MODE_KEY]) {
    const v = changes[READER_MODE_KEY].newValue;
    readerMode = v === 'study' ? 'study' : (v === 'research' ? 'research' : 'skim');
  }
  if (changes.backendTarget || changes.backendBaseUrlOverride) {
    backendProbeCache = { checkedAt: 0, result: null };
    void ensureBackendToken();
  }
  if (changes[USE_BACKEND_PROXY_KEY]?.newValue === true) void ensureBackendToken();
});

function summaryCadenceForMode() {
  if (readerMode === 'study') {
    return { minNewWords: 70, minIntervalMs: 7000, forceIntervalWords: 140 };
  }
  if (readerMode === 'research') {
    return { minNewWords: 110, minIntervalMs: 12000, forceIntervalWords: 220 };
  }
  return { minNewWords: 95, minIntervalMs: 11000, forceIntervalWords: 200 };
}

function defaultQuizState() {
  return {
    status: 'idle', // idle | loading | question | feedback_loading
    question: '',
    answer: '',
    feedback: '',
    history: [] // newest first
  };
}

function paragraphsUntilQuiz(tabId) {
  const s = tabState.get(tabId);
  if (!s) return QUIZ_EVERY;
  const next = quizNextAt.get(tabId) ?? QUIZ_EVERY;
  return Math.max(0, next - s.readParagraphs.length);
}

function countWords(text) {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

// Deterministic hash + URL-keyed storage keys live in utils/pageStore.js.
function stableStringHash(text) { return distillStableHash(text); }
function historyKeyForPageUrl(pageUrl) { return distillHistoryKey(pageUrl); }
function pageStateKeyForPageUrl(pageUrl) { return distillPageStateKey(pageUrl); }

async function publishResume(tabId) {
  const s = tabState.get(tabId);
  const pageUrl = s?.pageUrl || '';
  if (!pageUrl) {
    toPanel({ type: 'RESUME_DATA', tabId, item: null });
    return;
  }
  // Prefer the newer full page snapshot (it contains the same fields and more).
  const keyNew = pageStateKeyForPageUrl(pageUrl);
  const bagNew = await chrome.storage.local.get(keyNew).catch(() => ({}));
  const hitNew = bagNew?.[keyNew] || null;
  if (hitNew) {
    toPanel({ type: 'RESUME_DATA', tabId, item: hitNew });
    return;
  }
  // Back-compat: older minimal history snapshot.
  const keyOld = historyKeyForPageUrl(pageUrl);
  const bagOld = await chrome.storage.local.get(keyOld).catch(() => ({}));
  toPanel({ type: 'RESUME_DATA', tabId, item: bagOld?.[keyOld] || null });
}

function persistHistorySnapshot(tabId) {
  const s = tabState.get(tabId);
  if (!s?.pageUrl) return;
  const key = historyKeyForPageUrl(s.pageUrl);
  const payload = {
    v: 1,
    pageUrl: s.pageUrl,
    title: s.title || '',
    updatedAt: Date.now(),
    readCount: s.readParagraphs?.length || 0,
    totalParagraphs: s.totalParagraphs || 0,
    wordsRead: s.wordsRead || 0,
    totalWords: s.totalWords || 0,
    lastSummary: s.lastSummary || ''
  };
  chrome.storage.local.set({ [key]: payload }).catch(() => {});
}

/**
 * Persist a compact, URL-keyed page snapshot so reopening the panel restores state
 * even if the content script doesn't re-emit ARTICLE_DETECTED immediately.
 * Snapshot shape + size caps live in utils/pageStore.js.
 */
function persistPageState(tabId) {
  const s = tabState.get(tabId);
  if (!s?.pageUrl) return;
  const key = pageStateKeyForPageUrl(s.pageUrl);
  const payload = distillBuildPageStatePayload(s, Date.now());
  chrome.storage.local.set({ [key]: payload }).catch(() => {});
}

async function clearHistorySnapshot(tabId) {
  const s = tabState.get(tabId);
  const pageUrl = s?.pageUrl || '';
  if (!pageUrl) return;
  const keyOld = historyKeyForPageUrl(pageUrl);
  const keyNew = pageStateKeyForPageUrl(pageUrl);
  await chrome.storage.local.remove([keyOld, keyNew]).catch(() => {});
  toPanel({ type: 'RESUME_DATA', tabId, item: null });
}

/** Remove every saved per-page snapshot (new + legacy). Returns count of pages cleared. */
async function clearAllSavedHistory() {
  let all;
  try { all = await chrome.storage.local.get(null); } catch { return 0; }
  if (!all) return 0;
  const keys = [];
  const hashes = new Set();
  for (const k of Object.keys(all)) {
    if (k.startsWith(PAGE_STATE_KEY_PREFIX)) { keys.push(k); hashes.add(k.slice(PAGE_STATE_KEY_PREFIX.length)); }
    else if (k.startsWith(HISTORY_KEY_PREFIX)) { keys.push(k); hashes.add(k.slice(HISTORY_KEY_PREFIX.length)); }
  }
  if (keys.length) await chrome.storage.local.remove(keys).catch(() => {});
  return hashes.size;
}

function clearTab(tabId) {
  tabState.delete(tabId);
  quizNextAt.delete(tabId);
  const t = persistTimers.get(tabId);
  if (t) clearTimeout(t);
  persistTimers.delete(tabId);
  const q = quizArchiveTimers.get(tabId);
  if (q) clearTimeout(q);
  quizArchiveTimers.delete(tabId);
  nowAssistState.delete(tabId);
  const nd = nowDebounceTimers.get(tabId);
  if (nd) clearTimeout(nd);
  nowDebounceTimers.delete(tabId);
  const nac = nowAbortControllers.get(tabId);
  if (nac) nac.abort();
  nowAbortControllers.delete(tabId);
  lastActiveParagraphByTab.delete(tabId);
  summaryCadenceState.delete(tabId);
  const p = pauseExplainTimers.get(tabId);
  if (p) clearTimeout(p);
  pauseExplainTimers.delete(tabId);
  focusModeByTab.delete(tabId);
  restoredFromStorageTabs.delete(tabId);
  chrome.storage.session.remove(SESSION_TAB_KEY(tabId)).catch(() => {});
}

function tabSnapshotPayload(tabId) {
  const s = tabState.get(tabId);
  if (!s) return null;
  return {
    v: 1,
    pageUrl: s.pageUrl || '',
    quizNextAt: quizNextAt.get(tabId) ?? QUIZ_EVERY,
    articleText: s.articleText,
    totalParagraphs: s.totalParagraphs,
    totalWords: s.totalWords,
    wordsRead: s.wordsRead,
    title: s.title,
    readParagraphs: s.readParagraphs,
    readUnits: s.readUnits || [],
    pendingUnitParas: s.pendingUnitParas || [],
    pendingUnitWords: s.pendingUnitWords || 0,
    wordsSinceSummary: s.wordsSinceSummary || 0,
    lastSummaryUnitCount: s.lastSummaryUnitCount || 0,
    lastUpdateCount: s.lastUpdateCount,
    currentSelection: s.currentSelection,
    currentQuestion: s.currentQuestion,
    lastSummary: s.lastSummary,
    highlightHistory: s.highlightHistory || [],
    quiz: s.quiz || defaultQuizState(),
    explainCache: s.explainCache || null
  };
}

function persistTabSnapshot(tabId) {
  const payload = tabSnapshotPayload(tabId);
  const key = SESSION_TAB_KEY(tabId);
  if (!payload) {
    chrome.storage.session.remove(key).catch(() => {});
    return;
  }
  chrome.storage.session.set({ [key]: { ...payload, isUpdating: false } }).catch(() => {});
  // Also persist compact URL-keyed state so reopening the extension restores data.
  persistPageState(tabId);
}

function schedulePersistTab(tabId) {
  if (!tabState.has(tabId)) return;
  const prev = persistTimers.get(tabId);
  if (prev) clearTimeout(prev);
  persistTimers.set(
    tabId,
    setTimeout(() => {
      persistTimers.delete(tabId);
      persistTabSnapshot(tabId);
    }, PERSIST_DEBOUNCE_MS)
  );
}

function snapshotToState(snap) {
  const quiz = snap.quiz || defaultQuizState();
  return {
    articleText: snap.articleText,
    totalParagraphs: snap.totalParagraphs,
    totalWords: snap.totalWords,
    wordsRead: snap.wordsRead,
    title: snap.title,
    readParagraphs: Array.isArray(snap.readParagraphs) ? snap.readParagraphs : [],
    readUnits: Array.isArray(snap.readUnits) ? snap.readUnits : [],
    pendingUnitParas: Array.isArray(snap.pendingUnitParas) ? snap.pendingUnitParas : [],
    pendingUnitWords: typeof snap.pendingUnitWords === 'number' ? snap.pendingUnitWords : 0,
    wordsSinceSummary: typeof snap.wordsSinceSummary === 'number' ? snap.wordsSinceSummary : 0,
    lastSummaryUnitCount: typeof snap.lastSummaryUnitCount === 'number' ? snap.lastSummaryUnitCount : 0,
    lastUpdateCount: snap.lastUpdateCount || 0,
    isUpdating: false,
    currentSelection: snap.currentSelection ?? null,
    currentQuestion: snap.currentQuestion || '',
    lastSummary: snap.lastSummary || '',
    highlightHistory: Array.isArray(snap.highlightHistory) ? snap.highlightHistory : [],
    pageUrl: snap.pageUrl || '',
    quiz: {
      status: quiz.status || 'idle',
      question: quiz.question || '',
      answer: quiz.answer || '',
      feedback: quiz.feedback || '',
      history: Array.isArray(quiz.history) ? quiz.history : []
    }
  };
}

function pushQuizHistoryItem(s, item) {
  if (!s?.quiz) return;
  const list = Array.isArray(s.quiz.history) ? s.quiz.history : [];
  list.unshift(item);
  s.quiz.history = list.slice(0, 3);
}

function tailParagraphs(s, count = RECENT_CONTEXT_PARAS) {
  return (s?.readParagraphs || []).slice(-count).join('\n\n');
}

function tailReadUnits(s, count = 3, maxChars = MAX_CONTEXT_CHARS) {
  const units = Array.isArray(s?.readUnits) && s.readUnits.length
    ? s.readUnits
    : (s?.readParagraphs || []);
  return clampText(units.slice(-count).join('\n\n'), maxChars);
}

function firstParagraph(s) {
  if (!s?.articleText) return '';
  const chunks = s.articleText.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
  return chunks[0] || '';
}

function compactGistText(s) {
  const raw = (s?.lastSummary || '').trim();
  if (!raw) return '';
  const line = raw.split('\n').map(t => t.trim()).find(Boolean) || '';
  return line.length > 240 ? `${line.slice(0, 240)}...` : line;
}

function clampText(text, maxChars) {
  const raw = typeof text === 'string' ? text : '';
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n\n[truncated for length]`;
}

function cleanSummaryText(text) {
  const lines = (text || '')
    .split('\n')
    .map(l => l.trimEnd())
    .filter((line, idx) => {
      if (!line.trim()) return true;
      const compact = line.trim().toLowerCase();
      if (idx > 2) return true;
      if (/^#{1,6}\s*summary\b/.test(compact)) return false;
      if (/^\*\*summary\*\*$/.test(compact)) return false;
      if (/^summary:?$/.test(compact)) return false;
      return true;
    });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function trimWords(text, maxWords) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ');
}

function normalizeSummaryShape(text) {
  const lines = cleanSummaryText(text).split('\n').map(l => l.trim()).filter(Boolean);
  let gist = '';
  const bullets = [];

  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, '').trim();
    const lower = line.toLowerCase();
    if (!line) continue;
    if (lower === 'summary' || lower === '## summary') continue;
    if (lower.startsWith('the gist:')) {
      const candidate = line.slice('the gist:'.length).trim();
      if (candidate) gist = candidate;
      continue;
    }

    if (line.startsWith('•') || line.startsWith('-')) {
      const candidate = line.slice(1).trim();
      if (candidate) bullets.push(candidate);
      continue;
    }

    if (!gist) gist = line;
    else bullets.push(line);
  }

  const dedup = new Set();
  const uniqueBullets = [];
  for (const b of bullets) {
    const key = b.toLowerCase();
    if (dedup.has(key)) continue;
    dedup.add(key);
    uniqueBullets.push(trimWords(b, 34));
  }

  return {
    gist: trimWords(gist, 45),
    bullets: uniqueBullets.slice(0, 8)
  };
}

function formatSummaryShape(shape) {
  const out = [];
  if (shape.gist) out.push(`The gist: ${shape.gist}`);
  for (const b of shape.bullets || []) out.push(`• ${b}`);
  return out.join('\n').trim();
}

function trimSummaryLength(text) {
  return formatSummaryShape(normalizeSummaryShape(text));
}

function mergeSummaryText(previous, incoming) {
  const prev = normalizeSummaryShape(previous);
  const next = normalizeSummaryShape(incoming);

  const gist = next.gist && next.gist.length >= 18 ? next.gist : (prev.gist || next.gist);
  const dedup = new Set();
  const mergedBullets = [];

  for (const b of [...prev.bullets, ...next.bullets]) {
    const key = b.toLowerCase();
    if (dedup.has(key)) continue;
    dedup.add(key);
    mergedBullets.push(b);
  }

  return formatSummaryShape({
    gist,
    bullets: mergedBullets.slice(0, 8)
  });
}

function tailParagraphsCapped(s, count = RECENT_CONTEXT_PARAS, maxChars = MAX_CONTEXT_CHARS) {
  return clampText(tailParagraphs(s, count), maxChars);
}

function flushPendingUnit(s) {
  if (!s?.pendingUnitParas?.length) return 0;
  const unit = s.pendingUnitParas.join('\n\n').trim();
  const unitWords = s.pendingUnitWords || countWords(unit);
  if (unit) s.readUnits.push(unit);
  s.pendingUnitParas = [];
  s.pendingUnitWords = 0;
  return unitWords;
}

function absorbParagraphIntoUnits(s, text) {
  const paragraph = (text || '').trim();
  if (!paragraph) return 0;
  const words = countWords(paragraph);

  if (words >= UNIT_TARGET_MIN_WORDS || (words > SMALL_PARAGRAPH_MAX_WORDS && s.pendingUnitWords === 0)) {
    const flushed = flushPendingUnit(s);
    s.readUnits.push(paragraph);
    return flushed + words;
  }

  s.pendingUnitParas.push(paragraph);
  s.pendingUnitWords += words;

  if (s.pendingUnitWords >= UNIT_TARGET_MIN_WORDS) {
    return flushPendingUnit(s);
  }
  return 0;
}

function getAiMode() {
  return new Promise(resolve => {
    chrome.storage.local.get(AI_MODE_KEY, bag => {
      const raw = bag?.[AI_MODE_KEY];
      resolve(raw === 'ultra-lean' ? 'ultra-lean' : DEFAULT_AI_MODE);
    });
  });
}

function maxTokensForTask(task, mode) {
  const resolvedMode = mode === 'ultra-lean' ? 'ultra-lean' : DEFAULT_AI_MODE;
  return AI_TUNING[resolvedMode].taskMaxTokens[task] || 128;
}

function scheduleQuizArchive(tabId) {
  const prev = quizArchiveTimers.get(tabId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    quizArchiveTimers.delete(tabId);
    const s = tabState.get(tabId);
    if (!s?.quiz || s.quiz.status !== 'feedback_done') return;
    pushQuizHistoryItem(s, {
      status: 'reviewed',
      question: s.quiz.question || 'Check-in',
      answer: s.quiz.answer || '',
      feedback: s.quiz.feedback || '',
      createdAt: Date.now()
    });
    s.quiz.status = 'idle';
    s.quiz.question = '';
    s.quiz.answer = '';
    s.quiz.feedback = '';
    toPanel({ type: 'QUIZ_HISTORY_UPDATE', tabId, items: s.quiz.history });
    schedulePersistTab(tabId);
  }, QUIZ_ARCHIVE_DELAY_MS);
  quizArchiveTimers.set(tabId, timer);
}

async function ensureTabHydrated(tabId) {
  if (tabState.has(tabId)) return;
  const key = SESSION_TAB_KEY(tabId);
  const bag = await chrome.storage.session.get(key).catch(() => ({}));
  const snap = bag[key];
  if (!snap || snap.v !== 1) return;

  let tabUrl = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = distillPageUrlKey(tab.url || '');
  } catch {
    tabUrl = '';
  }
  if (snap.pageUrl && tabUrl && snap.pageUrl !== tabUrl) {
    await chrome.storage.session.remove(key).catch(() => {});
    return;
  }

  tabState.set(tabId, snapshotToState(snap));
  quizNextAt.set(tabId, typeof snap.quizNextAt === 'number' ? snap.quizNextAt : QUIZ_EVERY);
}

function pagePayloadToState(payload) {
  return distillPagePayloadToState(payload);
}

async function ensureTabHydratedFromPageState(tabId) {
  if (tabState.has(tabId)) return true;

  // Prefer existing session snapshot if present.
  await ensureTabHydrated(tabId);
  if (tabState.has(tabId)) return true;

  let tabUrl = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = distillPageUrlKey(tab?.url || '');
  } catch {
    tabUrl = '';
  }
  if (!tabUrl) return false;

  const key = pageStateKeyForPageUrl(tabUrl);
  const bag = await chrome.storage.local.get(key).catch(() => ({}));
  const payload = bag?.[key] || null;
  if (payload && payload.v === DISTILL_PAGE_STATE_VERSION) {
    // Guard against hash collisions / wrong URL: check embedded pageUrl if present.
    if (payload.pageUrl && payload.pageUrl !== tabUrl) return false;
    tabState.set(tabId, pagePayloadToState({ ...payload, pageUrl: tabUrl }));
    quizNextAt.set(tabId, QUIZ_EVERY);
    restoredFromStorageTabs.add(tabId);
    return true;
  }

  // Migration: no new-format snapshot — hydrate best-effort from the legacy minimal
  // history snapshot. The next persist writes the new format automatically.
  const oldKey = historyKeyForPageUrl(tabUrl);
  const oldBag = await chrome.storage.local.get(oldKey).catch(() => ({}));
  const oldPayload = oldBag?.[oldKey] || null;
  if (oldPayload && (oldPayload.lastSummary || oldPayload.title)) {
    if (oldPayload.pageUrl && oldPayload.pageUrl !== tabUrl) return false;
    tabState.set(tabId, distillHistoryPayloadToState({ ...oldPayload, pageUrl: tabUrl }));
    quizNextAt.set(tabId, QUIZ_EVERY);
    restoredFromStorageTabs.add(tabId);
    return true;
  }

  return false;
}

chrome.tabs.onRemoved.addListener(tabId => {
  clearTab(tabId);
});

const nowDebounceTimers = new Map();
const nowAbortControllers = new Map();
/** Latest paragraph unit text from content script (for manual Now tip). */
const lastActiveParagraphByTab = new Map();

// ── Port connection from side panel ──────────────────────────────────────────

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'sidepanel') return;
  sidePanelPort = port;

  port.onMessage.addListener(msg => {
    switch (msg.type) {
      case 'GET_STATE':
        void (async () => {
          await ensureTabHydratedFromPageState(msg.tabId);
          await restoreState(msg.tabId);
          await publishSitePrefs(msg.tabId);
          toPanel({ type: 'FOCUS_SYNC', tabId: msg.tabId, on: !!focusModeByTab.get(msg.tabId) });
        })();
        break;
      case 'SAVE_SITE_PREFS':
        void (async () => {
          const origin = typeof msg.origin === 'string' ? msg.origin : '';
          if (!origin || (!origin.startsWith('http://') && !origin.startsWith('https://'))) return;
          const map = await getSitePrefsMap();
          const cur = map[origin] && typeof map[origin] === 'object' ? { ...map[origin] } : {};
          if (typeof msg.fontScale === 'number' && Number.isFinite(msg.fontScale)) {
            cur.fontScale = Math.max(0.85, Math.min(1.35, msg.fontScale));
          }
          if (msg.theme === 'system' || msg.theme === 'light' || msg.theme === 'dark') cur.theme = msg.theme;
          if (typeof msg.backendOnly === 'boolean') cur.backendOnly = msg.backendOnly;
          map[origin] = cur;
          await chrome.storage.local.set({ [SITE_PREFS_KEY]: map }).catch(() => {});
          if (msg.tabId) await publishSitePrefs(msg.tabId);
        })();
        break;
      case 'GET_RESUME':
        void (async () => {
          await ensureTabHydratedFromPageState(msg.tabId);
          publishResume(msg.tabId);
        })();
        break;
      case 'CLEAR_RESUME':
        void (async () => {
          await ensureTabHydratedFromPageState(msg.tabId);
          await clearHistorySnapshot(msg.tabId);
        })();
        break;
      case 'CLEAR_ALL_HISTORY':
        void (async () => {
          const removed = await clearAllSavedHistory();
          toPanel({ type: 'ALL_HISTORY_CLEARED', tabId: msg.tabId, removed });
          if (msg.tabId != null) {
            restoredFromStorageTabs.delete(msg.tabId);
            toPanel({ type: 'RESUME_DATA', tabId: msg.tabId, item: null });
          }
        })();
        break;
      case 'GET_USAGE':
        void publishUsage(msg.tabId);
        break;
      case 'VALIDATE_AI_KEY':
        void (async () => {
          const provider = msg.provider === 'anthropic' ? 'anthropic' : 'gemini';
          const result = await validateAiKey(provider, msg.key);
          toPanel({ type: 'KEY_VALIDATION_RESULT', provider, ok: !!result.ok, message: result.message });
        })();
        break;
      case 'RETRY_LAST_AI':
        void (async () => {
          const tabId = msg.tabId;
          if (!tabId) return;
          const fn = lastAiRetryByTab.get(tabId);
          if (!fn) {
            toPanel({ type: 'ERROR', code: 'NO_RETRY', message: 'Nothing to retry yet.', tabId });
            return;
          }
          await ensureTabHydrated(tabId);
          fn().catch(err => {
            toPanel({ type: 'ERROR', code: err?.code, message: err?.message || 'Retry failed.', tabId });
          });
        })();
        break;
      case 'GET_NOTES':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          const s = tabState.get(msg.tabId);
          const wantPlain = msg.format === 'plain';
          if (!s) {
            toPanel({ type: 'NOTES_DATA', tabId: msg.tabId, markdown: '', plain: '', format: wantPlain ? 'plain' : 'markdown' });
            return;
          }
          if (wantPlain) {
            const plain = buildNotesPlain(s);
            toPanel({ type: 'NOTES_DATA', tabId: msg.tabId, markdown: '', plain, format: 'plain' });
          } else {
            const md = buildNotesMarkdown(s);
            toPanel({ type: 'NOTES_DATA', tabId: msg.tabId, markdown: md, plain: '', format: 'markdown' });
          }
        })();
        break;
      case 'UPDATE_HIGHLIGHT_NOTE':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          const s = tabState.get(msg.tabId);
          if (!s) return;
          const id = msg.highlightId;
          const note = typeof msg.note === 'string' ? msg.note.slice(0, 2000) : '';
          const list = Array.isArray(s.highlightHistory) ? s.highlightHistory : [];
          const hit = list.find(h => h?.id === id);
          if (hit) {
            hit.note = note.trim();
            schedulePersistTab(msg.tabId);
            persistHistorySnapshot(msg.tabId);
            broadcastHighlightHistory(msg.tabId);
          }
          toPanel({ type: 'HIGHLIGHT_NOTE_SAVED', tabId: msg.tabId, highlightId: id });
        })();
        break;

      case 'SAVE_SELECTION_NOTE':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          const s = tabState.get(msg.tabId);
          if (!s) return;
          const selection = typeof msg.selection === 'string' ? msg.selection.trim() : '';
          const note = typeof msg.note === 'string' ? msg.note.slice(0, 2000).trim() : '';
          if (!selection || !note) return;

          s.highlightHistory = Array.isArray(s.highlightHistory) ? s.highlightHistory : [];
          const existing = s.highlightHistory.find(h => h?.selection === selection);
          let id = existing?.id;
          let anchor = null;
          try {
            const resp = await chrome.tabs.sendMessage(msg.tabId, { type: 'GET_SELECTION_ANCHOR' });
            if (resp?.anchor && typeof resp.anchor === 'object') anchor = resp.anchor;
          } catch {}
          if (existing) {
            existing.note = note;
            existing.createdAt = existing.createdAt || Date.now();
            if (anchor) existing.anchor = anchor;
          } else {
            const item = {
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              selection,
              analysis: '',
              createdAt: Date.now(),
              note,
              anchor
            };
            s.highlightHistory.unshift(item);
            s.highlightHistory = s.highlightHistory.slice(0, 8);
            id = item.id;
          }

          schedulePersistTab(msg.tabId);
          persistHistorySnapshot(msg.tabId);
          broadcastHighlightHistory(msg.tabId);
          toPanel({ type: 'HIGHLIGHT_NOTE_SAVED', tabId: msg.tabId, highlightId: id });
        })();
        break;
      case 'ANALYZE_SELECTION':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          analyzeSelection(msg.tabId, { force: !!msg.force });
        })();
        break;
      case 'EXPLAIN_PAGE':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          explainPage(msg.tabId, { force: !!msg.force });
        })();
        break;
      case 'REQUEST_NOW_TIP':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          const para = lastActiveParagraphByTab.get(msg.tabId) || '';
          if (!para.trim()) {
            toPanel({
              type: 'TOAST',
              tabId: msg.tabId,
              message: 'Scroll to a paragraph first, then try again.',
              variant: 'info'
            });
            return;
          }
          await streamNowReading(msg.tabId, para, { force: !!msg.force });
        })();
        break;
      case 'SUBMIT_ANSWER':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          evaluateAnswer(msg.tabId, msg.question, msg.answer);
        })();
        break;
      case 'SET_ACCENT':
        if (msg.tabId) {
          chrome.tabs.sendMessage(msg.tabId, { type: 'ACCENT_CHANGED', accentId: msg.accentId }).catch(() => {});
        }
        break;
      case 'SET_FOCUS_MODE':
        if (msg.tabId != null) {
          focusModeByTab.set(msg.tabId, !!msg.on);
          chrome.tabs.sendMessage(msg.tabId, { type: 'FOCUS_MODE', on: !!msg.on }).catch(() => {});
        }
        break;
      case 'START_SCROLL':
      case 'STOP_SCROLL':
      case 'SET_SCROLL_SPEED':
        if (msg.tabId) {
          chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
        }
        break;
      case 'SKIP_QUIZ':
        if (msg.tabId) {
          const s = tabState.get(msg.tabId);
          if (s?.quiz && s.quiz.status !== 'idle') {
            const prev = quizArchiveTimers.get(msg.tabId);
            if (prev) clearTimeout(prev);
            quizArchiveTimers.delete(msg.tabId);
            const question = s.quiz.question || s.currentQuestion || 'Check-in';
            s.quiz.status = 'idle';
            s.quiz.question = '';
            s.quiz.answer = '';
            s.quiz.feedback = '';
            schedulePersistTab(msg.tabId);
            toPanel({ type: 'QUIZ_SKIPPED', tabId: msg.tabId });
            void generateSkippedReview(msg.tabId, question);
          }
          chrome.tabs.sendMessage(msg.tabId, { type: 'UNFREEZE_SCROLL' }).catch(() => {});
        }
        break;
      case 'LEARN_MODE':
        chrome.storage.local.set({ learnMode: msg.on });
        if (!msg.on && msg.tabId) {
          const s = tabState.get(msg.tabId);
          if (s?.quiz && s.quiz.status !== 'idle') {
            const prev = quizArchiveTimers.get(msg.tabId);
            if (prev) clearTimeout(prev);
            quizArchiveTimers.delete(msg.tabId);
            const question = s.quiz.question || s.currentQuestion || 'Check-in';
            s.quiz.status = 'idle';
            s.quiz.question = '';
            s.quiz.answer = '';
            s.quiz.feedback = '';
            schedulePersistTab(msg.tabId);
            toPanel({ type: 'QUIZ_SKIPPED', tabId: msg.tabId });
            void generateSkippedReview(msg.tabId, question);
          }
          chrome.tabs.sendMessage(msg.tabId, { type: 'UNFREEZE_SCROLL' }).catch(() => {});
        }
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    if (sidePanelPort === port) sidePanelPort = null;
  });
});

// ── Messages from content scripts ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  void (async () => {
    if (msg.type === 'TAB_NAVIGATING') {
      clearTab(tabId);
      toPanel({ type: 'ARTICLE_NAVIGATING', tabId });
      return;
    }

    await ensureTabHydrated(tabId);

    switch (msg.type) {
      case 'ARTICLE_DETECTED': {
        const pageUrl = distillPageUrlKey(msg.pageUrl || '');
        const articleText = clampText(msg.articleText || '', MAX_ARTICLE_TEXT_CHARS);

        // Load any saved snapshot for this URL first (covers a service-worker restart),
        // so re-detecting the article doesn't wipe the reader's saved progress.
        await ensureTabHydratedFromPageState(tabId);
        const existing = tabState.get(tabId);
        const hasSavedProgress = !!existing && existing.pageUrl === pageUrl && (
          !!existing.lastSummary ||
          (Array.isArray(existing.readUnits) && existing.readUnits.length > 0) ||
          (Array.isArray(existing.readParagraphs) && existing.readParagraphs.length > 0) ||
          (Array.isArray(existing.highlightHistory) && existing.highlightHistory.length > 0) ||
          (existing.quiz && existing.quiz.status !== 'idle')
        );

        if (hasSavedProgress) {
          // Same article with saved progress → refresh live fields, keep progress, republish.
          existing.articleText = articleText;
          existing.totalParagraphs = msg.paragraphCount || existing.totalParagraphs || 0;
          existing.totalWords = msg.totalWords || existing.totalWords || 0;
          if (msg.title) existing.title = msg.title;
          if (!summaryCadenceState.has(tabId)) summaryCadenceState.set(tabId, { lastSummaryAt: 0 });
          if (!quizNextAt.has(tabId)) quizNextAt.set(tabId, QUIZ_EVERY);
          persistTabSnapshot(tabId);
          persistHistorySnapshot(tabId);
          await restoreState(tabId); // republishes ARTICLE_DETECTED + progress + summary + quiz + highlights
          void publishResume(tabId);
          void publishSitePrefs(tabId);
          break;
        }

        // Fresh article (new page or no saved progress) → reset.
        restoredFromStorageTabs.delete(tabId);
        tabState.set(tabId, {
          articleText,
          totalParagraphs:  msg.paragraphCount,
          totalWords:       msg.totalWords || 0,
          wordsRead:        0,
          title:            msg.title || '',
          readParagraphs:   [],
          readUnits:        [],
          pendingUnitParas: [],
          pendingUnitWords: 0,
          wordsSinceSummary: 0,
          lastSummaryUnitCount: 0,
          lastUpdateCount:  0,
          isUpdating:       false,
          currentSelection: null,
          currentQuestion:  '',
          lastSummary:      '',
          highlightHistory: [],
          pageUrl,
          quiz: defaultQuizState()
        });
        summaryCadenceState.set(tabId, { lastSummaryAt: 0 });
        quizNextAt.set(tabId, QUIZ_EVERY);
        toPanel({
          type: 'ARTICLE_DETECTED',
          paragraphCount: msg.paragraphCount,
          title: msg.title || '',
          pageUrl,
          tabId,
          paragraphsUntilNextQuiz: paragraphsUntilQuiz(tabId)
        });
        persistTabSnapshot(tabId);
        persistHistorySnapshot(tabId);
        void publishResume(tabId);
        void publishSitePrefs(tabId);
        break;
      }

      case 'NO_ARTICLE':
        clearTab(tabId);
        toPanel({ type: 'NO_ARTICLE', tabId });
        break;

      case 'NO_ARTICLE_SERP':
        clearTab(tabId);
        toPanel({ type: 'NO_ARTICLE_SERP', tabId });
        break;

      case 'ACTIVE_PARAGRAPH': {
        const para = (msg.text || '').trim();
        if (para) lastActiveParagraphByTab.set(tabId, para);
        scheduleMaybeAutoNow(tabId, para);
        void schedulePauseToExplain(tabId, para);
        break;
      }

      case 'PARAGRAPH_READ':
        onParagraphRead(tabId, msg.text);
        break;

      case 'SELECTION_CHANGED': {
        const s = tabState.get(tabId);
        if (s) {
          s.currentSelection = msg.selectedText;
          schedulePersistTab(tabId);
        }
        toPanel({ type: 'SELECTION_CHANGED', selectedText: msg.selectedText, tabId });
        break;
      }

      case 'SCROLL_PAUSED':
        toPanel({ type: 'SCROLL_PAUSED', tabId });
        break;

      case 'SCROLL_ENDED':
        {
          const s = tabState.get(tabId);
          if (s) {
            const emitted = flushPendingUnit(s);
            if (emitted > 0) s.wordsSinceSummary += emitted;
            if (!s.isUpdating && s.wordsSinceSummary > 0) updateSummary(tabId);
            schedulePersistTab(tabId);
          }
        }
        toPanel({ type: 'SCROLL_ENDED', tabId });
        break;

    }
  })();

  return true;
});

// ── Reading progress ──────────────────────────────────────────────────────────

function onParagraphRead(tabId, text) {
  const s = tabState.get(tabId);
  if (!s) return;

  s.readParagraphs.push(text);
  s.wordsRead += countWords(text);
  const emittedUnitWords = absorbParagraphIntoUnits(s, text);
  if (emittedUnitWords > 0) s.wordsSinceSummary += emittedUnitWords;

  toPanel({
    type: 'PROGRESS_UPDATE',
    readCount: s.readParagraphs.length,
    totalParagraphs: s.totalParagraphs,
    wordsRead: s.wordsRead,
    totalWords: s.totalWords,
    tabId,
    paragraphsUntilNextQuiz: paragraphsUntilQuiz(tabId)
  });

  // "So far" summary every semantic unit window (whole paragraphs only).
  const cadence = summaryCadenceState.get(tabId) || { lastSummaryAt: 0 };
  const now = Date.now();
  const cfg = summaryCadenceForMode();
  const quietWindowPassed = now - cadence.lastSummaryAt >= cfg.minIntervalMs;
  const forceByVolume = s.wordsSinceSummary >= cfg.forceIntervalWords;
  if (!s.isUpdating && s.wordsSinceSummary >= cfg.minNewWords && (quietWindowPassed || forceByVolume)) {
    updateSummary(tabId);
  }

  // Comprehension quiz every QUIZ_EVERY paragraphs (only in Learn Mode)
  const nextQuiz = quizNextAt.get(tabId) || QUIZ_EVERY;
  if (s.readParagraphs.length >= nextQuiz && !s.isUpdating) {
    quizNextAt.set(tabId, s.readParagraphs.length + QUIZ_EVERY);
    schedulePersistTab(tabId);
    chrome.storage.local.get('learnMode', r => {
      if (r.learnMode) generateQuestion(tabId);
    });
  }

  schedulePersistTab(tabId);
  persistHistorySnapshot(tabId);
}

function paragraphDifficultyScore(text) {
  const raw = (text || '').trim();
  if (!raw) return 0;
  const words = countWords(raw);
  const sentences = raw.split(/[.!?]+/).map(s => s.trim()).filter(Boolean).length || 1;
  const avgSentenceLen = words / sentences;
  const digitDensity = (raw.match(/\d/g) || []).length;
  const punctuationDensity = (raw.match(/[;:()-]/g) || []).length;
  const longTokenCount = (raw.match(/\b[A-Za-z]{12,}\b/g) || []).length;
  let score = 0;
  // Length helps, but density matters more so short-but-dense paragraphs still qualify.
  if (words >= 90) score += 1.2;
  if (avgSentenceLen >= 22) score += 1.0;
  if (digitDensity >= 6) score += 1.0;
  if (punctuationDensity >= 6) score += 0.9;
  if (longTokenCount >= 3) score += 0.9;
  return score;
}

function getAutoNowMode() {
  return new Promise(resolve => {
    chrome.storage.local.get(AUTO_NOW_MODE_KEY, bag => {
      resolve(bag?.[AUTO_NOW_MODE_KEY] === 'smart' ? 'smart' : 'off');
    });
  });
}

function defaultNowAssistState() {
  return { lastAt: 0, lastHash: '', lastHintAt: 0, cache: null };
}

function nowParagraphHash(paragraphText) {
  return stableStringHash(clampText((paragraphText || '').trim(), 1300));
}

function scheduleMaybeAutoNow(tabId, paragraphText) {
  const prev = nowDebounceTimers.get(tabId);
  if (prev) clearTimeout(prev);
  nowDebounceTimers.set(tabId, setTimeout(() => {
    nowDebounceTimers.delete(tabId);
    void maybeAutoNowReading(tabId, paragraphText);
  }, 2000));
}

function replayNowCached(tabId, text) {
  toPanel({ type: 'NOW_CACHED', tabId, text: text || '', fromCache: true });
}

/** Auto "Now reading" while scrolling (Settings → Smart). */
async function maybeAutoNowReading(tabId, paragraphText) {
  const mode = await getAutoNowMode();
  if (mode === 'off') return;

  const raw = (paragraphText || '').trim();
  if (!raw) return;
  const hash = nowParagraphHash(raw);
  const now = Date.now();
  const prev = nowAssistState.get(tabId) || defaultNowAssistState();

  if (prev.lastHash === hash) return;
  if (now - (prev.lastAt || 0) < NOW_COOLDOWN_MS) return;

  const score = paragraphDifficultyScore(raw);
  if (score < 1.1) {
    if (score >= 0.7 && now - (prev.lastHintAt || 0) > 45000) {
      nowAssistState.set(tabId, { ...prev, lastHash: hash, lastHintAt: now });
      toPanel({ type: 'NOW_HINT', tabId });
    }
    return;
  }

  nowAssistState.set(tabId, { ...prev, lastAt: now, lastHash: hash });
  await streamNowReading(tabId, raw, { force: false });
}

/** Study mode: linger on a hard paragraph (only when Auto Now is off). */
async function schedulePauseToExplain(tabId, paragraphText) {
  if (readerMode !== 'study') return;
  const mode = await getAutoNowMode();
  if (mode === 'smart') return;

  const raw = (paragraphText || '').trim();
  if (!raw) return;

  const hash = nowParagraphHash(raw);
  const prev = nowAssistState.get(tabId) || defaultNowAssistState();

  if (prev.lastHash === hash && Date.now() - (prev.lastAt || 0) < 45000) return;

  const existing = pauseExplainTimers.get(tabId);
  if (existing) clearTimeout(existing);

  const words = countWords(raw);
  const expectedReadMs = Math.max(900, (words / ESTIMATED_READING_WPM) * 60000);
  const delayMs = Math.max(
    PAUSE_TO_EXPLAIN_MIN_MS,
    Math.min(PAUSE_TO_EXPLAIN_MAX_MS, expectedReadMs * 2.8)
  );

  const scheduledAt = Date.now();
  pauseExplainTimers.set(tabId, setTimeout(async () => {
    pauseExplainTimers.delete(tabId);

    const cur = nowAssistState.get(tabId) || defaultNowAssistState();
    if (cur.lastHash === hash && scheduledAt < (cur.lastAt || 0)) return;

    const score = paragraphDifficultyScore(raw);
    if (score < 1.9) return;

    nowAssistState.set(tabId, { ...cur, lastAt: Date.now(), lastHash: hash });
    await streamNowReading(tabId, raw, { force: false });
  }, delayMs));
}

// ── "Now reading" (one-line reading tip for current paragraph) ───────────────

async function streamNowReading(tabId, paragraphText, opts = {}) {
  const force = opts.force === true;
  const s = tabState.get(tabId);
  if (!s) return;

  const raw = (paragraphText || '').trim();
  if (!raw) return;
  const hash = nowParagraphHash(raw);
  const prev = nowAssistState.get(tabId) || defaultNowAssistState();

  if (!force && prev.cache?.hash === hash && prev.cache?.text) {
    replayNowCached(tabId, prev.cache.text);
    return;
  }

  const prevCtrl = nowAbortControllers.get(tabId);
  if (prevCtrl) prevCtrl.abort();
  const ctrl = new AbortController();
  nowAbortControllers.set(tabId, ctrl);

  toPanel({ type: 'NOW_START', tabId });

  let nowText = '';
  try {
    const recentContext = tailParagraphsCapped(s, 5);
    const clampedParagraph = clampText(raw, 1300);
    await streamTask({
      tabId,
      task: 'now',
      s,
      signal: ctrl.signal,
      noAuthMessage: 'No API key set — click ⚙ to add your Anthropic API key.',
      context: {
        title: s.title || '',
        recent: recentContext || '(start of article)'
      },
      input: { paragraph: clampedParagraph },
      systemPrompt: 'You are a reading companion. Give one crisp sentence that helps the reader keep momentum.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Recent context:\n\n${recentContext || '(start of article)'}` },
          { type: 'text', text: `Current paragraph:\n\n"${clampedParagraph}"\n\nIn ONE plain sentence (max 22 words), say what this means and why it matters.` }
        ]
      }],
      onChunk: chunk => {
        nowText += chunk;
        toPanel({ type: 'NOW_CHUNK', chunk, tabId });
      },
      onDone: () => {
        nowAbortControllers.delete(tabId);
        const text = nowText.trim();
        const state = nowAssistState.get(tabId) || defaultNowAssistState();
        if (text) {
          nowAssistState.set(tabId, {
            ...state,
            lastAt: Date.now(),
            lastHash: hash,
            cache: { hash, text }
          });
        }
        toPanel({ type: 'NOW_DONE', tabId });
      },
      onError: err => {
        nowAbortControllers.delete(tabId);
        if (err.name !== 'AbortError') {
          toPanel({ type: 'ERROR', code: err.code, message: err.message, tabId });
        }
      }
    });
  } catch (e) {
    nowAbortControllers.delete(tabId);
    if (e.name !== 'AbortError') toPanel({ type: 'ERROR', code: e.code, message: e.message, tabId });
  }
}

// ── "So far" summary ──────────────────────────────────────────────────────────

async function updateSummary(tabId) {
  const s = tabState.get(tabId);
  if (!s || s.isUpdating || s.readParagraphs.length === 0) return;

  // If we only have tiny trailing paragraphs buffered, keep paragraph boundaries and flush as one unit.
  if (s.pendingUnitWords > 0 && s.wordsSinceSummary >= SUMMARY_MIN_NEW_WORDS) {
    s.wordsSinceSummary += flushPendingUnit(s);
  }
  if (!s.readUnits.length && s.readParagraphs.length) {
    // Backward-compatible fallback for older state.
    s.readUnits = [...s.readParagraphs];
  }

  s.isUpdating = true;
  s.lastUpdateCount = s.readParagraphs.length;

  const readText = clampText(s.readUnits.join('\n\n'), MAX_READ_SO_FAR_CHARS);
  const readCount = s.readUnits.length;
  const isFirstSummary = !s.lastSummary?.trim();
  const startIdx = Math.max(0, Math.min(s.lastSummaryUnitCount || 0, s.readUnits.length));
  const freshUnits = s.readUnits.slice(startIdx);
  const freshText = clampText(freshUnits.join('\n\n'), MAX_CONTEXT_CHARS);

  toPanel({ type: 'SUMMARY_START', tabId });
  let summary = '';

  try {
    const opener = firstParagraph(s);
    const recent = tailParagraphsCapped(s, 4);
    const priorGist = compactGistText(s);
    await streamTask({
      tabId,
      task: 'summary',
      s,
      noAuthMessage: 'No API key set — click ⚙ to add your Anthropic API key.',
      context: {
        title: s.title || '',
        opener: opener || '',
        priorGist: priorGist || '',
        recent: recent || '',
        fresh: freshText || '',
        readCount
      },
      input: { readSoFar: readText, freshRead: freshText },
      systemPrompt: 'You are a reading companion. Summarize only what the reader has read so far — never hint at what comes next.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Article title: ${s.title || '(untitled)'}` },
          { type: 'text', text: `Opening paragraph:\n\n${opener || '(not available)'}` },
          !isFirstSummary ? { type: 'text', text: `Previous summary:\n\n${s.lastSummary}` } : null,
          { type: 'text', text: `Most recent read context:\n\n${recent || '(none yet)'}` },
          isFirstSummary
            ? { type: 'text', text: `Read so far (${readCount} paragraph(s)):\n\n${readText}` }
            : { type: 'text', text: `Newly read section since last update:\n\n${freshText || '(no significant change)'}` },
          isFirstSummary
            ? { type: 'text', text: 'Write only what was read. Format exactly: one line "The gist: ..." plus up to 3 short bullets. No headings. No markdown.' }
            : { type: 'text', text: 'Continue the summary with 1-3 NEW bullets for the newly read section. Keep previous details intact, avoid repeated points, and do not add headings.' }
        ].filter(Boolean)
      }],
      onChunk: chunk => { summary += chunk; toPanel({ type: 'SUMMARY_CHUNK', chunk, tabId }); },
      onDone:  ()    => {
        const merged = isFirstSummary
          ? cleanSummaryText(summary)
          : mergeSummaryText(s.lastSummary, summary);
        s.lastSummary = trimSummaryLength(merged);
        s.wordsSinceSummary = 0;
        s.lastSummaryUnitCount = s.readUnits.length;
        s.isUpdating = false;
        summaryCadenceState.set(tabId, { lastSummaryAt: Date.now() });
        toPanel({ type: 'SUMMARY_REWRITE', text: s.lastSummary, tabId });
        toPanel({ type: 'SUMMARY_DONE', tabId });
        schedulePersistTab(tabId);
        persistHistorySnapshot(tabId);
        void publishResume(tabId);
      },
      onError: err   => {
        s.isUpdating = false;
        toPanel({ type: 'ERROR', code: err.code, message: err.message, tabId });
        schedulePersistTab(tabId);
      }
    });
  } catch (e) {
    s.isUpdating = false;
    toPanel({ type: 'ERROR', code: e.code, message: e.message, tabId });
    schedulePersistTab(tabId);
  }
}

// ── Comprehension quiz ────────────────────────────────────────────────────────

async function generateQuestion(tabId) {
  const s = tabState.get(tabId);
  if (!s) return;

  const recentText = tailReadUnits(s, 3, MAX_CONTEXT_CHARS);
  s.quiz.status = 'loading';
  s.quiz.question = '';
  s.quiz.answer = '';
  s.quiz.feedback = '';
  schedulePersistTab(tabId);
  toPanel({ type: 'QUIZ_START', tabId });
  chrome.tabs.sendMessage(tabId, { type: 'FREEZE_SCROLL' }).catch(() => {});

  let question = '';
  try {
    await streamTask({
      tabId,
      task: 'quiz_question',
      s,
      noAuthMessage: 'No API key set — click ⚙ to add your Anthropic API key.',
      context: { title: s.title || '', recent: recentText },
      input: {},
      systemPrompt: 'You generate single, focused comprehension questions to test reading understanding.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `The reader just finished:\n\n${recentText}` },
          { type: 'text', text: 'Ask ONE short, specific comprehension question about this section only. Output only the question.' }
        ]
      }],
      onChunk: chunk => { question += chunk; toPanel({ type: 'QUIZ_CHUNK', chunk, tabId }); },
      onDone:  ()    => {
        if (s) {
          s.currentQuestion = question;
          s.quiz = {
            status: 'question',
            question: question.trim(),
            answer: '',
            feedback: '',
            history: s.quiz?.history || []
          };
        }
        toPanel({ type: 'QUIZ_DONE', tabId });
        schedulePersistTab(tabId);
      },
      onError: err => {
        if (s) {
          const history = s.quiz?.history || [];
          s.quiz = { ...defaultQuizState(), history };
          schedulePersistTab(tabId);
        }
        toPanel({ type: 'ERROR', code: err.code, message: err.message, tabId });
        chrome.tabs.sendMessage(tabId, { type: 'UNFREEZE_SCROLL' }).catch(() => {});
      }
    });
  } catch (e) {
    if (s) {
      const history = s.quiz?.history || [];
      s.quiz = { ...defaultQuizState(), history };
      schedulePersistTab(tabId);
    }
    toPanel({ type: 'ERROR', code: e.code, message: e.message, tabId });
    chrome.tabs.sendMessage(tabId, { type: 'UNFREEZE_SCROLL' }).catch(() => {});
  }
}

async function evaluateAnswer(tabId, question, answer) {
  const s = tabState.get(tabId);
  if (!s) return;

  s.quiz = {
    status: 'feedback_loading',
    question: question || s.quiz?.question || '',
    answer,
    feedback: '',
    history: s.quiz?.history || []
  };
  schedulePersistTab(tabId);
  toPanel({ type: 'FEEDBACK_START', tabId });

  try {
    let feedbackText = '';
    const recent = tailReadUnits(s, 3, MAX_CONTEXT_CHARS);
    const safeAnswer = clampText(answer, 700);
    await streamTask({
      tabId,
      task: 'quiz_feedback',
      s,
      noAuthMessage: 'No API key set — click ⚙ to add your Anthropic API key.',
      context: { title: s.title || '', recent },
      input: { question, answer: safeAnswer },
      systemPrompt: 'You give brief, encouraging feedback on reading comprehension answers. Be warm and specific.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Recent section:\n\n${recent}` },
          { type: 'text', text: `Question: ${question}\nReader answer: "${safeAnswer}"\n\nGive 2-3 supportive sentences: correctness + what was right/missed.` }
        ]
      }],
      onChunk: chunk => {
        feedbackText += chunk;
        if (s?.quiz) s.quiz.feedback = feedbackText;
        toPanel({ type: 'FEEDBACK_CHUNK', chunk, tabId });
      },
      onDone:  ()    => {
        const s2 = tabState.get(tabId);
        if (s2) {
          s2.quiz.status = 'feedback_done';
          s2.quiz.question = question || s2.quiz?.question || '';
          s2.quiz.answer = answer;
          s2.quiz.feedback = feedbackText;
          scheduleQuizArchive(tabId);
        }
        const until = s2 ? paragraphsUntilQuiz(tabId) : QUIZ_EVERY;
        toPanel({ type: 'FEEDBACK_DONE', paragraphsUntilNextQuiz: until, tabId });
        chrome.tabs.sendMessage(tabId, { type: 'UNFREEZE_SCROLL' }).catch(() => {});
        schedulePersistTab(tabId);
      },
      onError: err => {
        if (s) {
          const history = s.quiz?.history || [];
          s.quiz = { ...defaultQuizState(), history };
          schedulePersistTab(tabId);
        }
        toPanel({ type: 'ERROR', code: err.code, message: err.message, tabId });
        chrome.tabs.sendMessage(tabId, { type: 'UNFREEZE_SCROLL' }).catch(() => {});
      }
    });
  } catch (e) {
    if (s) {
      const history = s.quiz?.history || [];
      s.quiz = { ...defaultQuizState(), history };
      schedulePersistTab(tabId);
    }
    toPanel({ type: 'ERROR', code: e.code, message: e.message, tabId });
    chrome.tabs.sendMessage(tabId, { type: 'UNFREEZE_SCROLL' }).catch(() => {});
  }
}

async function generateSkippedReview(tabId, question) {
  const s = tabState.get(tabId);
  if (!s) return;
  const authMissingFallback = () => {
    pushQuizHistoryItem(s, { status: 'skipped', question, answer: 'Skipped', feedback: '', createdAt: Date.now() });
    toPanel({ type: 'QUIZ_HISTORY_UPDATE', tabId, items: s.quiz.history });
    schedulePersistTab(tabId);
  };

  let feedbackText = '';
  try {
    await streamTask({
      tabId,
      task: 'quiz_skipped_review',
      s,
      noAuthMessage: '',
      context: { title: s.title || '', recent: tailReadUnits(s, 3, MAX_CONTEXT_CHARS) },
      input: { question, answer: 'Skipped' },
      systemPrompt: 'You provide concise reading-comprehension coaching.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Recent section:\n\n${tailReadUnits(s, 3, MAX_CONTEXT_CHARS)}` },
          { type: 'text', text: `Question: ${question}\n\nThe reader skipped this check-in.\nProvide a short model answer and one key takeaway in 2-3 sentences.` }
        ]
      }],
      onChunk: chunk => { feedbackText += chunk; },
      onDone: () => {
        pushQuizHistoryItem(s, {
          status: 'skipped',
          question,
          answer: 'Skipped',
          feedback: feedbackText.trim(),
          createdAt: Date.now()
        });
        toPanel({ type: 'QUIZ_HISTORY_UPDATE', tabId, items: s.quiz.history });
        schedulePersistTab(tabId);
      },
      onError: () => authMissingFallback()
    });
  } catch {
    authMissingFallback();
  }
}

// ── Explain this page ─────────────────────────────────────────────────────────

async function runExplainStream(tabId, pageText, opts = {}) {
  const allowEnqueue = opts.allowEnqueue !== false;
  const s = tabState.get(tabId) || { pageUrl: '', title: '', totalParagraphs: 0 };
  let completed = false;
  let explainText = '';
  const pageUrlKey = distillPageUrlKey(s.pageUrl || '');
  const contentHash = distillExplainContentHash(pageText);
  toPanel({ type: 'EXPLAIN_START', tabId });
  const handleErr = err => {
    if (allowEnqueue && isBackendUnreachableError(err)) {
      void enqueueOfflineJob({
        task: 'explain_page',
        tabId,
        payload: {
          pageText: clampText(pageText, MAX_PAGE_EXPLAIN_CHARS),
          pageUrl: s.pageUrl || ''
        }
      });
      toPanel({
        type: 'TOAST',
        tabId,
        message: 'Explain queued — will run when the backend is back.',
        variant: 'success'
      });
    }
    toPanel({ type: 'ERROR', code: err?.code, message: err?.message || String(err), tabId });
  };
  try {
    await streamTask({
      tabId,
      task: 'explain_page',
      s,
      noAuthMessage: 'No API key set — click ⚙ to add your Anthropic API key.',
      context: {},
      input: { pageText },
      systemPrompt: 'You explain web pages in plain, friendly language.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Page content:\n\n${pageText}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Explain this web page in plain, friendly language. Cover what kind of page it is, what it\'s about (2–3 sentences), and who it\'s for. Under 120 words. No bullet points.' }
        ]
      }],
      onChunk: chunk => {
        explainText += chunk;
        toPanel({ type: 'EXPLAIN_CHUNK', chunk, tabId });
      },
      onDone:  ()    => {
        completed = true;
        const text = explainText.trim();
        if (text) {
          s.explainCache = { pageUrl: pageUrlKey, contentHash, text };
          schedulePersistTab(tabId);
        }
        toPanel({ type: 'EXPLAIN_DONE', tabId });
      },
      onError: handleErr
    });
  } catch (e) {
    handleErr(e);
  }
  return completed;
}

function replayCachedExplain(tabId, s, cache) {
  toPanel({ type: 'EXPLAIN_CACHED', tabId, text: cache.text, fromCache: true });
}

async function explainPage(tabId, opts = {}) {
  const force = opts.force === true;
  let tabUrl = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = tab?.url || '';
  } catch {
    tabUrl = '';
  }

  // Some pages are not scriptable by extensions (Chrome internal pages, Web Store, etc.).
  // Give a clear error instead of the generic "Could not read page content."
  if (!tabUrl) {
    toPanel({ type: 'ERROR', code: 'TAB_URL_UNKNOWN', message: 'Could not read this tab’s URL.', tabId });
    return;
  }
  const u = tabUrl.toLowerCase();
  if (
    u.startsWith('chrome://') ||
    u.startsWith('edge://') ||
    u.startsWith('about:') ||
    u.startsWith('chrome-extension://') ||
    u.startsWith('moz-extension://') ||
    u.startsWith('safari-extension://') ||
    u.startsWith('devtools://') ||
    u.startsWith('view-source:') ||
    u.includes('chrome.google.com/webstore')
  ) {
    toPanel({
      type: 'ERROR',
      code: 'PAGE_UNSUPPORTED',
      message: 'Chrome does not allow extensions to read content on this kind of page. Try an http(s) article/page instead.',
      tabId
    });
    return;
  }

  let pageText = '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: maxChars => document.body.innerText.trim().slice(0, maxChars),
      args: [MAX_PAGE_EXPLAIN_CHARS]
    });
    pageText = result.result || '';
  } catch {
    toPanel({
      type: 'ERROR',
      code: 'PAGE_READ_FAILED',
      message: 'Could not read page content. This can happen on restricted pages, PDFs, or pages that block script injection.',
      tabId
    });
    return;
  }

  if (!pageText) { toPanel({ type: 'ERROR', code: 'NO_READABLE_TEXT', message: 'No readable content found.', tabId }); return; }

  const s = tabState.get(tabId) || {};
  const pageUrlKey = distillPageUrlKey(tabUrl);
  const contentHash = distillExplainContentHash(pageText);
  if (!force && s.explainCache?.text && s.explainCache.pageUrl === pageUrlKey && s.explainCache.contentHash === contentHash) {
    replayCachedExplain(tabId, s, s.explainCache);
    return;
  }

  await runExplainStream(tabId, pageText, { allowEnqueue: true });
}

// ── Highlight analysis ────────────────────────────────────────────────────────

async function runAnalyzeStream(tabId, s, ctx, rawSelection, opts = {}) {
  const allowEnqueue = opts.allowEnqueue !== false;
  const selectedText = clampText(rawSelection, MAX_SELECTION_CHARS);
  const opener = ctx.opener || '';
  const priorGist = ctx.priorGist || '';
  const recent = ctx.recent || '';

  let completed = false;
  toPanel({ type: 'ANALYSIS_START', tabId });
  let analysisText = '';
  const handleErr = err => {
    if (allowEnqueue && isBackendUnreachableError(err)) {
      void enqueueOfflineJob({
        task: 'analysis',
        tabId,
        payload: {
          selectedText,
          title: s.title || '',
          pageUrl: s.pageUrl || '',
          opener,
          priorGist,
          recent
        }
      });
      toPanel({
        type: 'TOAST',
        tabId,
        message: 'Analysis queued — will run when the backend is back.',
        variant: 'success'
      });
    }
    toPanel({ type: 'ERROR', code: err?.code, message: err?.message || String(err), tabId });
  };
  try {
    await streamTask({
      tabId,
      task: 'analysis',
      s,
      noAuthMessage: 'No API key set.',
      context: { title: s.title || '', opener, priorGist, recent },
      input: { selection: selectedText },
      systemPrompt: 'You add context and depth to highlighted text.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Article title: ${s.title || '(untitled)'}` },
          { type: 'text', text: `Opening paragraph:\n\n${opener || '(not available)'}` },
          priorGist ? { type: 'text', text: `Article gist so far:\n${priorGist}` } : null,
          { type: 'text', text: `Recent reading context:\n\n${recent}` },
          { type: 'text', text: `Highlighted:\n\n"${selectedText}"\n\nExplain in context in 3-5 conversational sentences.` }
        ].filter(Boolean)
      }],
      onChunk: chunk => {
        analysisText += chunk;
        toPanel({ type: 'ANALYSIS_CHUNK', chunk, tabId });
      },
      onDone:  ()    => {
        completed = true;
        s.highlightHistory = Array.isArray(s.highlightHistory) ? s.highlightHistory : [];
        const existing = s.highlightHistory.find(h => h?.selection === selectedText);
        let item = existing;
        if (existing) {
          existing.analysis = analysisText.trim();
          existing.createdAt = existing.createdAt || Date.now();
          s.highlightHistory = [existing, ...s.highlightHistory.filter(h => h !== existing)];
        } else {
          item = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            selection: selectedText,
            analysis: analysisText.trim(),
            createdAt: Date.now(),
            note: '',
            anchor: null
          };
          s.highlightHistory.unshift(item);
        }
        s.highlightHistory = s.highlightHistory.slice(0, 8);
        schedulePersistTab(tabId);
        persistHistorySnapshot(tabId);
        broadcastHighlightHistory(tabId);
        toPanel({ type: 'ANALYSIS_DONE', tabId, highlightId: item.id });
      },
      onError: handleErr
    });
  } catch (e) {
    handleErr(e);
  }
  return completed;
}

async function runAnalyzeFromReplay(job) {
  const s = tabState.get(job.tabId);
  if (!s || !job.payload?.selectedText) return false;
  const p = job.payload;
  const ctx = {
    opener: p.opener || '',
    priorGist: p.priorGist || '',
    recent: p.recent || ''
  };
  s.currentSelection = p.selectedText;
  return runAnalyzeStream(job.tabId, s, ctx, p.selectedText, { allowEnqueue: false });
}

function replayCachedAnalysis(tabId, entry, selection) {
  toPanel({
    type: 'ANALYSIS_CACHED',
    tabId,
    highlightId: entry.id,
    selection: selection || entry.selection || '',
    analysis: entry.analysis || '',
    note: entry.note || '',
    fromCache: true
  });
}

async function analyzeSelection(tabId, opts = {}) {
  const force = opts.force === true;
  const s = tabState.get(tabId);
  if (!s?.currentSelection) return;

  const selectedText = clampText(s.currentSelection, MAX_SELECTION_CHARS);
  if (!force) {
    const cached = distillFindCachedHighlight(s.highlightHistory, selectedText);
    if (cached) {
      replayCachedAnalysis(tabId, cached, selectedText);
      return;
    }
  }

  const ctx = {
    opener: firstParagraph(s),
    priorGist: compactGistText(s),
    recent: tailParagraphsCapped(s, 8)
  };
  await runAnalyzeStream(tabId, s, ctx, s.currentSelection, { allowEnqueue: true });
}

async function tryFlushOfflineQueue() {
  if (offlineFlushRunning) return;
  const probe = await probeBackend();
  if (!probe.ok) return;
  const token = await ensureBackendToken();
  if (!token) return;

  const bag = await chrome.storage.local.get(OFFLINE_QUEUE_KEY).catch(() => ({}));
  const q = Array.isArray(bag[OFFLINE_QUEUE_KEY]) ? bag[OFFLINE_QUEUE_KEY] : [];
  if (!q.length) return;
  offlineFlushRunning = true;
  const kept = [];
  let processed = 0;
  try {
  for (const job of q) {
    try {
      if (job.task === 'explain_page' && job.payload?.pageText) {
        try {
          await chrome.tabs.get(job.tabId);
        } catch {
          processed++;
          continue;
        }
        const ok = await runExplainStream(job.tabId, job.payload.pageText, { allowEnqueue: false });
        if (ok) processed++;
        else kept.push(job);
      } else if (job.task === 'analysis' && job.payload?.selectedText) {
        try {
          await chrome.tabs.get(job.tabId);
        } catch {
          processed++;
          continue;
        }
        const ok = await runAnalyzeFromReplay(job);
        if (ok) processed++;
        else kept.push(job);
      } else {
        kept.push(job);
      }
    } catch {
      kept.push(job);
    }
  }
  await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: kept }).catch(() => {});
  if (processed > 0) toPanel({ type: 'OFFLINE_SYNC', processed });
  } finally {
    offlineFlushRunning = false;
  }
}

function buildNotesMarkdown(s) {
  const title = (s.title || '').trim();
  const url = (s.pageUrl || '').trim();
  const summary = (s.lastSummary || '').trim();
  const highlights = Array.isArray(s.highlightHistory) ? s.highlightHistory : [];
  const checkins = Array.isArray(s.quiz?.history) ? s.quiz.history : [];

  const fmtTime = ms => {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const oneLine = t => (t || '').replace(/\s+/g, ' ').trim();

  const out = [];
  out.push(`# Distill notes${title ? ` — ${title}` : ''}`);
  if (url) out.push(`Source: ${url}`);
  out.push(`Captured: ${fmtTime(Date.now())}`);
  out.push('');

  if (summary) {
    out.push('## So far (running notes)');
    out.push(summary.trim());
    out.push('');
  }

  if (highlights.length) {
    out.push('## Highlights');
    for (const h of highlights.slice(0, 5)) {
      const sel = oneLine(h.selection).slice(0, 220);
      out.push(`- ${sel ? `> ${sel}` : '> (highlight)'}`);
      if (h.analysis) out.push(`  - ${oneLine(h.analysis)}`);
      if (h.note) out.push(`  - **Note:** ${oneLine(h.note)}`);
      if (h.createdAt) out.push(`  - _${fmtTime(h.createdAt)}_`);
    }
    out.push('');
  }

  if (checkins.length) {
    out.push('## Recent check-ins');
    for (const c of checkins.slice(0, 3)) {
      const label = c.status === 'skipped' ? 'Skipped' : 'Reviewed';
      out.push(`- **${label}**: ${oneLine(c.question || 'Check-in')}`);
      if (c.feedback) out.push(`  - ${oneLine(c.feedback)}`);
      if (c.createdAt) out.push(`  - _${fmtTime(c.createdAt)}_`);
    }
    out.push('');
  }

  return out.join('\n').trim();
}

function buildNotesPlain(s) {
  const title = (s.title || '').trim();
  const url = (s.pageUrl || '').trim();
  const summary = (s.lastSummary || '').trim();
  const highlights = Array.isArray(s.highlightHistory) ? s.highlightHistory : [];
  const checkins = Array.isArray(s.quiz?.history) ? s.quiz.history : [];

  const fmtTime = ms => {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const oneLine = t => (t || '').replace(/\s+/g, ' ').trim();

  const out = [];
  out.push(`Distill notes${title ? ` — ${title}` : ''}`);
  if (url) out.push(`Source: ${url}`);
  out.push(`Captured: ${fmtTime(Date.now())}`);
  out.push('');

  if (summary) {
    out.push('So far (running notes)');
    out.push(summary.trim());
    out.push('');
  }

  if (highlights.length) {
    out.push('Highlights');
    for (const h of highlights.slice(0, 5)) {
      const sel = oneLine(h.selection).slice(0, 220);
      out.push(sel ? `  Quote: ${sel}` : '  Quote: (highlight)');
      if (h.analysis) out.push(`  Analysis: ${oneLine(h.analysis)}`);
      if (h.note) out.push(`  Note: ${oneLine(h.note)}`);
      if (h.createdAt) out.push(`  When: ${fmtTime(h.createdAt)}`);
      out.push('');
    }
  }

  if (checkins.length) {
    out.push('Recent check-ins');
    for (const c of checkins.slice(0, 3)) {
      const label = c.status === 'skipped' ? 'Skipped' : 'Reviewed';
      out.push(`${label}: ${oneLine(c.question || 'Check-in')}`);
      if (c.feedback) out.push(`  ${oneLine(c.feedback)}`);
      if (c.createdAt) out.push(`  When: ${fmtTime(c.createdAt)}`);
      out.push('');
    }
  }

  return out.join('\n').trim();
}

function broadcastHighlightHistory(tabId) {
  const s = tabState.get(tabId);
  if (!tabId) return;
  if (!s) {
    toPanel({ type: 'HIGHLIGHT_HISTORY_UPDATE', tabId, pageUrl: '', title: '', items: [] });
    return;
  }
  toPanel({
    type: 'HIGHLIGHT_HISTORY_UPDATE',
    tabId,
    pageUrl: s.pageUrl || '',
    title: s.title || '',
    items: Array.isArray(s.highlightHistory) ? s.highlightHistory : []
  });
}

// ── State restoration ─────────────────────────────────────────────────────────

async function restoreState(tabId) {
  await ensureTabHydrated(tabId);
  const s = tabState.get(tabId);
  if (!s) {
    broadcastHighlightHistory(tabId);
    return;
  }
  toPanel({
    type: 'ARTICLE_DETECTED',
    paragraphCount: s.totalParagraphs,
    title: s.title,
    tabId,
    paragraphsUntilNextQuiz: paragraphsUntilQuiz(tabId)
  });
  toPanel({
    type: 'PROGRESS_UPDATE',
    readCount: s.readParagraphs.length,
    totalParagraphs: s.totalParagraphs,
    wordsRead: s.wordsRead,
    totalWords: s.totalWords,
    tabId,
    paragraphsUntilNextQuiz: paragraphsUntilQuiz(tabId)
  });
  if (s.lastSummary) {
    toPanel({ type: 'SUMMARY_START', tabId });
    toPanel({ type: 'SUMMARY_CHUNK', chunk: s.lastSummary, tabId });
    toPanel({ type: 'SUMMARY_DONE', tabId });
  }
  toPanel({ type: 'QUIZ_HISTORY_UPDATE', tabId, items: s.quiz?.history || [] });
  if (s.quiz && s.quiz.status !== 'idle') {
    toPanel({
      type: 'QUIZ_RESTORE',
      tabId,
      status: s.quiz.status,
      question: s.quiz.question || '',
      answer: s.quiz.answer || '',
      feedback: s.quiz.feedback || '',
      paragraphsUntilNextQuiz: paragraphsUntilQuiz(tabId)
    });
    // A check-in was in progress when the user left — re-freeze the page so the
    // reader can't scroll past it, matching the normal quiz-start behavior.
    chrome.tabs.sendMessage(tabId, { type: 'FREEZE_SCROLL' }).catch(() => {});
  }
  broadcastHighlightHistory(tabId);

  // Show a one-time "restored from last time" notice only when state actually came
  // from persistent storage (not a still-live in-session read).
  if (restoredFromStorageTabs.has(tabId)) {
    restoredFromStorageTabs.delete(tabId);
    if (s.lastSummary || (s.quiz && s.quiz.status !== 'idle') || (s.highlightHistory && s.highlightHistory.length)) {
      toPanel({ type: 'RESTORED', tabId });
    }
  }
}

// ── Claude API streaming ──────────────────────────────────────────────────────

async function streamTask({
  tabId,
  task,
  s,
  signal,
  noAuthMessage = 'No API key set.',
  context = {},
  input = {},
  systemPrompt,
  messages,
  onChunk,
  onDone,
  onError
}) {
  // Allow the side panel to offer a "Retry" button for the last AI call.
  if (tabId) {
    lastAiRetryByTab.set(tabId, () => streamTask({
      tabId,
      task,
      s,
      signal: undefined,
      noAuthMessage,
      context,
      input,
      systemPrompt,
      messages,
      onChunk,
      onDone,
      onError
    }));
  }
  const aiMode = await getAiMode();
  const taskMaxTokens = maxTokensForTask(task, aiMode);
  const globalUseBackend = await useBackendProxy();
  const siteBackendOnly = await getSiteBackendOnly(s?.pageUrl || '');
  const preferBackend = siteBackendOnly || globalUseBackend !== false;

  let probeMemo = null;
  if (preferBackend) {
    probeMemo = await probeBackend();
    if (probeMemo.reachable) {
      const token = await ensureBackendToken();
      if (token) {
        void publishBackendStatus(tabId);
        await streamViaBackend({
          token,
          signal,
          task,
          articleId: getArticleId(s),
          context,
          input,
          meta: { tabId, aiMode },
          onChunk,
          onDone,
          onError
        });
        return;
      }
    }
    if (siteBackendOnly) {
      const msg = !probeMemo.reachable
        ? 'This site is set to backend-only. Start the local backend or change per-site settings in Distill.'
        : 'Distill cloud is reachable but not ready for AI on this site. Try again later.';
      const err = new Error(msg);
      err.code = 'BACKEND_DOWN';
      onError(err);
      void publishBackendStatus(tabId, { status: probeMemo.status });
      return;
    }
  }

  const provider = await getAiProvider();
  const apiKey = await getProviderKey(provider);
  if (!apiKey) {
    if (preferBackend) {
      const probe = probeMemo || (await probeBackend());
      const msg = probe.reachable
        ? 'Distill cloud is not ready yet. Wait a moment and try again, or add your own API key under Settings.'
        : 'Distill cloud is unavailable. Check your connection, or add your own API key under Settings.';
      const err = new Error(msg);
      err.code = 'BACKEND_DOWN';
      onError(err);
      void publishBackendStatus(tabId, { status: probe.status });
      return;
    }
    const err = new Error('Add a free AI key to start — open Settings and follow the quick setup.');
    err.code = 'NO_AI_KEY';
    onError(err);
    return;
  }
  if (preferBackend) void publishBackendStatus(tabId, { status: 'fallback_direct' });
  if (provider === 'anthropic') {
    await streamClaude({ apiKey, signal, systemPrompt, messages, maxTokens: taskMaxTokens, onChunk, onDone, onError });
  } else if (provider === 'groq' || provider === 'openai') {
    const cfg = chatProviderConfig(provider);
    await streamOpenAiCompat({ apiKey, cfg, signal, systemPrompt, messages, maxTokens: taskMaxTokens, onChunk, onDone, onError });
  } else {
    await streamGemini({ apiKey, signal, systemPrompt, messages, maxTokens: taskMaxTokens, onChunk, onDone, onError });
  }
}

async function streamViaBackend({ token, signal, task, articleId, context = {}, input = {}, meta = {}, onChunk, onDone, onError }) {
  const base = await distillResolveBackendBaseUrl();
  async function runRequest(authToken) {
    return fetch(`${base}/v1/ai/run`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({ task, articleId, context, input, meta })
    });
  }

  let response;
  try {
    response = await runRequest(token);
  } catch (e) {
    onError(e);
    return;
  }

  if (response.status === 401) {
    try {
      toPanel({ type: 'BACKEND_RETRYING', message: 'Session expired — reconnecting…', tabId: meta?.tabId });
      await chrome.storage.local.remove(BACKEND_TOKEN_KEY);
      const refreshed = await ensureBackendToken();
      if (!refreshed) {
        onError(new Error('Session expired. Open Settings → Test connection, or turn off Distill cloud under Advanced.'));
        return;
      }
      response = await runRequest(refreshed);
    } catch (e) {
      onError(e instanceof Error ? e : new Error('Failed to refresh backend session.'));
      return;
    }
  }

  if (!response.ok) {
    try {
      const err = await response.json();
      const code = err.code || '';
      let message = err.message || `Backend error ${response.status}`;
      if (typeof message === 'string' && (message.includes('ANTHROPIC_API_KEY') || message.includes('GEMINI_API_KEY') || message.includes('No LLM API key'))) {
        message = 'Distill cloud AI is not configured on the server. Try again later or add your own API key under Settings → Advanced.';
      }
      if (code === 'QUOTA_EXCEEDED') {
        message = quotaExceededMessage(err);
      } else if (code === 'RATE_LIMIT_USER' || code === 'RATE_LIMIT_IP' || code === 'RATE_LIMIT_GUEST_AUTH' || response.status === 429) {
        const sec = parseRetryAfterSeconds(response, err);
        const phrase = formatRetryAfterPhrase(sec);
        message = phrase
          ? `Rate limited. ${phrase}`
          : 'Rate limited. Retry after a short pause.';
      } else if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID') {
        message = 'Auth failed. Open Settings → Test connection, or turn off Distill cloud under Advanced.';
      }
      const e = new Error(message);
      e.code = code || `HTTP_${response.status}`;
      onError(e);
    } catch {
      onError(new Error(`Backend error ${response.status}`));
    }
    if (meta?.tabId) void publishUsage(meta.tabId);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
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
        if (evt === 'chunk') onChunk(payload.text || '');
        else if (evt === 'done') {
          void tryFlushOfflineQueue();
          onDone(payload);
          if (meta?.tabId) void publishUsage(meta.tabId);
          return;
        }         else if (evt === 'error') {
          let m = payload.message || 'AI request failed';
          if (typeof m === 'string' && (m.includes('ANTHROPIC_API_KEY') || m.includes('GEMINI_API_KEY') || m.includes('No LLM API key'))) {
            m = 'Distill cloud AI is not configured on the server. Try again later or add your own API key under Settings → Advanced.';
          }
          onError(new Error(m));
          if (meta?.tabId) void publishUsage(meta.tabId);
          return;
        }
      }
    }
  } catch (e) {
    onError(e);
    if (meta?.tabId) void publishUsage(meta.tabId);
    return;
  }
  void tryFlushOfflineQueue();
  onDone({});
  if (meta?.tabId) void publishUsage(meta.tabId);
}

async function streamClaude({ apiKey, signal, systemPrompt, messages, maxTokens = 256, onChunk, onDone, onError }) {
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, stream: true, system: systemPrompt, messages })
    });
  } catch (e) { onError(e); return; }

  if (!response.ok) {
    try {
      const err = await response.json();
      let message = err.error?.message || `API error ${response.status}`;
      if (response.status === 429) {
        const sec = parseRetryAfterSeconds(response, {});
        const phrase = formatRetryAfterPhrase(sec);
        if (phrase) message = `Rate limited. ${phrase}`;
      } else if (response.status === 401) {
        message = 'Anthropic rejected the key. Fix the API key in Settings, then retry.';
      }
      onError(new Error(message));
    } catch {
      let message = `API error ${response.status}`;
      if (response.status === 429) {
        const phrase = formatRetryAfterPhrase(parseRetryAfterSeconds(response, {}));
        if (phrase) message = `Rate limited. ${phrase}`;
      }
      onError(new Error(message));
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') { onDone(); return; }
        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') onChunk(evt.delta.text);
          else if (evt.type === 'message_stop') { onDone(); return; }
        } catch { /* ignore malformed stream lines */ }
      }
    }
  } catch (e) { onError(e); return; }
  onDone();
}

// ── Gemini API streaming (direct, user's own free key) ────────────────────────

// Serialize the START of Gemini calls with a minimum gap so a burst (progressive
// summaries + "now" tips while scrolling) can't blow past the free-tier per-minute
// limit. Calls still run to completion concurrently; only their kickoff is spaced.
const GEMINI_MIN_GAP_MS = 1500;
const GEMINI_RATELIMIT_MAX_WAIT_MS = 30_000; // cap auto-wait so the SW isn't parked too long
let geminiGateChain = Promise.resolve();
let geminiLastStartedAt = 0;
function geminiThrottle() {
  const run = geminiGateChain.then(async () => {
    const wait = geminiLastStartedAt + GEMINI_MIN_GAP_MS - Date.now();
    if (wait > 0) await delay(wait);
    geminiLastStartedAt = Date.now();
  });
  geminiGateChain = run.catch(() => {});
  return run;
}

function abortedError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

async function streamGemini({ apiKey, signal, systemPrompt, messages, maxTokens = 256, onChunk, onDone, onError }) {
  const body = distillBuildGeminiRequestBody({ systemPrompt, messages, maxTokens, temperature: 0.5 });
  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

  await geminiThrottle();
  if (signal?.aborted) { onError(abortedError()); return; }

  let response;
  let attempt = 0;
  // Auto-recover before any bytes stream: retry transient 5xx overloads, and
  // transparently wait out free-tier 429 rate limits using the server's retry-after
  // (so background summaries just appear a little later instead of erroring).
  for (;;) {
    try {
      response = await fetch(url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body)
      });
    } catch (e) { onError(e); return; }

    if (response.ok) break;

    let errBody = null;
    try { errBody = await response.clone().json(); } catch { /* non-JSON error */ }
    const info = distillClassifyGeminiError(response.status, errBody);

    if (info.retryable && response.status >= 500 && attempt < 1) {
      attempt++;
      await delay(800);
      if (signal?.aborted) { onError(abortedError()); return; }
      continue;
    }

    if (info.code === 'GEMINI_RATE_LIMIT' && attempt < 2) {
      const sec = distillParseGeminiRetrySeconds(errBody) || parseRetryAfterSeconds(response, {}) || 0;
      const waitMs = Math.min(Math.max(sec, 3) * 1000, GEMINI_RATELIMIT_MAX_WAIT_MS);
      attempt++;
      await delay(waitMs);
      if (signal?.aborted) { onError(abortedError()); return; }
      continue;
    }

    let message = info.message;
    if (info.code === 'GEMINI_RATE_LIMIT') {
      const sec = distillParseGeminiRetrySeconds(errBody) || parseRetryAfterSeconds(response, {});
      const phrase = formatRetryAfterPhrase(sec);
      message = phrase ? `${info.message} ${phrase}` : `${info.message} Wait a moment, then retry.`;
    }
    const err = new Error(message);
    err.code = info.code;
    onError(err);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let blockReason = null;
  let gotText = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let obj;
        try { obj = JSON.parse(raw); } catch { continue; }
        const parsed = distillParseGeminiChunk(obj);
        if (parsed.blockReason) blockReason = parsed.blockReason;
        if (parsed.text) { gotText = true; onChunk(parsed.text); }
        if (!gotText && distillIsGeminiHardStop(parsed.finishReason)) blockReason = parsed.finishReason;
      }
    }
  } catch (e) { onError(e); return; }

  if (blockReason && !gotText) {
    const err = new Error(distillGeminiBlockedMessage(blockReason));
    err.code = 'GEMINI_BLOCKED';
    onError(err);
    return;
  }
  onDone();
}

// ── OpenAI-compatible streaming (Groq, OpenAI) — direct, user's own key ────────

async function streamOpenAiCompat({ apiKey, cfg, signal, systemPrompt, messages, maxTokens = 256, onChunk, onDone, onError }) {
  const body = distillBuildChatRequestBody({ systemPrompt, messages, maxTokens, temperature: 0.5, model: cfg.model });
  const classifyOpts = { label: cfg.label, keyUrl: cfg.keyUrl };

  let response;
  let attempt = 0;
  for (;;) {
    try {
      response = await fetch(cfg.url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body)
      });
    } catch (e) { onError(e); return; }

    if (response.ok) break;

    let errBody = null;
    try { errBody = await response.clone().json(); } catch { /* non-JSON error */ }
    const info = distillClassifyChatError(response.status, errBody, classifyOpts);

    if (info.retryable && response.status >= 500 && attempt < 1) {
      attempt++;
      await delay(800);
      if (signal?.aborted) { onError(abortedError()); return; }
      continue;
    }

    if (info.code === 'CHAT_RATE_LIMIT' && attempt < 2) {
      const sec = parseRetryAfterSeconds(response, {}) || 0;
      const waitMs = Math.min(Math.max(sec, 3) * 1000, GEMINI_RATELIMIT_MAX_WAIT_MS);
      attempt++;
      await delay(waitMs);
      if (signal?.aborted) { onError(abortedError()); return; }
      continue;
    }

    let message = info.message;
    if (info.code === 'CHAT_RATE_LIMIT') {
      const phrase = formatRetryAfterPhrase(parseRetryAfterSeconds(response, {}));
      message = phrase ? `${info.message} ${phrase}` : `${info.message} Wait a moment, then retry.`;
    }
    const err = new Error(message);
    err.code = info.code;
    onError(err);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        if (raw === '[DONE]') { onDone(); return; }
        let obj;
        try { obj = JSON.parse(raw); } catch { continue; }
        const parsed = distillParseChatChunk(obj);
        if (parsed.text) onChunk(parsed.text);
      }
    }
  } catch (e) { onError(e); return; }
  onDone();
}

/** One-shot key check used by onboarding + Settings. Returns { ok, message }. */
async function validateAiKey(provider, key) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return { ok: false, message: 'Paste your API key first.' };
  try {
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': trimmed,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      });
      if (r.ok) return { ok: true, message: 'Key works — you’re all set.' };
      if (r.status === 429) return { ok: true, message: 'Key is valid (rate-limited right now, but it works).' };
      if (r.status === 401) return { ok: false, message: 'Anthropic rejected that key. Re-check it.' };
      return { ok: false, message: `Anthropic error ${r.status}.` };
    }
    if (provider === 'groq' || provider === 'openai') {
      const cfg = chatProviderConfig(provider);
      const r = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${trimmed}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
      });
      if (r.ok) return { ok: true, message: 'Key works — you’re all set.' };
      let cBody = null;
      try { cBody = await r.json(); } catch { /* ignore */ }
      const info = distillClassifyChatError(r.status, cBody, { label: cfg.label, keyUrl: cfg.keyUrl });
      // A plain per-minute rate limit still means the key itself is valid.
      if (info.code === 'CHAT_RATE_LIMIT') return { ok: true, message: 'Key is valid (rate-limited right now, but it works).' };
      return { ok: false, message: info.message };
    }
    const r = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': trimmed },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } })
    });
    if (r.ok) return { ok: true, message: 'Key works — you’re all set.' };
    if (r.status === 429) return { ok: true, message: 'Key is valid (free-tier limit hit right now, but it works).' };
    let errBody = null;
    try { errBody = await r.json(); } catch { /* ignore */ }
    return { ok: false, message: distillClassifyGeminiError(r.status, errBody).message };
  } catch {
    return { ok: false, message: 'Network error — check your connection and try again.' };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seconds until retry from JSON body or HTTP Retry-After (delta seconds or HTTP-date). */
function parseRetryAfterSeconds(response, errBody) {
  const bodySec = Number(errBody?.retryAfterSec);
  if (Number.isFinite(bodySec) && bodySec > 0) return Math.min(Math.floor(bodySec), 86400);
  const raw = response.headers?.get?.('Retry-After');
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 0) return Math.min(Math.floor(asNum), 86400);
  const asTime = Date.parse(raw);
  if (Number.isFinite(asTime)) {
    const sec = Math.ceil((asTime - Date.now()) / 1000);
    return sec > 0 ? Math.min(sec, 86400) : null;
  }
  return null;
}

/** Short user-facing line; empty if unknown. */
function formatRetryAfterPhrase(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds <= 90) return `Retry after ~${seconds}s.`;
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 180) return `Retry after ~${min} min.`;
  const hrs = Math.max(1, Math.round(min / 60));
  return `Retry after ~${hrs} hr.`;
}

function quotaExceededMessage(err) {
  const resetAt = err?.resetAt;
  if (resetAt) {
    const d = new Date(resetAt);
    if (!Number.isNaN(d.getTime())) {
      const sec = Math.ceil((d.getTime() - Date.now()) / 1000);
      const retry = formatRetryAfterPhrase(sec);
      if (retry) return `Out of credits for today. ${retry}`;
      if (sec <= 0) {
        return `Out of credits. Retry after reset (${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}).`;
      }
    }
  }
  return 'Out of credits for today. Retry after the daily reset (see Usage below).';
}

function toPanel(msg) { sidePanelPort?.postMessage(msg); }

async function publishBackendStatus(tabId, hint = {}) {
  const allowed = await useBackendProxy();
  if (!allowed) {
    toPanel({ type: 'BACKEND_STATUS', tabId, routing: 'direct', status: 'direct_forced' });
    return;
  }
  const probe = await probeBackend();
  toPanel({
    type: 'BACKEND_STATUS',
    tabId,
    routing: probe.status === 'ok' ? 'backend' : 'auto',
    status: probe.status,
    reachable: probe.reachable,
    ...hint
  });
}
function getAiProvider() {
  return new Promise(resolve => chrome.storage.local.get(AI_PROVIDER_KEY, r => {
    const p = r[AI_PROVIDER_KEY];
    resolve(AI_PROVIDERS.includes(p) ? p : DEFAULT_AI_PROVIDER);
  }));
}
function providerStorageKey(provider) {
  if (provider === 'anthropic') return ANTHROPIC_API_KEY_STORAGE;
  if (provider === 'groq') return GROQ_API_KEY_STORAGE;
  if (provider === 'openai') return OPENAI_API_KEY_STORAGE;
  return GEMINI_API_KEY_STORAGE;
}
function getProviderKey(provider) {
  const storageKey = providerStorageKey(provider);
  return new Promise(resolve => chrome.storage.local.get(storageKey, r => resolve(r[storageKey] || null)));
}
function getBackendToken() {
  return new Promise(resolve => chrome.storage.local.get(BACKEND_TOKEN_KEY, r => resolve(r[BACKEND_TOKEN_KEY] || null)));
}
function getInstallId() {
  return new Promise(resolve => chrome.storage.local.get(INSTALL_ID_KEY, r => resolve(r[INSTALL_ID_KEY] || null)));
}
async function ensureInstallId() {
  const existing = await getInstallId();
  if (existing) return existing;
  const created = (globalThis.crypto?.randomUUID?.() || `inst_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  await chrome.storage.local.set({ [INSTALL_ID_KEY]: created });
  return created;
}
async function ensureBackendToken() {
  const probe = await probeBackend();
  if (!probe.reachable) return null;
  const existing = await getBackendToken();
  if (existing) return existing;
  const installId = await ensureInstallId();
  const base = await distillResolveBackendBaseUrl();
  try {
    const response = await fetchWithTimeout(`${base}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installId,
        client: { name: 'distill-extension', version: chrome.runtime.getManifest().version || 'dev' }
      })
    }, 1200);
    if (response.status === 429) return null;
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    const token = body?.token || null;
    if (!token) return null;
    await chrome.storage.local.set({ [BACKEND_TOKEN_KEY]: token });
    return token;
  } catch {
    return null;
  }
}
function getArticleId(s) {
  const seed = `${s?.pageUrl || ''}|${s?.title || ''}|${s?.totalParagraphs || 0}`;
  return seed || 'unknown-article';
}

async function messageForBackendUsageError(response) {
  try {
    const err = await response.json();
    const code = err.code || '';
    if (code === 'RATE_LIMIT_USER' || code === 'RATE_LIMIT_IP' || code === 'RATE_LIMIT_GUEST_AUTH' || response.status === 429) {
      const sec = parseRetryAfterSeconds(response, err);
      const phrase = formatRetryAfterPhrase(sec);
      return phrase ? `Credits: rate limited. ${phrase}` : 'Credits: rate limited. Retry after a short pause.';
    }
    if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID') {
      return 'Credits: session invalid. Open Settings → Test connection.';
    }
    if (code === 'QUOTA_EXCEEDED') return quotaExceededMessage(err);
  } catch { /* ignore */ }
  if (response.status === 429) {
    const phrase = formatRetryAfterPhrase(parseRetryAfterSeconds(response, {}));
    if (phrase) return `Credits: rate limited. ${phrase}`;
  }
  return 'Credits unavailable';
}

async function publishUsage(tabId) {
  if (!tabId) return;
  if (!(await useBackendProxy())) {
    const provider = await getAiProvider();
    const labels = {
      anthropic: 'Using your own Anthropic key — usage counts against your account.',
      openai: 'Using your own OpenAI key — usage counts against your account.',
      groq: 'Using your own Groq key — usage counts against your free Groq quota.',
      gemini: 'Using your own Gemini key — usage counts against your free Google quota.'
    };
    toPanel({ type: 'USAGE_UNAVAILABLE', tabId, message: labels[provider] || labels.groq });
    return;
  }

  const token = await ensureBackendToken();
  if (!token) {
    toPanel({ type: 'USAGE_UNAVAILABLE', tabId, message: 'Credits unavailable' });
    return;
  }

  const base = await distillResolveBackendBaseUrl();
  try {
    const response = await fetch(`${base}/v1/usage`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      await chrome.storage.local.remove(BACKEND_TOKEN_KEY);
      const refreshed = await ensureBackendToken();
      if (!refreshed) {
        toPanel({
          type: 'USAGE_UNAVAILABLE',
          tabId,
          message: 'Credits: no session. Open Settings → Test connection, then retry.'
        });
        return;
      }
      const retry = await fetch(`${base}/v1/usage`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${refreshed}` }
      });
      if (!retry.ok) {
        toPanel({ type: 'USAGE_UNAVAILABLE', tabId, message: await messageForBackendUsageError(retry) });
        return;
      }
      const usageRetry = await retry.json().catch(() => ({}));
      toPanel({
        type: 'USAGE_UPDATE',
        tabId,
        remainingCredits: normalizeNumber(
          usageRetry.remainingCredits ?? usageRetry.remaining ?? usageRetry.creditsLeft
        ),
        dailyLimit: normalizeNumber(
          usageRetry.dailyLimit ?? usageRetry.limit ?? usageRetry.dailyQuota
        ),
        resetAt: usageRetry.resetAt ?? usageRetry.resetTime ?? usageRetry.resetsAt ?? null
      });
      return;
    }

    if (!response.ok) {
      toPanel({ type: 'USAGE_UNAVAILABLE', tabId, message: await messageForBackendUsageError(response) });
      return;
    }

    const usage = await response.json().catch(() => ({}));
    toPanel({
      type: 'USAGE_UPDATE',
      tabId,
      remainingCredits: normalizeNumber(
        usage.remainingCredits ?? usage.remaining ?? usage.creditsLeft
      ),
      dailyLimit: normalizeNumber(
        usage.dailyLimit ?? usage.limit ?? usage.dailyQuota
      ),
      resetAt: usage.resetAt ?? usage.resetTime ?? usage.resetsAt ?? null
    });
  } catch {
    toPanel({ type: 'USAGE_UNAVAILABLE', tabId, message: 'Credits unavailable' });
  }
}

function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const DEFAULT_PREFS_KEY = 'distillDefaultPrefsApplied';

/**
 * Retention/pruning: keep at most DISTILL_MAX_SAVED_PAGES saved pages, each for
 * DISTILL_PAGE_STATE_TTL_MS. Evicts expired + oldest-beyond-cap snapshots, removing
 * both the new (distillPageState_) and legacy (distillHist_) key for each page hash.
 */
async function prunePageStates() {
  let all;
  try { all = await chrome.storage.local.get(null); } catch { return; }
  if (!all) return;
  const byHash = new Map();
  for (const [k, v] of Object.entries(all)) {
    let hash = null;
    if (k.startsWith(PAGE_STATE_KEY_PREFIX)) hash = k.slice(PAGE_STATE_KEY_PREFIX.length);
    else if (k.startsWith(HISTORY_KEY_PREFIX)) hash = k.slice(HISTORY_KEY_PREFIX.length);
    else continue;
    const updatedAt = v && typeof v.updatedAt === 'number' ? v.updatedAt : 0;
    const cur = byHash.get(hash);
    if (!cur || updatedAt > cur.updatedAt) byHash.set(hash, { hash, updatedAt });
  }
  if (!byHash.size) return;
  const removeHashes = distillSelectPrunedKeys([...byHash.values()], {
    maxPages: DISTILL_MAX_SAVED_PAGES,
    ttlMs: DISTILL_PAGE_STATE_TTL_MS,
    now: Date.now()
  });
  if (!removeHashes.length) return;
  const keys = [];
  for (const h of removeHashes) keys.push(`${PAGE_STATE_KEY_PREFIX}${h}`, `${HISTORY_KEY_PREFIX}${h}`);
  await chrome.storage.local.remove(keys).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('distillFlushOffline', { periodInMinutes: 3 }).catch(() => {});
  chrome.alarms.create('distillPrunePages', { periodInMinutes: 360 }).catch(() => {});
  void chrome.storage.local.get([USE_BACKEND_PROXY_KEY, AI_PROVIDER_KEY, 'backendTarget', DEFAULT_PREFS_KEY], bag => {
    const patch = {};
    if (!bag[DEFAULT_PREFS_KEY]) {
      patch[DEFAULT_PREFS_KEY] = true;
      // BYOK direct mode is the default product; hosted cloud stays opt-in.
      if (bag[USE_BACKEND_PROXY_KEY] === undefined) patch[USE_BACKEND_PROXY_KEY] = false;
      if (!bag[AI_PROVIDER_KEY]) patch[AI_PROVIDER_KEY] = DEFAULT_AI_PROVIDER;
      if (!bag.backendTarget) patch.backendTarget = 'prod';
      if (!bag.readerMode) patch.readerMode = 'skim';
    }
    if (Object.keys(patch).length) chrome.storage.local.set(patch).catch(() => {});
  });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'distillFlushOffline') void tryFlushOfflineQueue();
  else if (alarm.name === 'distillPrunePages') void prunePageStates();
});
// Ensure the prune alarm exists even on SW restart (onInstalled only fires on install/update).
chrome.alarms.create('distillPrunePages', { periodInMinutes: 360 }).catch(() => {});
void tryFlushOfflineQueue();
void prunePageStates();

void useBackendProxy().then(on => {
  if (on) void ensureBackendToken();
});
