import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const read = f => readFileSync(join(process.cwd(), 'extension', f), 'utf8');
const html = read('sidepanel.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const later = () => new Promise(r => setTimeout(r, 0));

describe('side panel startup', () => {
  it('asks for the open tab only once every panel script has loaded', async () => {
    document.body.innerHTML = html.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    const posted = [];
    // Chrome answers asynchronously, so an answer can arrive between two <script>s.
    chrome.runtime.connect = vi.fn(() => ({ postMessage: m => posted.push(m), onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }));
    chrome.tabs.query = vi.fn((_q, cb) => (cb ? void setTimeout(() => cb([{ id: 7 }]), 0) : Promise.resolve([{ id: 7 }])));
    chrome.storage.local.get = vi.fn((_k, cb) => (cb ? void setTimeout(() => cb({}), 0) : Promise.resolve({})));
    chrome.tabs.get = vi.fn();
    chrome.runtime.getURL = f => f;
    const errors = [];
    const onError = e => { errors.push(e.message); e.preventDefault?.(); };
    window.addEventListener('error', onError);
    for (const f of scripts) {
      vm.runInThisContext(read(f), { filename: f }); // same global scope for every script, like <script> tags
      await later(); // the page can handle events before the next script runs
    }
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await later();
    await later();
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
    expect(posted).toContainEqual({ type: 'GET_STATE', tabId: 7 });
  });
});
