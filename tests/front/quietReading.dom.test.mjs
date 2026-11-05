import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const background = readFileSync('extension/background.js','utf8');
const features = readFileSync('extension/paperFeatures.js','utf8');
const later = () => new Promise(r => setTimeout(r,0));
it('changing explanation preferences republishes context without generating an overview', async () => {
  const runOverview=vi.fn();
  const ctx=vm.createContext({tabState:new Map([[1,{paper:{}}]]),chrome:{tabs:{sendMessage:async()=>{},query:async()=>[{id:1}]}},runOverview});
  const a=features.indexOf('function onReadingLevelChanged('),b=features.indexOf('\nconst ASK_THREAD_MAX',a);
  vm.runInContext(features.slice(a,b),ctx);ctx.onReadingLevelChanged();await later();expect(runOverview).not.toHaveBeenCalled();
});
it('restoring a pending quiz never locks the paper scroll', async () => {
  const sent=[];
  const s={paper:{},readParagraphs:[],quiz:{status:'question',question:'Why?'},highlightHistory:[]};
  const ctx=vm.createContext({tabState:new Map([[1,s]]),pdfTabs:new Map(),ensureTabHydrated:async()=>{},publishPaperHelp(){},toPanel(){},paragraphsUntilQuiz:()=>5,restoredFromStorageTabs:new Set(),broadcastHighlightHistory(){},distillReadingAssistance:p=>p.readingAssistance,chrome:{storage:{local:{get:async()=>({readingAssistance:{checkins:true}})}},tabs:{sendMessage:async(_id,msg)=>sent.push(msg)}}});
  const a=background.indexOf('async function restoreState('),b=background.indexOf('// ── Claude API streaming',a);
  vm.runInContext(background.slice(a,b),ctx);await ctx.restoreState(1);expect(sent.filter(m=>m.type==='FREEZE_SCROLL')).toEqual([]);
});

it('automatic inference is quiet by default and aborts without publishing late chunks', async () => {
  let prefs={},pending;
  const chunks=[],errors=[],calls=[];
  const ctx=vm.createContext({AbortController,Map,Symbol,
    chrome:{storage:{local:{get:async()=>prefs}}},
    streamTask:async opts=>{calls.push(opts);await new Promise(resolve=>{pending=()=>{opts.onChunk('late');opts.onDone();resolve();};});},
    autoAiWork:new Map(),distillReadingAssistance:p=>({automaticHelp:p.readingAssistance?.automaticHelp===true,checkins:false}),
    distillMayAutoRun:(p,t)=>p.automaticHelp&&t==='summary'
  });
  const a=background.indexOf('async function runAutomaticTask('),b=background.indexOf('\nasync function streamTask(',a);
  if(a>=0)vm.runInContext(background.slice(a,b),ctx);
  const opts={task:'summary',tabId:1,onChunk:x=>chunks.push(x),onDone:()=>chunks.push('done'),onError:e=>errors.push(e.code)};
  await ctx.runAutomaticTask?.(opts);expect(calls.length).toBe(0);expect(errors).toEqual(['CANCELLED']);
  prefs={readingAssistance:{automaticHelp:true}};const work=ctx.runAutomaticTask(opts);await later();
  expect(calls.length).toBe(1);for(const value of ctx.autoAiWork.values())value.ctrl.abort();pending();await work;
  expect(chunks).toEqual([]);expect(errors).toEqual(['CANCELLED','CANCELLED']);expect(ctx.autoAiWork.size).toBe(0);
});
