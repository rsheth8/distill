// Use an installed Playwright and Chrome; never touches the user's Chrome profile.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { chromium } = await import(process.env.DISTILL_PLAYWRIGHT || 'playwright');
const root = path.resolve(import.meta.dirname,'../../..');
const out = path.resolve(process.env.DISTILL_QA_OUT || `${root}/dist/evaluation/direct-setup`);
await fs.mkdir(out,{recursive:true});
const profile = await fs.mkdtemp(path.join(os.tmpdir(),'distill-direct-'));
const context = await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.DISTILL_CHROME,args:[`--disable-extensions-except=${process.env.DISTILL_EXTENSION_DIR || root+'/extension'}`,`--load-extension=${process.env.DISTILL_EXTENSION_DIR || root+'/extension'}`]});
const evidence = {date:new Date().toISOString(),freshProfile:true,relay:false,network:[],checks:[]};
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 evidence.extensionOrigin=worker.url().split('/').slice(0,3).join('/');
 evidence.browserVersion=context.browser()?.version();
 await worker.evaluate(() => {
  const original = globalThis.fetch; globalThis.__readinessRequests = [];
  globalThis.fetch = (url, init) => { globalThis.__readinessRequests.push({ url: String(url), method: init?.method || 'GET' }); return original(url, init); };
 });
 for(const [name,baseUrl,model] of [['ordinary-ollama','http://localhost:11434','qwen2.5:7b'],['wrong-model','http://localhost:11434','distill-missing-eval-model'],['unreachable','http://127.0.0.1:1','qwen2.5:7b'],['lmstudio','http://localhost:1234','actual-model-unknown']]) {
  const result=await worker.evaluate(async ({baseUrl,model})=>validateLocal({baseUrl,model}),{baseUrl,model});
  evidence.checks.push({name,baseUrl,model,result});
 }
 const page=await context.newPage();await page.goto(worker.url().replace(/background.js.*$/,'sidepanel.html'));
 await page.click('#settingsBtn');
 await page.selectOption('#aiProviderSelect','local');
 await page.fill('#localBaseUrlInput','http://localhost:11434');
 await page.fill('#localModelInput','qwen2.5:7b');
 await page.click('#validateKeyBtn');
 await page.waitForFunction(()=>!document.querySelector('#validateKeyBtn').disabled && document.querySelector('#keyStatusLine').textContent.includes('OLLAMA_ORIGINS'),{},{timeout:35000});
 evidence.freshSettingsResult=await page.locator('#keyStatusLine').innerText();
 evidence.chromeBuiltIn=await page.evaluate(async()=>({apiPresent:typeof LanguageModel!=='undefined',availability:typeof LanguageModel==='undefined'?'api-absent':await LanguageModel.availability({expectedInputs:[{type:'text',languages:['en']}],expectedOutputs:[{type:'text',languages:['en']}]})}));
 evidence.network = await worker.evaluate(() => globalThis.__readinessRequests);
 await fs.writeFile(`${out}/results.json`,JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
} finally {await context.close();await fs.rm(profile,{recursive:true,force:true});}
