// Opens Chrome's actual native side-panel container in a headed temporary profile.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const {chromium}=await import(process.env.DISTILL_PLAYWRIGHT||'playwright');
const root=path.resolve(import.meta.dirname,'../../..'),out=process.env.DISTILL_NATIVE_OUT || root+'/dist/evaluation/native';await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(os.tmpdir()+'/distill-native-');
const ctx=await chromium.launchPersistentContext(profile,{headless:false,executablePath:process.env.DISTILL_CHROME,args:[`--disable-extensions-except=${process.env.DISTILL_EXTENSION_DIR || root+'/extension'}`,`--load-extension=${process.env.DISTILL_EXTENSION_DIR || root+'/extension'}`]});
try{
 const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const base=sw.url().split('/').slice(0,3).join('/');
 await sw.evaluate(async()=>{while(!(await chrome.storage.local.get('distillDefaultPrefsApplied')).distillDefaultPrefsApplied)await new Promise(r=>setTimeout(r,20));await chrome.storage.local.set({aiProvider:'local',localBaseUrl:'http://127.0.0.1:1',localModel:'unavailable-test',distillSetupHintDismissed:true});});
 const helper=await ctx.newPage();await helper.goto(base+'/sidepanel.html');
 await helper.evaluate(()=>{const btn=document.createElement('button');btn.id='nativeProbe';btn.textContent='Open native panel';btn.onclick=async()=>{try{await chrome.sidePanel.open({windowId:(await chrome.windows.getCurrent()).id});document.body.dataset.nativeResult='opened';}catch(e){document.body.dataset.nativeResult=e.message;}};document.body.prepend(btn);});
 await helper.click('#nativeProbe');await helper.waitForTimeout(700);
 const pages=ctx.pages(),native=pages.find(p=>p!==helper&&p.url()===helper.url());
 const evidence={date:new Date().toISOString(),openApiResult:await helper.evaluate(()=>document.body.dataset.nativeResult),nativePageAttached:!!native,scope:'Actual sidePanel.open from user gesture; OS shortcut dispatch and screen reader not tested.'};
 if(native){
  await native.waitForLoadState();
  evidence.initialLayout=await native.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,title:document.title}));
  await native.screenshot({path:out+'/native-panel.png'});
  const article=await ctx.newPage();await article.goto('https://arxiv.org/html/1706.03762v7');await article.bringToFront();
  await native.waitForSelector('#paperCard:not(.hidden)',{timeout:30000});
  evidence.paper=await native.locator('#articleTitle').innerText();
  await native.click('#tabAskBtn');await native.fill('#askInput','What is the main result?');await native.locator('#askForm button').click();
  await native.waitForFunction(()=>document.querySelector('#askStatus').textContent.includes('reach'),{},{timeout:15000});
  evidence.connectionFailure=await native.locator('#askStatus').innerText();
  evidence.retryVisible=await native.locator('#askRetryBtn').isVisible();
  await native.screenshot({path:out+'/native-failure.png'});
 }
 if (!native) {
  const cdp=await ctx.newCDPSession(helper);
  const {targetInfos}=await cdp.send('Target.getTargets');
  const helperTarget=(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
  const target=targetInfos.find(t=>t.url===helper.url()&&t.targetId!==helperTarget);
  if(target){
   const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
   let seq=0;const pending=new Map();
   cdp.on('Target.receivedMessageFromTarget',event=>{if(event.sessionId!==sessionId)return;const m=JSON.parse(event.message);if(m.id){const callback=pending.get(m.id);pending.delete(m.id);callback?.(m);}});
   const send=async(method,params={})=>{const id=++seq;const promise=new Promise(resolve=>pending.set(id,resolve));await cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});return promise;};
   const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.result?.value;
   evidence.nativeTargetAttached=true;
   evidence.initialLayout=await evaluate('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,title:document.title})');
   const article=await ctx.newPage();await article.goto('https://arxiv.org/html/1706.03762v7');await article.bringToFront();
   for(let attempt=0;attempt<50;attempt++){evidence.paper=await evaluate('document.querySelector("#articleTitle")?.textContent');if(evidence.paper?.includes('Attention'))break;await helper.waitForTimeout(200);}
   const screenshot=(await send('Page.captureScreenshot',{format:'png'})).result?.data;
   if(screenshot)await fs.writeFile(out+'/native-panel.png',Buffer.from(screenshot,'base64'));
   evidence.nativeState=await evaluate('({paper:document.querySelector("#articleTitle")?.textContent,overviewStatus:document.querySelector("#overviewStatus")?.textContent,retryVisible:!document.querySelector("#overviewRetryBtn")?.classList.contains("hidden")})');
   await cdp.send('Target.detachFromTarget',{sessionId});
  }
 }
 await fs.writeFile(out+'/results.json',JSON.stringify(evidence,null,2));console.log(evidence);
}finally{await ctx.close();await fs.rm(profile,{recursive:true,force:true});}
