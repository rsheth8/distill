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
    canGuide: !!(s.paper && s.section?.heading && distillFindSection(s.paper, s.section.heading)),
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
  clearTimeout(guideDwellTimers.get(tabId));
  guideDwellTimers.delete(tabId);
}

const GUIDE_DWELL_MS = 8000;
const guideDwellTimers = new Map(); // tabId -> timeout

function sendTerms(tabId, heading, terms) {
  if (terms?.length) chrome.tabs.sendMessage(tabId, { type: 'SHOW_TERMS', heading, terms }).catch(() => {});
}

/** Guide for one section; on success its terms are underlined in the page and added to the glossary. */
function runSectionGuide(tabId, heading) {
  return queuePaperHelp(tabId, async () => {
    const s = tabState.get(tabId);
    const section = s?.paper && distillFindSection(s.paper, heading);
    if (!section) {
      toPanel({ type: 'PAPER_HELP_ERROR', tabId, kind: 'guide', key: heading, code: 'NO_SECTION', message: 'No guide for this part.' });
      return;
    }
    const level = await readingLevel();
    if (tabState.get(tabId) !== s) return; // the tab moved on while we read the level
    if (s.guides?.[heading]?.level === level) return sendTerms(tabId, heading, s.guides[heading].terms);
    const text = await streamPaperHelp(tabId, {
      kind: 'guide', key: heading, task: 'section_guide', level,
      context: { title: s.title || s.paper.title, section: { heading: section.heading, kind: section.kind } },
      input: { sectionText: section.text }
    });
    if (!text || tabState.get(tabId) !== s) return;
    const terms = distillParseTerms(distillParseLabelled(text, ['TERMS']).TERMS);
    s.guides = { ...s.guides, [heading]: { level, text, terms } };
    s.glossary = distillMergeGlossary(s.glossary, terms, heading);
    schedulePersistTab(tabId);
    sendTerms(tabId, heading, terms);
    publishPaperHelp(tabId);
  });
}

/** The reader entered a new section: tell the panel, and guide it after GUIDE_DWELL_MS there. */
function onSectionChanged(tabId, heading) {
  clearTimeout(guideDwellTimers.get(tabId));
  const s = tabState.get(tabId);
  if (!s?.paper || !heading) return;
  const canGuide = !!distillFindSection(s.paper, heading);
  toPanel({ type: 'SECTION_CHANGED', tabId, heading, hasGuide: !!s.guides?.[heading], canGuide });
  if (!canGuide) return;
  guideDwellTimers.set(tabId, setTimeout(async () => {
    guideDwellTimers.delete(tabId);
    const now = tabState.get(tabId);
    if (now?.section?.heading !== heading) return;
    const level = await readingLevel();
    if (tabState.get(tabId) !== now || now.guides?.[heading]?.level === level) return;
    void runSectionGuide(tabId, heading);
  }, GUIDE_DWELL_MS));
}

/** Re-underline every stored guide's terms at the current level (after a page reload). */
async function resendTerms(tabId) {
  const s = tabState.get(tabId);
  const level = await readingLevel();
  for (const [heading, g] of Object.entries(s?.guides || {})) if (g.level === level) sendTerms(tabId, heading, g.terms);
}

/** Reading level changed: drop the pages' underlines and re-run the overview for the paper in view. */
function onReadingLevelChanged() {
  for (const [tabId, s] of tabState) {
    if (s?.paper) chrome.tabs.sendMessage(tabId, { type: 'CLEAR_TERMS' }).catch(() => {});
  }
  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (tab && tabState.get(tab.id)?.paper) void runOverview(tab.id);
  }).catch(() => {});
}
