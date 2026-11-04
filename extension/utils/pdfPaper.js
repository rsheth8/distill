// PDF text → the same paper object paperExtractor.js builds for HTML pages.
// Input is pdf.js text items flattened by reader.js:
//   pages: [{ width, height, items: [{ str, x, y, w, size, font, rot }] }]   (y = baseline from page top;
//   rot = rotated text such as arXiv's sideways ID stamp — kept for IDs, left out of layout)
// Needs paperExtractor.js loaded first (distillSectionKind, DISTILL_SKIP_SECTION_RE).

const DISTILL_PDF_NAMED_HEADING_RE = /^(abstract|introduction|background|related work|method(s|ology)?|materials and methods|experiments?|results|discussion|conclusions?|limitations|references|bibliography|acknowledg(e)?ments?|appendix|supplementary materials?)$/i;
// "2 ", "2.1 ", "II. ", "A ", "A.1 ", "A. " — digits capped at 2 so "2019 was…" isn't a heading number.
const DISTILL_PDF_NUMBER_RE = /^(?:(\d{1,2}(?:\.\d{1,2})*)\.?|([IVX]{1,4})\.|([A-H])((?:\.\d{1,2})*)(\.?))\s+/;
const DISTILL_PDF_CAPTION_RE = /^(fig(ure)?|table)\.?\s*\d+[.:|]/i;

/** Most common value, weighted (e.g. by character count). */
function distillPdfMode(pairs) {
  const tally = new Map();
  for (const [value, weight] of pairs) tally.set(value, (tally.get(value) || 0) + weight);
  let best = null;
  for (const [value, weight] of tally) if (best === null || weight > tally.get(best)) best = value;
  return best;
}

