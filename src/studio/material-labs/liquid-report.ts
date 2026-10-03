import {LABS,materialFor,normalizeSettings,type LabSettings} from './catalog';
import {LIQUID_DEFAULTS,LIQUID_NUMBERS} from './liquid-config';
import {studyParameters,type AnalysisSample,type SectionCell,type StudyParameter,type StudyResult} from './liquid-analysis';
import type {RunStorage} from './run-library';

export const REPORT_FORMAT='box3d-liquid-comparison-v2';
export const NOTEBOOK_KEY='box3d.liquid-notebook.v1';
export const MAX_REPORT_BYTES=4*1024*1024;
export const MAX_NOTEBOOK_CHARS=2_500_000;
export const MAX_REPORTS=12;
export type ReportMetric='volume'|'flow'|'depth'|'flood';
export type StudyLimit='depth'|'floodArea'|'coverage';
export interface ReportReview {baseline:number;time:number;metric:ReportMetric;limit:StudyLimit;limitValue:number|null;}
export interface LiquidReport {format:typeof REPORT_FORMAT;calibrated:false;title:string;notes:string;source:string;parameter:StudyParameter;complete:boolean;results:StudyResult[];review:ReportReview;}
export interface NotebookEntry {id:string;savedAt:string;report:LiquidReport;}
export interface NotebookState {entries:NotebookEntry[];warning:string;writable:boolean;}
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
function check(ok:unknown,message='The file is not a valid Liquid Lab comparison.'):asserts ok {if(!ok)throw new Error(message);}
function n(v:unknown,min=-1e6,max=1e6):number {check(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,'The report contains an invalid or out-of-range measurement.');return v;}
function str(v:unknown,max:number):string {check(typeof v==='string'&&v.length<=max,'The report contains invalid text.');return v;}
const near=(a:number,b:number)=>Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
const HYDRAULIC_KEYS=['inlet','rainRate','outlet','added','rained','drained','absorbed','residual','wetArea','meanFilm','head','reynolds','floodArea','coverage','meanSpeed','overflow','overflowRate'] as const;
function probe(value:unknown):SectionCell {
  check(record(value));check(typeof value.blocked==='boolean');const p={z:n(value.z,-1,1),bed:n(value.bed,0,5),depth:n(value.depth,0,10),vx:n(value.vx),speed:n(value.speed,0),blocked:value.blocked};
  check(!p.blocked||(p.depth===0&&p.vx===0&&p.speed===0),'Solid probes cannot contain flow measurements.');check(Math.abs(p.vx)<=p.speed+1e-7);return p;
}
function sample(value:unknown):AnalysisSample {
  check(record(value)&&record(value.hydraulics));const h=value.hydraulics;check(typeof h.supplyOn==='boolean');
  const hydraulics=Object.fromEntries(HYDRAULIC_KEYS.map(k=>[k,n(h[k],k==='residual'?-1e6:0)])) as unknown as AnalysisSample['hydraulics'];hydraulics.supplyOn=h.supplyOn;
  check(hydraulics.coverage<=100+1e-7&&hydraulics.wetArea<=12+1e-7&&hydraulics.floodArea<=12+1e-7,'The report has invalid coverage or area.');
  check(Array.isArray(value.metrics)&&value.metrics.length===3&&Array.isArray(value.probes)&&value.probes.length===3);
  return {time:n(value.time,0,60.000001),metrics:value.metrics.map(v=>n(v,0)) as [number,number,number],flow:n(value.flow),hydraulics,probes:value.probes.map(probe)};
}
const settingsKeys=[...Object.keys(LABS.liquid.defaults),...Object.keys(LIQUID_DEFAULTS)];
function settings(value:unknown):LabSettings {
  check(record(value));const input=Object.fromEntries(settingsKeys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
  const normalized=normalizeSettings('liquid',input);
  check(Object.keys(input).every(k=>input[k]===normalized[k as keyof LabSettings]),'A saved setup has unsupported settings.');return normalized;
}
export function sharedDuration(results:StudyResult[]):number {return Math.min(...results.map(r=>r.samples.at(-1)!.time));}
export function defaultReview(results:StudyResult[]):ReportReview {return {baseline:results.find(r=>r.index===1)?.index??results[0].index,time:sharedDuration(results),metric:'volume',limit:'depth',limitValue:null};}
/** Parse and copy an allowlisted report. File content never becomes markup or executable code. */
export function validateReport(value:unknown):LiquidReport {
  check(record(value));check(value.format===REPORT_FORMAT||value.format==='box3d-liquid-comparison-v1','Choose a Liquid Lab comparison JSON report (V4 or newer).');check(value.calibrated===false&&record(value.parameter));
  check(Array.isArray(value.results)&&value.results.length>=1&&value.results.length<=3,'The report must contain one to three completed cases.');
  const parameterKey=value.parameter.key;let parameter:StudyParameter|undefined;
  const results:StudyResult[]=value.results.map(raw=>{
    check(record(raw));const p=settings(raw.settings),definition=studyParameters(p).find(p=>p.key===parameterKey);check(definition,'The comparison parameter does not apply to this setup.');parameter=definition;
    const index=n(raw.index,0,2);check(Number.isInteger(index));const value=n(raw.value,definition.min,definition.max);check(value===p[definition.key],'A case value does not match its setup.');
    const section=n(raw.section,0,6);check(near(section,(Math.floor(section/(6/84))+.5)*6/84),'The section must identify a model cell centre.');
    check(Array.isArray(raw.samples)&&raw.samples.length>=2&&raw.samples.length<=320);const samples=raw.samples.map(sample);
    check(samples[0].time===0&&near(samples.at(-1)!.time,p.runSeconds??18),'Each case must include the initial state and its complete program.');
    const origin=samples[0].metrics[2]-samples[0].hydraulics.added-samples[0].hydraulics.rained+samples[0].hydraulics.drained+samples[0].hydraulics.absorbed;
    for(let i=0;i<samples.length;i++){
      const s=samples[i],h=s.hydraulics;
      check(!i||s.time>samples[i-1].time,'Recorded times must increase.');
      if(i)for(const key of ['added','rained','drained','absorbed','overflow'] as const)check(h[key]+1e-9>=samples[i-1].hydraulics[key],'Cumulative water totals cannot decrease.');
      check(near(h.residual,s.metrics[2]-(origin+h.added+h.rained-h.drained-h.absorbed)),'The report water budget is inconsistent.');
      for(let j=0;j<3;j++){const expected=(-.65+j*.65+1)/(2/28);check(near(s.probes[j].z,(Math.floor(expected)+.5)*(2/28)-1),'Probe locations do not match this model.');}
    }
    check(record(raw.peak));const peak={depth:n(raw.peak.depth,0),speed:n(raw.peak.speed,0),volume:n(raw.peak.volume,0),floodArea:n(raw.peak.floodArea,0,12.000001),coverage:n(raw.peak.coverage,0,100.000001),balanceError:n(raw.peak.balanceError,0)};
    for(const s of samples)check(peak.depth+1e-8>=s.metrics[0]&&peak.speed+1e-8>=s.metrics[1]&&peak.volume+1e-8>=s.metrics[2]&&peak.floodArea+1e-8>=s.hydraulics.floodArea&&peak.coverage+1e-8>=s.hydraulics.coverage&&peak.balanceError+1e-8>=Math.abs(s.hydraulics.residual),'Reported maxima cannot be smaller than recorded measurements.');
    return {index,value,settings:p,section,samples,peak,phase:str(raw.phase,160)};
  }).sort((a,b)=>a.index-b.index);
  check(new Set(results.map(r=>r.index)).size===results.length&&new Set(results.map(r=>r.value)).size===results.length,'Duplicate cases cannot be compared.');
  for(const r of results){check(near(r.section,results[0].section),'All cases must use the same section.');for(const k of settingsKeys)if(k!==parameterKey)check(r.settings[k as keyof LabSettings]===results[0].settings[k as keyof LabSettings],'A comparison may change only one input.');}
  const review=defaultReview(results);
  if(value.format===REPORT_FORMAT){check(record(value.review));const v=value.review;check(results.some(r=>r.index===v.baseline));review.baseline=v.baseline as number;review.time=n(v.time,0,sharedDuration(results)+1e-7);check(['volume','flow','depth','flood'].includes(String(v.metric)));review.metric=v.metric as ReportMetric;check(['depth','floodArea','coverage'].includes(String(v.limit)));review.limit=v.limit as StudyLimit;review.limitValue=v.limitValue===null?null:n(v.limitValue,0,review.limit==='coverage'?100:review.limit==='floodArea'?12:10000);}
  check(results[0].settings.rig==='river'||(review.metric!=='flood'&&review.limit!=='floodArea'),'Floodplain analysis requires a river setup.');
  return {format:REPORT_FORMAT,calibrated:false,title:value.format===REPORT_FORMAT?str(value.title,100).trim()||'Untitled comparison':`${parameter!.label} study`,notes:value.format===REPORT_FORMAT?str(value.notes,2000):'',source:str(value.source,500),parameter:parameter!,complete:results.length===3,results,review};
}
export function parseReport(text:string):LiquidReport {check(new TextEncoder().encode(text).byteLength<=MAX_REPORT_BYTES,'Report files must be smaller than 4 MB.');let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new Error('This file is not valid JSON.');}return validateReport(parsed);}
export function createReport(results:StudyResult[],parameter:StudyParameter,source:string):LiquidReport {return validateReport({format:REPORT_FORMAT,calibrated:false,title:`${parameter.label} study`,notes:'',source,parameter,results,review:defaultReview(results)});}
export function readNotebook(storage:RunStorage):NotebookState {
  try {const text=storage.getItem(NOTEBOOK_KEY);if(!text)return {entries:[],warning:'',writable:true};check(text.length<=MAX_NOTEBOOK_CHARS);const data=JSON.parse(text);check(record(data)&&data.version===1&&Array.isArray(data.entries)&&data.entries.length<=MAX_REPORTS);
    const entries:NotebookEntry[]=[];let corrupt=false;for(const raw of data.entries){try{check(record(raw)&&typeof raw.id==='string'&&/^[\w-]{1,100}$/.test(raw.id)&&typeof raw.savedAt==='string'&&Number.isFinite(Date.parse(raw.savedAt)));check(!entries.some(e=>e.id===raw.id));entries.push({id:raw.id,savedAt:raw.savedAt,report:validateReport(raw.report)});}catch{corrupt=true;}}
    return {entries,warning:corrupt?'Some notebook entries could not be read. Import a backup to recover them; storage has been left unchanged.':'',writable:!corrupt};
  }catch{return {entries:[],warning:'The notebook could not be read. You can still import and export reports; stored data has been left unchanged.',writable:false};}
}
export function saveNotebook(storage:RunStorage,entry:NotebookEntry):{ok:true;entry:NotebookEntry}|{ok:false;message:string} {
  const state=readNotebook(storage);if(!state.writable)return {ok:false,message:state.warning};
  try {check(/^[\w-]{1,100}$/.test(entry.id)&&Number.isFinite(Date.parse(entry.savedAt)));const safe={...entry,report:validateReport(entry.report)},entries=[safe,...state.entries.filter(e=>e.id!==entry.id)];
    check(entries.length<=MAX_REPORTS,'This notebook holds 12 comparisons. Export this report to keep another copy.');const text=JSON.stringify({version:1,entries});check(text.length<=MAX_NOTEBOOK_CHARS,'The notebook is full. Export this report as JSON to keep it.');storage.setItem(NOTEBOOK_KEY,text);return {ok:true,entry:safe};
  }catch(error){return {ok:false,message:error instanceof Error?error.message:'The browser could not save the notebook. Export JSON to keep this report.'};}
}
export const REPORT_METRICS=[{id:'volume',label:'Water volume',unit:'L'},{id:'flow',label:'Section flow',unit:'L/s'},{id:'depth',label:'Probe B depth',unit:'mm'},{id:'flood',label:'Wet floodplain',unit:'m²'}] as const;
export function reportValue(sample:AnalysisSample,metric:ReportMetric):number|null {return metric==='volume'?sample.metrics[2]*1000:metric==='flow'?sample.flow*1000:metric==='flood'?sample.hydraulics.floodArea:sample.probes[1].blocked?null:sample.probes[1].depth*1000;}
/** Select the nearest actual record within the common time range; no invented interpolated data. */
export function compareAt(report:LiquidReport):{index:number;time:number;value:number|null;delta:number|null;percent:number|null}[] {
  const time=Math.min(sharedDuration(report.results),Math.max(0,report.review.time));
  const rows=report.results.map(r=>{const s=r.samples.reduce((a,b)=>Math.abs(a.time-time)<=Math.abs(b.time-time)?a:b);return {index:r.index,time:s.time,value:reportValue(s,report.review.metric)};});
  const base=rows.find(r=>r.index===report.review.baseline)!.value;
  return rows.map(r=>({...r,delta:r.value===null||base===null?null:r.value-base,percent:r.value===null||base===null||Math.abs(base)<1e-9?null:(r.value-base)/Math.abs(base)*100}));
}
export function limitReading(result:StudyResult,review:ReportReview):{peak:number;exceeded:boolean|null} {const peak=result.peak[review.limit]*(review.limit==='depth'?1000:1);return {peak,exceeded:review.limitValue===null?null:peak>review.limitValue+1e-8};}
export const escapeReport=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const formatReading=(value:number|null,digits=2):string=>value===null?'—':Number(value.toFixed(digits)).toLocaleString('en-US',{maximumFractionDigits:digits});
export function reportPlot(report:LiquidReport):string {
  const colors=['#087f89','#bd671d','#7860ac'],values=report.results.flatMap(r=>r.samples.map(s=>reportValue(s,report.review.metric))).filter((v):v is number=>v!==null),min=Math.min(0,...values),max=Math.max(min+.001,...values),duration=sharedDuration(report.results),y=(v:number)=>133-(v-min)/(max-min)*102;
  const metric=REPORT_METRICS.find(m=>m.id===report.review.metric)!;
  return `<svg viewBox="0 0 520 175" role="img" aria-label="${metric.label} over time"><path d="M58 20V133H507" fill="none" stroke="#b8c7be"/><path d="M58 ${y(0)}H507" stroke="#dae2d8" stroke-dasharray="3 3"/><text x="3" y="30">${formatReading(max)}</text><text x="3" y="135">${formatReading(min)}</text>${report.results.map(r=>{let drawing=false;const d=r.samples.filter(s=>s.time<=duration+1e-7).map(s=>{const v=reportValue(s,report.review.metric);if(v===null){drawing=false;return '';}const cmd=`${drawing?'L':'M'}${58+s.time/duration*449},${y(v)}`;drawing=true;return cmd;}).join(' ');return `<path d="${d}" fill="none" stroke="${colors[r.index]}" stroke-width="${r.index===report.review.baseline?3:1.8}"/>`;}).join('')}<path d="M${58+report.review.time/duration*449} 20V133" stroke="#264b44" stroke-dasharray="3 4"/><text x="58" y="154">0 s</text><text x="505" y="154" text-anchor="end">${formatReading(duration)} s</text><text x="285" y="170" text-anchor="middle">${metric.label} · ${metric.unit}</text></svg>`;
}
export function readableReport(report:LiquidReport):string {
  const r=validateReport(report),e=escapeReport,f=formatReading,rows=compareAt(r),metric=REPORT_METRICS.find(m=>m.id===r.review.metric)!,limits={depth:['Maximum depth','mm'],floodArea:['Maximum wet floodplain','m²'],coverage:['Maximum wet coverage','%']} as const;
  const settingsLabels=new Map([...LIQUID_NUMBERS,...LABS.liquid.controls].map(c=>[c.key,{label:c.label,unit:c.unit}]));
  if(['rain','surface','pipes'].includes(r.results[0].settings.rig??'flume'))settingsLabels.set('fill',{label:'Initial film depth',unit:'mm'});
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(r.title)} · BOX3D</title><style>body{margin:0;background:#f3f4eb;color:#24443d;font:15px/1.6 system-ui,sans-serif}main{max-width:920px;margin:36px auto;padding:32px;background:#fffef9}header{border-bottom:2px solid #0c7984;padding-bottom:20px}h1{font-size:32px;margin:10px 0}h2{font-size:19px;margin:30px 0 12px}p{margin:8px 0}small,.muted{color:#667a70}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:left;border-bottom:1px solid #dbe2d4;padding:9px 8px;font-size:13px}svg{width:100%;height:auto}svg text{font:11px system-ui;fill:#546c60}.notes{white-space:pre-wrap;border-left:3px solid #b99c64;padding:10px 15px;background:#f6f5eb}.legend{display:flex;gap:24px;flex-wrap:wrap;font-size:12px}.settings{overflow-wrap:anywhere}@media print{body{background:white}main{margin:0;max-width:none;padding:0}h2,thead{break-after:avoid}tr,svg{break-inside:avoid}}@media(max-width:600px){main{margin:0;padding:18px}th,td{padding:7px 4px;font-size:11px}}</style></head><body><main><header><b>BOX3D / EXPERIMENT NOTEBOOK</b><h1>${e(r.title)}</h1><p>${e(r.source)}</p><small>${r.results.length} completed cases · Comparative model · not calibrated</small></header>${r.notes?`<h2>Experiment notes</h2><p class="notes">${e(r.notes)}</p>`:''}<h2>${metric.label} · baseline Case ${r.review.baseline+1}</h2>${reportPlot(r)}<div class="legend">${r.results.map(c=>`<span style="color:${['#087f89','#bd671d','#7860ac'][c.index]}"><b aria-hidden="true">━</b> Case ${c.index+1}: ${e(r.parameter.label)} ${f(c.value,4)} ${e(r.parameter.unit)}</span>`).join('')}</div><h2>At ${f(r.review.time)} s</h2><table><thead><tr><th>Case</th><th>Recorded time</th><th>${metric.label} (${metric.unit})</th><th>Change from baseline</th><th>Change (%)</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${c.index+1}</td><td>${f(c.time,3)} s</td><td>${f(c.value)}</td><td>${f(c.delta)}</td><td>${f(c.percent)}</td></tr>`).join('')}</tbody></table><p class="muted">Nearest actual recorded samples are shown. A dash means a solid probe or a zero baseline for percentage change.</p><h2>Study limit</h2><p>${limits[r.review.limit][0]}: ${r.review.limitValue===null?'No limit set':f(r.review.limitValue)+' '+limits[r.review.limit][1]}</p><table><thead><tr><th>Case</th><th>Measured maximum</th><th>Compared with your limit</th></tr></thead><tbody>${r.results.map(c=>{const l=limitReading(c,r.review);return `<tr><td>${c.index+1}</td><td>${f(l.peak)} ${limits[r.review.limit][1]}</td><td>${l.exceeded===null?'Not set':l.exceeded?'Above limit':'Within limit'}</td></tr>`;}).join('')}</tbody></table><p class="muted">User-defined study limits are comparisons, not safety criteria. Maxima include every solver tick in the source run; imported files are validated for structure and consistency, not independently re-simulated.</p><h2>Final water budget</h2><table><thead><tr><th>Case</th><th>Initial (L)</th><th>Supplied + rain (L)</th><th>Collected + overflow (L)</th><th>Infiltrated (L)</th><th>Remaining (L)</th></tr></thead><tbody>${r.results.map(c=>{const s=c.samples.at(-1)!,h=s.hydraulics;return `<tr><td>${c.index+1}</td><td>${f(c.samples[0].metrics[2]*1000)}</td><td>${f((h.added+h.rained)*1000)}</td><td>${f(h.drained*1000)}</td><td>${f(h.absorbed*1000)}</td><td>${f(s.metrics[2]*1000)}</td></tr>`;}).join('')}</tbody></table><h2>Reproduction settings</h2><p>Material: ${e(materialFor('liquid',r.results[0].settings.material).name)}. Section: ${f(r.results[0].section,4)} m from inlet. Initial water quantity can differ when the varied setting changes bed geometry.</p><table class="settings"><thead><tr><th>Input</th>${r.results.map(c=>`<th>Case ${c.index+1}</th>`).join('')}</tr></thead><tbody>${Object.keys(r.results[0].settings).map(k=>{const label=settingsLabels.get(k as never);return `<tr><td>${e(label?.label??k)}${label?.unit?' ('+e(label.unit)+')':''}</td>${r.results.map(c=>`<td>${e(String(c.settings[k as keyof LabSettings]))}</td>`).join('')}</tr>`;}).join('')}</tbody></table><p class="muted">Depth-averaged comparative flow. This report contains no external assets, scripts or tracking. Use your browser's Print command for paper or PDF.</p></main></body></html>`;
}
