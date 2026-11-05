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

describe('local inference privacy boundary', () => {
  it('uses only the configured local endpoint even with reachable backend-only preferences', async () => {
    const attempts = [];
    const context = vm.createContext({
      chrome: { storage: { local: { get: async () => ({readerExpertise:'expert'}) } } },
      readingLevel: async () => 'close',
      distillBuildPrompt: () => ({system:'S',blocks:['private paper text']}),
      getAiMode: async () => 'balanced', maxTokensForTask: () => 200,
      getAiProvider: async () => 'local', localChatConfig: async () => ({url:'http://localhost:11434/v1/chat/completions'}),
      streamOpenAiCompat: async opts => { attempts.push(opts.cfg.url); opts.onDone(); },
      useBackendProxy: async () => { throw Error('Local mode consulted backend preferences'); },
      getSiteBackendOnly: async () => true,
      probeBackend: async () => { attempts.push('REMOTE BACKEND'); return {reachable:true}; }
    });
    const start = background.indexOf('async function streamTask(');
    const end = background.indexOf('\nasync function ', start + 1);
    vm.runInContext(background.slice(start,end),context);
    let done = false;
    await context.streamTask({task:'ask',input:{question:'Q'},onDone:()=>{done=true;},onError:e=>{throw e;}});
    expect(attempts).toEqual(['http://localhost:11434/v1/chat/completions']);
    expect(done).toBe(true);
  });
});