/** Line-number gutters: ≥8 bare numbers sharing a right edge and mostly counting up by 1. */
function distillPdfDropLineNumbers(items) {
  const groups = new Map();
  for (const it of items) {
    if (!/^\d{1,4}$/.test(it.str.trim())) continue;
    const key = Math.round((it.x + it.w) / 3);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const drop = new Set();
  for (const g of groups.values()) {
    if (g.length < 8) continue;
    g.sort((a, b) => a.y - b.y);
    let steps = 0;
    for (let i = 1; i < g.length; i++) if (Number(g[i].str) - Number(g[i - 1].str) === 1) steps++;
    if (steps >= (g.length - 1) * 0.7) g.forEach(it => drop.add(it));
  }
  return items.filter(it => !drop.has(it));
}

/**
 * x of the column gutter for the whole document, or null for one-column papers. Found once for all
 * pages, since figure-heavy or reference pages alone are often too ambiguous.
 */
function distillPdfColumnSplit(pages, bodySize, lo = 0.35, hi = 0.65, minSide = 0.25) {
  const text = pages.flatMap(p => p.items).filter(it => it.str.trim() && it.size >= bodySize * 0.75 && it.size <= bodySize * 1.3);
  const width = pages[0]?.width || 0;
  if (text.length < 40) return null;
  let best = null;
  for (let x = width * lo; x <= width * hi; x += 2) {
    const crossing = text.filter(it => it.x < x && it.x + it.w > x).length;
    if (!best || crossing < best.crossing) best = { x, crossing };
  }
  const left = text.filter(it => it.x + it.w <= best.x).length;
  const right = text.filter(it => it.x >= best.x).length;
  const ok = best.crossing <= text.length * 0.15 && left > text.length * minSide && right > text.length * minSide;
  return ok ? best.x : null;
}

/** Whether this page actually uses the document's gutter (a one-column appendix page doesn't). */
function distillPdfPageHasColumns(items, split, bodySize) {
  if (split === null) return false;
  const text = items.filter(it => it.size >= bodySize * 0.75);
  const crossing = text.filter(it => it.x < split - 2 && it.x + it.w > split + 2).length;
  const right = text.filter(it => it.x >= split).length;
  return text.length > 0 && crossing <= text.length * 0.2 && right >= text.length * 0.1 && right <= text.length * 0.9;
}

function distillPdfLine(items, page, col) {
  items.sort((a, b) => a.x - b.x);
  let text = '';
  let end = -Infinity;
  for (const it of items) {
    if (text && it.x - end > it.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
    text += it.str;
    end = it.x + it.w;
  }
  const baseline = items.find(it => it.size === Math.max(...items.map(i => i.size))) || items[0];
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    x: items[0].x,
    y: baseline.y,
    size: distillPdfMode(items.map(it => [it.size, it.str.length])),
    font: distillPdfMode(items.map(it => [it.font, it.str.length])),
    page,
    col
  };
}

/** One page's lines in reading order: full-width rows as they come, column runs left then right. */
function distillPdfPageLines(page, pageIndex, bodySize, docSplit) {
  const items = distillPdfDropLineNumbers(page.items.filter(it => it.str.trim()))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && it.y - row.y <= Math.max(2, row.size * 0.45)) {
      row.items.push(it);
      row.size = Math.max(row.size, it.size);
    } else {
      rows.push({ y: it.y, size: it.size, items: [it] });
    }
  }
  // A page can have its own layout, e.g. a journal's metadata sidebar on page 1.
  const split = distillPdfPageHasColumns(items, docSplit, bodySize)
    ? docSplit : distillPdfColumnSplit([{ ...page, items }], bodySize, 0.25, 0.75, 0.15);
  const out = [];
  const left = [];
  const right = [];
  const flush = () => out.push(...left.splice(0), ...right.splice(0));
  for (const row of rows) {
    if (split === null) { out.push(distillPdfLine(row.items, pageIndex, 0)); continue; }
    const L = row.items.filter(it => it.x + it.w / 2 < split);
    const R = row.items.filter(it => it.x + it.w / 2 >= split);
    // Tiny figure labels and superscripts don't decide layout.
    const bigL = L.filter(it => it.size >= bodySize * 0.75);
    const bigR = R.filter(it => it.size >= bodySize * 0.75);
    const gap = bigL.length && bigR.length
      ? Math.min(...bigR.map(it => it.x)) - Math.max(...bigL.map(it => it.x + it.w)) : Infinity;
    const spans = [...bigL, ...bigR].some(it => it.x < split - 2 && it.x + it.w > split + 2);
    if (spans || gap < bodySize * 0.6) {
      flush();
      out.push(distillPdfLine(row.items, pageIndex, 0));
      continue;
    }
    if (L.length) left.push(distillPdfLine(L, pageIndex, 1));
    if (R.length) right.push(distillPdfLine(R, pageIndex, 2));
  }
  flush();
  return out;
}

/** Running headers/footers: margin lines whose digit-blind text repeats across pages, or bare page numbers. */
function distillPdfDropRunningLines(lines, pages) {
  const inMargin = ln => ln.y < pages[ln.page].height * 0.08 || ln.y > pages[ln.page].height * 0.92;
  const key = ln => ln.text.replace(/\d+/g, '#').toLowerCase();
  const seen = new Map();
  for (const ln of lines.filter(inMargin)) {
    if (!seen.has(key(ln))) seen.set(key(ln), new Set());
    seen.get(key(ln)).add(ln.page);
  }
  const minPages = Math.max(2, pages.length * 0.4);
  return lines.filter(ln => !inMargin(ln) || (!/^\W*\d{1,4}\W*$/.test(ln.text) && seen.get(key(ln)).size < minPages));
}

