// Distill's own PDF reader: reader.html?src=<pdf url>. Chrome's built-in PDF viewer
// can't be scripted, so papers in PDF form open here: a clean reading view of the
// paper's text by default, with the original pages one click away.
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';

const VENDOR = 'vendor/pdfjs/';
pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}pdf.worker.min.mjs`;

const statusEl = document.getElementById('status');
const readingEl = document.getElementById('reading');
const pagesEl = document.getElementById('pages');
const toolbarEl = document.getElementById('toolbar');
let pdfPageTexts = [];
let pdfDocument;
let pageObserver;
let pdfResizePending = false;
const src = new URLSearchParams(location.search).get('src') || '';

function showStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

async function renderPage(pdf, num, slot, scale) {
  const page = await pdf.getPage(num);
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  slot.style.width = canvas.style.width;
  slot.style.height = canvas.style.height;
  slot.append(canvas);
  await page.render({
    canvas,
    canvasContext: canvas.getContext('2d'),
    viewport,
    transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0]
  }).promise;
  const textDiv = document.createElement('div');
  textDiv.className = 'textLayer';
  slot.append(textDiv);
  await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport }).render();
  document.dispatchEvent(new CustomEvent('distill-pdf-rendered'));
}

/** Lay out placeholders for every page and draw each one as it nears the viewport. */
async function showPdfPages(pdf) {
  // Fit page 1 to the window width (capped), and use its size as every placeholder's.
  const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
  const scale = Math.max(0.1, Math.min(1.6, (pagesEl.clientWidth - 32) / first.width));
  // ponytail: scale is fixed when the pages are first shown; re-render on resize/zoom if readers ask for it.

  // A 40-page paper at 2x is hundreds of MB of canvas, so pages render lazily.
  pageObserver?.disconnect();
  const observer = pageObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      renderPage(pdf, Number(e.target.dataset.page), e.target, scale)
        .catch(err => { e.target.textContent = `Page ${e.target.dataset.page} failed to render: ${err?.message || err}`; });
    }
  }, { rootMargin: '150% 0px' });

  for (let n = 1; n <= pdf.numPages; n++) {
    const slot = document.createElement('div');
    slot.className = 'page';
    slot.dataset.page = String(n);
    slot.style.setProperty('--total-scale-factor', String(scale));
    slot.style.width = `${first.width * scale}px`;
    slot.style.height = `${first.height * scale}px`;
    pagesEl.append(slot);
    observer.observe(slot);
  }
}

/** Every page's text items, in the shape utils/pdfPaper.js reads. */
async function pdfTextPages(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    pdfPageTexts[n - 1] = items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join('');
    pages.push({
      width: viewport.width,
      height: viewport.height,
      items: items.filter(it => it.str !== undefined).map(it => {
        const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        const [, b, c, d] = it.transform;
        return { str: it.str, x, y, w: it.width, size: Math.hypot(c, d), font: it.fontName, rot: Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 };
      })
    });
  }
  return pages;
}

/** The paper as plain HTML. PDF text is untrusted, so it only ever goes in via textContent. */
function renderReadingView(paper) {
  const add = (parent, tag, text, className) => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    parent.append(el);
    return el;
  };
  const article = document.createElement('article');
  add(article, 'h1', paper.title || document.title);
  if (paper.authors.length) add(article, 'p', paper.authors.join(', '), 'byline');
  const sections = paper.abstract ? [{ heading: 'Abstract', text: paper.abstract }, ...paper.sections] : paper.sections;
  for (const section of sections) {
    add(article, 'h2', section.heading);
    for (const para of section.text.split('\n\n')) if (para.trim()) add(article, 'p', para);
  }
  if (paper.figures.length) {
    add(article, 'h2', 'Figures and tables');
    for (const fig of paper.figures) add(article, 'p', fig.caption, 'caption');
  }
  readingEl.append(article);
}

/** Switch between the reading view and the original pages; pages are drawn on first open. */
function setUpToggle(pdf) {
  const [readingBtn, pdfBtn] = toolbarEl.querySelectorAll('button');
  let pagesShown = false;
  const show = pdfMode => {
    readingEl.hidden = pdfMode;
    pagesEl.hidden = !pdfMode;
    readingBtn.setAttribute('aria-pressed', String(!pdfMode));
    pdfBtn.setAttribute('aria-pressed', String(pdfMode));
    if (pdfMode && pdfResizePending) { pagesEl.replaceChildren(); pagesShown = false; pdfResizePending = false; }
    if (pdfMode && !pagesShown) {
      pagesShown = true;
      showPdfPages(pdf).catch(err => showStatus(`Couldn't show the PDF pages (${err?.message || err}).`));
    }
    document.dispatchEvent(new CustomEvent('distill-reader-view'));
  };
  document.addEventListener('distill-show-reading', () => show(false));
  document.addEventListener('distill-show-pdf', () => show(true));
  readingBtn.addEventListener('click', () => show(false));
  pdfBtn.addEventListener('click', () => show(true));
  toolbarEl.hidden = false;
  return show;
}

