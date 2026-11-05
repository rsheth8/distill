// Paper help in the side panel: reading level, overview, trust, section guide, Ask, Glossary.
// Loaded after sidepanel.js and uses its globals ($, port, currentTabId, show, hide, setStatus, setPanel, setThinking).
// AI output and paper text are untrusted: everything goes in with textContent.

const DISTILL_LEVELS = ['simple', 'everyday', 'close'];
// state: last PAPER_HELP_STATE; section: heading the reader is in; streams: text arriving per "kind:key".
// canGuide: false when the section is not in the paper object (no guide to offer).
// live: keys of streams still running, so a state publish does not wipe their partial text.
const paperView = { level: 'everyday', state: null, section: '', canGuide: true, streams: {}, live: new Set() };

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

// sidepanel.js owns whether the card is shown; this only fills it.
function renderPaperCard() {
  const st = paperView.state;
  const list = $('paperFacts');
  list.replaceChildren();
  $('paperByline').textContent = st?.byline || '';
  for (const f of st?.trustFacts || []) {
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
  const segs = distillSectionMap(st?.sections || [], paperView.section);
  distillRenderSectionMap($('sectionMap'), segs, heading => sendPaper({ type: 'JUMP_TO_SECTION', heading }));
  const cur = segs.find(s => s.state === 'current');
  $('sectionNow').textContent = cur ? cur.heading : '';
  $('sectionLine').textContent = cur?.line || '';
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
  $('trustStudy').textContent = parsed.STUDY ? `Study: ${parsed.STUDY}` : '';
  const limits = $('trustLimits');
  limits.replaceChildren();
  const items = bulletLines(parsed.LIMITS);
  if (items.length) {
    addText(limits, 'h3', 'Limits the authors mention', 'overview-label');
    const ul = addText(limits, 'ul', '');
    for (const t of items) addText(ul, 'li', t);
  }
  $('trustCard').classList.toggle('hidden', !parsed.STUDY && !bulletLines(parsed.LIMITS).length);
}

function renderGuide() {
  const heading = paperView.section;
  const card = $('guideCard');
  if (!heading || !paperView.state) return hide(card);
  show(card);
  $('guideHeading').textContent = heading;
  const stored = paperView.state.guides?.[heading];
  const current = stored?.level === paperView.level ? stored : null;
  const text = paperView.streams[`guide:${heading}`] ?? current?.text ?? '';
  const body = paperView.canGuide ? distillParseLabelled(text, ['TERMS']).lead : 'No guide for this part.';
  $('guideBody').textContent = body;
  $('guideBtn').classList.toggle('hidden', !paperView.canGuide || !!text || `guide:${heading}` in paperView.streams);
  const n = current?.terms?.length || 0;
  $('guideTermsBtn').textContent = n === 1 ? '1 term in the Glossary' : `${n} terms in the Glossary`;
  $('guideTermsBtn').classList.toggle('hidden', !n);
}

function renderGlossary() {
  const items = [...(paperView.state?.glossary || [])]
    .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }));
  const list = $('glossaryList');
  list.replaceChildren();
  $('glossaryEmpty').classList.toggle('hidden', items.length > 0);
  for (const g of items) {
    const dt = document.createElement('dt');
    const btn = addText(dt, 'button', g.term, 'paper-link-btn');
    btn.type = 'button';
    btn.title = 'Show in the paper';
    btn.addEventListener('click', () => sendPaper({ type: 'SCROLL_TO_TERM', term: g.term }));
    list.append(dt);
    const dd = addText(list, 'dd', g.definition);
    addText(dd, 'span', ` · ${g.section}`, 'glossary-section');
  }
}

let lastAskQuestion = '';

