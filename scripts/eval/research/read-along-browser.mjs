// Real Chrome production-package checks. No mocked speech callbacks.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.DISTILL_PLAYWRIGHT || 'playwright');
const root = path.resolve(import.meta.dirname, '../../..');
const out = `${root}/dist/evaluation/read-along`; await fs.mkdir(out, { recursive: true });
const requests = [], errors = [], checks = [];
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/paper') { res.setHeader('Content-Type','text/html'); res.end(`<meta name="citation_title" content="Read along test"><article><h1>Read along test</h1><h2>Introduction</h2><p>${'The dose was 2.5 mg. The study measured an association, with no causal conclusion. '.repeat(30)}</p><h2>Results</h2><p>${'The result remains uncertain. '.repeat(30)}</p></article>`); }
  else if (req.url === '/planck.pdf') { res.setHeader('Content-Type','application/pdf'); res.end(await fs.readFile(`${root}/dist/evaluation/accuracy-source/planck-v3.pdf`)); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'distill-readalong-'));
const extension = process.env.DISTILL_EXTENSION_DIR || `${root}/dist/extension`;
const ctx = await chromium.launchPersistentContext(profile, { executablePath:process.env.DISTILL_CHROME, headless:false, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`], viewport:{width:480,height:850} });
try {
 ctx.on('request', r => { if (!r.url().startsWith('chrome-extension:')) requests.push({url:r.url().split('?')[0],method:r.method()}); });
 const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
 const base = worker.url().split('/').slice(0,3).join('/');
 const page = await ctx.newPage(); page.on('pageerror',e=>errors.push(e.message)); await page.goto(origin+'/paper');
 await page.locator('#distill-read-along').waitFor();
 const ui = page.locator('#distill-read-along');
 await ui.locator('#play').click(); await page.waitForTimeout(600); await ui.locator('#play').click();
 assert.ok(Number(await ui.locator('#progress').getAttribute('value')) > 0); checks.push('silent advances');
 await ui.locator('#next').click(); const progress = await ui.locator('#progress').getAttribute('value');
 await page.reload(); await page.locator('#distill-read-along').waitFor(); await page.waitForTimeout(500);
 assert.equal(await ui.locator('#progress').getAttribute('value'), progress); checks.push('position persistence');
 for (const width of [360,480]) for (const theme of ['light','dark']) {
  await page.setViewportSize({width,height:850}); await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  assert.ok(await ui.evaluate(el=>el.getBoundingClientRect().right <= innerWidth));
  await page.screenshot({path:`${out}/html-${width}-${theme}.png`}); checks.push(`${width} ${theme} controls fit`);
 }
 await ui.locator('#mode').selectOption('voice'); await page.waitForTimeout(600);
 const voices = await page.evaluate(()=>speechSynthesis.getVoices().map(v=>({name:v.name,uri:v.voiceURI,local:v.localService,lang:v.lang})));
 await fs.writeFile(`${out}/voices.json`,JSON.stringify(voices,null,2));
 assert.ok(voices.some(v=>v.local));
 await ui.locator('#play').click(); await page.waitForTimeout(2000);
 const speechStatus = await ui.locator('#status').textContent();
 const speechActive = await page.evaluate(()=>speechSynthesis.speaking);
 await ui.locator('#stop').click(); assert.equal(await page.evaluate(()=>speechSynthesis.speaking),false);
 checks.push('real local speech start/stop requested');
 const pdfs = [origin+'/planck.pdf','https://arxiv.org/pdf/1602.03837','https://arxiv.org/pdf/1706.03762'];
 const pdfResults=[];
 for (let i=0;i<pdfs.length;i++) {
  const pdf = await ctx.newPage();pdf.on('pageerror',e=>errors.push(e.message));
  try {
   await pdf.goto(`${base}/reader.html?src=${encodeURIComponent(pdfs[i])}`);
   await pdf.locator('#distill-read-along').waitFor({timeout:90000});
   const controls=pdf.locator('#distill-read-along');await controls.locator('#next').click();
   let before=await controls.locator('#progress').getAttribute('value');
   await pdf.getByRole('button',{name:'Original PDF',exact:true}).click();await pdf.locator('.textLayer span').first().waitFor({timeout:30000});
   assert.equal(await controls.locator('#progress').getAttribute('value'),before);
   const alignment = await pdf.evaluate(() => {
    const layer = document.querySelector('.textLayer');
    const paragraphs = [...document.querySelectorAll('#reading [data-air-id]')];
    const target = paragraphs.find(el => globalThis.DistillReadAlong.align(layer.textContent, el.textContent));
    if (!target) return {status:'no-full-block-match-on-first-page'};
    document.dispatchEvent(new CustomEvent('distill-source-position',{detail:{element:target}}));
    return {status:'matched',highlight:CSS.highlights.has('distill-word'),text:target.textContent.slice(0,100)};
   });
   const paragraphAlignment=await pdf.evaluate(async()=>{
    const blocks=[...document.querySelectorAll('#reading p[data-air-id]')].filter(el=>el.textContent.length>100);
    const target=blocks.find(el=>globalThis.distillPdfResolve(el.textContent));
    if(!target)return {status:'no-unique-paragraph-match'};
    const result=await globalThis.distillReadingNavigation.jump(target.textContent);
    return {status:result?'requested':'failed',page:globalThis.distillPdfResolve(target.textContent),characters:target.textContent.length};
   });
   if(paragraphAlignment.status==='requested'){
    await pdf.waitForFunction(()=>CSS.highlights.has('distill-word'),null,{timeout:15000});
    paragraphAlignment.highlight=true;
    paragraphAlignment.returned=await pdf.evaluate(()=>globalThis.distillReadingNavigation.returnToReading());
   }
   before=await controls.locator('#progress').getAttribute('value');
   await pdf.setViewportSize({width:900,height:850});await pdf.waitForTimeout(900);
   await pdf.getByRole('button',{name:'Reading view',exact:true}).click();assert.equal(await controls.locator('#progress').getAttribute('value'),before);
   await pdf.setViewportSize({width:600,height:850}); await pdf.waitForTimeout(500);
   await pdf.getByRole('button',{name:'Original PDF',exact:true}).click(); await pdf.locator('.textLayer span').first().waitFor();
   assert.ok(await pdf.locator('.page').first().evaluate(el=>el.getBoundingClientRect().width > 0));
   await pdf.getByRole('button',{name:'Reading view',exact:true}).click();
   await pdf.screenshot({path:`${out}/pdf-${i}.png`});pdfResults.push({url:pdfs[i],status:'view-position-preserved',pages:await pdf.locator('.page').count(),alignment,paragraphAlignment});
  } catch(e) {pdfResults.push({url:pdfs[i],status:'failed',error:e.message});} finally {await pdf.close();}
 }
 await fs.writeFile(`${out}/results.json`,JSON.stringify({checks,errors,voices:voices.length,speechStatus,speechActive,pdfResults,requests,audioPerception:'Not evaluated: browser speaking status and boundary events do not establish perceived sound or naturalness.'},null,2));
 console.log(JSON.stringify({checks,errors,speechStatus,speechActive,pdfResults},null,2));
}finally{await ctx.close();server.close();await fs.rm(profile,{recursive:true,force:true});}
