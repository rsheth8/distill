import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const read = f => readFileSync(join(process.cwd(), 'extension', f), 'utf8');
const html = read('sidepanel.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const later = () => new Promise(r => setTimeout(r, 0));
const inPanel = code => vm.runInThisContext(code); // the panel's top-level let/const are only reachable from its own scope
const TAB = 7;
const paperState = (askThread = []) => ({ type: 'PAPER_HELP_STATE', tabId: TAB, overview: null, trustFacts: [], section: '', canGuide: true, guides: {}, glossary: [], askThread });

describe('side panel', () => {
  const posted = [];
  const errors = [];
  let onPortMessage;
  let earlyError = null;
  const scrolls = vi.fn();

  // Every <script> shares one global scope, and their top-level const/let can only be declared once: boot once.
  // (Not in beforeAll: the shared setup gives each test its own `chrome`, so the first test boots.)
  let booted;
  const boot = () => (booted ||= (async () => {
    document.body.innerHTML = html.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    // Chrome answers asynchronously, so an answer can arrive between two <script>s.
    chrome.runtime.connect = vi.fn(() => ({ postMessage: m => posted.push(m), onMessage: { addListener: fn => { onPortMessage = fn; } }, onDisconnect: { addListener() {} } }));
    chrome.tabs.query = vi.fn((_q, cb) => (cb ? void setTimeout(() => cb([{ id: TAB }]), 0) : Promise.resolve([{ id: TAB }])));
    chrome.storage.local.get = vi.fn((_k, cb) => (cb ? void setTimeout(() => cb({}), 0) : Promise.resolve({})));
    chrome.tabs.get = vi.fn();
    chrome.runtime.getURL = f => f;
    Element.prototype.scrollIntoView = scrolls;
    const onError = e => { errors.push(e.message); e.preventDefault?.(); };
    window.addEventListener('error', onError);
    for (const f of scripts) {
      vm.runInThisContext(read(f), { filename: f }); // same global scope for every script, like <script> tags
      if (f === 'sidepanel.js') {
        try { onPortMessage({ type: 'PAPER_HELP_STATE' }); } catch (e) { earlyError = e; } // sidepanelPaper.js has not loaded yet
      }
      await later(); // the page can handle events before the next script runs
    }
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await later();
    await later();
    window.removeEventListener('error', onError);
  })());

  it('asks for the open tab only once every panel script has loaded', async () => {
    await boot();
    expect(errors).toEqual([]);
    expect(posted).toContainEqual({ type: 'GET_STATE', tabId: TAB });
  });

  it('a port message that arrives before sidepanelPaper.js loads is handled, not a crash', async () => {
    await boot();
    expect(earlyError).toBeNull();
  });

  it('a stream event renders only its own view', async () => {
    await boot();
    onPortMessage(paperState());
    const spies = {};
    for (const n of ['renderOverview', 'renderGuide', 'renderGlossary', 'renderAsk']) {
      const orig = globalThis[n];
      spies[n] = globalThis[n] = vi.fn(orig);
    }
    const reset = () => Object.values(spies).forEach(s => s.mockClear());
    const called = () => Object.keys(spies).filter(n => spies[n].mock.calls.length);
    onPortMessage({ type: 'PAPER_HELP_START', tabId: TAB, kind: 'overview', key: 'overview' });
    onPortMessage({ type: 'PAPER_HELP_CHUNK', tabId: TAB, kind: 'overview', key: 'overview', chunk: 'ASKED: x' });
    expect(called()).toEqual(['renderOverview']);
    reset();
    onPortMessage({ type: 'PAPER_HELP_DONE', tabId: TAB, kind: 'overview', key: 'overview', level: 'everyday', text: 'ASKED: x' });
    expect(called()).toEqual(['renderOverview']);
    reset();
    onPortMessage({ type: 'PAPER_HELP_CHUNK', tabId: TAB, kind: 'guide', key: 'Methods', chunk: 'g' });
    expect(called()).toEqual(['renderGuide']);
    reset();
    onPortMessage({ type: 'PAPER_HELP_CHUNK', tabId: TAB, kind: 'ask', key: '0', chunk: 'a' });
    expect(called()).toEqual(['renderAsk']);
    reset();
    onPortMessage(paperState()); // a state publish still renders everything
    expect(called().sort()).toEqual(['renderAsk', 'renderGlossary', 'renderGuide', 'renderOverview']);
  });

  it('the ask thread scrolls only when ask activity changed it', async () => {
    await boot();
    onPortMessage(paperState([{ q: 'one', a: '' }]));
    scrolls.mockClear();
    onPortMessage({ type: 'PAPER_HELP_CHUNK', tabId: TAB, kind: 'ask', key: '0', chunk: 'a' });
    expect(scrolls).toHaveBeenCalledTimes(1);
    scrolls.mockClear();
    onPortMessage({ type: 'PAPER_HELP_CHUNK', tabId: TAB, kind: 'overview', key: 'overview', chunk: 'x' });
    onPortMessage(paperState([{ q: 'one', a: 'done' }])); // an unrelated state publish
    expect(scrolls).not.toHaveBeenCalled();
    onPortMessage(paperState([{ q: 'one', a: 'done' }, { q: 'two', a: '' }])); // a new question
    expect(scrolls).toHaveBeenCalledTimes(1);
  });

  it('an ABORTED job drops its live key and its "Reading…" status, without an error or Retry', async () => {
    await boot();
    onPortMessage(paperState());
    onPortMessage({ type: 'PAPER_HELP_START', tabId: TAB, kind: 'overview', key: 'overview' });
    expect(document.getElementById('overviewStatus').textContent).toContain('Reading');
    expect(inPanel('paperView.live.has("overview:overview")')).toBe(true);
    onPortMessage({ type: 'PAPER_HELP_ERROR', tabId: TAB, kind: 'overview', key: 'overview', code: 'ABORTED', message: '' });
    expect(inPanel('paperView.live.size')).toBe(0);
    expect(inPanel('"overview:overview" in paperView.streams')).toBe(false);
    expect(document.getElementById('overviewStatus').textContent).toBe('');
    expect(document.getElementById('overviewRetryBtn').classList.contains('hidden')).toBe(true);
  });
});
