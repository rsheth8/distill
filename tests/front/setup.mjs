/**
 * Minimal `chrome` API surface for tests that exercise browser-like code paths.
 */
import { vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((_keys, cb) => {
          if (typeof cb === 'function') cb({});
        }),
        set: vi.fn((_obj, cb) => {
          if (typeof cb === 'function') cb();
        })
      }
    },
    runtime: {
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() }
      })),
      lastError: undefined
    },
    tabs: {
      query: vi.fn((_q, cb) => {
        if (typeof cb === 'function') cb([]);
      }),
      get: vi.fn(),
      onActivated: { addListener: vi.fn() }
    }
  };
});

afterEach(() => {
  delete globalThis.chrome;
});
