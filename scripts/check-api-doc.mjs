#!/usr/bin/env node
/**
 * CI smoke: every app.METHOD('/path') in backend/server.js appears in docs/api.md.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverSrc = readFileSync(join(root, 'backend/server.js'), 'utf8');
const apiDoc = readFileSync(join(root, 'docs/api.md'), 'utf8');

const routeRe = /app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
const routes = [];
let m;
while ((m = routeRe.exec(serverSrc)) !== null) {
  routes.push({ method: m[1].toUpperCase(), path: m[2] });
}

const missing = routes.filter(({ method, path }) => {
  const needle = `\`${method}\` | \`${path}\``;
  const alt = `\`${path}\``;
  return !apiDoc.includes(needle) && !apiDoc.includes(`| \`${method}\` | \`${path}\``) && !apiDoc.match(new RegExp(`### \`${method} ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

if (missing.length) {
  console.error('check-api-doc: routes in server.js missing from docs/api.md:');
  for (const r of missing) console.error(`  ${r.method} ${r.path}`);
  process.exit(1);
}

console.log(`check-api-doc: ${routes.length} routes documented OK`);