/** { text, depth, size } when a line looks like a section heading, else null. depth 0 = unnumbered. */
function distillPdfHeading(ln, bodySize, bodyFont) {
  const t = ln.text;
  if (ln.size < bodySize * 0.9 || t.length > 90 || t.split(' ').length > 12 || !/[A-Za-z]{3}/.test(t) || /[,;]$/.test(t)) return null;
  const num = t.match(DISTILL_PDF_NUMBER_RE);
  const rest = num ? t.slice(num[0].length) : t;
  if (!/^[A-Z]/.test(rest) || (/\.$/.test(rest) && rest.split(' ').length > 4)) return null;
  const named = DISTILL_PDF_NAMED_HEADING_RE.test(rest.replace(/[.:]$/, ''));
  const big = ln.size >= bodySize * 1.12;
  const styled = ln.font !== bodyFont;
  if (!big && !(styled && (num || named))) return null;
  let depth = 0;
  if (num?.[1]) depth = num[1].split('.').length;
  else if (num?.[2]) depth = 1;
  else if (num?.[3]) depth = num[4] ? 1 + num[4].split('.').length - 1 : num[5] ? 2 : 1;
  return { text: rest.replace(/[.:]$/, ''), depth, size: ln.size, named };
}

function distillPdfJoin(lines) {
  return lines.reduce((t, l) => {
    if (!t) return l;
    return /[a-z]-$/.test(t) && /^[a-z]/.test(l) ? t.slice(0, -1) + l : `${t} ${l}`;
  }, '');
}

/**
 * @param {{width:number,height:number,items:object[]}[]} pages
 * @param {{url?:string, info?:object}} opts  url = PDF address; info = pdf.js metadata info
 */