/** scroll: only when ask activity changed the thread, not on every unrelated render. */
function renderAsk(scroll = false) {
  const thread = paperView.state?.askThread || [];
  const box = $('askThread');
  box.replaceChildren();
  thread.forEach((entry, i) => {
    const item = addText(box, 'div', '', 'ask-item');
    addText(item, 'p', entry.q, 'ask-q');
    const text = paperView.streams[`ask:${i}`] ?? entry.a;
    const parsed = distillParseLabelled(text || '', ['BACKGROUND', 'FROM']);
    addText(item, 'p', parsed.lead || '…', 'ask-a');
    if (parsed.BACKGROUND) addText(item, 'p', `Background: ${parsed.BACKGROUND}`, 'ask-meta');
    if (parsed.FROM) addText(item, 'p', `From: ${parsed.FROM}`, 'ask-meta');
  });
  $('askStarters').classList.toggle('hidden', thread.length > 0);
  if (scroll) box.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

/** Returns true when the question was sent. */
function askPaper(question) {
  const q = question.trim();
  if (!q) return false;
  if (!paperView.state) {
    setStatus('askStatus', 'Open a research paper to ask about it.', 'error');
    return false;
  }
  // A double click on a starter would queue the same question twice.
  if ((paperView.state.askThread || []).some(e => e.q === q && !e.a)) return false;
  lastAskQuestion = q;
  hide($('askRetryBtn'));
  setStatus('askStatus', '', '');
  sendPaper({ type: 'ASK_PAPER', question: q });
  return true;
}

function renderAll(scrollAsk = false) {
  renderPaperCard();
  renderOverview();
  renderGuide();
  renderGlossary();
  renderAsk(scrollAsk);
}

// A stream event only changes its own view; rendering the rest on every chunk is wasted work.
function renderKind(kind) {
  if (kind === 'overview') renderOverview();
  else if (kind === 'guide') renderGuide();
  else if (kind === 'ask') renderAsk(true);
  else renderAll();
}

function resetPaperView() {
  paperView.state = null;
  paperView.section = '';
  paperView.canGuide = true;
  paperView.streams = {};
  paperView.live = new Set();
  for (const id of ['overviewCard', 'trustCard', 'guideCard']) hide($(id));
}

function handlePaperMessage(msg) {
  const k = `${msg.kind}:${msg.key}`;
  switch (msg.type) {
    case 'PAPER_HELP_STATE': {
      const grew = (msg.askThread?.length || 0) > (paperView.state?.askThread?.length || 0); // a question was just added
      paperView.state = msg;
      paperView.section = msg.section || paperView.section;
      if (msg.section) paperView.canGuide = msg.canGuide !== false;
      paperView.streams = Object.fromEntries(Object.entries(paperView.streams).filter(([key]) => paperView.live.has(key)));
      renderAll(grew);
      break;
    }
    case 'PAPER_HELP_START':
      setThinking(k, true);
      paperView.live.add(k);
      paperView.streams[k] = '';
      if (msg.kind === 'overview') {
        hide($('overviewRetryBtn'));
        setStatus('overviewStatus', 'Reading the paper…', 'updating');
      }
      if (msg.kind === 'guide' && msg.key === paperView.section) setStatus('guideStatus', 'Reading this section…', 'updating');
      renderKind(msg.kind);
      break;
    case 'PAPER_HELP_CHUNK':
      paperView.streams[k] = (paperView.streams[k] || '') + msg.chunk;
      renderKind(msg.kind);
      break;
    case 'PAPER_HELP_DONE':
      setThinking(k, false);
      paperView.live.delete(k);
      if (msg.kind === 'overview') {
        delete paperView.streams[k];
        if (paperView.state) paperView.state.overview = { level: msg.level, text: msg.text };
        setStatus('overviewStatus', '', '');
      } else {
        paperView.streams[k] = msg.text;
      }
      if (msg.kind === 'guide' && msg.key === paperView.section) setStatus('guideStatus', '', '');
      renderKind(msg.kind);
      break;
    case 'PAPER_HELP_ERROR':
      setThinking(k, false);
      paperView.live.delete(k);
      delete paperView.streams[k];
      if (msg.code === 'ABORTED') { // the background dropped the job (a new paper): nothing failed, so no error and no Retry
        if (msg.kind === 'overview') setStatus('overviewStatus', '', '');
        if (msg.kind === 'guide' && msg.key === paperView.section) setStatus('guideStatus', '', '');
        renderKind(msg.kind);
        break;
      }
      if (msg.kind === 'overview') {
        setStatus('overviewStatus', msg.message || 'Something went wrong.', 'error');
        show($('overviewRetryBtn'));
      }
      if (msg.kind === 'ask') {
        lastAskQuestion = paperView.state?.askThread?.[Number(msg.key)]?.q ?? lastAskQuestion; // Retry resends the one that failed
        setStatus('askStatus', msg.message || 'Something went wrong.', 'error');
        show($('askRetryBtn'));
      }
      if (msg.kind === 'guide' && msg.key === paperView.section) {
        if (msg.code === 'NO_SECTION') paperView.canGuide = false;
        setStatus('guideStatus', msg.code === 'NO_SECTION' ? '' : msg.message || 'Something went wrong.', 'error');
      }
      renderKind(msg.kind);
      break;
    case 'SECTION_CHANGED':
      paperView.section = msg.heading;
      paperView.canGuide = msg.canGuide !== false;
      setStatus('guideStatus', '', '');
      renderGuide();
      renderPaperCard();
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
$('guideBtn').addEventListener('click', () => sendPaper({ type: 'GUIDE_SECTION', heading: paperView.section }));
$('guideTermsBtn').addEventListener('click', () => setPanel('glossary'));
levelSelect.addEventListener('change', renderGuide);

$('askForm').addEventListener('submit', e => {
  e.preventDefault();
  if (askPaper($('askInput').value)) $('askInput').value = '';
});
$('askInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('askForm').requestSubmit();
  }
});
for (const btn of document.querySelectorAll('.ask-starter')) btn.addEventListener('click', () => askPaper(btn.textContent));
$('askRetryBtn').addEventListener('click', () => askPaper(lastAskQuestion));

// Selection card: carry the selected passage into Ask (the input holds 500 characters, so the quote is capped at 300).
$('askAboutBtn').addEventListener('click', () => {
  const quote = lastSelectedText.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!quote) return;
  setPanel('ask');
  const input = $('askInput');
  input.value = `About "${quote}": `;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});
