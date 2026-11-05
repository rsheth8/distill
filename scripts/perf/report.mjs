import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const { distillValidPerformanceSample } = createRequire(import.meta.url)('../../extension/utils/performanceMetrics.js');
const budgets = {panel_ready:300,restore_presented:500,cache_presented:100,action_feedback:100,cancel_ack:200, ai_first_text:5000, ai_complete:12000};
const shortTasks = ['now', 'quiz_question', 'quiz_feedback', 'quiz_skipped_review', 'analysis'];
export function validateExport(data) {
  if (!data || data.schemaVersion !== 1 || Object.keys(data).some(k => !['schemaVersion','samples'].includes(k)) || !Array.isArray(data.samples) || data.samples.length > 200 || !data.samples.every(distillValidPerformanceSample)) throw Error('Invalid performance export');
  return data.samples;
}
export function summarize(samples) {
  const groups = new Map();
  for (const s of samples) {
    if (!distillValidPerformanceSample(s)) throw Error('Invalid sample');
    const labels = Object.fromEntries(['metric','task','provider','route','cache','outcome'].filter(k => s[k] !== undefined).map(k => [k,s[k]]));
    const key = JSON.stringify(labels);
    if (!groups.has(key)) groups.set(key, { ...labels, values: [] });
    groups.get(key).values.push(s.durationMs);
  }
  return [...groups.values()].map(({values, ...labels}) => {
    values.sort((a,b) => a-b);
    const n = values.length, ai = labels.metric.startsWith('ai_');
    const median = n % 2 ? values[(n-1)/2] : (values[n/2-1]+values[n/2])/2;
    const p95 = values[Math.ceil(n*0.95)-1];
    const budget = ai && !shortTasks.includes(labels.task) ? undefined : budgets[labels.metric];
    let status = 'count-only';
    if (labels.outcome === 'success') {
      status = n < (ai ? 100 : 30) ? 'insufficient' : budget === undefined ? 'manual' :
        p95 <= budget && (!ai || median <= (labels.metric === 'ai_first_text' ? 2000 : 6000)) ? 'pass' : 'fail';
    }
    return {...labels, n, median, p95, budget, status};
  });
}
export function main(argv, output = console.log, error = console.error) {
  try {
    const check = argv.includes('--check');
    const files = argv.filter(a => a !== '--check');
    if (!files.length) throw Error('Usage: npm run perf:report -- [--check] export.json [export2.json ...]');
    const samples = files.flatMap(file => {
      if (statSync(file).size > 1_000_000) throw Error('Export exceeds 1 MB');
      return validateExport(JSON.parse(readFileSync(file, 'utf8')));
    });
    const rows = summarize(samples);
    output('| Metric / task / provider / route / cache / outcome | n | median ms | p95 ms | status |\n| --- | ---: | ---: | ---: | --- |');
    for (const r of rows) output(`| ${[r.metric,r.task,r.provider,r.route,r.cache,r.outcome].filter(Boolean).join(' / ')} | ${r.n} | ${r.median.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.status} |`);
    if (!rows.length) output('No samples: unmeasured.');
    output('\nCounts include errors and cancellations as separate rows. First-text timings include successful completions only. UI frame timings are proxies requiring manual assessment, as are scrolling, extraction article class, cold/warm state, quality and usability. Never pool different machines or scenarios.');
    return check && rows.some(r => r.status === 'fail') ? 1 : 0;
  } catch (e) { error(e.message); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
