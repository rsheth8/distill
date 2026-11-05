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
    expect(texts(p)).toEqual(['Preprint source — review status unverified', 'First posted: Oct 2023', '1 author', 'DOI 10.48550/arXiv.2310.06825']);
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

describe('term and heading edge cases', () => {
  it('keeps inner underscores, strips edge markers', () => {
    expect(help.distillParseTerms('- **k_means** — clustering\n- `p-value` — chance').map(t => t.term)).toEqual(['k_means', 'p-value']);
  });
  it('matches headings the content script cut to 120 chars', () => {
    const long = 'H'.repeat(150);
    expect(help.distillFindSection({ sections: [{ heading: long, kind: '', text: 'x' }] }, long.slice(0, 120))?.text).toBe('x');
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

describe('distillPickSections', () => {
  const p = {
    abstract: 'We study sleep in mice.',
    sections: [
      { heading: 'Methods', kind: 'methods', text: 'Mice slept in cages.\n\nWe measured heart rate.' },
      { heading: 'Results', kind: 'results', text: 'Sleep improved memory.\n\nHeart rate fell during sleep.' },
      { heading: 'Funding', kind: '', text: 'Paid by a grant.' }
    ]
  };
  it('keeps relevant paragraphs, in paper order, grouped by section', () => {
    expect(help.distillPickSections(p, 'What happened to heart rate?')).toEqual([
      { heading: 'Methods', text: 'We measured heart rate.' },
      { heading: 'Results', text: 'Heart rate fell during sleep.' }
    ]);
  });
  it('heading words count, stopwords do not', () => {
    expect(help.distillPickSections(p, 'who paid the funding')[0].heading).toBe('Funding');
    expect(help.distillPickSections(p, 'what was the')).toEqual(help.distillPickSections(p, ''));
  });
  it('with no match, falls back to the opening paragraphs within the budget', () => {
    const r = help.distillPickSections(p, "What's the main takeaway?", 60);
    expect(r[0]).toEqual({ heading: 'Abstract', text: 'We study sleep in mice.' });
    expect(r.map(x => x.text).join('').length).toBeLessThanOrEqual(60);
  });
  it('respects the budget and never returns nothing for a non-empty paper', () => {
    const big = { abstract: 'heart '.repeat(2000), sections: [] };
    const r = help.distillPickSections(big, 'heart', 500);
    expect(r[0].text.length).toBeLessThanOrEqual(500);
    expect(help.distillPickSections({}, 'heart')).toEqual([]);
  });
});

describe('distillPickSections budget', () => {
  it('cuts an oversized best match down to the room left instead of skipping it', () => {
    const paper = { sections: [
      { heading: 'Results', text: 'heart '.repeat(1000).trim() }, // 6,000-ish chars, the best match
      { heading: 'Other', text: 'heart is mentioned once here, a weak match.' }
    ] };
    const r = help.distillPickSections(paper, 'heart heart', 5000);
    expect(r[0].heading).toBe('Results');
    expect(r[0].text.length).toBeGreaterThan(4000);
    expect(r.map(x => x.text).join('').length).toBeLessThanOrEqual(5000);
  });
});

describe('distillSectionMap', () => {
  const secs = [
    { heading: 'Introduction', kind: 'intro', chars: 1000 },
    { heading: 'Methods', kind: 'methods', chars: 4000 },
    { heading: 'Results', kind: 'results', chars: 0 },
    { heading: 'Related work', kind: 'other', chars: 2000 }
  ];
  it('marks sections before the current one read, the current one current, the rest ahead', () => {
    expect(help.distillSectionMap(secs, 'methods').map(s => s.state)).toEqual(['read', 'current', 'ahead', 'ahead']);
  });
  it('scales width into 0.5–2 by length', () => {
    const m = help.distillSectionMap(secs, '');
    expect(m[1].flex).toBe(2);
    expect(m[2].flex).toBe(0.5);
    expect(m[0].flex).toBeCloseTo(0.88, 2);
  });
  it('gives each known kind a plain line and other kinds none', () => {
    const m = help.distillSectionMap(secs, '');
    expect(m[1].line).toBe('How they did it and what was measured.');
    expect(m[3].line).toBe('');
  });
  it('treats an unknown current heading as all ahead', () => {
    expect(help.distillSectionMap(secs, 'Appendix').every(s => s.state === 'ahead')).toBe(true);
  });
  it('survives empty and malformed input', () => {
    expect(help.distillSectionMap(null, 'x')).toEqual([]);
    expect(help.distillSectionMap([null, { kind: 'intro' }], 'x')).toEqual([]);
  });
});

describe('distillByline', () => {
  const by = (authors, source) => help.distillByline({ authors, source });

  it('names one author, two authors, or the first of three or more', () => {
    expect(by([], 'generic')).toBe('');
    expect(by(['Ada Lovelace'], 'generic')).toBe('Ada Lovelace');
    expect(by(['A', 'B'], 'generic')).toBe('A and B');
    expect(by(['A', 'B', 'C'], 'generic')).toBe('A et al.');
    expect(by(['A', 'B', 'C', 'D'], 'generic')).toBe('A et al.');
  });

  it('names the known sources and joins with a middle dot', () => {
    expect(by(['A'], 'arxiv')).toBe('A · arXiv');
    expect(by(['A', 'B'], 'pmc')).toBe('A and B · PubMed Central');
    expect(by(['A', 'B', 'C'], 'biorxiv')).toBe('A et al. · bioRxiv');
    expect(by([], 'arxiv')).toBe('arXiv');
  });

  it('says nothing for generic, pdf or unknown sources', () => {
    expect(by(['A'], 'pdf')).toBe('A');
    expect(by([], 'pdf')).toBe('');
    expect(by([], 'nature')).toBe('');
    expect(by([], undefined)).toBe('');
  });

  it('survives a missing paper or missing authors', () => {
    expect(help.distillByline(null)).toBe('');
    expect(help.distillByline({ source: 'arxiv' })).toBe('arXiv');
  });
});

describe('distillGroupBullets', () => {
  const tags = { [help.distillBulletKey('B in methods')]: 'Methods', [help.distillBulletKey('A in intro')]: 'Introduction' };
  it('groups bullets under their sections in paper order, untagged first', () => {
    expect(help.distillGroupBullets(['B in methods', 'Old one', 'A in intro'], tags, ['Introduction', 'Methods'])).toEqual([
      { heading: '', bullets: ['Old one'] },
      { heading: 'Introduction', bullets: ['A in intro'] },
      { heading: 'Methods', bullets: ['B in methods'] }
    ]);
  });
  it('puts sections missing from the order after the known ones', () => {
    const g = help.distillGroupBullets(['x'], { [help.distillBulletKey('x')]: 'Appendix' }, ['Introduction']);
    expect(g).toEqual([{ heading: 'Appendix', bullets: ['x'] }]);
  });
  it('keys ignore case, spacing and a leading bullet mark', () => {
    expect(help.distillBulletKey('•  Hello   World ')).toBe(help.distillBulletKey('hello world'));
  });
  it('survives bad input', () => {
    expect(help.distillGroupBullets(null, null, null)).toEqual([]);
  });
});


describe('passage grounding and long-document retrieval', () => {
  it('finds evidence at the end of a long paragraph without repeated words crowding it out', () => {
    const p = { sections: [
      { heading: 'Introduction', text: 'sample '.repeat(3000) },
      { heading: 'Methods', text: 'filler '.repeat(2000) + 'The randomized population contained 412 adults.' }
    ] };
    const picked = help.distillPickPassages(p, 'randomized population adults', 2000);
    expect(picked.some(x => x.text.includes('412 adults'))).toBe(true);
    expect(picked.map(x => x.text).join('').length).toBeLessThan(2000);
    expect(new Set(picked.map(x => x.id)).size).toBe(picked.length);
  });
  it('never turns invented IDs or section names into supplied-source controls', () => {
    const supplied = [{ id: 'S2P3', heading: 'Results', text: 'Evidence.' }];
    expect(help.distillCitedPassages('Claim [S2P3]. FROM: S9P9, Results', supplied)).toEqual(supplied);
    expect(help.distillCitedPassages('FROM: S9P9', supplied)).toEqual([]);
    expect(help.distillCitedPassages('FROM: Results', undefined)).toEqual([]);
  });
});

describe('overview context allocation', () => {
  it('includes an ending caveat from a long discussion instead of only its opening', () => {
    const p=paper({sections:[
      {heading:'Introduction',kind:'intro',text:'Question.'},
      {heading:'Discussion',kind:'discussion',text:'Context. '.repeat(2000)+'Important caveat: this observational study cannot establish causation.'}
    ]});
    const excerpt=help.distillPaperExcerpt(p);
    expect(excerpt).toContain('cannot establish causation');
    expect(excerpt).toContain('Middle of section omitted');
    expect(excerpt.length).toBeLessThanOrEqual(7000);
  });
});

describe('first useful reading-note export',()=>{
  it('includes overview/caveats and supplied Ask evidence without requiring progressive reading',()=>{
    const s={lastSummary:'',overview:{text:'FOUND: Association.\nLIMITS: Cannot establish causation.'},askThread:[{q:'Sample?',a:'42 adults [S2P0]. FROM: S2P0, S99P99',passages:[{id:'S2P0',heading:'Methods',text:'The sample included 42 adults.'}]}]};
    for(const markdown of [true,false]){
      const notes=help.distillPaperNotesText(s,markdown);
      expect(notes).toContain('Cannot establish causation');
      expect(notes).toContain('The sample included 42 adults.');
      expect(notes).toContain('S2P0 — Methods');
      expect(notes).not.toContain('S99P99 —');
    }
  });
});

describe('background population versus study sample evidence',()=>{
 it('includes the recruitment passage when answering a generic result question',()=>{
  const paper={abstract:'Over 500 million people use the platform. '+ 'The result is an association. '.repeat(100),sections:[
    {heading:'Methods',kind:'methods',text:'Participants\n\nEighty-two people were recruited for a study. Mean age was 19.52 years.'},
    {heading:'Results',kind:'results',text:'The result was an association, not a randomized effect.'}
  ]};
  const passages=help.distillPickPassages(paper,'What is the key result, including units and uncertainty?',2000);
  expect(passages.some(p=>p.text.includes('Eighty-two people were recruited'))).toBe(true);
 });
});

describe('design reservation is bounded',()=>{
 it('keeps result evidence when many methods paragraphs mention randomization',()=>{
  const paper={sections:[
   {heading:'Methods',kind:'methods',text:Array.from({length:8},(_,i)=>`We randomized group ${i}. `+'Protocol details. '.repeat(60)).join('\n\n')},
   {heading:'Results',kind:'results',text:'The result was 12 mg (95% CI 10–14 mg).'}
  ]};
  const picked=help.distillPickPassages(paper,'What is the key result?',2200);
  expect(picked.some(p=>p.text.includes('12 mg'))).toBe(true);
 });
});

describe('unreported demographic complements',()=>{
 it('flags a fabricated male count despite valid source IDs',()=>{
   const passages=[{id:'S2P1',text:'Eighty-two people were recruited, including 53 females.'}];
   expect(help.distillUnsupportedDemographicCounts('82 people, 53 females and 49 males [S2P1].',passages)).toEqual([{count:49,group:'male'}]);
   expect(help.distillUnsupportedDemographicCounts('82 people, including 53 women [S2P1].',passages)).toEqual([]);
 });
});

describe('checking unsupported count claims',()=>{
 it('allows a supported abstention/refutation instead of blocking a claim-checking task',()=>{
  const p=[{text:'82 people, including 53 females.'}];
  expect(help.distillUnsupportedDemographicCounts('The supplied text does not report 49 males. That count is unsupported.',p)).toEqual([]);
  expect(help.distillUnsupportedDemographicCounts('The sample included 49 males.',p)).toEqual([{count:49,group:'male'}]);
 });
});

describe('design questions retain enrollment rather than irrelevant analysis exclusions',()=>{
 it('does not crowd a design/population answer with subgroup moderation exclusions',()=>{
  const paper={abstract:'An observational study of well-being.',sections:[
   {heading:'Methods',kind:'methods',text:'Eighty-two people were recruited for this study. Participants completed surveys.'},
   {heading:'Results',kind:'results',text:'Data from one person were excluded only from the BDI moderation analysis.'}
  ]};
  const picked=help.distillPickPassages(paper,'What is the study design and population or data?');
  expect(picked.some(p=>p.text.includes('Eighty-two'))).toBe(true);
  expect(picked.some(p=>p.text.includes('moderation analysis'))).toBe(false);
  expect(help.distillPickPassages(paper,'What data were excluded from the moderation analysis?').some(p=>p.text.includes('moderation analysis'))).toBe(true);
 });
});

describe('demographic proportions are not literal head counts',()=>{
 it('does not misread a decimal percentage after a group label as a count',()=>{
  expect(help.distillUnsupportedDemographicCounts('Women (60.5%) were represented.',[])).toEqual([]);
 });
});
