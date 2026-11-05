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

const DISTILL_SOURCE_NAMES = { arxiv: 'arXiv', pmc: 'PubMed Central', biorxiv: 'bioRxiv' };

/** "A and B · arXiv" for the paper card; empty parts (no authors, generic/pdf/unknown source) are left out. */
function distillByline(paper) {
  const authors = Array.isArray(paper?.authors) ? paper.authors : [];
  let who = '';
  if (authors.length >= 3) who = `${authors[0]} et al.`;
  else who = authors.join(' and ');
  const where = DISTILL_SOURCE_NAMES[paper?.source] || '';
  return [who, where].filter(Boolean).join(' · ');
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

/** "term — definition" lines (also –, " - " and ":") from a TERMS: block. */
function distillParseTerms(block) {
  const terms = [];
  for (const line of String(block || '').split('\n')) {
    const m = /^\s*(?:[-*•]|\d+[.)])?\s*(.+?)\s*(?:—|–|:|\s-\s)\s*(.+)$/.exec(line);
    if (!m) continue;
    const term = m[1].trim().replace(/^[*_"`]+|[*_"`]+$/g, '').trim();
    if (!term || term.length > 60) continue;
    terms.push({ term, definition: m[2].trim() });
    if (terms.length === 12) break;
  }
  return terms;
}

/** The paper section with this heading (case and spacing ignored); "Abstract" is the abstract. */
function distillFindSection(paper, heading) {
  const p = paper || {};
  // The content script cuts headings to 120 chars, so compare that much.
  const norm = h => String(h || '').trim().toLowerCase().slice(0, 120);
  const want = norm(heading);
  if (!want) return null;
  if (want === 'abstract') return p.abstract ? { heading: 'Abstract', kind: '', text: p.abstract } : null;
  const s = (Array.isArray(p.sections) ? p.sections : []).find(x => norm(x.heading) === want);
  return s ? { heading: s.heading, kind: s.kind, text: s.text } : null;
}

/** Add a section's terms to the glossary; the first definition of a term wins. */
function distillMergeGlossary(glossary, terms, section, max = 150) {
  const list = Array.isArray(glossary) ? glossary.slice() : [];
  const seen = new Set(list.map(g => g.term.toLowerCase()));
  for (const t of terms || []) {
    const key = t.term.toLowerCase();
    if (seen.has(key) || list.length >= max) continue;
    seen.add(key);
    list.push({ term: t.term, definition: t.definition, section });
  }
  return list;
}

const DISTILL_STOPWORDS = new Set(('the and for are was were with that this from what which who whom how why when where does did ' +
  'has have had can could would should will their they them into about than then there these those its not but you your ' +
  'our out all any been being more most some such only also very just over under paper study authors').split(' '));

function distillWords(text) {
  return (String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter(w => !DISTILL_STOPWORDS.has(w));
}

/**
 * Paragraphs most likely to answer the question (word overlap, +2 when the heading matches),
 * best first until maxChars, then put back in paper order. No match → the opening paragraphs.
 * ponytail: keyword overlap, not embeddings; swap in embeddings if answers miss obvious passages.
 */
function distillPickSections(paper, question, maxChars = 5000) {
  const p = paper || {};
  const q = new Set(distillWords(question));
  const sections = [...(p.abstract ? [{ heading: 'Abstract', text: p.abstract }] : []), ...(Array.isArray(p.sections) ? p.sections : [])];
  const paras = [];
  sections.forEach((s, si) => {
    const headingBonus = distillWords(s.heading).some(w => q.has(w)) ? 2 : 0;
    String(s.text || '').split('\n\n').forEach((raw, pi) => {
      const text = raw.trim();
      if (!text) return;
      const hits = distillWords(text).filter(w => q.has(w)).length;
      paras.push({ si, pi, text, score: hits ? hits + headingBonus : headingBonus });
    });
  });
  const ranked = paras.filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  const pool = ranked.length ? ranked : paras;
  const chosen = [];
  let used = 0;
  for (const x of pool) {
    const gap = chosen.length ? 2 : 0; // the "\n\n" that may join it to a neighbour
    const room = maxChars - used - gap;
    if (room < 1) break;
    const text = x.text.slice(0, room); // an oversized paragraph is cut down, not skipped
    chosen.push({ ...x, text });
    used += gap + text.length;
  }
  chosen.sort((a, b) => a.si - b.si || a.pi - b.pi);
  const out = [];
  for (const x of chosen) {
    const heading = sections[x.si].heading;
    const last = out[out.length - 1];
    if (last && last.heading === heading) last.text += `\n\n${x.text}`;
    else out.push({ heading, text: x.text });
  }
  return out;
}

const DISTILL_SECTION_LINES = {
  intro: 'The question and why it matters.',
  methods: 'How they did it. Fine to skim.',
  results: 'What they found.',
  discussion: 'What it means, and its limits.'
};

/** Segments for the panel's section map: width by length, read/current/ahead by position. */
function distillSectionMap(sections, currentHeading) {
  const norm = h => String(h || '').trim().toLowerCase().slice(0, 120);
  const list = (Array.isArray(sections) ? sections : []).filter(s => s && s.heading);
  const longest = Math.max(1, ...list.map(s => s.chars || 0));
  const cur = list.findIndex(s => norm(s.heading) === norm(currentHeading));
  return list.map((s, i) => ({
    heading: s.heading,
    kind: s.kind || 'other',
    flex: Math.round((0.5 + 1.5 * Math.min(1, (s.chars || 0) / longest)) * 100) / 100,
    state: cur === -1 || i > cur ? 'ahead' : i === cur ? 'current' : 'read',
    line: DISTILL_SECTION_LINES[s.kind] || ''
  }));
}

/** Stable key for a summary bullet (case, spacing and a leading bullet mark ignored). */
function distillBulletKey(bullet) {
  return String(bullet || '').replace(/^\s*[-*•]\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);
}

/** Summary bullets grouped by the section they were written in, in paper order; untagged first. */
function distillGroupBullets(bullets, bulletSections, sectionOrder) {
  const tags = bulletSections || {};
  const order = Array.isArray(sectionOrder) ? sectionOrder : [];
  const groups = new Map();
  for (const b of Array.isArray(bullets) ? bullets : []) {
    const heading = tags[distillBulletKey(b)] || '';
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(b);
  }
  const rank = h => (h === '' ? -1 : order.indexOf(h) === -1 ? order.length : order.indexOf(h));
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0])).map(([heading, list]) => ({ heading, bullets: list }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillBulletKey, distillGroupBullets, distillPaperExcerpt, distillTrustFacts, distillParseLabelled, distillParseTerms, distillFindSection, distillMergeGlossary, distillPickSections, distillSectionMap, distillByline };
}
