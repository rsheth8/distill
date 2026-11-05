// Reproducible local quality capture. No downloads of models or server mutations.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Window } from 'happy-dom';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const output = path.resolve(arg('out') || `${root}/dist/evaluation/baseline`);
const baseline = arg('prompts') !== 'current';
const tokenBudgets = { overview: 420, section_guide: 380, analysis: 260, ask: 320 };
const productionBudget = process.argv.includes('--production-budget');
const promptPath = baseline ? `${root}/docs/evaluation/baseline-prompts.cjs` : `${root}/extension/utils/prompts.js`;
const { distillBuildPrompt } = require(promptPath);
const { distillExtractPaper } = require(`${root}/extension/utils/paperExtractor.js`);
const { distillPaperExcerpt, distillPickSections, distillPickPassages } = require(baseline ? `${root}/docs/evaluation/baseline-paper-help.cjs` : `${root}/extension/utils/paperHelp.js`);
const manifest = JSON.parse(await fs.readFile(`${root}/docs/evaluation/papers.json`));
const only = arg('papers')?.split(',');
const models = (arg('models') || 'qwen2.5:7b').split(',');
const baseUrl = arg('base') || 'http://localhost:11434';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(baseUrl).hostname)) throw Error('Evaluation accepts loopback inference only.');
await fs.mkdir(output, { recursive: true });
const hash = s => createHash('sha256').update(s).digest('hex');
const meta = { date: new Date().toISOString(), provider: 'Ollama OpenAI-compatible API; Node direct, NOT extension origin verification', baseUrl, models, promptSha256: hash(await fs.readFile(promptPath)), promptVersion: baseline ? 'cd163b1' : 'working-tree', temperature: 0.5, maxTokens: productionBudget ? tokenBudgets : 700, budgetMode: productionBudget ? 'production-balanced' : 'exploratory-700; differs from shipped task limits', platform: process.platform, architecture: process.arch, scoring: 'unscored; human verification pending' };
try { meta.server = await fetch(`${baseUrl}/api/version`).then(r=>r.json()); meta.installedModels = await fetch(`${baseUrl}/api/tags`).then(r=>r.json()).then(r=>r.models.map(({name,digest,details})=>({name,digest,details}))); } catch(e) { meta.serverError = e.message; }
await fs.writeFile(`${output}/metadata.json`, JSON.stringify(meta,null,2));
for (const spec of manifest.papers.filter(p=>!only||only.includes(p.id))) {
 const dest = `${output}/${spec.id}`; await fs.mkdir(dest,{recursive:true});
 let paper, extraction;
 try {
  if (process.argv.includes('--cached-only')) {
    const sourceDir = path.resolve(arg('source-dir') || `${root}/dist/evaluation/baseline`);
    paper = JSON.parse(await fs.readFile(`${sourceDir}/${spec.id}/paper.json`));
    extraction = { status: 'extracted', cached: true, paperSha256: hash(JSON.stringify(paper)), sections: paper.sections.map(s=>({heading:s.heading,chars:s.text.length})) };
  } else {
  const r = await fetch(spec.url,{signal:AbortSignal.timeout(45000)}); if (!r.ok) throw Error(`HTTP ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (spec.format === 'pdf') {
   // Diagnostic only: do not substitute Poppler for production PDF intake.
   const cache = `${dest}/source.pdf`; await fs.writeFile(cache,bytes);
   const text = execFileSync('pdftotext',['-layout',cache,'-'],{maxBuffer:10e6}).toString();
   await fs.unlink(cache);
   extraction = { diagnosticTextChars:text.length, status:'production-pdf-intake-pending', sourceSha256:hash(bytes), note:'Poppler diagnostic only; quality tasks withheld until production extractor is exercised.' };
  } else {
   const window = new Window({url:spec.url}); window.document.write(bytes.toString());
   paper = distillExtractPaper(window.document,spec.url);
   const textChars = (paper?.sections||[]).reduce((n,s)=>n+s.text.length,0);
   extraction = {status:textChars>1000?'extracted':'incomplete', title:paper?.title, abstractChars:paper?.abstract?.length||0, textChars, sections:paper?.sections.map(s=>({heading:s.heading,chars:s.text.length})), sourceSha256:hash(bytes), missingExpected:spec.expectedSections.filter(h=>!paper?.sections.some(s=>s.heading.toLowerCase().includes(h.toLowerCase())))};
   await window.happyDOM.close();
  }
  }
 } catch(e) { extraction={status:'failed',error:e.message}; }
 await fs.writeFile(`${dest}/extraction.json`,JSON.stringify(extraction,null,2));
 console.log(spec.id,extraction.status,extraction.textChars||'');
 if (paper) await fs.writeFile(`${dest}/paper.json`,JSON.stringify(paper));
 if (!paper || extraction.status !== 'extracted' || process.argv.includes('--extract-only')) continue;
 // Cached source stays in ignored dist, never bundled in the extension or committed.
 await fs.writeFile(`${dest}/paper.json`,JSON.stringify(paper));
 for(const model of models) for(const level of ['simple','everyday','close']) for (const expertise of (arg('audiences') || 'newcomer').split(',')) {
  const section = paper.sections.find(s=>s.kind==='results') || paper.sections[0];
  const tasks = [ ['overview',{}, {excerpt:distillPaperExcerpt(paper)}], ['section_guide',{section},{sectionText:section.text}], ['analysis',{section,opener:paper.abstract},{selection:section.text.slice(0,900)}], ...spec.questions.map(q=>['ask',baseline?{abstract:paper.abstract}:{},{question:q.question,excerpts:(baseline?distillPickSections:distillPickPassages)(paper,q.question)},q.id]) ];
  for(const [task,ctx,input,qid] of tasks) {
   const file = `${dest}/${model.replace(/[^a-z0-9.-]/gi,'_')}-${level}${baseline && expertise === 'newcomer' ? '' : '-'+expertise}-${qid||task}.json`;
   try { await fs.access(file); continue; } catch { /* resume missing runs only */ }
   const prompt=distillBuildPrompt(task,{title:paper.title,level,expertise,...ctx},input);
   const record={paper:spec.id,model,level,task,questionId:qid,expertise,maxTokens:productionBudget ? tokenBudgets[task] : 700,started:new Date().toISOString(),prompt,output:'',status:'failed',firstTokenMs:null};
   const start=performance.now();
   try {
    const r=await fetch(`${baseUrl}/v1/chat/completions`,{method:'POST',signal:AbortSignal.timeout(120000),headers:{'Content-Type':'application/json'},body:JSON.stringify({model,temperature:meta.temperature,max_tokens:record.maxTokens,stream:true,messages:[{role:'system',content:prompt.system+'\n/no_think'},{role:'user',content:prompt.blocks.join('\n\n')}],reasoning_effort:'none'})});
    if(!r.ok)throw Error(`HTTP ${r.status}: ${(await r.text()).slice(0,500)}`);
    let buf='',ended=false;
    for await(const chunk of r.body){buf+=new TextDecoder().decode(chunk); let nl; while((nl=buf.indexOf('\n'))>=0){const line=buf.slice(0,nl).trim();buf=buf.slice(nl+1);if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(raw==='[DONE]'){ended=true;continue;}if(!raw)continue;const obj=JSON.parse(raw);const c=obj.choices?.[0];if(c?.finish_reason){record.finishReason=c.finish_reason;ended=true;}const text=c?.delta?.content||'';if(text&&record.firstTokenMs===null)record.firstTokenMs=Math.round(performance.now()-start);record.output+=text;}}
    if(!ended)throw Error('Stream ended without completion marker');
    record.status=!record.output.trim()?'empty':record.finishReason==='length'?'truncated':'complete';
   }catch(e){record.error=e.message;}
   record.completionMs=Math.round(performance.now()-start);
   await fs.writeFile(file,JSON.stringify(record,null,2));console.log(spec.id,model,level,qid||task,record.status,record.completionMs);
  }
 }
}
