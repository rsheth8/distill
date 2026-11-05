import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let distillPdfPaper;

beforeAll(() => {
  // In the extension these are globals from paperExtractor.js, loaded first.
  Object.assign(globalThis, require('../../extension/utils/paperExtractor.js'));
  ({ distillPdfPaper } = require('../../extension/utils/pdfPaper.js'));
});

const W = 600;
const H = 800;
// One text item; width ≈ half an em per character, like a proportional font.
const item = (x, y, str, { size = 10, font = 'body', rot = false } = {}) =>
  ({ str, x, y, w: str.length * size * 0.5, size, font, rot });
const words = (n, seed) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');

/** A column of body lines, 12pt apart, each ~40 chars wide (fits a 200pt column). */
const column = (x, y0, texts) => texts.map((t, i) => item(x, y0 + i * 12, t));

describe('distillPdfPaper', () => {
  it('reads a two-column page left column first, and finds numbered sections', () => {
    const left = column(50, 200, [
      'This is the first line of the intro with', 'more words to read in the left column',
      'and ends the left column here with text'
    ]);
    const right = column(320, 200, [
      'continuing on the right column with more', 'words until the final sentence ends here.'
    ]);
    const page = {
      width: W,
      height: H,
      items: [
        item(150, 80, 'A Paper About Columns', { size: 18 }),
        item(50, 180, '1 Introduction', { size: 12, font: 'bold' }),
        ...left, ...right,
        // a second heading in the right column
        item(320, 240, '2 Methods', { size: 12, font: 'bold' }),
        ...column(320, 256, [words(7, 'm'), words(7, 'n'), words(7, 'o'), words(7, 'p'), words(7, 'q')]),
        ...column(50, 400, [words(7, 'a'), words(7, 'b'), words(7, 'c'), words(7, 'd'), words(7, 'e'), words(7, 'f')]),
        ...column(320, 400, [words(7, 'g'), words(7, 'h'), words(7, 'i'), words(7, 'j'), words(7, 'k')])
      ]
    };
    const paper = distillPdfPaper([page], { url: 'https://example.org/p.pdf' });
    expect(paper.title).toBe('A Paper About Columns');
    expect(paper.source).toBe('pdf');
    expect(paper.date).toBe('');
    expect(paper.sections.map(s => [s.heading, s.kind])).toEqual([['Introduction', 'intro'], ['Methods', 'methods']]);
    const intro = paper.sections[0].text;
    expect(intro.startsWith('This is the first line of the intro')).toBe(true);
    expect(intro.indexOf('a0 a1')).toBeLessThan(intro.indexOf('continuing on the right'));
  });

  it('drops running footers, page numbers and line-number gutters; joins hyphenated words', () => {
    const page = n => ({
      width: W,
      height: H,
      items: [
        item(50, 790, 'Journal of Tests, vol. 3'),
        item(300, 790, String(n)),
        ...(n === 1 ? [item(50, 100, 'Results', { size: 12, font: 'bold' })] : []),
        ...Array.from({ length: 10 }, (_, i) => item(20, 120 + i * 12, String(n * 10 + i + 1))),
        ...column(50, 120, [
          `Page ${n} begins a paragraph that is split by a hy-`, 'phen across the line and keeps going on', 'for a while until it ends here.'
        ])
      ]
    });
    const paper = distillPdfPaper([page(1), page(2), page(3)]);
    const text = paper.sections[0].text;
    expect(paper.sections[0].heading).toBe('Results');
    expect(text).toContain('split by a hyphen across');
    expect(text).not.toMatch(/Journal of Tests|\b1[1-9]\b/);
  });

  it('pulls out captions and the abstract, skips references, reads arXiv IDs from the rotated stamp', () => {
    const page = {
      width: W,
      height: H,
      items: [
        item(10, 600, 'arXiv:2401.04088v1 [cs.LG] 8 Jan 2024', { rot: true }),
        item(150, 60, 'Short Title Here', { size: 18 }),
        item(50, 100, 'Abstract', { size: 12, font: 'bold' }),
        ...column(50, 116, ['We study a thing and find it works well', 'in every case we tried.']),
        item(50, 160, 'Introduction', { size: 12, font: 'bold' }),
        ...column(50, 176, [words(8, 'x'), words(8, 'y')]),
        item(50, 220, 'Figure 1: A small chart of results.', { size: 9 }),
        item(50, 260, 'References', { size: 12, font: 'bold' }),
        ...column(50, 276, ['[1] A. Person. Some cited work, 2020.'])
      ]
    };
    const paper = distillPdfPaper([page]);
    expect(paper.abstract).toBe('We study a thing and find it works well in every case we tried.');
    expect(paper.figures).toEqual([{ caption: 'Figure 1: A small chart of results.' }]);
    expect(paper.sections.map(s => s.heading)).toEqual(['Introduction']);
    expect(paper.doi).toBe('10.48550/arXiv.2401.04088');
    expect(paper.isPreprint).toBe(true);
  });
});