function distillPdfPaper(rawPages, { url = '', info = {} } = {}) {
  const pages = rawPages.map(p => ({ ...p, items: p.items.filter(it => !it.rot) }));
  const all = pages.flatMap(p => p.items).filter(it => it.str.trim());
  const bodySize = distillPdfMode(all.map(it => [Math.round(it.size * 2) / 2, it.str.length])) || 10;
  const bodyFont = distillPdfMode(all.filter(it => Math.abs(it.size - bodySize) < 0.5).map(it => [it.font, it.str.length]));
  const docSplit = distillPdfColumnSplit(pages, bodySize);
  let lines = distillPdfDropRunningLines(pages.flatMap((p, i) => distillPdfPageLines(p, i, bodySize, docSplit)), pages);

  // Title: the PDF's own Title when it looks real, else the biggest text in the top half of page 1.
  const metaTitle = (info.Title || '').trim();
  const useMeta = metaTitle.split(' ').length >= 3 && !/\.(pdf|docx?|tex)$|^microsoft word|^untitled/i.test(metaTitle);
  const squash = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const titleCands = lines.filter(ln => ln.page === 0 && ln.y < pages[0].height * 0.5 && ln.size >= bodySize * 1.3 && /[A-Za-z]{3}/.test(ln.text)
    && !DISTILL_PDF_NAMED_HEADING_RE.test(ln.text.replace(DISTILL_PDF_NUMBER_RE, '')));
  const titleSize = Math.max(0, ...titleCands.map(ln => ln.size));
  const titleLines = useMeta
    ? titleCands.filter(ln => squash(metaTitle).includes(squash(ln.text)))
    : titleCands.filter(ln => ln.size >= titleSize - 0.5);
  lines = lines.filter(ln => !titleLines.includes(ln));
  const title = useMeta ? metaTitle : titleLines.map(ln => ln.text).join(' ');

  // Paragraph blocks.
  const blocks = [];
  let cur = null;
  let prev = null;
  for (const ln of lines) {
    const heading = distillPdfHeading(ln, bodySize, bodyFont);
    // A heading that wraps onto a second line: same style, right below.
    if (heading && cur?.heading && !heading.depth && ln.font === prev.font && Math.abs(ln.size - prev.size) < 0.5 && ln.y - prev.y < ln.size * 1.6) {
      cur.heading.text += ` ${heading.text}`;
      cur.lines.push(ln.text);
      prev = ln;
      continue;
    }
    let fresh = !cur || !!heading || !!cur.heading || DISTILL_PDF_CAPTION_RE.test(ln.text) || Math.abs(ln.size - prev.size) > 0.8;
    if (!fresh) {
      const jumped = ln.page !== prev.page || ln.y < prev.y - 1; // new page or column
      fresh = jumped
        ? /[.?!:]$/.test(prev.text)
        : ln.y - prev.y > prev.size * 1.75 || (ln.x - prev.x > ln.size * 0.8 && ln.x - prev.x < ln.size * 4);
    }
    if (fresh) blocks.push(cur = { heading, lines: [], size: ln.size });
    cur.lines.push(ln.text);
    prev = ln;
  }

  // An unnumbered, unnamed "heading" must lead into a real paragraph — else it's figure or table text.
  blocks.forEach((b, i) => {
    const h = b.heading;
    if (!h || h.depth || h.named) return;
    const next = blocks[i + 1];
    const words = next && !next.heading ? next.lines.join(' ').split(' ').length : 0;
    if (words < 20 || Math.abs(next.size - bodySize) > 1) b.heading = null;
  });
  const headings = blocks.map(b => b.heading).filter(Boolean);
  // Papers that number their sections: only numbered or standard-named headings are top level.
  const numbered = headings.some(h => h.depth === 1);
  const topSize = Math.max(0, ...headings.map(h => h.size));
  const isTop = h => h.depth === 1 || h.named || (!numbered && h.depth === 0 && h.size >= topSize - 0.3);

  const sections = [];
  const figures = [];
  let section = null;
  let abstract = '';
  for (const b of blocks) {
    if (b.heading && isTop(b.heading)) {
      sections.push(section = { heading: b.heading.text, parts: [] });
      continue;
    }
    const text = b.heading ? b.heading.text : distillPdfJoin(b.lines);
    if (DISTILL_PDF_CAPTION_RE.test(text)) { figures.push({ caption: text }); continue; }
    if (!b.heading) {
      // Footnotes, figure labels, tables and equations: small, tiny or mostly non-letters.
      const letters = (text.match(/[A-Za-z]/g) || []).length;
      if (b.size < bodySize * 0.85 || text.split(' ').length < 3 || letters < text.replace(/\s/g, '').length * 0.5) continue;
    }
    if (!section) {
      const m = text.match(/^abstract\b[\s.:—–-]*/i);
      if (m && !abstract) abstract = text.slice(m[0].length);
      continue; // authors and affiliations before the first heading
    }
    section.parts.push(text);
  }
  const abs = sections.find(s => /^abstract$/i.test(s.heading));
  if (abs) {
    // No headings after the abstract (>600 words): keep ~300 as abstract, the rest becomes the body.
    abs.parts = abs.parts.filter(t => !/^(key ?words|index terms)\b/i.test(t));
    let words = 0;
    const total = abs.parts.join(' ').split(' ').length;
    const cut = total < 600 ? -1
      : abs.parts[0].split(' ').length >= 100 ? 1
        : abs.parts.findIndex((t, i) => (words += t.split(' ').length) > 300 && i > 0);
    if (cut > 0) sections.splice(sections.indexOf(abs) + 1, 0, { heading: 'Main text', parts: abs.parts.splice(cut) });
  }

  const page1 = rawPages[0]?.items.map(it => it.str).join(' ') || '';
  const arxivId = (page1.match(/arXiv:(\d{4}\.\d{4,5})/) || [])[1];
  const doi = arxivId ? `10.48550/arXiv.${arxivId}` : ((page1.match(/\b10\.\d{4,9}\/[^\s"<>]+/) || [''])[0].replace(/[.,;)]+$/, ''));
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a URL */ }

  return {
    title,
    authors: (info.Author || '').split(/;|,|\band\b/).map(s => s.trim()).filter(Boolean),
    doi,
    source: 'pdf',
    isPreprint: !!arxivId || /bioRxiv preprint|medRxiv preprint/i.test(page1) || DISTILL_PREPRINT_HOST_RE.test(host),
    pdfUrl: url,
    abstract: abs ? abs.parts.join('\n\n') : abstract,
    sections: sections
      .filter(s => s !== abs && s.parts.length && !DISTILL_SKIP_SECTION_RE.test(s.heading))
      .map(s => ({ heading: s.heading, kind: distillSectionKind(s.heading), text: s.parts.join('\n\n') })),
    figures
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillPdfPaper };
}
