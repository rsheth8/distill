#!/usr/bin/env node
/**
 * Smoke-check a deployed Distill API (no secrets).
 * Usage: node scripts/check-remote.mjs [baseUrl]
 *   npm run remote:check --prefix backend
 *   npm run remote:check --prefix backend -- https://other.example
 */
const base = (process.argv[2] || process.env.DISTILL_BACKEND_URL || 'https://distill-api.fly.dev')
  .trim()
  .replace(/\/+$/, '');

async function main() {
  for (const path of ['/healthz', '/v1/config']) {
    const url = `${base}${path}`;
    const res = await fetch(url);
    const text = await res.text();
    const label = `${res.status} ${path}`;
    try {
      console.log(label, JSON.stringify(JSON.parse(text)));
    } catch {
      console.log(label, text.slice(0, 200));
    }
    if (!res.ok) process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
