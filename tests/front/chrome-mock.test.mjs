import { describe, it, expect } from 'vitest';

describe('chrome mock (setup.mjs)', () => {
  it('exposes storage.local and runtime.connect', () => {
    expect(globalThis.chrome).toBeDefined();
    expect(typeof chrome.storage.local.get).toBe('function');
    expect(typeof chrome.storage.local.set).toBe('function');
    const port = chrome.runtime.connect({ name: 'test' });
    expect(port.postMessage).toBeDefined();
    expect(port.onMessage.addListener).toBeDefined();
  });
});
