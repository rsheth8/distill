// Turns a research-paper page into the one structured "paper" object every Distill
// feature reads from. Spec: docs/superpowers/specs/2026-11-04-paper-intake-design.md

const DISTILL_PREPRINT_HOST_RE = /(^|\.)(arxiv|biorxiv|medrxiv)\.org$/;
// Dropped as noise. Funding, conflicts and data availability are kept: the trust check needs them.
const DISTILL_SKIP_SECTION_RE = /^(references|bibliography|acknowledg|footnotes|supplementary|supporting information|extended data|associated data|online content|author contributions|figures$)/i;

// Where the article body lives and which elements are figure captions, per site.
// Sites not listed use the generic rule; `roots` are tried in order.
const DISTILL_SITE_RULES = [
  { source: 'pmc', host: /(^|\.)ncbi\.nlm\.nih\.gov$/, roots: ['section.body.main-article-body'], captions: 'figure figcaption' },
  { source: 'biorxiv', host: /(^|\.)(biorxiv|medrxiv)\.org$/, roots: ['.article.fulltext-view'], captions: '.fig-caption' }
];
const DISTILL_GENERIC_RULE = {
  source: 'generic',
  roots: ['.article-body', '[itemprop="articleBody"]', 'article', 'main'],
  captions: 'figcaption, .figcaption, .fig-caption'
};

/** Rough role of a section from its heading, so features can find e.g. the methods. */
function distillSectionKind(heading) {
  const h = heading.toLowerCase();
  // Nature-style "Main" holds intro, results and discussion together, so it stays 'other'.
  if (/introduction|background|motivation/.test(h)) return 'intro';
  if (/method|materials|approach|setup|study design|participants|architectur/.test(h)) return 'methods';
  if (/result|finding|evaluation|experiment/.test(h)) return 'results';
  if (/discussion|conclu|limitation|future work/.test(h)) return 'discussion';
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
 * Splits a journal-style body on its top heading level (usually h2). Lower
 * headings become lines in their section; figures, tables and captions are skipped.
 */
function distillWalkSections(root, captionSel) {
  const skipInside = `figure, table, nav, aside, .fig, .figure, .table-wrap, .ref-list, ${captionSel}`;
  const nodes = Array.from(root.querySelectorAll('h2, h3, h4, p, li')).filter(el =>
    !el.closest(skipInside) && !(el.tagName === 'LI' && el.querySelector('p, li')));
  const isHeading = el => /^H\d$/.test(el.tagName);
  const top = Math.min(...nodes.filter(isHeading).map(h => Number(h.tagName[1])));
  const sections = [];
  let cur = null;
  for (const el of nodes) {
    const text = isHeading(el) ? distillCleanHeading(distillNodeText(el)) : distillNodeText(el);
    if (!text) continue;
    if (isHeading(el) && Number(el.tagName[1]) === top) sections.push(cur = { heading: text, parts: [] });
    else if (cur) cur.parts.push(text);
  }
  return sections.map(s => ({ heading: s.heading, text: s.parts.join('\n\n') }));
}

/** Journal/preprint pages: meta tags for the header, heading walk for the body. */
function distillExtractJournal(doc, host) {
  const meta = distillPaperMeta(doc);
  if (!meta.title) return null;
  const rule = DISTILL_SITE_RULES.find(r => r.host.test(host)) || DISTILL_GENERIC_RULE;
  const root = rule.roots.map(s => doc.querySelector(s)).find(Boolean) || doc.body;
  const walked = distillWalkSections(root, rule.captions);
  const abs = walked.find(s => /^abstract$/i.test(s.heading));
  const captions = Array.from(root.querySelectorAll(rule.captions)).map(c => {
    // PMC puts the "Fig. 1." label in a heading beside the caption, not inside it.
    const label = c.closest('figure')?.querySelector('h3, h4');
    const text = distillNodeText(c);
    return label && !c.contains(label) ? `${distillNodeText(label)} ${text}`.trim() : text;
  }).filter(Boolean);
  return {
    source: rule.source,
    isPreprint: DISTILL_PREPRINT_HOST_RE.test(host),
    ...meta,
    // The on-page abstract beats citation_abstract, which some sites fill with raw HTML.
    abstract: abs?.text || meta.abstract,
    sections: walked
      .filter(s => s !== abs && s.text && !DISTILL_SKIP_SECTION_RE.test(s.heading))
      .map(s => ({ heading: s.heading, kind: distillSectionKind(s.heading), text: s.text })),
    figures: [...new Set(captions)].map(caption => ({ caption }))
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
  return distillExtractJournal(doc, host);
}

/** Plain text of a paper, paragraphs split by blank lines — feeds features that still take `articleText`. */
function distillPaperText(paper) {
  return [paper.title, ...(paper.abstract ? ['Abstract', paper.abstract] : []),
    ...paper.sections.flatMap(s => [s.heading, s.text])].filter(Boolean).join('\n\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillExtractPaper, distillSectionKind, distillPaperText };
}
