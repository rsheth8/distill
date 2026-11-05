import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const { distillExtractPaper, distillSectionKind, distillPaperText } = require(
  join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/paperExtractor.js')
);

const parse = html => new DOMParser().parseFromString(html, 'text/html');

// Trimmed copy of real arXiv HTML (LaTeXML) structure, e.g. arxiv.org/html/2310.06825.
const ARXIV_HTML = `<html><body><article class="ltx_document">
<h1 class="ltx_title ltx_title_document">Tiny&nbsp;Model </h1>
<div class="ltx_authors">
  <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Ada Lovelace<sup>1</sup>, Alan Turing and Grace Hopper<br class="ltx_break">Analytical Engine Lab</span></span>
  <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Emmy Noether
</span><span class="ltx_author_notes">Affiliation: Göttingen</span></span>
</div>
<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6><p class="ltx_p">We build a tiny model.</p></div>
<section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Introduction</h2>
  <div class="ltx_para"><p class="ltx_p">Models are big<span class="ltx_note ltx_role_footnote"><sup>1</sup>footnote text</span>.</p></div>
</section>
<section id="S2" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">2 </span>Architectural details</h2>
  <figure class="ltx_figure"><img src="a.png"><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 1: </span>Window of size <math alttext="W"><mi>W</mi></math>.</figcaption></figure>
  <div class="ltx_para"><p class="ltx_p">Each layer attends over <math alttext="W=3"><mi>W</mi><mo>=</mo><mn>3</mn></math> tokens.</p></div>
  <section id="S2.SS1" class="ltx_subsection"><h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag">2.1 </span>Cache</h3>
    <div class="ltx_para"><p class="ltx_p">A rolling cache.</p></div>
  </section>
</section>
<section id="S3" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">3 </span>Results</h2>
  <div class="ltx_para"><p class="ltx_p">It works.</p></div>
</section>
<section id="Sx1" class="ltx_section"><h2 class="ltx_title ltx_title_section">Acknowledgements</h2><div class="ltx_para"><p class="ltx_p">Thanks.</p></div></section>
<section id="bib" class="ltx_bibliography"><h2 class="ltx_title ltx_title_bibliography">References</h2><p class="ltx_p">[1] Someone.</p></section>
</article></body></html>`;

describe('distillExtractPaper — arXiv HTML', () => {
  const paper = distillExtractPaper(parse(ARXIV_HTML), 'https://arxiv.org/html/2310.06825v1');

  it('reads title, authors, ids and abstract', () => {
    expect(paper.source).toBe('arxiv');
    expect(paper.isPreprint).toBe(true);
    expect(paper.title).toBe('Tiny Model');
    expect(paper.authors).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Emmy Noether']);
    expect(paper.doi).toBe('10.48550/arXiv.2310.06825');
    expect(paper.pdfUrl).toBe('https://arxiv.org/pdf/2310.06825');
    expect(paper.abstract).toBe('We build a tiny model.');
  });

  it('splits sections, strips numbering, drops acknowledgements and references', () => {
    expect(paper.sections.map(s => [s.heading, s.kind])).toEqual([
      ['Introduction', 'intro'],
      ['Architectural details', 'methods'],
      ['Results', 'results']
    ]);
  });

  it('keeps math as LaTeX, folds in subsections, drops footnotes and figure text', () => {
    expect(paper.sections[0].text).toBe('Models are big.');
    expect(paper.sections[1].text).toBe('Each layer attends over $W=3$ tokens.\n\nCache\n\nA rolling cache.');
  });

  it('collects figure captions', () => {
    expect(paper.figures).toEqual([{ caption: 'Figure 1: Window of size $W$.' }]);
  });
});

