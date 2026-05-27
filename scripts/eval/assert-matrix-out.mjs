#!/usr/bin/env node
/**
 * CI guard: fail if any processed matrix row has non-empty regression_flags.
 *
 * Usage:
 *   node scripts/eval/assert-matrix-out.mjs scripts/eval/article-test-matrix.ci.out.csv
 *   node scripts/eval/assert-matrix-out.mjs OUT.csv --min-rows 2
 */

import fs from 'node:fs';
import process from 'node:process';

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseArgs(argv) {
  const args = { minRows: 1 };
  const paths = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min-rows') args.minRows = Number(argv[++i] || '1');
    else if (a === '--help' || a === '-h') args.help = true;
    else paths.push(a);
  }
  args.path = paths[0];
  return args;
}

function usage() {
  console.log('Usage: node scripts/eval/assert-matrix-out.mjs <out.csv> [--min-rows N]');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.path) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const raw = fs.readFileSync(args.path, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    console.error(`assert-matrix-out: expected header + data rows in ${args.path}`);
    process.exit(1);
  }

  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  if (!('regression_flags' in idx)) {
    console.error('assert-matrix-out: missing regression_flags column');
    process.exit(1);
  }

  const failures = [];
  let dataRows = 0;
  for (const line of lines.slice(1)) {
    dataRows++;
    const cols = parseCsvLine(line);
    const id = cols[idx.article_id] || `row_${dataRows}`;
    const flags = cols[idx.regression_flags] || '';
    if (flags.trim()) failures.push({ id, flags });
  }

  if (dataRows < args.minRows) {
    console.error(`assert-matrix-out: expected at least ${args.minRows} data row(s), got ${dataRows}`);
    process.exit(1);
  }

  if (failures.length) {
    for (const f of failures) {
      console.error(`assert-matrix-out: ${f.id}: ${f.flags}`);
    }
    process.exit(1);
  }

  console.log(`assert-matrix-out: ok (${dataRows} row(s), no regression_flags)`);
}

main();
