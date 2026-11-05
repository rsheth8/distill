// Production PDF reader capture. Requires existing Playwright/Chrome; no bundled papers.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const {chromium}=await import(process.env.DISTILL_PLAYWRIGHT || 'playwright');
const root=path.resolve(import.meta.dirname,'../../..');
const specs=JSON.parse(await fs.readFile(`${root}/docs/evaluation/papers.json`)).papers.filter(p=>p.format==='pdf');
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'distill-pdf-eval-'));
const ctx=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.DISTILL_CHROME,args:[`--disable-extensions-except=${root}/extension`,`--load-extension=${root}/extension`]});
try {
 const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 const base=sw.url().split('/').slice(0,3).join('/');
 await sw.evaluate(()=>chrome.storage.local.set({aiProvider:'local',localBaseUrl:'http://127.0.0.1:1'}));
 for(const spec of specs){
  const dir=`${process.env.DISTILL_PDF_OUT || `${root}/dist/evaluation/baseline`}/${spec.id}`;await fs.mkdir(dir,{recursive:true});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const start=performance.now();let result;
  try {
   await page.goto(`${base}/reader.html?src=${encodeURIComponent(spec.url)}`);
   await page.waitForFunction(()=>globalThis.distillReaderPaper || document.querySelector('#status')?.textContent.includes("Couldn't"),{},{timeout:120000});
   const paper=await page.evaluate(()=>globalThis.distillReaderPaper||null);
   result={date:new Date().toISOString(),status:paper?'extracted':'failed',productionReader:true,source:spec.url,latencyMs:Math.round(performance.now()-start),errors,statusText:await page.locator('#status').textContent(),sections:paper?.sections.map(s=>({heading:s.heading,chars:s.text.length})),abstractChars:paper?.abstract?.length||0, warnings:paper&&!paper.abstract?['No labeled abstract extracted; inspect original PDF before relying on overview.']:['Text extraction does not establish table/equation fidelity.']};
   if(paper) await fs.writeFile(`${dir}/paper.json`,JSON.stringify(paper));
   await page.screenshot({path:`${dir}/pdf-reader.png`});
  }catch(e){result={status:'failed',error:e.message,errors};}
  await fs.writeFile(`${dir}/production-pdf.json`,JSON.stringify(result,null,2));console.log(spec.id,result.status,result.sections?.length,result.error||result.statusText);await page.close();
 }
}finally{await ctx.close();await fs.rm(profile,{recursive:true,force:true});}
