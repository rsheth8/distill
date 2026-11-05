import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const { distillBuildPrompt } = require('../../extension/utils/prompts.js');
const text = p => p.blocks.join('\n\n');

describe('distillBuildPrompt', () => {
  const tasks = {
    now: [{ recent: 'R' }, { paragraph: 'PARA' }, ['PARA', 'R']],
    summary: [{ title: 'T', opener: 'ABS', readCount: 2 }, { readSoFar: 'READ' }, ['T', 'ABS', 'READ', 'The gist']],
    quiz_question: [{ recent: 'R' }, {}, ['R', 'ONE short question']],
    quiz_feedback: [{ recent: 'R' }, { question: 'Q?', answer: 'A' }, ['R', 'Q?', '"A"']],
    quiz_skipped_review: [{ recent: 'R' }, { question: 'Q?' }, ['R', 'Q?', 'model answer']],
    analysis: [{ title: 'T', opener: 'ABS', priorGist: 'G', recent: 'R' }, { selection: 'SEL' }, ['T', 'ABS', 'G', 'R', '"SEL"']],
    overview: [{ title: 'T' }, { excerpt: 'EXC' }, ['T', 'EXC', 'ASKED:', 'DID:', 'FOUND:', 'WHY:', 'STUDY:', 'LIMITS:']],
    section_guide: [{ title: 'T', section: { heading: 'Methods', kind: 'methods' } }, { sectionText: 'SEC' }, ['T', '"Methods"', 'SEC', 'TERMS:', 'up to 12']],
  };

  for (const [task, [context, input, wanted]] of Object.entries(tasks)) {
    it(`${task}: plain-language system prompt and every input in the message`, () => {
      const p = distillBuildPrompt(task, context, input);
      expect(p.system).toMatch(/no academic background/);
      for (const w of wanted) expect(text(p)).toContain(w);
    });
  }

  it('overview trims the excerpt to 7,000 chars', () => {
    expect(text(distillBuildPrompt('overview', {}, { excerpt: 'x'.repeat(20000) })).length).toBeLessThan(8000);
  });

  it('section_guide trims the section to 6,000 chars', () => {
    expect(text(distillBuildPrompt('section_guide', {}, { sectionText: 'x'.repeat(20000) })).length).toBeLessThan(7000);
  });

  it('explain_page is gone (the overview replaces it)', () => {
    expect(() => distillBuildPrompt('explain_page', {}, { pageText: 'x' })).toThrow(/explain_page/);
  });

  it('continues an existing summary with only the fresh text', () => {
    const t = text(distillBuildPrompt('summary', { prevSummary: 'OLD' }, { readSoFar: 'ALL', freshRead: 'NEW' }));
    expect(t).toContain('OLD');
    expect(t).toContain('NEW');
    expect(t).not.toContain('ALL');
  });

  it('names the section and adds a hint for its kind', () => {
    const t = text(distillBuildPrompt('now', { section: { heading: 'Methods', kind: 'methods' } }, { paragraph: 'p' }));
    expect(t).toContain('"Methods"');
    expect(t).toMatch(/what the researchers did/);
    expect(text(distillBuildPrompt('now', {}, { paragraph: 'p' }))).not.toContain('section');
  });

  it('trims oversized or non-string input from the network', () => {
    const p = distillBuildPrompt('analysis', { title: { x: 1 }, recent: 'r'.repeat(9000) }, { selection: 's'.repeat(5000) });
    expect(text(p)).toContain('(untitled)');
    expect(text(p).length).toBeLessThan(6000);
  });

  it('reading level swaps one sentence of the persona', () => {
    const sys = level => distillBuildPrompt('now', { level }, { paragraph: 'p' }).system;
    expect(sys('simple')).toMatch(/no technical terms at all/);
    expect(sys('close')).toMatch(/define each one the first time/);
    expect(sys('everyday')).toMatch(/explain it in a few words/);
    expect(sys(undefined)).toBe(sys('everyday'));
    expect(sys('nonsense')).toBe(sys('everyday'));
    expect(sys('constructor')).toBe(sys('everyday'));
    expect(sys('__proto__')).toBe(sys('everyday'));
    for (const level of ['simple', 'everyday', 'close']) expect(sys(level)).toMatch(/never invent findings/);
  });

  it('throws for a task with no prompt', () => {
    expect(() => distillBuildPrompt('nope')).toThrow(/nope/);
  });

  it('backend copy matches (run `npm run sync:prompts`)', () => {
    const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
    expect(read('../../backend/lib/prompts.js')).toBe(read('../../extension/utils/prompts.js'));
  });
});
