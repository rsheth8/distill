import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const { distillHexToRgb, distillApplyAccentCssVars } = require(
  join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/accentColor.js')
);

describe('accentColor (browser-like DOM)', () => {
  it('parses six-digit hex', () => {
    expect(distillHexToRgb('#2563eb')).toEqual([37, 99, 235]);
  });

  it('returns zeros for invalid hex', () => {
    expect(distillHexToRgb('')).toEqual([0, 0, 0]);
    expect(distillHexToRgb('#fff')).toEqual([0, 0, 0]);
  });

  it('applies CSS custom properties to documentElement', () => {
    distillApplyAccentCssVars(document.documentElement, '#2563eb');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--accent').trim()).toBe('#2563eb');
    expect(root.style.getPropertyValue('--accent-a20')).toMatch(/rgba\s*\(\s*37\s*,\s*99\s*,\s*235/);
  });
});
