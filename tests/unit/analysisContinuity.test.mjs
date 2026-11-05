import {it,expect} from 'vitest';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync('extension/background.js','utf8');
it('replaced analysis cannot publish or save late output for an old selection',async()=>{
 const sent=[],calls=[],state={highlightHistory:[]};
 const ctx=vm.createContext({AbortController,Map,Date,Math,MAX_SELECTION_CHARS:900,clampText:x=>x,
   lastAiRetryByTab:new Map(),analysisWork:new Map(),tabState:new Map([[1,state]]),toPanel:x=>sent.push(x),isBackendUnreachableError:()=>false,
   schedulePersistTab(){},persistHistorySnapshot(){},broadcastHighlightHistory(){},
   streamTask:async options=>{calls.push(options);}
 });
 const a=src.indexOf('async function runAnalyzeStream('),b=src.indexOf('\nasync function runAnalyzeFromReplay',a);
 vm.runInContext(src.slice(a,b),ctx);
 await ctx.runAnalyzeStream(1,state,{},'First selection.');
 await ctx.runAnalyzeStream(1,state,{},'Second selection.');
 calls[0].onChunk('late wrong result');calls[0].onDone();
 expect(state.highlightHistory).toEqual([]);
 expect(sent.filter(x=>x.type==='ANALYSIS_CHUNK')).toEqual([]);
 calls[1].onChunk('Current result');calls[1].onDone();
 expect(state.highlightHistory[0].selection).toBe('Second selection.');
 await ctx.runAnalyzeStream(1,state,{},'Retry this selection.');
 calls[2].onError({code:'FAILED',message:'Try again'});
 expect(typeof ctx.lastAiRetryByTab.get(1)).toBe('function');
 await ctx.lastAiRetryByTab.get(1)();
 calls[3].onChunk('Retried result');calls[3].onDone();
 expect(state.highlightHistory[0].analysis).toBe('Retried result');
 expect(sent.filter(x=>x.type==='ANALYSIS_START').at(-1).requestId).not.toBe(sent.filter(x=>x.type==='ANALYSIS_START').at(-2).requestId);
});