const pageMatches = new Map();
globalThis.distillPdfResolve = text => {
  if (!pageMatches.has(text)) pageMatches.set(text, globalThis.DistillReadAlong.pageFor(pdfPageTexts, text));
  return pageMatches.get(text);
};

// Resolve the canonical block before scrolling; lazy pages may not have a text layer yet.
document.addEventListener('distill-pdf-source', event => {
  const page = globalThis.distillPdfResolve(event.detail.text);
  if (!page) return;
  const slot = pagesEl.querySelector(`[data-page="${page}"]`);
  if (slot) slot.scrollIntoView({ block: 'center', behavior: 'instant' });
});
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!pdfDocument || !pagesEl.children.length) return;
    if (pagesEl.hidden) { pdfResizePending = true; return; }
    const visible = [...pagesEl.children].find(el => el.getBoundingClientRect().bottom > 80)?.dataset.page;
    pagesEl.replaceChildren();
    showPdfPages(pdfDocument).then(() => {
      pagesEl.querySelector(`[data-page="${visible}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' });
      document.dispatchEvent(new CustomEvent('distill-reader-view'));
    }).catch(err => showStatus(`PDF resize failed: ${err.message}`));
  }, 250);
});

async function open() {
  if (!src) return showStatus('No PDF to open.');
  document.title = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() || 'Paper');
  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      url: src,
      wasmUrl: `${VENDOR}wasm/`,
      standardFontDataUrl: `${VENDOR}standard_fonts/`,
      iccUrl: `${VENDOR}iccs/`,
      isEvalSupported: false // extension CSP forbids eval
    }).promise;
  } catch (err) {
    const hint = src.startsWith('file:')
      ? ' For files on your computer, turn on "Allow access to file URLs" for Distill in chrome://extensions.'
      : '';
    return showStatus(`Couldn't open this PDF (${err?.message || err}).${hint}`);
  }

  pdfDocument = pdf;
  const show = setUpToggle(pdf);
  showStatus('Reading the paper…');
  const meta = await pdf.getMetadata().catch(() => null);
  let paper = null;
  try {
    paper = distillPdfPaper(await pdfTextPages(pdf), { url: src, info: meta?.info || {} });
  } catch (err) {
    console.warn('Distill: could not read paper text', err);
  }
  if (!paper || (!paper.abstract && !paper.sections.length)) {
    showStatus('');
    show(true);
    return showStatus("Couldn't find readable text in this PDF (it may be a scanned image), so here are the original pages.");
  }
  if (paper.title) document.title = paper.title;
  renderReadingView(paper);
  showStatus('');
  show(false);

  // Hand the paper to the regular content script, which tracks reading like on any paper page.
  globalThis.distillReaderPaper = paper;
  const script = document.createElement('script');
  script.src = 'content.js';
  document.head.append(script);
}

open();
