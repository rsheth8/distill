import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const background = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
const sitePrefs = background.slice(background.indexOf('const SITE_PREFS_KEY'), background.indexOf('async function publishSitePrefs'));

describe('per-site backend routing', () => {
  const check = (includeBackend, url) => {
    const context = vm.createContext({
      URL, Map, DISTILL_INCLUDE_BACKEND: includeBackend,
      chrome: { storage: { local: { get: async key => ({ [key]: { 'https://arxiv.org': { backendOnly: true } } }) } } }
    });
    vm.runInContext(sitePrefs, context);
    return context.getSiteBackendOnly(url);
  };

  it('ignores saved backend-only site preferences in store builds', async () => {
    expect(await check(false, 'https://arxiv.org/html/1706.03762')).toBe(false);
  });

  it('keeps the optional backend preference available in development builds', async () => {
    expect(await check(true, 'https://arxiv.org/html/1706.03762')).toBe(true);
    expect(await check(true, 'https://example.com')).toBe(false);
    expect(await check(true, 'chrome://extensions')).toBe(false);
  });
});
