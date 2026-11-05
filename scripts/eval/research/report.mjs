// Sanitized evidence: outputs/timing, no full paper caches or raw prompts.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {distillUnsupportedDemographicCounts}=require('../../../extension/utils/paperHelp.js');
const root=path.resolve(import.meta.dirname,'../../..');
const arg=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const run=arg('run')||'baseline';const input=path.resolve(arg('input')||`${root}/dist/evaluation/${run}`);
const out=`${root}/docs/evaluation/evidence`;await fs.mkdir(out,{recursive:true});
let meta;try{meta=JSON.parse(await fs.readFile(`${input}/metadata.json`));}catch{meta={};}
const records=[],extraction=[];
for(const dir of await fs.readdir(input,{withFileTypes:true}))if(dir.isDirectory())for(const name of await fs.readdir(`${input}/${dir.name}`)){
 if(!name.endsWith('.json'))continue;
 const data=JSON.parse(await fs.readFile(`${input}/${dir.name}/${name}`));
 if(typeof data.output==='string'&&data.task){
  const {paper,model,level,expertise='newcomer',task,questionId,started,completionMs,firstTokenMs,finishReason,error,maxTokens}=data;
  const status=data.status === 'complete' && !data.output.trim() ? 'empty' : data.status;
  const suppliedIds=[...new Set((data.prompt?.blocks?.join('\n').match(/\bS\d+P\d+\b/g)||[]))];
  const outputIds=[...new Set((data.output.match(/\bS\d+P\d+\b/g)||[]))];
  const sourceBlock=data.prompt?.blocks?.find(b=>b.startsWith('Parts of the paper:'))||'';
  const sources=sourceBlock.replace(/^Parts of the paper:\s*/, '').split(/\n\n(?=\[S\d+P\d+\])/).map(b=>/^\[(S\d+P\d+)\] ([^\n]+)\n([\s\S]*)/.exec(b)).filter(Boolean).map(m=>({id:m[1],heading:m[2],text:m[3]}));
  const unsupportedDemographicCounts=sources.length?distillUnsupportedDemographicCounts(data.output,sources):[];
  records.push({paper,model,level,expertise,task,questionId,started, ...(task==='ask'&&suppliedIds.length?{citationAudit:{suppliedIds,outputIds,unknownIds:outputIds.filter(id=>!suppliedIds.includes(id)),unsupportedDemographicCounts,expectedQuantityGuardDisposition:unsupportedDemographicCounts.length?'withhold-unmatched-demographic-count':'no-flag',scope:'ID membership and limited literal count checks only; not claim support. Expected guard disposition is an audit, not live browser-model validation.'}}:{}),maxTokens:maxTokens||700,status,completionMs,firstTokenMs,finishReason,error,output:data.output.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[redacted-email]'),outputSha256:createHash('sha256').update(data.output).digest('hex'),promptSha256:createHash('sha256').update(JSON.stringify(data.prompt)).digest('hex')});
 }else if(name==='extraction.json'||name==='production-pdf.json')extraction.push({paper:dir.name,...data});
}
records.sort((a,b)=>[a.paper,a.model,a.level,a.expertise,a.task,a.questionId].join('/').localeCompare([b.paper,b.model,b.level,b.expertise,b.task,b.questionId].join('/')));
const groups={};for(const r of records){const k=[r.model,r.expertise,r.level,r.task].join(' / ');const g=groups[k] ||= {count:0,complete:0,empty:0,truncated:0,failed:0,completionMs:[],firstTokenMs:[]};g.count++;g[r.status]=(g[r.status]||0)+1;g.completionMs.push(r.completionMs);if(r.firstTokenMs!==null)g.firstTokenMs.push(r.firstTokenMs);}
const median=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null;};
for(const g of Object.values(groups)){g.completionMedianMs=median(g.completionMs);g.firstTokenMedianMs=median(g.firstTokenMs);delete g.completionMs;delete g.firstTokenMs;}
const {date,provider,models,promptSha256,promptVersion,temperature,maxTokens,budgetMode,platform,architecture,server,gitRevision,hardware}=meta;
const summary={run,generated:new Date().toISOString(),metadata:{date,provider,models,gitRevision,hardware,promptSha256,promptVersion,temperature,maxTokens,budgetMode:budgetMode||'exploratory-700; differs from production limits',platform,architecture,server},qualityScoring:'NOT SCORED: human source verification and independent review pending',total:records.length,papers:[...new Set(records.map(r=>r.paper))],groups,extraction};
await fs.writeFile(`${out}/${run}-outputs.jsonl`,records.map(r=>JSON.stringify(r)).join('\n')+'\n');
await fs.writeFile(`${out}/${run}-summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(run,records.length,'outputs',Object.fromEntries(['complete','empty','truncated','failed'].map(s=>[s,records.filter(r=>r.status===s).length])));
