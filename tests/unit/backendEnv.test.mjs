import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const backendEnvPath = join(dirname(fileURLToPath(import.meta.url)), '../../extension/utils/backendEnv.js');

describe('backendEnv', () => {
  const { distillResolveBackendBaseUrlSync } = require(backendEnvPath);

  it('resolves prod, staging, and dev defaults', () => {
    expect(distillResolveBackendBaseUrlSync({ backendTarget: 'prod' })).toBe('https://distill-api.fly.dev');
    expect(distillResolveBackendBaseUrlSync({ backendTarget: 'staging' })).toBe(
      'https://distill-api-staging.fly.dev'
    );
    expect(distillResolveBackendBaseUrlSync({ backendTarget: 'dev' })).toBe('http://localhost:8787');
  });

  it('prefers URL override over target', () => {
    expect(
      distillResolveBackendBaseUrlSync({
        backendTarget: 'prod',
        backendBaseUrlOverride: 'https://custom.example/'
      })
    ).toBe('https://custom.example');
  });
});
