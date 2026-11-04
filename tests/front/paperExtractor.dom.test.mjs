import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const { distillExtractPaper, distillSectionKind } = require(
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
    <meta name="citation_doi" content="doi:10.1101/2024.01.01.123456">
    <meta name="citation_pdf_url" content="https://www.biorxiv.org/x.full.pdf">
    <meta name="citation_abstract" content="We studied things.">
  </head><body><p>Body</p></body></html>`;

  it('builds a paper from meta tags and flags preprint hosts', () => {
    const paper = distillExtractPaper(parse(META_HTML), 'https://www.biorxiv.org/content/10.1101/2024.01.01.123456v1');
    expect(paper).toMatchObject({
      source: 'generic',
      isPreprint: true,
      title: 'A Study of Things',
      authors: ['Jane Doe', 'John Roe'],
      doi: '10.1101/2024.01.01.123456',
      pdfUrl: 'https://www.biorxiv.org/x.full.pdf',
      abstract: 'We studied things.'
    });
  });

  it('is not a preprint on a journal host', () => {
    expect(distillExtractPaper(parse(META_HTML), 'https://www.nature.com/articles/x').isPreprint).toBe(false);
  });

  it('returns null for a page that is not a paper', () => {
    expect(distillExtractPaper(parse('<html><body><h1>Blog</h1><p>Hi</p></body></html>'), 'https://example.com/post')).toBeNull();
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
    ['Related Work', 'other']
  ])('%s → %s', (heading, kind) => {
    expect(distillSectionKind(heading)).toBe(kind);
  });
});