describe('distillExtractPaper — citation meta tags', () => {
  const META_HTML = `<html><head>
    <meta name="citation_title" content="A Study of Things">
    <meta name="citation_author" content="Jane Doe">
    <meta name="citation_author" content="John Roe">
    <meta name="citation_doi" content="https://doi.org/10.1101/2024.01.01.123456">
    <meta name="citation_pdf_url" content="https://www.biorxiv.org/x.full.pdf">
    <meta name="citation_abstract" content="We studied things.">
  </head><body><p>Body</p></body></html>`;

  it('builds a paper from meta tags and flags preprint hosts', () => {
    const paper = distillExtractPaper(parse(META_HTML), 'https://www.biorxiv.org/content/10.1101/2024.01.01.123456v1');
    expect(paper).toMatchObject({
      source: 'biorxiv',
      isPreprint: true,
      title: 'A Study of Things',
      authors: ['Jane Doe', 'John Roe'],
      doi: '10.1101/2024.01.01.123456',
      pdfUrl: 'https://www.biorxiv.org/x.full.pdf',
      abstract: 'We studied things.'
    });
  });

  it('arXiv abstract pages give the abstract only, not the page\'s link menus', () => {
    const html = META_HTML.replace('<p>Body</p>', '<div class="extra-services"><h2>Access Paper:</h2><ul><li>View PDF</li></ul></div>');
    const paper = distillExtractPaper(parse(html), 'https://arxiv.org/abs/2310.06825');
    expect(paper).toMatchObject({ source: 'arxiv', isPreprint: true, abstract: 'We studied things.', sections: [], figures: [] });
  });

  it('is not a preprint on a journal host', () => {
    expect(distillExtractPaper(parse(META_HTML), 'https://www.nature.com/articles/x').isPreprint).toBe(false);
  });

  it('returns null for a page that is not a paper', () => {
    expect(distillExtractPaper(parse('<html><body><h1>Blog</h1><p>Hi</p></body></html>'), 'https://example.com/post')).toBeNull();
  });
});

const META_HEAD = `<head><meta name="citation_title" content="Paper"><meta name="citation_author" content="A. Author"></head>`;

