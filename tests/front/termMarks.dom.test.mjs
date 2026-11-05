import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { distillMarkTerms, distillUnmarkTerms } = require('../../extension/utils/termMarks.js');

const dom = html => new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
const T = [{ term: 'attention', definition: 'weighing words' }];

describe('distillMarkTerms', () => {
  it('wraps the first whole-word, case-insensitive match in each element', () => {
    const root = dom('<p>Attention is all. More attention.</p><p>No match: attentions.</p>');
    expect(distillMarkTerms([...root.querySelectorAll('p')], T)).toBe(1);
    const mark = root.querySelector('.distill-term');
    expect(mark.textContent).toBe('Attention');
    expect(mark.dataset.term).toBe('attention');
    expect(mark.dataset.definition).toBe('weighing words');
    expect(mark.tabIndex).toBe(0);
    expect(root.querySelectorAll('.distill-term').length).toBe(1);
  });
  it('marks longer terms first and ignores malformed entries', () => {
    const root = dom('<p>Only self-attention here.</p>');
    expect(distillMarkTerms([root.firstElementChild], [T[0], null, { term: 7 }, { term: 'self-attention', definition: 'd' }])).toBe(1);
    expect(root.querySelector('.distill-term').textContent).toBe('self-attention');
  });
  it('skips links, code and math', () => {
    const root = dom('<p><a href="#">attention</a> <code>attention</code> then attention</p>');
    distillMarkTerms([root.querySelector('p')], T);
    const mark = root.querySelector('.distill-term');
    expect(mark.parentElement.tagName).toBe('P');
    expect(root.querySelector('a').textContent).toBe('attention');
  });
  it('is idempotent and treats the term as text, not a pattern', () => {
    const root = dom('<p>attention and attention</p><p>cost (USD) here</p>');
    const ps = [...root.querySelectorAll('p')];
    distillMarkTerms(ps, T);
    expect(distillMarkTerms(ps, T)).toBe(0);
    expect(root.querySelectorAll('.distill-term').length).toBe(1);
    expect(distillMarkTerms(ps, [{ term: 'cost (USD)', definition: 'd' }])).toBe(1);
  });
  it('unmark restores the original text as one text node', () => {
    const root = dom('<p>Some attention here.</p>');
    distillMarkTerms([root.querySelector('p')], T);
    distillUnmarkTerms(root);
    expect(root.querySelector('.distill-term')).toBeNull();
    expect(root.querySelector('p').textContent).toBe('Some attention here.');
    expect(root.querySelector('p').childNodes.length).toBe(1);
  });
});
