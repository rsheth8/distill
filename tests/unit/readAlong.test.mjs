import { describe, it, expect } from 'vitest';
import '../../extension/utils/readAlong.js';
const { model, chunks, route, session, align } = globalThis.DistillReadAlong;
describe('canonical reading', () => {
 it('retains source offsets and quantities across chunks', () => { const text='Dose 2.5 mg. Next sentence. '+ 'x'.repeat(700); const m=model([text]); const c=chunks(m.text); expect(c.map(x=>x.text).join('')).toBe(text); expect(c.every(x=>x.text.length<=320)).toBe(true); expect(m.words[1].start).toBe(5); });
 it('rejects remote or missing local voice without explicit consent',()=>{ expect(route({localService:false},false)).toBe(false); expect(route(null,true)).toBe(false); expect(route({localService:true},false)).toBe(true); expect(route({localService:false},true)).toBe(true); });
 it('invalidates callbacks on cancel and restart',()=>{ const s=session(); const a=s.next(); expect(s.valid(a)).toBe(true); s.next(); expect(s.valid(a)).toBe(false); });
 it('only aligns unique source context and repairs line hyphens',()=>{ expect(align('A scientific discovery.', 'scientific')).toEqual({start:2,end:12}); expect(align('the the','the')).toBe(null); expect(align('A scien-\ntific discovery.', 'scientific')).toEqual({start:2,end:14}); expect(align('abc','unrelated')).toBe(null); });
});
it('maps words inside unique PDF context even with repeated prefixes',()=>{
 expect(globalThis.DistillReadAlong.alignRange('The dose. The scien-\ntific result.', 'The dose. The scientific result.', 14,24)).toEqual({start:14,end:26});
});
it('rejects text repeated on another PDF page, even if ambiguous within that page',()=>{
 expect(globalThis.DistillReadAlong.pageFor(['header header','header'],'header')).toBe(null);
 expect(globalThis.DistillReadAlong.pageFor(['first','Scientific result.'],'Scientific result.')).toBe(2);
});