describe('distillExtractPaper — journal bodies', () => {
  it('PubMed Central: walks the article body, labels figures from their heading', () => {
    const html = `<html>${META_HEAD}<body>
      <section class="front-matter"><h3>A. Author</h3></section>
      <section class="body main-article-body">
        <section class="abstract"><h2>Abstract</h2><p>We found a virus.</p></section>
        <section><h2>Main</h2><p>Story.</p>
          <figure><h3>Fig. 1. Genome.</h3><figcaption><p>a, Reads.</p></figcaption></figure>
        </section>
        <section><h2>Methods</h2><h3>Sampling</h3><p>Bats were sampled.</p></section>
        <section><h2>Competing interests</h2><p>None declared.</p></section>
        <section><h2>Footnotes</h2><p>Note.</p></section>
        <section class="ref-list"><h2>References</h2><ul><li>Ref one.</li></ul></section>
      </section></body></html>`;
    const paper = distillExtractPaper(parse(html), 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/');
    expect(paper.source).toBe('pmc');
    expect(paper.isPreprint).toBe(false);
    expect(paper.abstract).toBe('We found a virus.');
    expect(paper.sections).toEqual([
      { heading: 'Main', kind: 'other', text: 'Story.' },
      { heading: 'Methods', kind: 'methods', text: 'Sampling\n\nBats were sampled.' },
      { heading: 'Competing interests', kind: 'other', text: 'None declared.' }
    ]);
    expect(paper.figures).toEqual([{ caption: 'Fig. 1. Genome. a, Reads.' }]);
  });

  it('bioRxiv: h4 subsections fold in, fig-caption boxes become figures', () => {
    const html = `<html>${META_HEAD}<body><div class="article fulltext-view">
      <div class="section abstract"><h2>Abstract</h2><p>Short.</p></div>
      <div class="section"><h2>Results</h2><h4>Part one</h4><p>Found it.</p>
        <div class="fig"><div class="fig-caption"><p>Fig. 1. Tree.</p></div></div></div>
      <div class="section ack"><h2>ACKNOWLEDGMENTS</h2><p>Thanks.</p></div>
    </div><h2>Citation Manager Formats</h2></body></html>`;
    const paper = distillExtractPaper(parse(html), 'https://www.medrxiv.org/content/10.1101/x.full');
    expect(paper.source).toBe('biorxiv');
    expect(paper.isPreprint).toBe(true);
    expect(paper.sections).toEqual([{ heading: 'Results', kind: 'results', text: 'Part one\n\nFound it.' }]);
    expect(paper.figures).toEqual([{ caption: 'Fig. 1. Tree.' }]);
  });

  it('generic journal (PLOS-like): picks .article-body, skips the figures carousel and nav', () => {
    const html = `<html>${META_HEAD}<body><nav><h2>Menu</h2><p>Home</p></nav>
      <article><div class="article-body">
        <h2>Figures</h2><div class="figure"><p class="figcaption">Fig 1. Curve.</p></div>
        <h2>Abstract</h2><p>Model of spread.</p>
        <h2>1. Introduction</h2><p>Outbreak.</p><ul><li>Point one</li></ul>
        <h2>Conclusion</h2><p>Act early.</p>
      </div></article></body></html>`;
    const paper = distillExtractPaper(parse(html), 'https://journals.plos.org/plosone/article?id=1');
    expect(paper.source).toBe('generic');
    expect(paper.abstract).toBe('Model of spread.');
    expect(paper.sections.map(s => [s.heading, s.kind, s.text])).toEqual([
      ['Introduction', 'intro', 'Outbreak.\n\nPoint one'],
      ['Conclusion', 'discussion', 'Act early.']
    ]);
    expect(paper.figures).toEqual([{ caption: 'Fig 1. Curve.' }]);
  });
});

describe('distillSectionKind', () => {
  it.each([
    ['Introduction', 'intro'],
    ['Background', 'intro'],
    ['Materials and Methods', 'methods'],
    ['Experimental Setup', 'methods'],
    ['Results', 'results'],
    ['Experiments', 'results'],
    ['Discussion', 'discussion'],
    ['Conclusions and Future Work', 'discussion'],
    ['Limitations', 'discussion'],
    ['Concluding remarks', 'discussion'],
    ['Main', 'other'],
    ['Related Work', 'other']
  ])('%s → %s', (heading, kind) => {
    expect(distillSectionKind(heading)).toBe(kind);
  });
});

describe('distillPaperText', () => {
  it('flattens title, abstract and sections into paragraph-separated text', () => {
    const paper = distillExtractPaper(parse(ARXIV_HTML), 'https://arxiv.org/html/2310.06825v1');
    expect(distillPaperText(paper).split('\n\n').slice(0, 6)).toEqual([
      'Tiny Model', 'Abstract', 'We build a tiny model.', 'Introduction', 'Models are big.', 'Architectural details'
    ]);
  });

  it('skips a missing abstract', () => {
    expect(distillPaperText({ title: 'T', abstract: '', sections: [{ heading: 'H', text: 'x' }] })).toBe('T\n\nH\n\nx');
  });
});

describe('paper date', () => {
  const page = meta => parse(`<html><head><meta name="citation_title" content="T">${meta}</head>
    <body><article><h2>Introduction</h2><p>${'word '.repeat(80)}</p></article></body></html>`);
  it('reads citation_publication_date, then citation_date, then citation_online_date', () => {
    expect(distillExtractPaper(page('<meta name="citation_publication_date" content="2021/03/04 extra">'), 'https://journal.test/a').date).toBe('2021/03/04');
    expect(distillExtractPaper(page('<meta name="citation_date" content="2020-01-02">'), 'https://journal.test/a').date).toBe('2020-01-02');
    expect(distillExtractPaper(page('<meta name="citation_online_date" content="2019">'), 'https://journal.test/a').date).toBe('2019');
  });
  it('is empty when unknown', () => {
    expect(distillExtractPaper(page(''), 'https://journal.test/a').date).toBe('');
  });
  it('strips doi: and doi.org URL prefixes from citation_doi', () => {
    for (const v of ['doi:10.1/x', 'https://dx.doi.org/10.1/x']) {
      expect(distillExtractPaper(page(`<meta name="citation_doi" content="${v}">`), 'https://journal.test/a').doi).toBe('10.1/x');
    }
  });
});
