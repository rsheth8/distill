import { it, expect } from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const c=vm.createContext({module:{exports:{}}});
try{vm.runInContext(readFileSync('extension/utils/localConnection.js','utf8'),c);}catch(e){if(e.code!=='ENOENT')throw e;}
it('compares exact model IDs with normalized OpenAI-compatible server roots',()=>{
 const {distillLocalConnectionSnapshot:s,distillSameLocalConnection:eq}=c.module.exports;
 expect(s?.({baseUrl:' http://localhost:11434/v1/ ',model:' qwen2.5:7b '})).toEqual({baseUrl:'http://localhost:11434',model:'qwen2.5:7b'});
 expect(eq?.({baseUrl:'http://localhost:11434/',model:'qwen2.5:7b'},{baseUrl:'http://localhost:11434/v1',model:'qwen2.5:7b'})).toBe(true);
 expect(eq?.({baseUrl:'http://localhost:11434',model:'qwen2.5:7b'},{baseUrl:'http://localhost:11434',model:'qwen3:4b'})).toBe(false);
});
