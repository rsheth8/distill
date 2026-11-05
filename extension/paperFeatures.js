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

/** Stream one task to the panel. Resolves with the trimmed text, or '' after an error. */
function streamPaperHelp(tabId, { kind, key, task, context, input }) {
  const s = tabState.get(tabId);
  return new Promise(resolve => {
    let text = '';
    let settled = false;
    const fail = err => {
      if (settled) return;
      settled = true;
      toPanel({ type: 'PAPER_HELP_ERROR', tabId, kind, key, code: err?.code, message: err?.message || String(err) });
      resolve('');
    };
    toPanel({ type: 'PAPER_HELP_START', tabId, kind, key });
    streamTask({
      tabId, task, s, context, input,
      noAuthMessage: 'No API key set — click ⚙ to add one.',
      onChunk: chunk => {
        text += chunk;
        toPanel({ type: 'PAPER_HELP_CHUNK', tabId, kind, key, chunk });
      },
      onDone: () => {
        if (settled) return;
        settled = true;
        toPanel({ type: 'PAPER_HELP_DONE', tabId, kind, key, text });
        resolve(text.trim());
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
    if (s.overview?.text && s.overview.level === level) return;
    const text = await streamPaperHelp(tabId, {
      kind: 'overview', key: 'overview', task: 'overview',
      context: { title: s.title || s.paper.title },
      input: { excerpt: distillPaperExcerpt(s.paper) }
    });
    if (!text || tabState.get(tabId) !== s) return; // failed, or the tab moved on
    s.overview = { level, text };
    schedulePersistTab(tabId);
  });
}

function clearPaperHelp(tabId) {
  paperHelpQueue.delete(tabId);
}
