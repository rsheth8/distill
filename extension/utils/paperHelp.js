'use strict';

// Pure helpers for paper help (overview, trust card, section guides, ask). No DOM, no chrome.*.
// Loaded by the service worker (importScripts) and the side panel (<script>).

const DISTILL_EXCERPT_KINDS = ['intro', 'methods', 'results', 'discussion'];
const DISTILL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Abstract plus the opening of the first intro/methods/results/discussion, each under its heading. */
function distillPaperExcerpt(paper, maxChars = 7000) {
  const p = paper || {};
  const sections = Array.isArray(p.sections) ? p.sections : [];
  let picked = DISTILL_EXCERPT_KINDS.map(kind => sections.find(s => s.kind === kind)).filter(Boolean);
  if (picked.length < 2) picked = sections.slice(0, 4);
  const parts = [];
  if (p.abstract) parts.push(`Abstract\n${p.abstract.slice(0, 1500)}`);
  for (const s of picked) parts.push(`${s.heading}\n${String(s.text || '').slice(0, 1200)}`);
  return parts.join('\n\n').slice(0, maxChars);
}

/** "Oct 2023" from an arXiv DOI, else from paper.date ("2021-03-04", "2021/03", "2019"); '' if unknown. */
function distillPaperDate(p) {
  const arxiv = /arXiv\.(\d{2})(\d{2})\./i.exec(p.doi || '');
  if (arxiv && DISTILL_MONTHS[Number(arxiv[2]) - 1]) return `${DISTILL_MONTHS[Number(arxiv[2]) - 1]} 20${arxiv[1]}`;
  const d = /^(\d{4})(?:[-/](\d{2}))?/.exec(p.date || '');
  if (!d) return '';
  const month = d[2] && DISTILL_MONTHS[Number(d[2]) - 1];
  return month ? `${month} ${d[1]}` : d[1];
}

/** Facts read straight from the paper object, for the trust card. */
function distillTrustFacts(paper) {
  const p = paper || {};
  const facts = [];
  if (p.isPreprint) facts.push({ text: 'Preprint — not yet peer-reviewed' });
  else if (p.source === 'pdf') facts.push({ text: 'Publication status unknown' });
  else facts.push({ text: 'Journal article' });
  const date = distillPaperDate(p);
  if (date) facts.push({ text: date });
  const n = Array.isArray(p.authors) ? p.authors.length : 0;
  if (n) facts.push({ text: n === 1 ? '1 author' : `${n} authors` });
  if (p.doi) facts.push({ text: `DOI ${p.doi}`, href: `https://doi.org/${encodeURI(p.doi).replace(/[#?]/g, encodeURIComponent)}` });
  return facts;
}

/**
 * Split "LABEL: text" output. `lead` is whatever comes before the first label.
 * Labels must start a line; case, **bold** and missing labels are fine; safe on a half-streamed reply.
 */
function distillParseLabelled(text, labels) {
  const src = String(text || '');
  const re = new RegExp(`^[ \\t*#_]*(${labels.join('|')})[ \\t*_]*:[ \\t*_]*`, 'gim');
  const hits = [];
  for (let m = re.exec(src); m; m = re.exec(src)) hits.push({ label: m[1].toUpperCase(), start: m.index, end: re.lastIndex });
  const out = { lead: src.slice(0, hits.length ? hits[0].start : src.length).trim() };
  hits.forEach((h, k) => {
    if (!(h.label in out)) out[h.label] = src.slice(h.end, k + 1 < hits.length ? hits[k + 1].start : src.length).trim();
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillPaperExcerpt, distillTrustFacts, distillParseLabelled };
}
