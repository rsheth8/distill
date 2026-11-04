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
}

open();
