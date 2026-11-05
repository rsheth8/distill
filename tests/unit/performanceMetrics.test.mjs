import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { distillCreatePerformanceRecorder: create } = require('../../extension/utils/performanceMetrics.js');
describe('local performance recorder', () => {
  it('does no clock work when disabled', () => {
    const r = create({ now: () => { throw Error('clock used'); } });
    r.start('extraction').finish('success');
    expect(r.snapshot().samples).toEqual([]);
  });
  it('records bounded durations, removes arbitrary fields, and closes once', () => {
    let t = 0;
    const r = create({ enabled: true, now: () => t, limit: 2 });
    const h = r.start('ai_complete', { provider: 'groq', task: 'now', secret: 'private' });
    t = 10; h.firstText(); h.firstText();
    t = 30; h.finish('success'); h.finish('error'); h.firstText();
    expect(r.snapshot().samples.map(s => s.durationMs)).toEqual([10, 30]);
    expect(JSON.stringify(r.snapshot())).not.toContain('private');
    t = 40; r.start('extraction').finish('error');
    expect(r.snapshot().samples.map(s => s.metric)).toEqual(['ai_complete', 'extraction']);
    const exported = r.snapshot(); exported.samples[0].durationMs = 999;
    expect(r.snapshot().samples[0].durationMs).toBe(30);
    r.clear(); expect(r.snapshot().samples).toEqual([]);
  });
  it('rejects bad labels and invalid durations without recording', () => {
    const r = create({ enabled: true, now: () => NaN });
    r.start('extraction').finish('success');
    r.start('secret-url').finish('success');
    r.start('extraction', { provider: 'private-key' }).finish('success');
    expect(r.snapshot().samples).toEqual([]);
  });
});

it('excludes failed and canceled streams from successful first-text timings', () => {
  let t = 0; const r = create({enabled:true, now:()=>t});
  const failed = r.start('ai_complete'); t=5; failed.firstText(); t=10; failed.finish('error');
  const canceled = r.start('ai_complete'); t=15; canceled.firstText(); canceled.finish('canceled');
  expect(r.snapshot().samples.map(s=>s.metric)).toEqual(['ai_complete','ai_complete']);
});

it('retains local model attribution and paper-help task labels',()=>{
 const r=create({enabled:true});const h=r.start('ai_complete',{provider:'local',task:'overview',route:'direct'});h.firstText();h.finish('success');
 expect(r.snapshot().samples).toHaveLength(2);expect(r.snapshot().samples[1]).toMatchObject({provider:'local',task:'overview'});
});
