import { describe,it,expect,vi } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {distillBrowserModelAvailability:availability,distillStreamBrowserModel:stream}=require('../../extension/utils/browserModel.js');
describe('window-only Chrome model capability paths (fixtures, not live inference)',()=>{
 it('handles missing API and unsupported runtime',async()=>{
  expect((await availability({})).status).toBe('unavailable');
  expect((await availability({availability:async()=> 'unavailable'})).status).toBe('unavailable');
 });
 it('never starts a model download without explicit consent',async()=>{
  const api={availability:async()=> 'downloadable',create:vi.fn()};
  await expect(stream({api,onChunk:()=>{}})).rejects.toMatchObject({code:'BROWSER_MODEL_UNAVAILABLE'});
  expect(api.create).not.toHaveBeenCalled();
 });
 it('streams available text and destroys the session',async()=>{
  const destroy=vi.fn(),onChunk=vi.fn();
  const api={availability:async()=> 'available',create:async opts=>{
   expect(opts.expectedInputs).toEqual([{type:'text',languages:['en']}]);
   return {contextWindow:5000,measureContextUsage:async()=>100,promptStreaming:async function*(){yield '42 ';yield 'adults';},destroy};
  }};
  await stream({api,messages:[{role:'user',content:'Q'}],onChunk});
  expect(onChunk.mock.calls.flat().join('')).toBe('42 adults');expect(destroy).toHaveBeenCalledOnce();
 });
 it('reports oversized context and destroys without inference',async()=>{
  const destroy=vi.fn(),promptStreaming=vi.fn();
  const api={availability:async()=> 'available',create:async()=>({contextWindow:10,measureContextUsage:async()=>20,destroy,promptStreaming})};
  await expect(stream({api,onChunk:()=>{}})).rejects.toMatchObject({code:'BROWSER_MODEL_CONTEXT'});
  expect(promptStreaming).not.toHaveBeenCalled();expect(destroy).toHaveBeenCalledOnce();
 });
 it('aborts before creation and never invokes a cloud fallback',async()=>{
  const api={availability:async()=> 'available',create:vi.fn()};
  await expect(stream({api,signal:AbortSignal.abort(),onChunk:()=>{}})).rejects.toMatchObject({name:'AbortError'});
  expect(api.create).not.toHaveBeenCalled();
 });
});
