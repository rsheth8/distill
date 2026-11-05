import { it, expect } from 'vitest';
import { summarize, validateExport, main } from '../../scripts/perf/report.mjs';
const sample = (durationMs, extra = {}) => ({ metric: 'extraction', durationMs, outcome: 'success', ...extra });
it('uses nearest-rank p95 and never passes insufficient samples', () => {
  expect(summarize([])).toEqual([]);
  expect(summarize([sample(1)])[0].status).toBe('insufficient');
  const row = summarize(Array.from({length: 30}, (_, i) => sample(i + 1)))[0];
  expect(row.p95).toBe(29); expect(row.median).toBe(15.5);
  expect(row.status).toBe('manual'); // extraction must be grouped by article class manually
  expect(summarize(Array.from({length: 30}, () => sample(200, {metric: 'cancel_ack'})))[0].status).toBe('pass');
  expect(summarize(Array.from({length: 30}, () => sample(201, {metric: 'cancel_ack'})))[0].status).toBe('fail');
});
it('separates providers, errors, cancellations and requires 100 AI successes', () => {
  const rows = summarize([sample(1, {metric:'ai_complete', provider:'groq'}), sample(900, {metric:'ai_complete', provider:'gemini'}), sample(0, {outcome:'canceled'})]);
  expect(rows).toHaveLength(3);
  expect(rows.find(r => r.outcome === 'canceled').status).toBe('count-only');
});
it('rejects unknown fields, schema versions and invalid numeric values', () => {
  for (const data of [{schemaVersion:2,samples:[]}, {schemaVersion:1,samples:[sample(-1)]}, {schemaVersion:1,samples:[sample(Infinity)]}, {schemaVersion:1,samples:[sample(1,{url:'private'})]}, {schemaVersion:1,samples:[], secret:'x'}]) {
    expect(() => validateExport(data)).toThrow();
  }
  expect(validateExport({schemaVersion:1,samples:[]})).toEqual([]);
  expect(main([],()=>{},()=>{})).toBe(2);
});

it('checks CLI budgets and handles malformed or oversized files', async () => {
  const {mkdtempSync, writeFileSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'distill-perf-'));
  const file = join(dir, 'samples.json');
  const quiet = () => {};
  try {
    writeFileSync(file, JSON.stringify({schemaVersion:1,samples:Array.from({length:30}, () => sample(201,{metric:'cancel_ack'}))}));
    expect(main(['--check',file],quiet,quiet)).toBe(1);
    expect(main([file],quiet,quiet)).toBe(0);
    writeFileSync(file, '{'); expect(main([file],quiet,quiet)).toBe(2);
    writeFileSync(file, ' '.repeat(1_000_001)); expect(main([file],quiet,quiet)).toBe(2);
    expect(main([join(dir,'missing')],quiet,quiet)).toBe(2);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
