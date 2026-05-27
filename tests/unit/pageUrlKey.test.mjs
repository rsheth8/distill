import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const { distillPageUrlKey } = require(
  join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/pageUrlKey.js')
);

describe('distillPageUrlKey', () => {
  it('returns origin path and search without hash', () => {
    expect(distillPageUrlKey('https://example.com/a/b?q=1#frag')).toBe('https://example.com/a/b?q=1');
  });

  it('returns empty for empty input', () => {
    expect(distillPageUrlKey('')).toBe('');
  });

  it('falls back to stripping hash on invalid URL', () => {
    expect(distillPageUrlKey('not-a-url#h')).toBe('not-a-url');
  });
});
