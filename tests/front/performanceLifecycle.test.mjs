import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import process from 'node:process';
const {distillInstallPerformanceDiagnostics: install} = createRequire(import.meta.url)('../../extension/utils/performanceMetrics.js');
const source = fs.readFileSync(`${process.cwd()}/extension/background.js`, 'utf8');
function setup(run) {
  const scope = {requestAnimationFrame: () => {throw Error('unexpected frame');}};
  const api = install(scope);
  // Exercise the actual gateway wrapper, with only network dispatch substituted.
  const start = source.indexOf('async function streamTask(');
  const end = source.indexOf('async function streamTaskUnmeasured(');
  expect(end).toBeGreaterThan(start);
  const ctx = vm.createContext({distillPerformance:api, streamTaskUnmeasured:run, runAutomaticTask:()=>{throw Error('Unexpected automatic request');}});
  vm.runInContext(source.slice(start,end), ctx);
  return {api, run:ctx.streamTask};
}
it('keeps disabled recording and frame scheduling inert', () => {
  const api = install({requestAnimationFrame: () => {throw Error('frame');}});
  api.presented('panel_ready');
  api.start('extraction').finish('success');
  expect(api.snapshot().samples).toEqual([]);
});
it('preserves stream chunks and callbacks while measuring once', async () => {
  const chunks = [];
  const {api,run} = setup(async o => {
    o.performanceMeasure.setLabels({provider:'groq',route:'direct'});
    o.onChunk(''); o.onChunk('hello'); o.onDone(); o.onDone();
  });
  api.enable();
  let done = 0;
  await run({task:'now', onChunk:c => chunks.push(c), onDone:() => done++, onError:() => {}});
  expect(chunks).toEqual(['','hello']); expect(done).toBe(2);
  expect(api.snapshot().samples.map(s => s.metric)).toEqual(['ai_first_text','ai_complete']);
  expect(api.snapshot().samples[1]).toMatchObject({outcome:'success', provider:'groq',route:'direct'});
});
it('records thrown errors and cancels without swallowing errors', async () => {
  const failure = Error('transport');
  const {api,run} = setup(async () => {throw failure;}); api.enable();
  await expect(run({task:'now'})).rejects.toBe(failure);
  expect(api.snapshot().samples[0].outcome).toBe('error');
  const ctrl = new AbortController();
  const b = setup(async () => {ctrl.abort();}); b.api.enable();
  await b.run({task:'now',signal:ctrl.signal});
  expect(b.api.snapshot().samples.map(s=>s.outcome)).toEqual(['canceled','success']);
});
it('tracks backend route and reported errors without fabricating first text', async () => {
  const {api,run} = setup(async o => {
    o.performanceMeasure.setLabels({provider:'backend',route:'backend'});
    o.onError({code:'NO_AI_KEY'});
  }); api.enable();
  let code;
  await run({task:'quiz_question',onError:e=>{code=e.code;}});
  expect(code).toBe('NO_AI_KEY');
  expect(api.snapshot().samples).toHaveLength(1);
  expect(api.snapshot().samples[0]).toMatchObject({outcome:'error',provider:'backend'});
});

it('does not count empty answers as successful completions', async () => {
  const {api,run} = setup(async o=>{o.onChunk('');o.onDone();}); api.enable();
  await run({task:'now'});
  expect(api.snapshot().samples).toHaveLength(1);
  expect(api.snapshot().samples[0].outcome).toBe('error');
});
it('ignores aborts after a terminal callback', async () => {
  const ctrl = new AbortController();
  const {api,run} = setup(async o=>{o.onChunk('ok');o.onDone();ctrl.abort();}); api.enable();
  await run({task:'now',signal:ctrl.signal});
  expect(api.snapshot().samples.map(s=>s.metric)).toEqual(['ai_first_text','ai_complete']);
});
it('retains resolved route attribution when canceled during preflight', async () => {
  const ctrl = new AbortController();
  const {api,run} = setup(async o=>{
    ctrl.abort();
    o.performanceMeasure.setLabels({provider:'groq',route:'direct'});
  }); api.enable();
  await run({task:'now',signal:ctrl.signal});
  expect(api.snapshot().samples[0]).toMatchObject({outcome:'canceled',provider:'groq',route:'direct'});
});
it('does not measure messages that the panel ignores', () => {
  const panel = fs.readFileSync(`${process.cwd()}/extension/sidepanel.js`, 'utf8');
  const begin = panel.indexOf('function handleMessage(msg) {');
  const end = panel.indexOf('  switch (msg.type)',begin);
  const frames = [];
  const ctx = vm.createContext({currentTabId:1,requestAnimationFrame:cb=>frames.push(cb)});
  install(ctx); ctx.distillPerformance.enable();
  vm.runInContext(panel.slice(begin,end)+'}',ctx);
  ctx.handleMessage({type:'RESTORED',tabId:2});
  ctx.handleMessage({type:'NOW_CACHED',tabId:2});
  expect(frames).toHaveLength(0);
});
it('measures actual persisted-state hydration rather than the later cache check', async () => {
  const begin = source.indexOf('async function ensureTabHydratedFromPageState(tabId) {');
  const end = source.indexOf('async function ensureTabHydratedFromPageStateUnmeasured(',begin);
  expect(end).toBeGreaterThan(begin);
  const ctx = vm.createContext({ensureTabHydratedFromPageStateUnmeasured:async()=>true});
  install(ctx); ctx.distillPerformance.enable();
  vm.runInContext(source.slice(begin,end),ctx);
  expect(await ctx.ensureTabHydratedFromPageState(1)).toBe(true);
  expect(ctx.distillPerformance.snapshot().samples[0]).toMatchObject({metric:'restore_load',outcome:'success'});
});
