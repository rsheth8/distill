'use strict';

/**
 * Default API origins (no trailing slash).
 * Overrides: chrome.storage.local `backendBaseUrlOverride`, or `backendTarget` ('dev' | 'prod' | 'staging').
 *
 * If `prod` still equals DISTILL_BACKEND_PROD_UNCONFIGURED, we fall back to `dev` (avoids dead DNS).
 * After you deploy, set `prod` to your real `https://…` host (must differ from the sentinel).
 */
var DISTILL_BACKEND_PROD_UNCONFIGURED = 'https://YOUR_PROD_BACKEND.example';

var DISTILL_BACKEND_DEFAULTS = {
  dev: 'http://localhost:8787',
  prod: 'https://distill-api.fly.dev',
  staging: 'https://distill-api-staging.fly.dev'
};

var DISTILL_BACKEND_OVERRIDE_KEY = 'backendBaseUrlOverride';
var DISTILL_BACKEND_TARGET_KEY = 'backendTarget';

function distillResolveBackendBaseUrlSync(bag) {
  const override = String(bag && bag[DISTILL_BACKEND_OVERRIDE_KEY] || '').trim().replace(/\/+$/, '');
  if (override) return override;
  const rawTarget = bag && bag[DISTILL_BACKEND_TARGET_KEY];
  const target =
    rawTarget === 'prod' || rawTarget === 'staging' ? rawTarget : 'dev';
  let base = DISTILL_BACKEND_DEFAULTS[target] || DISTILL_BACKEND_DEFAULTS.dev;
  base = String(base).trim().replace(/\/+$/, '');
  if (target === 'prod' && base === DISTILL_BACKEND_PROD_UNCONFIGURED) {
    return DISTILL_BACKEND_DEFAULTS.dev;
  }
  return base;
}

function distillResolveBackendBaseUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get([DISTILL_BACKEND_OVERRIDE_KEY, DISTILL_BACKEND_TARGET_KEY], bag => {
      resolve(distillResolveBackendBaseUrlSync(bag));
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DISTILL_BACKEND_DEFAULTS,
    distillResolveBackendBaseUrlSync,
    distillResolveBackendBaseUrl
  };
}
