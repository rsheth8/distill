import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../extension/paperFeatures.js'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

let ctx, sent, calls, levelReads;

// A streamTask whose calls the test drives by hand; like the real one, abort ends in onError(AbortError).
function load() {
  sent = [];
  calls = [];
  levelReads = 0;
  ctx = vm.createContext({
    console, AbortController, Map, Promise,
    tabState: new Map(),
    toPanel: m => sent.push(m),
    schedulePersistTab: () => {},
    readingLevel: async () => { levelReads++; return 'everyday'; },
    distillPaperExcerpt: () => 'EXC',
    distillTrustFacts: () => [],
    streamTask: opts => new Promise((resolve, reject) => {
      calls.push({ ...opts, resolve, reject });
      opts.signal.addEventListener('abort', () => {
        opts.onError(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        resolve();
      });
    })
  });
  vm.runInContext(src, ctx);
}

const job = (tabId, key) => () => ctx.streamPaperHelp(tabId, { kind: 'overview', key, task: 'overview', level: 'everyday' });
const types = () => sent.map(m => `${m.type}:${m.key}`);

describe('paperFeatures', () => {
  beforeEach(load);

  it('runs queued jobs one at a time', async () => {
    ctx.tabState.set(1, { paper: {} });
    const a = ctx.queuePaperHelp(1, job(1, 'a'));
    const b = ctx.queuePaperHelp(1, job(1, 'b'));
    await tick();
    expect(calls).toHaveLength(1);
    calls[0].onDone();
    calls[0].resolve();
    await a;
    await tick();
    expect(calls).toHaveLength(2);
    calls[1].onDone();
    calls[1].resolve();
    await b;
    expect(types()).toEqual(['PAPER_HELP_START:a', 'PAPER_HELP_DONE:a', 'PAPER_HELP_START:b', 'PAPER_HELP_DONE:b']);
  });

  it('a failed job does not block the next', async () => {
    ctx.tabState.set(1, { paper: {} });
    const a = ctx.queuePaperHelp(1, job(1, 'a'));
    const b = ctx.queuePaperHelp(1, job(1, 'b'));
    await tick();
    calls[0].reject(new Error('boom'));
    await a;
    await tick();
    expect(sent.find(m => m.type === 'PAPER_HELP_ERROR' && m.key === 'a').message).toBe('boom');
    expect(calls).toHaveLength(2);
    calls[1].onDone();
    calls[1].resolve();
    await b;
  });

  it('clearPaperHelp aborts the old job silently and the next one still runs', async () => {
    ctx.tabState.set(1, { paper: {} });
    const a = ctx.queuePaperHelp(1, job(1, 'a'));
    await tick();
    calls[0].onChunk('old ');
    ctx.tabState.delete(1);
    ctx.clearPaperHelp(1);
    ctx.tabState.set(1, { paper: {} });
    const b = ctx.queuePaperHelp(1, job(1, 'b'));
    await a;
    expect(calls[0].signal.aborted).toBe(true);
    // late output from the old stream reaches nobody
    calls[0].onChunk('late');
    calls[0].onDone();
    await tick();
    expect(calls).toHaveLength(2); // the new job waited for the aborted one, then started
    calls[1].onChunk('new');
    calls[1].onDone();
    calls[1].resolve();
    expect(await b).toBe('new');
    expect(types()).toEqual([
      'PAPER_HELP_START:a', 'PAPER_HELP_CHUNK:a',
      'PAPER_HELP_START:b', 'PAPER_HELP_CHUNK:b', 'PAPER_HELP_DONE:b'
    ]);
    expect(sent.some(m => m.chunk === 'late')).toBe(false);
  });

  it('a replaced tabState entry makes the old job stale even without clearPaperHelp', async () => {
    ctx.tabState.set(1, { paper: {} });
    const a = ctx.queuePaperHelp(1, job(1, 'a'));
    await tick();
    ctx.tabState.set(1, { paper: {} });
    calls[0].onChunk('stale');
    expect(await a).toBe('');
    expect(calls[0].signal.aborted).toBe(true);
    expect(types()).toEqual(['PAPER_HELP_START:a']);
  });

  it('runOverview reads the level once, passes it through and stores it', async () => {
    const s = { paper: { title: 'P' }, title: 'T' };
    ctx.tabState.set(1, s);
    const p = ctx.runOverview(1);
    await tick();
    expect(calls[0].context).toEqual({ title: 'T', level: 'everyday' });
    calls[0].onChunk('ASKED: x');
    calls[0].onDone();
    calls[0].resolve();
    await p;
    expect(levelReads).toBe(1);
    expect(sent.find(m => m.type === 'PAPER_HELP_DONE').level).toBe('everyday');
    expect(s.overview).toEqual({ level: 'everyday', text: 'ASKED: x' });
  });
});
