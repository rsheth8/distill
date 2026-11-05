import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const read = file => readFileSync(join(process.cwd(), 'extension', file), 'utf8');
const html = read('sidepanel.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
const $ = id => document.getElementById(id);
const later = () => new Promise(resolve => setTimeout(resolve, 0));
const saved = {};
const posted = [];
let message;
let booted;
const created = vi.fn();

beforeEach(() => {
  const reply = (value, callback) => {
    if (callback) queueMicrotask(() => callback(value));
    return Promise.resolve(value);
  };
  const event = { addListener() {} };
  globalThis.chrome = {
    storage: { local: {
      get: (_keys, callback) => reply({ ...saved }, callback),
      set: (value, callback) => { Object.assign(saved, value); return reply(undefined, callback); },
      remove: (key, callback) => { delete saved[key]; return reply(undefined, callback); }
    } },
    runtime: {
      id: 'test', getURL: file => file,
      connect: () => ({ postMessage: value => posted.push(value), onMessage: { addListener: fn => { message = fn; } }, onDisconnect: event })
    },
    tabs: {
      query: (_query, callback) => reply([{ id: 7, url: 'https://arxiv.org/html/1706.03762' }], callback),
      get() {}, onActivated: event, create: created
    }
  };
});

function boot() {
  return booted ||= (async () => {
    document.body.innerHTML = html.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    for (const file of scripts) {
      // Exercise the production flag, including the backend-only row outside the details element.
      vm.runInThisContext(file === 'utils/buildConfig.js' ? 'var DISTILL_INCLUDE_BACKEND = false;' : read(file), { filename: file });
      await later();
    }
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await later();
  })();
}

const changeProvider = provider => {
  $('aiProviderSelect').value = provider;
  $('aiProviderSelect').dispatchEvent(new Event('change'));
};

describe('onboarding', () => {
  it('keeps backend-only controls hidden in the store build, even after site preferences arrive', async () => {
    await boot();
    message({ type: 'SITE_PREFS', tabId: 7, origin: 'https://arxiv.org', prefs: {} });
    expect($('siteBackendOnlyRow').classList.contains('hidden')).toBe(true);
    expect($('advancedBackendDetails').classList.contains('hidden')).toBe(true);
  });

  it('ignores a validation response after the user changes providers', async () => {
    await boot();
    $('onboardKeyInput').value = 'test-groq-key';
    $('onboardConnectBtn').click();
    const request = posted.at(-1);
    expect($('onboardConnectBtn').disabled).toBe(true);
    changeProvider('openai');
    message({ type: 'KEY_VALIDATION_RESULT', provider: request.provider, requestId: request.requestId, ok: true });
    await later();
    expect(saved.groqApiKey).toBeUndefined();
    expect(saved.openaiApiKey).toBeUndefined();
    expect($('onboardDone').classList.contains('hidden')).toBe(true);
  });

  it('re-enables Connect on failure and saves only the key that was actually validated', async () => {
    await boot();
    changeProvider('groq');
    $('onboardKeyInput').value = 'test-validated-key';
    $('onboardConnectBtn').click();
    let request = posted.at(-1);
    message({ type: 'KEY_VALIDATION_RESULT', provider: request.provider, requestId: request.requestId, ok: false, message: 'Invalid key' });
    expect($('onboardStatusLine').textContent).toBe('Invalid key');
    expect($('onboardConnectBtn').disabled).toBe(false);
    $('onboardConnectBtn').click();
    request = posted.at(-1);
    $('onboardKeyInput').value = 'unvalidated-edit';
    message({ type: 'KEY_VALIDATION_RESULT', provider: request.provider, requestId: request.requestId, ok: true });
    await later();
    expect(saved.groqApiKey).toBe('test-validated-key');
    expect($('onboardDone').classList.contains('hidden')).toBe(false);
    $('onboardSampleBtn').click();
    expect(created).toHaveBeenCalledWith({ url: 'https://arxiv.org/html/1706.03762' });
  });

  it('lets the user dismiss the Connected card', async () => {
    await boot();
    $('setupHintDismissBtn').click();
    await later();
    expect($('setupHintCard').classList.contains('hidden')).toBe(true);
  });

  it('opens local setup with the server fields visible and no key required', async () => {
    await boot();
    $('onboardLocalBtn').click();
    expect($('viewSettings').classList.contains('hidden')).toBe(false);
    expect($('aiProviderSelect').value).toBe('local');
    expect($('localFields').classList.contains('hidden')).toBe(false);
    expect($('apiKeyInput').classList.contains('hidden')).toBe(true);
  });
});
