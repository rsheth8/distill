import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const {
  distillNormalizeSelection,
  distillFindCachedHighlight,
  distillExplainContentHash
} = require(join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/aiResultCache.js'));

describe('aiResultCache', () => {
  it('normalizes selection whitespace', () => {
    expect(distillNormalizeSelection('  hello   world  ')).toBe('hello world');
  });

  it('finds cached highlight by normalized selection', () => {
    const history = [
      { id: '1', selection: 'foo\nbar', analysis: 'insight', note: '' },
      { id: '2', selection: 'other', analysis: '', note: '' }
    ];
    const hit = distillFindCachedHighlight(history, 'foo bar');
    expect(hit?.id).toBe('1');
    expect(hit?.analysis).toBe('insight');
  });

  it('explain content hash is stable for same input', () => {
    const a = distillExplainContentHash('same page text');
    const b = distillExplainContentHash('same page text');
    expect(a).toBe(b);
  });
});
