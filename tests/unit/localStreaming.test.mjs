import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
const helpers=require('../../extension/utils/openaiCompatAdapter.js');
const source=readFileSync(new URL('../../extension/background.js',import.meta.url),'utf8');
const stream=source.slice(source.indexOf('async function streamOpenAiCompat('),source.indexOf('/** One-shot key check'));
const chunk=(text,finish=null)=>`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:finish}]})}\n\n`;
async function run(body,{signal,timeout=false,status=200,errorBody}={}){
 const events=[];
 const context=vm.createContext({
  ...helpers, AbortSignal:timeout?{any:AbortSignal.any,timeout:()=>AbortSignal.abort(new DOMException('Timed out','TimeoutError'))}:AbortSignal,
  TextDecoder, chrome:{runtime:{id:'test'}},delay:async()=>{},
  fetch:async(_url,opts)=>{if(opts.signal.aborted)throw opts.signal.reason;return new Response(status===200?body:JSON.stringify(errorBody),{status});}
 });
 vm.runInContext(stream,context);
 await context.streamOpenAiCompat({cfg:{local:true,url:'http://localhost:11434/v1/chat/completions',baseUrl:'http://localhost:11434',model:'test'},signal,messages:[],onChunk:t=>events.push(['text',t]),onDone:()=>events.push(['done']),onError:e=>events.push(['error',typeof e.code === 'string' ? e.code : e.name])});
 return events;
}
describe('local stream recovery',()=>{
 it('accepts a completed SSE answer',async()=>{
  expect(await run(chunk('42 adults','stop')+'data: [DONE]\n\n')).toEqual([['text','42 adults'],['done']]);
 });
 it('rejects an interrupted stream instead of saving a partial answer',async()=>{
  expect(await run(chunk('partial'))).toEqual([['text','partial'],['error','CHAT_INTERRUPTED']]);
 });
 it('rejects output truncation even when DONE follows',async()=>{
  expect(await run(chunk('partial','length')+'data: [DONE]\n\n')).toEqual([['text','partial'],['error','CHAT_TRUNCATED']]);
 });
 it('preserves user cancellation',async()=>{
  expect(await run('',{signal:AbortSignal.abort()})).toEqual([['error','AbortError']]);
 });
 it('gives a timeout recovery message rather than an unreachable-server diagnosis',async()=>{
  expect(await run('',{timeout:true})).toEqual([['error','LOCAL_TIMEOUT']]);
 });
 it('classifies actual server context errors',async()=>{
  expect(await run('',{status:400,errorBody:{error:{message:'maximum context length exceeded'}}})).toEqual([['error','LOCAL_CONTEXT']]);
 });
 it('does not suggest Ollama install commands for LM Studio',()=>{
  const r=helpers.distillClassifyLocalError(404,{baseUrl:'http://localhost:1234',model:'missing'});
  expect(r.message).toContain('/v1/models');expect(r.message).not.toContain('ollama pull');
 });
});

describe('terminal stream edge cases',()=>{
 it('reads a final SSE record without a trailing newline',async()=>{
  expect(await run(chunk('42','stop').trim())).toEqual([['text','42'],['done']]);
 });
 it('does not save a filtered partial answer as success',async()=>{
  expect(await run(chunk('partial','content_filter')+'data: [DONE]\n\n')).toEqual([['text','partial'],['error','CHAT_INCOMPLETE']]);
 });
});
