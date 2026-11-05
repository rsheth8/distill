// Isolated operator-run benchmark. No inference, user profiles, or remote telemetry.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const {chromium}=await import(process.env.DISTILL_PLAYWRIGHT || 'playwright');
const root=path.resolve(import.meta.dirname,'../..');
const out=root+'/dist/evaluation/dependable-performance';await fs.mkdir(out,{recursive:true});
const words='This synthetic research passage describes a measured association and explicitly retains uncertainty without asserting that the relationship is causal. '.repeat(4);
const paper=count=>`<!doctype html><meta name="citation_title" content="Performance fixture"><style>body{max-width:700px;margin:40px auto;font:18px/1.6 Georgia}</style><article><h1>Performance fixture</h1><h2>Methods</h2>${Array.from({length:count},(_,i)=>`<p>Paragraph ${i+1}. ${words}</p>`).join('')}</article>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(paper(req.url==='/long'?125:25));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const runs=[];
try {
 for(const [label,extension] of [['historical-before',process.env.DISTILL_BASELINE_EXTENSION],['packaged-current',root+'/dist/extension']]) {
  if(!extension)continue;
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'distill-perf-'));
  const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.DISTILL_CHROME,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try {
   const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const base=worker.url().split('/').slice(0,3).join('/');
   const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{
    const begin=performance.now();
    document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(()=>{globalThis.__benchmarkReady=performance.now()-begin;}),{once:true});
   });
   const warm=[],cold=[];
   for(let i=0;i<31;i++){
    await page.goto(base+'/sidepanel.html');await page.waitForFunction(()=>globalThis.__benchmarkReady!==undefined);
    const duration=await page.evaluate(()=>globalThis.__benchmarkReady);(i?warm:cold).push(duration);
   }
   const extraction=[];
   for(const [scenario,endpoint] of [['typical-html','/typical'],['long-html','/long']]) {
    await page.goto(origin+endpoint);
    // Execute the exact build's extractor functions on a controlled document, separately from full intake.
    for(const file of ['utils/articleExtractor.js','utils/paperExtractor.js'])await page.addScriptTag({path:extension+'/'+file});
    const durations=await page.evaluate(()=>{
     const result=[];
     for(let i=0;i<30;i++){const start=performance.now();const paper=distillExtractPaper(document,location.href);const article=extractArticle();if(!paper||!article)throw Error('Fixture extraction failed');result.push(performance.now()-start);}
     return result;
    });
    extraction.push({scenario,n:durations.length,durations});
   }
   const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {n:sorted.length,median:sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2,p95:sorted[Math.ceil(sorted.length*.95)-1]};};
   runs.push({label,panel:{cold:{...summary(cold),status:'insufficient'},warm:{...summary(warm),status:summary(warm).p95<=300?'pass':'fail'},durations:{cold,warm}},extraction:extraction.map(x=>({...x,...summary(x.durations),status:summary(x.durations).p95<=(x.scenario==='typical-html'?500:1000)?'pass':'fail'})),errors});
  }finally{await context.close();await fs.rm(profile,{recursive:true,force:true});}
 }
 const report={date:'2026-11-05',browser:'Chrome for Testing',machine:os.arch(),scope:'Same-context initialization-to-next-frame and repeated warm extractor-function benchmarks on synthetic HTML; not native opening, full page intake, PDF, human usability, or AI latency.',runs};
 await fs.writeFile(out+'/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{server.closeAllConnections();server.close();}
