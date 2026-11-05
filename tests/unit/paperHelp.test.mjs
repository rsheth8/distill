import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const help = require('../../extension/utils/paperHelp.js');

const paper = (over = {}) => ({
  title: 'T', authors: ['A', 'B', 'C'], doi: '10.1000/x', source: 'nature', isPreprint: false, date: '2021-03-04',
  abstract: 'ABS '.repeat(10).trim(),
  sections: [
    { heading: 'Introduction', kind: 'intro', text: 'INTRO '.repeat(400) },
    { heading: 'Related work', kind: '', text: 'REL' },
    { heading: 'Methods', kind: 'methods', text: 'METH' },
    { heading: 'Results', kind: 'results', text: 'RES' },
    { heading: 'Discussion', kind: 'discussion', text: 'DISC' }
  ],
  figures: [],
  ...over
});

describe('distillPaperExcerpt', () => {
  it('abstract then the first intro/methods/results/discussion, headed, within budget', () => {
    const x = help.distillPaperExcerpt(paper());
    expect(x.startsWith('Abstract\nABS')).toBe(true);
    for (const h of ['Introduction', 'Methods\nMETH', 'Results\nRES', 'Discussion\nDISC']) expect(x).toContain(h);
    expect(x).not.toContain('Related work');
    expect(x.length).toBeLessThanOrEqual(7000);
    expect(x.indexOf('Methods')).toBeLessThan(x.indexOf('Results'));
  });
  it('caps each section at 1,200 chars and the whole at maxChars', () => {
    expect(help.distillPaperExcerpt(paper()).match(/INTRO/g).length).toBeLessThanOrEqual(200);
    expect(help.distillPaperExcerpt(paper(), 500).length).toBe(500);
  });
  it('falls back to the first sections when kinds are missing', () => {
    const p = paper({ sections: [{ heading: 'One', kind: '', text: '1' }, { heading: 'Two', kind: '', text: '2' }] });
    expect(help.distillPaperExcerpt(p)).toContain('One\n1');
    expect(help.distillPaperExcerpt(p)).toContain('Two\n2');
  });
  it('survives an empty paper', () => {
    expect(help.distillPaperExcerpt({})).toBe('');
  });
});

describe('distillTrustFacts', () => {
  const texts = p => help.distillTrustFacts(p).map(f => f.text);
  it('journal article with date, authors and a DOI link', () => {
    const facts = help.distillTrustFacts(paper());
    expect(texts(paper())).toEqual(['Journal article', 'Mar 2021', '3 authors', 'DOI 10.1000/x']);
    expect(facts[3].href).toBe('https://doi.org/10.1000/x');
    expect(help.distillTrustFacts(paper({ doi: '10.1002/(SICI)1#2?3' })).at(-1).href).toBe('https://doi.org/10.1002/(SICI)1%232%3F3');
  });
  it('preprint, arXiv date from the DOI, one author', () => {
    const p = paper({ isPreprint: true, source: 'arxiv', doi: '10.48550/arXiv.2310.06825', date: '', authors: ['A'] });
    expect(texts(p)).toEqual(['Preprint — not yet peer-reviewed', 'Oct 2023', '1 author', 'DOI 10.48550/arXiv.2310.06825']);
  });
  it('PDF without a preprint signal, year-only date, no authors or DOI', () => {
    expect(texts(paper({ source: 'pdf', date: '2019', authors: [], doi: '' }))).toEqual(['Publication status unknown', '2019']);
  });
  it('missing or bad date is left out', () => {
    expect(texts(paper({ date: '' }))).not.toContain('');
    expect(texts(paper({ date: 'soon' })).length).toBe(3);
  });
});

