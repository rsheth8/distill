'use strict';

// Paper help: overview + trust card, section guides with jargon, ask-the-paper.
// Loaded by background.js (importScripts) and uses its globals: tabState, toPanel, streamTask,
// schedulePersistTab, readingLevel. Only functions here — nothing runs at load time.

const paperHelpQueue = new Map(); // tabId -> tail of a promise chain: one paper-help call at a time per tab

function queuePaperHelp(tabId, job) {
  const next = (paperHelpQueue.get(tabId) || Promise.resolve()).then(job).catch(err => console.warn('Distill paper help', err));
  paperHelpQueue.set(tabId, next);
  return next;
}

const paperHelpAbort = new Map(); // tabId -> AbortController of the paper-help call now streaming

/**
 * Stream one task to the panel. Resolves with the trimmed text, or '' after an error, an abort
 * or when the tab moved on (clearPaperHelp, or tabState replaced by a new paper): a stale call
 * sends and stores nothing, and settles so the queue never hangs.
 */
function streamPaperHelp(tabId, { kind, key, task, context, input, level }) {
  const s = tabState.get(tabId);
  const ctrl = new AbortController();
  paperHelpAbort.set(tabId, ctrl);
  return new Promise(resolve => {
    let text = '';
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (paperHelpAbort.get(tabId) === ctrl) paperHelpAbort.delete(tabId);
      resolve(value);
    };
    const stale = () => ctrl.signal.aborted || tabState.get(tabId) !== s;
    ctrl.signal.addEventListener('abort', () => finish(''));
    const fail = err => {
      if (settled) return;
      if (stale()) { ctrl.abort(); return; }
      toPanel({ type: 'PAPER_HELP_ERROR', tabId, kind, key, code: err?.code, message: err?.message || String(err) });
      finish('');
    };
    toPanel({ type: 'PAPER_HELP_START', tabId, kind, key });
    streamTask({
      tabId, task, s, signal: ctrl.signal, context: { ...context, level }, input,
      noAuthMessage: 'No API key set — click ⚙ to add one.',
      onChunk: chunk => {
        if (settled) return;
        if (stale()) { ctrl.abort(); return; }
        text += chunk;
        toPanel({ type: 'PAPER_HELP_CHUNK', tabId, kind, key, chunk });
      },
      onDone: () => {
        if (settled) return;
        if (stale()) { ctrl.abort(); return; }
        toPanel({ type: 'PAPER_HELP_DONE', tabId, kind, key, level, text });
        finish(text.trim());
      },
      onError: fail
    }).catch(fail);
  });
}

function paperHelpState(s) {
  return {
    overview: s.overview || null,
    trustFacts: s.paper ? distillTrustFacts(s.paper) : [],
    section: s.section?.heading || '',
    guides: s.guides || {},
    glossary: s.glossary || [],
    askThread: s.askThread || []
  };
}

function publishPaperHelp(tabId) {
  const s = tabState.get(tabId);
  if (s?.paper) toPanel({ type: 'PAPER_HELP_STATE', tabId, ...paperHelpState(s) });
}

/** Overview of the whole paper; skipped when one exists at the current reading level. */
function runOverview(tabId) {
  return queuePaperHelp(tabId, async () => {
    const s = tabState.get(tabId);
    if (!s?.paper) return;
    const level = await readingLevel();
    if (tabState.get(tabId) !== s) return; // the tab moved on while we read the level
    if (s.overview?.text && s.overview.level === level) return;
    const text = await streamPaperHelp(tabId, {
      kind: 'overview', key: 'overview', task: 'overview', level,
      context: { title: s.title || s.paper.title },
      input: { excerpt: distillPaperExcerpt(s.paper) }
    });
    if (!text || tabState.get(tabId) !== s) return; // failed, or the tab moved on
    s.overview = { level, text };
    schedulePersistTab(tabId);
  });
}

/** Abort the running call. The queue tail stays, so the next job waits for the aborted one to settle. */
function clearPaperHelp(tabId) {
  paperHelpAbort.get(tabId)?.abort();
}
