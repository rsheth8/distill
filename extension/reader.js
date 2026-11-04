// Distill's own PDF reader: reader.html?src=<pdf url>. Chrome's built-in PDF viewer
// can't be scripted, so papers in PDF form open here instead.
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';

const VENDOR = 'vendor/pdfjs/';
pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}pdf.worker.min.mjs`;

const statusEl = document.getElementById('status');
const pagesEl = document.getElementById('pages');
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
}

/** Every page's text items, in the shape utils/pdfPaper.js reads. */
async function pdfTextPages(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
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

/** Build the paper object and hand it to the extension, like content.js does for HTML papers. */
async function announcePaper(pdf, info) {
  const paper = distillPdfPaper(await pdfTextPages(pdf), { url: src, info: info || {} });
  if (paper.title) document.title = paper.title;
  const text = distillPaperText(paper);
  if (!globalThis.chrome?.runtime?.id) return; // opened outside the extension (local testing)
  chrome.runtime.sendMessage({
    type: 'PAPER_DETECTED',
    paper,
    paragraphCount: paper.sections.reduce((n, s) => n + s.text.split('\n\n').length, 0),
    title: (paper.title || document.title).slice(0, 140),
    totalWords: text.split(/\s+/).filter(Boolean).length,
    pageUrl: src
  }, () => { void chrome.runtime.lastError; });
}

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

  const meta = await pdf.getMetadata().catch(() => null);
  if (meta?.info?.Title?.trim()) document.title = meta.info.Title.trim();

  // Fit page 1 to the window width (capped), and use its size as every placeholder's.
  const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
  const scale = Math.min(1.6, (pagesEl.clientWidth - 32) / first.width);
  // ponytail: scale is fixed at load; re-render on resize/zoom if readers ask for it.

  // Render pages only as they near the viewport: a 40-page paper at 2x is hundreds of MB of canvas.
  const observer = new IntersectionObserver(entries => {
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
  showStatus('');
  announcePaper(pdf, meta?.info).catch(err => console.warn('Distill: could not read paper text', err));
}

open();
