// Paper help in the side panel: reading level, overview, trust, section guide, Ask, Glossary.
// Loaded after sidepanel.js and uses its globals ($, port, currentTabId, show, hide, setStatus, setPanel).
// AI output and paper text are untrusted: everything goes in with textContent.

const DISTILL_LEVELS = ['simple', 'everyday', 'close'];
// state: last PAPER_HELP_STATE; section: heading the reader is in; streams: text arriving per "kind:key".
const paperView = { level: 'everyday', state: null, section: '', streams: {} };

const levelSelect = $('levelSelect');
chrome.storage.local.get('readingLevel').then(({ readingLevel }) => {
  if (DISTILL_LEVELS.includes(readingLevel)) paperView.level = levelSelect.value = readingLevel;
});
levelSelect.addEventListener('change', () => {
  paperView.level = levelSelect.value;
  chrome.storage.local.set({ readingLevel: paperView.level });
});

const OVERVIEW_LABELS = ['ASKED', 'DID', 'FOUND', 'WHY', 'STUDY', 'LIMITS'];
const OVERVIEW_PARTS = [['ASKED', 'The question'], ['DID', 'What they did'], ['FOUND', 'What they found'], ['WHY', 'Why it matters']];

function sendPaper(msg) { port?.postMessage({ ...msg, tabId: currentTabId }); }

function addText(parent, tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function bulletLines(text) {
  return String(text || '').split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
}

function overviewText() {
  return paperView.streams['overview:overview'] ?? paperView.state?.overview?.text ?? '';
}

function renderOverview() {
  const text = overviewText();
  const body = $('overviewBody');
  body.replaceChildren();
  const parsed = distillParseLabelled(text, OVERVIEW_LABELS);
  const labelled = OVERVIEW_PARTS.filter(([k]) => parsed[k]);
  for (const [k, label] of labelled) {
    addText(body, 'h3', label, 'overview-label');
    addText(body, 'p', parsed[k]);
  }
  // A reply with no labels at all still shows, as one paragraph.
  if (!labelled.length && parsed.lead && !('overview:overview' in paperView.streams)) addText(body, 'p', parsed.lead);
  if (paperView.state) show($('overviewCard'));
  renderTrust(parsed);
}

function renderTrust(parsed) {
  const facts = paperView.state?.trustFacts || [];
  const list = $('trustFacts');
  list.replaceChildren();
  for (const f of facts) {
    const li = document.createElement('li');
    if (f.href) {
      const a = addText(li, 'a', f.text);
      a.href = f.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else {
      li.textContent = f.text;
    }
    list.append(li);
  }
  $('trustStudy').textContent = parsed.STUDY ? `Study: ${parsed.STUDY}` : '';
  const limits = $('trustLimits');
  limits.replaceChildren();
  const items = bulletLines(parsed.LIMITS);
  if (items.length) {
    addText(limits, 'h3', 'Limits the authors mention', 'overview-label');
    const ul = addText(limits, 'ul', '');
    for (const t of items) addText(ul, 'li', t);
  }
  $('trustCard').classList.toggle('hidden', !facts.length);
}

function renderAll() {
  renderOverview();
}

function resetPaperView() {
  paperView.state = null;
  paperView.section = '';
  paperView.streams = {};
  for (const id of ['overviewCard', 'trustCard']) hide($(id));
}

function handlePaperMessage(msg) {
  const k = `${msg.kind}:${msg.key}`;
  switch (msg.type) {
    case 'PAPER_HELP_STATE':
      paperView.state = msg;
      paperView.section = msg.section || paperView.section;
      paperView.streams = {};
      renderAll();
      break;
    case 'PAPER_HELP_START':
      paperView.streams[k] = '';
      if (msg.kind === 'overview') {
        hide($('overviewRetryBtn'));
        setStatus('overviewStatus', '⟳ Reading the paper…', 'updating');
      }
      renderAll();
      break;
    case 'PAPER_HELP_CHUNK':
      paperView.streams[k] = (paperView.streams[k] || '') + msg.chunk;
      renderAll();
      break;
    case 'PAPER_HELP_DONE':
      if (msg.kind === 'overview') {
        delete paperView.streams[k];
        if (paperView.state) paperView.state.overview = { level: paperView.level, text: msg.text };
        setStatus('overviewStatus', '', '');
      } else {
        paperView.streams[k] = msg.text;
      }
      renderAll();
      break;
    case 'PAPER_HELP_ERROR':
      delete paperView.streams[k];
      if (msg.kind === 'overview') {
        setStatus('overviewStatus', msg.message || 'Something went wrong.', 'error');
        show($('overviewRetryBtn'));
      }
      renderAll();
      break;
    case 'ARTICLE_NAVIGATING':
    case 'NO_ARTICLE':
    case 'PDF_DETECTED':
      resetPaperView();
      renderAll();
      break;
  }
}

$('overviewRetryBtn').addEventListener('click', () => sendPaper({ type: 'RETRY_OVERVIEW' }));
