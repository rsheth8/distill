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
  for (const s of picked) {
    const text = String(s.text || '');
    const excerpt = text.length > 1200 ? `${text.slice(0, 800)}\n[Middle of section omitted]\n${text.slice(-350)}` : text;
    parts.push(`${s.heading}\n${excerpt}`);
  }
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
  if (p.isPreprint) facts.push({ text: 'Preprint source — review status unverified' });
  else if (p.source === 'pdf') facts.push({ text: 'Publication status unknown' });
  else facts.push({ text: 'Journal article' });
  const date = distillPaperDate(p);
  if (date) facts.push({ text: p.source === 'arxiv' && !p.date ? `First posted: ${date}` : date });
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

/** Bounded passage retrieval: unique query terms prevent repetition from dominating.
 * Long paragraphs are windowed so a result near their end remains retrievable.
 * IDs refer to extracted section/paragraph positions, not publisher paragraph numbers.
 */
function distillPickPassages(paper, question, maxChars = 5000) {
  const q = new Set(distillWords(question));
  const designIntent = /\b(study design|study population|design and population)\b/i.test(question) && !/result|outcome|exclu|inclusion|effect|association/i.test(question);
  const resultIntent = /\b(key|main|principal) results?\b/i.test(question);
  const limitationIntent = /\b(limitations?|caveats?)\b/i.test(question);
  const sections = [{ heading: 'Abstract', text: paper?.abstract || '' }, ...(paper?.sections || [])];
  const candidates = [];
  sections.forEach((s, si) => String(s.text || '').split('\n\n').forEach((raw, pi) => {
    if (designIntent && si > 0 && s.kind !== 'methods') return;
    const para = raw.trim();
    for (let start = 0; start < para.length; start += 1000) {
      const text = para.slice(start, start + 1200);
      const words = new Set(distillWords(text));
      const hits = [...q].filter(w => words.has(w)).length;
      const headingHits = distillWords(s.heading).filter(w => q.has(w)).length;
      candidates.push({ id: `S${si}P${pi}`, heading: s.heading, text, start, si, pi, score: hits * 3 + Math.min(2, headingHits), designScore: s.kind === 'methods' && /\b(study|design|population|sample|result|participants)\b/i.test(question) ? (/recruited|enrolled|sample.*included|study population/i.test(text) ? 2 : /randomi[sz]ed/i.test(text) ? 1 : 0) : 0 });
    }
  }));
  // Reserve one design passage, so methods do not crowd out the actual results.
  const design = candidates.filter(x => x.designScore > 0).sort((a, b) => b.designScore - a.designScore || b.score - a.score)[0];
  if (design) design.score += 20;
  // Generic questions have few discriminating terms. Reserve the abstract opening for
  // headline results (including their interval convention), and prioritize actual
  // discussion caveats over the introduction's research gap. Keep IDs/windows intact.
  if (resultIntent) {
    const headline = candidates.find(x => x.si === 0 && x.pi === 0 && x.start === 0);
    if (headline) headline.score += 40;
    for (const x of candidates) {
      if (sections[x.si].kind === 'results') {
        x.score += 10;
        // Quantified findings outrank procedural descriptions in generic queries.
        if (/[=<>≤≥±]\s*[−-]?(?:\d|\.\d)/u.test(x.text)) x.score += 20;
      }
    }
  }
  if (limitationIntent) {
    for (const x of candidates) {
      if (sections[x.si].kind === 'discussion' || /discussion|conclusion/i.test(x.heading)) {
        x.score += 15;
        if (/limit|caveat|causal|generaliz|generalis|foreground|poor fit|anomal|cannot|may not|too late/i.test(x.text)) x.score += 15;
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.si - b.si || a.pi - b.pi || a.start - b.start);
  const selected = [], seen = new Map();
  let used = 0;
  for (const x of candidates) {
    if (seen.has(x.id)) {
      const previous = seen.get(x.id);
      const start = Math.min(previous.start, x.start);
      const end = Math.max(previous.start + previous.text.length, x.start + x.text.length);
      const para = String(sections[x.si].text).split('\n\n')[x.pi].trim();
      const text = para.slice(start, end);
      const added = text.length - previous.text.length;
      // Merge contiguous source context under the same paragraph ID. Do not
      // silently drop a later interval when the bounded evidence budget fits it.
      if (added <= maxChars - used) {
        previous.start = start; previous.text = text;
        previous.truncated = start > 0 || end < para.length;
        used += added;
      }
      continue;
    }
    const overhead = x.id.length + x.heading.length + 8;
    const room = maxChars - used - overhead;
    if (room < 80) break;
    if (selected.length >= 12) continue;
    const text = x.text.slice(0, room);
    selected.push({ id: x.id, heading: x.heading, text, start: x.start, truncated: x.start > 0 || text.length < String(sections[x.si].text).split('\n\n')[x.pi].trim().length });
    used += text.length + overhead;
    seen.set(x.id, selected[selected.length - 1]);
  }
  return selected;
}

/** Only IDs present in supplied input are navigable. This checks provenance, not truth. */
function distillCitedPassages(text, supplied) {
  const ids = new Set((String(text || '').match(/\bS\d+P\d+\b/g) || []));
  return (Array.isArray(supplied) ? supplied : []).filter(p => ids.has(p.id));
}

/** Conservative check for explicit demographic counts; does not validate other claims. */
function distillUnsupportedDemographicCounts(answer, passages) {
  const group = value => /^female|^women/i.test(value) ? 'female' : 'male';
  const counts = (text, allowRefutations = false) => {
    const found = [];
    const refutes = index => {
      if (!allowRefutations) return false;
      const before = String(text).slice(0, index).split(/[.!?;\n]/).pop();
      const after = String(text).slice(index).split(/[.!?;\n]/)[0];
      return /\b(?:not (?:reported|stated|supported|confirmed)|(?:do|does|did) not (?:report|state|support|confirm)|(?:don't|doesn't|didn't) (?:report|state|support|confirm)|unsupported|unreported|unverified|incorrect|no evidence|cannot confirm)\b/i.test(before + after);
    };
    for (const m of String(text || '').matchAll(/\b(\d{1,7}(?:,\d{3})*)\s+(women|men|females?|males?)\b/gi)) if (!refutes(m.index)) found.push({ count: Number(m[1].replace(/,/g, '')), group: group(m[2]) });
    for (const m of String(text || '').matchAll(/\b(women|men|females?|males?)\s*[:=(]\s*(?:n\s*=\s*)?(\d{1,7})(?![\d.,%])\b/gi)) if (!refutes(m.index)) found.push({ count: Number(m[2]), group: group(m[1]) });
    return found;
  };
  const supplied = counts((passages || []).map(p => p.text || '').join('\n'));
  return counts(answer, true).filter(c => !supplied.some(s => s.count === c.count && s.group === c.group));
}

/** Include paper-help evidence even before a running summary has been generated. */
function distillPaperNotesText(state, markdown = false) {
  const out = [];
  const heading = text => markdown ? `## ${text}` : text;
  if (state?.overview?.text) {
    out.push(heading('AI overview — selected excerpts; verify against source'), state.overview.text, '');
  }
  for (const entry of (state?.askThread || []).filter(e => e?.a).slice(-5)) {
    out.push(heading('Question about the paper'), entry.q, entry.a);
    const cited = distillCitedPassages(entry.a, entry.passages);
    if (cited.length) {
      out.push('Supplied passages (provenance only; check claim support):');
      for (const p of cited) out.push(`${p.id} — ${p.heading}`, markdown ? `> ${p.text.replace(/\n/g, '\n> ')}` : p.text);
    } else out.push('No supplied passage citation available for this answer.');
    out.push('');
  }
  return out.join('\n').trim();
}

const DISTILL_SECTION_LINES = {
  intro: 'The question and why it matters.',
  methods: 'How they did it and what was measured.',
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
  module.exports = { distillUnsupportedDemographicCounts, distillPaperNotesText, distillPickPassages, distillCitedPassages, distillBulletKey, distillGroupBullets, distillPaperExcerpt, distillTrustFacts, distillParseLabelled, distillParseTerms, distillFindSection, distillMergeGlossary, distillPickSections, distillSectionMap, distillByline };
}
