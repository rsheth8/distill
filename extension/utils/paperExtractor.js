// Turns a research-paper page into the one structured "paper" object every Distill
// feature reads from. Spec: docs/superpowers/specs/2026-11-04-paper-intake-design.md

const DISTILL_PREPRINT_HOST_RE = /(^|\.)(arxiv|biorxiv|medrxiv)\.org$/;
// Dropped as noise. Funding, conflicts and data availability are kept: the trust check needs them.
const DISTILL_SKIP_SECTION_RE = /^(references|bibliography|acknowledg)/i;

/** Rough role of a section from its heading, so features can find e.g. the methods. */
function distillSectionKind(heading) {
  const h = heading.toLowerCase();
  if (/introduction|background|motivation/.test(h)) return 'intro';
  if (/method|materials|approach|setup|study design|participants|architectur/.test(h)) return 'methods';
  if (/result|finding|evaluation|experiment/.test(h)) return 'results';
  if (/discussion|conclusion|limitation|future work/.test(h)) return 'discussion';
  return 'other';
}

function distillNormSpace(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** "2.1 Methods" / "II. Methods" → "Methods". */
function distillCleanHeading(text) {
  return distillNormSpace(text).replace(/^(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+/, '');
}

/** Element text with math kept as LaTeX ($x^2$) and footnotes dropped. */
function distillNodeText(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('.ltx_note').forEach(n => n.remove());
  copy.querySelectorAll('math').forEach(m => {
    const tex = m.getAttribute('alttext');
    m.replaceWith(el.ownerDocument.createTextNode(tex ? `$${tex}$` : m.textContent));
  });
  return distillNormSpace(copy.textContent);
}

/** Highwire/Google Scholar `citation_*` tags — present on nearly every journal and preprint site. */
function distillPaperMeta(doc) {
  const all = name => Array.from(doc.querySelectorAll(`meta[name="${name}"]`))
    .map(m => distillNormSpace(m.getAttribute('content'))).filter(Boolean);
  const one = name => all(name)[0] || '';
  return {
    title: one('citation_title'),
    authors: all('citation_author'),
    doi: one('citation_doi').replace(/^doi:\s*/i, ''),
    pdfUrl: one('citation_pdf_url'),
    abstract: one('citation_abstract')
  };
}

function distillArxivAuthors(doc) {
  const names = [];
  doc.querySelectorAll('.ltx_authors .ltx_personname').forEach(p => {
    // Names come before the first <br>; affiliations often follow it.
    let text = '';
    for (const n of p.childNodes) {
      if (n.nodeName === 'BR') break;
      if (n.nodeName !== 'SUP') text += n.textContent;
    }
    text.split(/,|\band\b|&/).map(distillNormSpace).filter(Boolean).forEach(n => names.push(n));
  });
  return names;
}

function distillExtractArxiv(doc, url) {
  const id = (url.match(/\/html\/(\d{4}\.\d{4,5})/) || [])[1] || '';
  const sections = [];
  doc.querySelectorAll('section.ltx_section, section.ltx_appendix').forEach(sec => {
    const titleEl = sec.querySelector('.ltx_title');
    const heading = titleEl ? distillCleanHeading(distillNodeText(titleEl)) : '';
    if (!heading || DISTILL_SKIP_SECTION_RE.test(heading)) return;
    const parts = [];
    sec.querySelectorAll('h3, h4, p.ltx_p, table.ltx_equation, table.ltx_equationgroup').forEach(el => {
      if (el.closest('figure')) return;
      const t = /^H\d$/.test(el.tagName) ? distillCleanHeading(distillNodeText(el)) : distillNodeText(el);
      if (t) parts.push(t);
    });
    const kind = sec.classList.contains('ltx_appendix') ? 'other' : distillSectionKind(heading);
    sections.push({ heading, kind, text: parts.join('\n\n') });
  });
  const titleEl = doc.querySelector('.ltx_title_document');
  const abstractEl = doc.querySelector('.ltx_abstract');
  return {
    title: titleEl ? distillNodeText(titleEl) : distillNormSpace(doc.title),
    authors: distillArxivAuthors(doc),
    doi: id ? `10.48550/arXiv.${id}` : '',
    pdfUrl: id ? `https://arxiv.org/pdf/${id}` : '',
    abstract: abstractEl ? Array.from(abstractEl.querySelectorAll('p')).map(distillNodeText).join('\n\n') : '',
    sections,
    figures: Array.from(doc.querySelectorAll('figure > figcaption'))
      .map(c => ({ caption: distillNodeText(c) })).filter(f => f.caption)
  };
}

/**
 * @param {Document} doc
 * @param {string} url page URL (decides site extractor + preprint flag)
 * @returns {object|null} paper object, or null when the page isn't a paper
 */
function distillExtractPaper(doc, url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a URL: generic path only */ }
  if (/(^|\.)arxiv\.org$/.test(host) && doc.querySelector('.ltx_title_document')) {
    return { source: 'arxiv', isPreprint: true, ...distillExtractArxiv(doc, url) };
  }
  const meta = distillPaperMeta(doc);
  if (!meta.title) return null;
  return { source: 'generic', isPreprint: DISTILL_PREPRINT_HOST_RE.test(host), ...meta, sections: [], figures: [] };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillExtractPaper, distillSectionKind };
}