describe('distillParseLabelled', () => {
  const L = ['ASKED', 'DID', 'FOUND', 'WHY', 'STUDY', 'LIMITS'];
  it('splits every label and keeps the text before the first as lead', () => {
    const r = help.distillParseLabelled('Intro line\nASKED: q\nDID: d\nFOUND: f\nWHY: w\nSTUDY: s\nLIMITS:\n- one\n- two', L);
    expect(r).toEqual({ lead: 'Intro line', ASKED: 'q', DID: 'd', FOUND: 'f', WHY: 'w', STUDY: 's', LIMITS: '- one\n- two' });
  });
  it('tolerates case, bold markers and missing labels', () => {
    const r = help.distillParseLabelled('**Asked:** q\n**FOUND**: f', L);
    expect(r.ASKED).toBe('q');
    expect(r.FOUND).toBe('f');
    expect('DID' in r).toBe(false);
  });
  it('is safe on a partial stream', () => {
    expect(help.distillParseLabelled('ASKED: half a sen', L)).toEqual({ lead: '', ASKED: 'half a sen' });
    expect(help.distillParseLabelled('', L)).toEqual({ lead: '' });
  });
  it('only matches labels at the start of a line', () => {
    expect(help.distillParseLabelled('They found: nothing', ['FOUND'])).toEqual({ lead: 'They found: nothing' });
  });
  it('lead is the whole text when no label appears', () => {
    expect(help.distillParseLabelled('Just a guide.\nTwo lines.', ['TERMS']).lead).toBe('Just a guide.\nTwo lines.');
  });
});

describe('distillParseTerms', () => {
  it('reads em dash, en dash, spaced hyphen and colon lines; strips list markers and bold', () => {
    const block = '- **attention** — a way to weigh words\n2. p-value: chance of a fluke\n• baseline – the thing compared against\nself-attention - attention within one sentence';
    expect(help.distillParseTerms(block)).toEqual([
      { term: 'attention', definition: 'a way to weigh words' },
      { term: 'p-value', definition: 'chance of a fluke' },
      { term: 'baseline', definition: 'the thing compared against' },
      { term: 'self-attention', definition: 'attention within one sentence' }
    ]);
  });
  it('keeps a leading number that is part of the term', () => {
    expect(help.distillParseTerms('3D printing — building objects layer by layer')[0].term).toBe('3D printing');
  });
  it('skips lines without a definition, terms over 60 chars, and stops at 12', () => {
    expect(help.distillParseTerms('no separator here\n' + 'x'.repeat(61) + ' — too long')).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `t${i} — d`).join('\n');
    expect(help.distillParseTerms(many).length).toBe(12);
    expect(help.distillParseTerms(undefined)).toEqual([]);
  });
});

describe('distillFindSection', () => {
  it('finds by heading, ignoring case and spaces; Abstract maps to the abstract', () => {
    expect(help.distillFindSection(paper(), '  methods ')).toEqual({ heading: 'Methods', kind: 'methods', text: 'METH' });
    expect(help.distillFindSection(paper(), 'Abstract').text).toBe(paper().abstract);
    expect(help.distillFindSection(paper(), 'Figure 2')).toBeNull();
    expect(help.distillFindSection(paper(), '')).toBeNull();
    expect(help.distillFindSection(null, 'Methods')).toBeNull();
  });
});

describe('distillMergeGlossary', () => {
  it('adds new terms with their section, keeps the first definition, caps the list', () => {
    let g = help.distillMergeGlossary([], [{ term: 'Attention', definition: 'first' }], 'Intro');
    g = help.distillMergeGlossary(g, [{ term: 'attention', definition: 'second' }, { term: 'loss', definition: 'error' }], 'Methods');
    expect(g).toEqual([
      { term: 'Attention', definition: 'first', section: 'Intro' },
      { term: 'loss', definition: 'error', section: 'Methods' }
    ]);
    const full = Array.from({ length: 150 }, (_, i) => ({ term: `t${i}`, definition: 'd', section: 's' }));
    expect(help.distillMergeGlossary(full, [{ term: 'new', definition: 'd' }], 's').length).toBe(150);
  });
});
