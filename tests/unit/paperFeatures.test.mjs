import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../extension/paperFeatures.js'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

const helpSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/paperHelp.js'), 'utf8');

let ctx, sent, calls, levelReads, tabMsgs, activeTabs, currentLevel, levelGate;

// A streamTask whose calls the test drives by hand; like the real one, abort ends in onError(AbortError).
function load() {
  sent = [];
  calls = [];
  levelReads = 0;
  currentLevel = 'everyday';
  levelGate = null; // a promise the next readingLevel() calls wait on
  tabMsgs = [];
  activeTabs = [];
  ctx = vm.createContext({
    console, AbortController, Map, Promise, Object, Array, String,
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: id => clearTimeout(id),
    chrome: {
      tabs: {
        sendMessage: (tabId, m) => { tabMsgs.push({ tabId, ...m }); return Promise.resolve(); },
        query: () => Promise.resolve(activeTabs)
      }
    },
    tabState: new Map(),
    toPanel: m => sent.push(m),
    schedulePersistTab: () => {},
    readingLevel: async () => { levelReads++; if (levelGate) await levelGate; return currentLevel; },
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
  vm.runInContext(helpSrc, ctx);
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

describe('section guides', () => {
  const paper = { title: 'P', sections: [{ heading: 'Methods', kind: 'methods', text: 'We trained it.' }] };
  const guideText = 'It trains the model.\nTERMS:\nbackprop — how it learns';
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const setup = (heading = 'Methods') => {
    const s = { paper, title: 'T', section: { heading } };
    ctx.tabState.set(1, s);
    return s;
  };

  beforeEach(() => { load(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('guides a findable section after 8 s of dwell, once', async () => {
    setup();
    ctx.onSectionChanged(1, 'Methods');
    expect(sent.find(m => m.type === 'SECTION_CHANGED')).toMatchObject({ heading: 'Methods', hasGuide: false, canGuide: true });
    await vi.advanceTimersByTimeAsync(7999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].task).toBe('section_guide');
    expect(calls[0].context).toEqual({ title: 'T', section: { heading: 'Methods', kind: 'methods' }, level: 'everyday' });
    expect(calls[0].input).toEqual({ sectionText: 'We trained it.' });
    await vi.advanceTimersByTimeAsync(20000);
    expect(calls).toHaveLength(1);
  });

  it('leaving the section before 8 s runs no guide', async () => {
    const s = setup();
    ctx.onSectionChanged(1, 'Methods');
    await vi.advanceTimersByTimeAsync(5000);
    s.section = { heading: 'Results' };
    ctx.onSectionChanged(1, 'Results');
    await vi.advanceTimersByTimeAsync(3000); // Methods' timer would have fired by now
    await flush();
    expect(calls).toHaveLength(0);
  });

  it('a heading not in the paper never calls the model and says canGuide: false', async () => {
    setup('Figure 3');
    ctx.onSectionChanged(1, 'Figure 3');
    expect(sent.find(m => m.type === 'SECTION_CHANGED').canGuide).toBe(false);
    await vi.advanceTimersByTimeAsync(9000);
    await flush();
    expect(calls).toHaveLength(0);
  });

  it('GUIDE_SECTION on an unfindable heading reports NO_SECTION', async () => {
    setup('Figure 3');
    await ctx.runSectionGuide(1, 'Figure 3');
    expect(calls).toHaveLength(0);
    expect(sent.find(m => m.type === 'PAPER_HELP_ERROR')).toMatchObject({ kind: 'guide', code: 'NO_SECTION', message: 'No guide for this part.' });
  });

  it('a finished guide is stored, merged into the glossary and underlined in the page', async () => {
    const s = setup();
    const p = ctx.runSectionGuide(1, 'Methods');
    await flush();
    calls[0].onChunk(guideText);
    calls[0].onDone();
    calls[0].resolve();
    await p;
    expect(levelReads).toBe(2); // once to start, once to check the level did not change while streaming
    expect(sent.find(m => m.type === 'PAPER_HELP_DONE').level).toBe('everyday');
    expect(s.guides.Methods).toMatchObject({ level: 'everyday', text: guideText, terms: [{ term: 'backprop', definition: 'how it learns' }] });
    expect(s.glossary).toEqual([{ term: 'backprop', definition: 'how it learns', section: 'Methods' }]);
    expect(tabMsgs).toEqual([{ tabId: 1, type: 'SHOW_TERMS', heading: 'Methods', terms: [{ term: 'backprop', definition: 'how it learns' }] }]);
    expect(sent.at(-1)).toMatchObject({ type: 'PAPER_HELP_STATE', section: 'Methods' });
    expect(sent.at(-1).guides.Methods.level).toBe('everyday');
  });

  it('a level change while a guide streams: the guide is kept at its level but not underlined', async () => {
    const s = setup();
    const p = ctx.runSectionGuide(1, 'Methods');
    await flush();
    currentLevel = 'simple';
    ctx.onReadingLevelChanged();
    await flush();
    expect(tabMsgs.map(m => m.type)).toEqual(['CLEAR_TERMS']);
    calls[0].onChunk(guideText);
    calls[0].onDone();
    calls[0].resolve();
    await p;
    expect(tabMsgs.map(m => m.type)).toEqual(['CLEAR_TERMS']); // no SHOW_TERMS from the old level
    expect(s.guides.Methods.level).toBe('everyday');
    expect(s.glossary).toHaveLength(1);
  });

  it('the dwell callback re-checks the section after reading the level', async () => {
    const s = setup();
    let release;
    ctx.onSectionChanged(1, 'Methods');
    levelGate = new Promise(r => { release = r; });
    await vi.advanceTimersByTimeAsync(8000); // timer fired, now waiting on the level
    s.section = { heading: 'Results' };
    release();
    await flush();
    expect(calls).toHaveLength(0);
  });

  it('sends at most 6,000 characters of the section', async () => {
    const big = { title: 'P', sections: [{ heading: 'Methods', kind: 'methods', text: 'x'.repeat(20000) }] };
    ctx.tabState.set(1, { paper: big, section: { heading: 'Methods' } });
    ctx.runSectionGuide(1, 'Methods');
    await flush();
    expect(calls[0].input.sectionText).toHaveLength(6000);
  });

  it('a guide that finishes after the tab moved on stores nothing', async () => {
    const s = setup();
    const p = ctx.runSectionGuide(1, 'Methods');
    await flush();
    ctx.tabState.set(1, { paper });
    calls[0].onChunk(guideText);
    calls[0].onDone();
    calls[0].resolve();
    await p;
    expect(s.guides).toBeUndefined();
    expect(tabMsgs).toEqual([]);
  });

  it('an existing guide at the current level is re-underlined, not regenerated', async () => {
    const s = setup();
    s.guides = { Methods: { level: 'everyday', text: 'x', terms: [{ term: 'a', definition: 'b' }] } };
    await ctx.runSectionGuide(1, 'Methods');
    expect(calls).toHaveLength(0);
    expect(tabMsgs).toHaveLength(1);
  });

  it('clearPaperHelp cancels the dwell timer', async () => {
    setup();
    ctx.onSectionChanged(1, 'Methods');
    ctx.clearPaperHelp(1);
    await vi.advanceTimersByTimeAsync(9000);
    expect(calls).toHaveLength(0);
  });

  it('a level change clears underlines on paper tabs and re-runs the overview in view', async () => {
    ctx.tabState.set(1, { paper, title: 'T', overview: { level: 'simple', text: 'old' } });
    ctx.tabState.set(2, { paper });
    ctx.tabState.set(3, {});
    activeTabs = [{ id: 1 }];
    ctx.onReadingLevelChanged();
    await flush();
    expect(tabMsgs.map(m => `${m.tabId}:${m.type}`)).toEqual(['1:CLEAR_TERMS', '2:CLEAR_TERMS']);
    expect(calls).toHaveLength(1);
    expect(calls[0].task).toBe('overview');
  });
});
