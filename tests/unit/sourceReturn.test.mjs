import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const c=vm.createContext({module:{exports:{}},crypto:webcrypto,TextEncoder});
try{vm.runInContext(readFileSync('extension/utils/sourceReturn.js','utf8'),c);}catch(e){if(e.code!=='ENOENT')throw e;}
it('uses full source identity, rejecting changed papers and out-of-range return anchors',async()=>{
 const {distillSourceVersion:version,distillValidSourceReturn:valid}=c.module.exports;
 const first=await version?.('Same beginning. First conclusion.');
 const next=await version?.('Same beginning. Other conclusion.');
 expect(typeof first).toBe('string');expect(first).not.toBe(next);
 const anchor={schemaVersion:1,paperKey:'paper-a',sourceVersion:first,blockIndex:0,charOffset:12,view:'html',focusTarget:'ask-source'};
 expect(valid?.(anchor,{paperKey:'paper-a',sourceVersion:first,textLength:32})).toBe(true);
 expect(valid?.(anchor,{paperKey:'paper-b',sourceVersion:first,textLength:32})).toBe(false);
 expect(valid?.(anchor,{paperKey:'paper-a',sourceVersion:next,textLength:32})).toBe(false);
 expect(valid?.({...anchor,charOffset:100},{paperKey:'paper-a',sourceVersion:first,textLength:32})).toBe(false);
 expect(valid?.({...anchor,focusTarget:'javascript:bad'},{paperKey:'paper-a',sourceVersion:first,textLength:32})).toBe(false);
});
