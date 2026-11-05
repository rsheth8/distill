// Deterministic interaction checks. These are NOT real-model or human validation.
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const {chromium}=await import(process.env.DISTILL_PLAYWRIGHT || 'playwright');
const root=path.resolve(import.meta.dirname,'../../..'),out=process.env.DISTILL_QA_OUT || `${root}/dist/evaluation/ui`;
const extensionDir=process.env.DISTILL_EXTENSION_DIR || `${root}/extension`;
await fs.mkdir(out,{recursive:true});
const requests=[],checks=[],errors=[];let mode='complete';
const sections={Introduction:'We investigated sleep and memory using an observational design.',Methods:'The sample included 42 adults. We measured sleep and memory without assigning sleep duration.',Results:'Longer sleep was associated with better memory. The estimated difference was 2 points (95% confidence interval 1 to 3 points).',Discussion:'The observational design cannot establish causation. The sample is small and may not generalize.'};
const paper=`<!doctype html><meta name="citation_title" content="Synthetic sleep study"><meta name="citation_author" content="Test Author"><style>body{font:18px/1.6 Georgia;max-width:700px;margin:40px auto}p{margin:80px 0}</style><article><h1>Synthetic sleep study</h1>${Object.entries(sections).map(([h,t])=>`<h2>${h}</h2><p>${t}</p><p>${'This is additional fixture context. '.repeat(6)}</p>`).join('')}</article>`;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.url==='/paper'){res.setHeader('Content-Type','text/html');res.end(paper);return;}
 if(req.url==='/normal'){res.end('<h1>Ordinary page</h1>');return;}
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture-reader'}]}));return;}
 if(req.url==='/v1/chat/completions'){
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push(body);
  if(!body.stream){res.setHeader('Content-Type','application/json');res.end('{}');return;}
  if(mode==='context'){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'maximum context length exceeded'}}));return;}
  const sys=body.messages[0].content;
  const answer=sys.includes('overview')?'ASKED: Does sleep relate to memory?\nDID: Observed 42 adults.\nFOUND: A positive association.\nWHY: May motivate further study.\nSTUDY: Observational, 42 adults.\nLIMITS:\n- Cannot establish causation.'
   :sys.includes('one section')?'This section describes the study design.\nTERMS:\nobservational — Researchers measured rather than assigned exposure.'
   :sys.includes('highlighted')?'The study measured an association, not causation.'
   :'The sample included 42 adults [S2P0]. The observational design cannot establish causation [S4P0].\nFROM: S2P0, S4P0, S99P99';
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\n');
  if(mode==='slow'){const interval=setInterval(()=>res.write(': keepalive\n\n'),1000);res.on('close',()=>clearInterval(interval));return;}
  if(mode==='interrupted'){res.end();return;}
  res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
 }
 res.writeHead(404);res.end();
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'distill-readiness-ui-'));
const ctx=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.DISTILL_CHROME,args:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`],viewport:{width:360,height:900}});
await ctx.addInitScript(()=>{if(location.protocol==='chrome-extension:')chrome.tabs.onActivated.addListener=()=>{};});
const check=(name,ok,detail)=>{checks.push({name,ok,detail});console.log(ok?'PASS':'FAIL',name,detail||'');};
try{
 const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const base=sw.url().split('/').slice(0,3).join('/');
 await sw.evaluate(async url=>{
  while(!(await chrome.storage.local.get('distillDefaultPrefsApplied')).distillDefaultPrefsApplied)await new Promise(r=>setTimeout(r,20));
  await chrome.storage.local.set({aiProvider:'local',localBaseUrl:url,localModel:'fixture-reader',useBackendProxy:true,distillSetupHintDismissed:true});
  const original=fetch;globalThis.__evalRequests=[];globalThis.fetch=(url,init)=>{__evalRequests.push({url:String(url),method:init?.method||'GET',hasPaper:!!init?.body?.includes('Synthetic sleep study')});return original(url,init);};
 },url);
 const panel=await ctx.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.goto(`${base}/sidepanel.html`);
 const source=await ctx.newPage();source.on('pageerror',e=>errors.push(e.message));await source.goto(url+'/paper');
 const tabId=(await sw.evaluate(url=>chrome.tabs.query({url}),url+'/paper'))[0].id;
 await panel.evaluate(id=>wireActiveTab(id),tabId);
 await panel.waitForFunction(()=>paperView.state?.overview?.text);
 check('overview uses real worker and panel with fixture inference',await panel.locator('#overviewBody').innerText().then(t=>t.includes('Does sleep')));
 await panel.selectOption('#expertiseSelect','expert');await panel.waitForFunction(()=>paperView.state?.overview?.text && !paperView.live.size);
 await panel.waitForTimeout(150);
 check('experience selection reaches overview prompt',requests.some(r=>r.messages[0].content.includes('experienced researcher')));
 await panel.click('#tabAskBtn');await panel.fill('#askInput','What was the sample and limitation?');await panel.locator('#askForm button').click();
 await panel.waitForFunction(()=>paperView.state?.askThread?.[0]?.a);
 check('only supplied citations become source controls',await panel.locator('#askThread details').count()===2);
 check('invented ID gets no navigable source',!(await panel.locator('#askThread summary').allTextContents()).some(t=>t.includes('S99P99')));
 await panel.locator('#askThread summary').first().click();
 check('source passage is inspectable',await panel.locator('#askThread blockquote').first().isVisible());
 await panel.locator('#askThread details button').first().click();await source.waitForTimeout(200);
 check('source navigation focuses actual passage',await source.evaluate(()=>document.activeElement?.textContent.includes('42 adults')));
 await panel.evaluate(()=>{globalThis.__copiedNotes='';navigator.clipboard.writeText=async value=>{globalThis.__copiedNotes=value;};});
 await panel.click('#tabReadBtn');await panel.locator('#copyMenu summary').click();await panel.locator('#copyMenu [data-format=markdown]').click();
 await panel.waitForFunction(()=>globalThis.__copiedNotes?.includes('Supplied passages'));
 check('first-use note export includes overview, Ask and supplied evidence',await panel.evaluate(()=>__copiedNotes.includes('42 adults')&&__copiedNotes.includes('AI overview')&&__copiedNotes.includes('S2P0')));
 await panel.click('#tabAskBtn');
 for(const scheme of ['light','dark'])for(const width of [360,480]){
  await panel.emulateMedia({colorScheme:scheme});await panel.setViewportSize({width,height:900});
  check(`Ask fits ${scheme} ${width}`,await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await panel.screenshot({path:`${out}/ask-${scheme}-${width}.png`,fullPage:true});
 }
 await panel.evaluate(()=>document.body.style.zoom='2');
 check('200% zoom has no horizontal document overflow at 480px',await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await panel.screenshot({path:`${out}/ask-zoom.png`,fullPage:true});await panel.evaluate(()=>document.body.style.zoom='');
 await panel.keyboard.press('Tab');check('keyboard reaches a visible control',await panel.evaluate(()=>document.activeElement!==document.body));
 check('keyboard focus has a visible outline',await panel.evaluate(()=>{const style=getComputedStyle(document.activeElement);return style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>=2;}));
 await panel.emulateMedia({reducedMotion:'reduce'});check('reduced motion disables logo animation',await panel.locator('.wavy-d-logo g path').first().evaluate(e=>getComputedStyle(e).animationName==='none'));
 mode='slow';await panel.fill('#askInput','Wait for a response');await panel.locator('#askForm button').click();await panel.waitForSelector('#paperStopBtn:not(.hidden)');await panel.click('#paperStopBtn');await panel.waitForSelector('#askRetryBtn:not(.hidden)');
 check('cancel releases stream and offers retry',await panel.locator('#askStatus').innerText().then(t=>t.includes('Stopped')));
 mode='complete';await panel.click('#askRetryBtn');await panel.waitForFunction(()=>paperView.state.askThread.length===2&&!!paperView.state.askThread[1].a);check('retry completes after cancellation',true);
 mode='interrupted';await panel.fill('#askInput','Interrupted question');await panel.locator('#askForm button').click();await panel.waitForFunction(()=>document.querySelector('#askStatus').textContent.includes('ended before'));
 check('interrupted answer is not saved as completed',await panel.evaluate(()=>!paperView.state.askThread.some(e=>e.q==='Interrupted question'&&e.a)));
 mode='context';await panel.fill('#askInput','Context question');await panel.locator('#askForm button').click();await panel.waitForFunction(()=>document.querySelector('#askStatus').textContent.includes('context window'));check('context failure offers actionable message',true);
 mode='complete';await panel.click('#settingsBtn');
 if(process.env.DISTILL_EXTENSION_DIR) check('packaged build hides hosted-backend settings',await panel.locator('#advancedBackendDetails').isHidden());await panel.click('#discoverModelsBtn');await panel.waitForFunction(()=>document.querySelectorAll('#localModelsList option').length===1);check('model discovery lists installed ID',await panel.locator('#localModelsList option').getAttribute('value')==='fixture-reader');
 await panel.click('#checkBrowserModelBtn');await panel.waitForFunction(()=>document.querySelector('#browserModelStatus').textContent);check('Chrome availability is explicit without download',await panel.locator('#browserModelStatus').innerText().then(t=>t.includes('unavailable')||t.includes('not yet verified')||t.includes('download')));
 for(const width of [360,480]){await panel.setViewportSize({width,height:900});check(`Settings fits ${width}`,await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await panel.screenshot({path:`${out}/settings-${width}.png`,fullPage:true});}
 const network=await sw.evaluate(()=>__evalRequests);await fs.writeFile(`${out}/network.json`,JSON.stringify(network,null,2));check('paper-bearing inference stays at configured loopback server despite backend preference',network.filter(r=>r.hasPaper).every(r=>r.url.startsWith(url+'/v1/chat/completions'))&&network.some(r=>r.hasPaper));
 check('no JavaScript page errors',errors.length===0,errors);
}catch(e){check('walkthrough completed',false,e.stack);}
finally{await fs.writeFile(`${out}/results.json`,JSON.stringify({fixture:true,checks,errors},null,2));await ctx.close();server.closeAllConnections();server.close();await fs.rm(profile,{recursive:true,force:true});}
if(checks.some(c=>!c.ok))process.exitCode=1;
