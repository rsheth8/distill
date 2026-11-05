import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import '../../extension/utils/readAlong.js';
import '../../extension/readAlong.js';
let utterances, local, remote;
beforeEach(() => {
 document.body.innerHTML='<article><p>The first sentence has 2.5 mg. The next sentence has a clear conclusion.</p></article>';
 utterances=[];local={name:'Local',voiceURI:'local',localService:true};remote={name:'Remote',voiceURI:'remote',localService:false};
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[local,remote],speak:u=>utterances.push(u),cancel:vi.fn(),addEventListener:vi.fn()}});
 globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
 globalThis.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}}};
 vi.useFakeTimers();
});
afterEach(()=>{document.dispatchEvent(new Event('visibilitychange'));vi.clearAllTimers();vi.useRealTimers();});
const setup=async()=>{await globalThis.distillStartReadAlong([...document.querySelectorAll('article p')],'test');return document.querySelector('#distill-read-along').shadowRoot;};
it('never offers remote voice until opted in, and sends exact paper text',async()=>{
 const ui=await setup();expect(ui.querySelector('#voice').options.length).toBe(1);
 ui.querySelector('#mode').value='voice';ui.querySelector('#mode').dispatchEvent(new Event('change'));
 ui.querySelector('#play').click();expect(utterances[0].voice).toBe(local);expect(utterances[0].text).toBe('The first sentence has 2.5 mg. ');
 ui.querySelector('#stop').click();const before=ui.querySelector('#progress').value;
 utterances[0].onend();expect(ui.querySelector('#progress').value).toBe(before);expect(utterances.length).toBe(1);
 ui.querySelector('#online').checked=true;ui.querySelector('#online').dispatchEvent(new Event('change'));
 expect(ui.querySelector('#voice').options.length).toBe(2);
});
it('silent pause prevents timer advancement and manual scroll suspends following',async()=>{
 const ui=await setup();ui.querySelector('#play').click();await vi.advanceTimersByTimeAsync(600);ui.querySelector('#play').click();
 const before=ui.querySelector('#progress').value;await vi.advanceTimersByTimeAsync(1000);expect(ui.querySelector('#progress').value).toBe(before);
 window.dispatchEvent(new Event('wheel'));expect(ui.querySelector('#status').textContent).toContain('Following paused');
});
it('requires an explicit voice choice when only remote voices exist',async()=>{
 window.speechSynthesis.getVoices=()=>[remote];const ui=await setup();
 ui.querySelector('#online').checked=true;ui.querySelector('#online').dispatchEvent(new Event('change'));
 ui.querySelector('#mode').value='voice';ui.querySelector('#mode').dispatchEvent(new Event('change'));ui.querySelector('#play').click();
 expect(utterances.length).toBe(0);
 ui.querySelector('#voice').value='remote';ui.querySelector('#voice').dispatchEvent(new Event('change'));ui.querySelector('#play').click();expect(utterances[0].voice).toBe(remote);
});
