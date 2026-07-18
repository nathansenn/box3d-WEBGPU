#!/usr/bin/env python3
from __future__ import annotations
import json, os, platform, shutil, statistics, subprocess, sys, time, hashlib, tempfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
OPT=HERE.parent
BASE_OVERRIDE=os.environ.get('BOX3D_BASELINE')
BASE=Path(BASE_OVERRIDE).expanduser().resolve() if BASE_OVERRIDE else None
BASE_WORK=None
if BASE is None:
    archive=HERE/'baselines'/'box3d-webgpu-v1.2.0-source.tar.gz'
    if not archive.exists():
        raise SystemExit(f'Bundled baseline archive missing: {archive}')
    BASE_WORK=Path(tempfile.mkdtemp(prefix='box3d-webgpu-v1.2-baseline-'))
    subprocess.run(['tar','-xzf',str(archive),'-C',str(BASE_WORK)],check=True)
    candidates=[q.parent for q in BASE_WORK.rglob('package.json') if 'node_modules' not in q.parts]
    if not candidates:
        raise SystemExit(f'No package.json found in bundled baseline: {archive}')
    BASE=candidates[0].resolve()
OUT=HERE/'results'; OUT.mkdir(parents=True,exist_ok=True)
LOG=OUT/'logs'; LOG.mkdir(parents=True,exist_ok=True)

def load_scripts(root:Path):
    return json.loads((root/'package.json').read_text()).get('scripts',{})

def run(root:Path, args:list[str], timeout=900, env=None):
    e=os.environ.copy(); e.update(env or {})
    started=time.perf_counter()
    cp=subprocess.run(args,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout,env=e)
    return cp.returncode,time.perf_counter()-started,cp.stdout

def ensure_install(root:Path):
    if (root/'node_modules').exists(): return
    code,sec,out=run(root,['npm','ci','--no-audit','--no-fund'],timeout=1200)
    (LOG/f'install-{root.name}.log').write_text(out)
    if code: raise RuntimeError(f'npm ci failed in {root}: {code}')

def median(xs): return statistics.median(xs)
def mad(xs):
    m=median(xs); return median([abs(x-m) for x in xs])
def sha(s:str): return hashlib.sha256(s.encode()).hexdigest()

def measure(root:Path, script:str, samples:int, warmups:int=1):
    outputs=[]
    for w in range(warmups):
        c,t,o=run(root,['npm','run',script],timeout=1200,env={'CI':'1'})
        (LOG/f'{root.name}-{script.replace(":","-")}-warmup-{w}.log').write_text(o)
        if c: return {'available':True,'passed':False,'error':f'warmup exit {c}','samples':[]}
    vals=[]
    for i in range(samples):
        c,t,o=run(root,['npm','run',script],timeout=1200,env={'CI':'1'})
        (LOG/f'{root.name}-{script.replace(":","-")}-{i}.log').write_text(o)
        if c: return {'available':True,'passed':False,'error':f'sample {i} exit {c}','samples':vals}
        vals.append(t); outputs.append(sha(o))
    return {'available':True,'passed':True,'samples':vals,'medianSeconds':median(vals),'madSeconds':mad(vals),'outputHashes':outputs}

def tree_bytes(root:Path, sub='dist'):
    p=root/sub
    if not p.exists(): return 0
    return sum(f.stat().st_size for f in p.rglob('*') if f.is_file())

if BASE is None or not BASE.exists():
    raise SystemExit(f'Baseline tree missing: {BASE}')
ensure_install(BASE); ensure_install(OPT)
bs=load_scripts(BASE); oscripts=load_scripts(OPT)
baseline_version=json.loads((BASE/'package.json').read_text()).get('version','unknown')
optimized_version=json.loads((OPT/'package.json').read_text()).get('version','unknown')
# Representative gates. Soft soak is the principal CPU simulation benchmark; WebGPU measures renderer validation/command preparation; build tracks delivery cost.
requested=[('test:soft-soak',7,2),('test:webgpu',5,1),('build',5,1),('test',3,1)]
results=[]
for name,samples,warmups in requested:
    if name not in bs or name not in oscripts:
        results.append({'script':name,'available':False,'reason':'script not present in both revisions'})
        continue
    b=measure(BASE,name,samples,warmups); o=measure(OPT,name,samples,warmups)
    row={'script':name,'available':True,'baseline':b,'optimized':o}
    if b.get('passed') and o.get('passed'):
        row['speedup']=b['medianSeconds']/o['medianSeconds']
        row['timeReductionPercent']=(1-o['medianSeconds']/b['medianSeconds'])*100
        row['noiseCeilingPercent']=max(b['madSeconds']/b['medianSeconds'],o['madSeconds']/o['medianSeconds'])*100
        row['accepted']=row['speedup']>=1.02 and row['noiseCeilingPercent']<=15
    else: row['accepted']=False
    results.append(row)
# Ensure final production outputs exist for size comparison.
for root,scripts in [(BASE,bs),(OPT,oscripts)]:
    if 'build' in scripts and not (root/'dist').exists(): run(root,['npm','run','build'],timeout=1200,env={'CI':'1'})
base_bytes=tree_bytes(BASE); opt_bytes=tree_bytes(OPT)
payload={
 'schema':1,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
 'environment':{'python':sys.version,'platform':platform.platform(),'machine':platform.machine(),'node':subprocess.run(['node','--version'],capture_output=True,text=True).stdout.strip()},
 'method':{'baselineVersion':baseline_version,'optimizedVersion':optimized_version,'baseline':str(BASE),'optimized':str(OPT),'timer':'perf_counter wall clock','warmups':'1-2 by workload','samples':'3-7 by workload','summaryStatistic':'median','dispersion':'median absolute deviation','acceptance':'at least 2% speedup and <=15% normalized MAD'},
 'results':results,
 'bundle':{'baselineBytes':base_bytes,'optimizedBytes':opt_bytes,'deltaBytes':opt_bytes-base_bytes,'deltaPercent':((opt_bytes/base_bytes)-1)*100 if base_bytes else None}
}
(OUT/'end-to-end.json').write_text(json.dumps(payload,indent=2))
lines=['# End-to-End Performance Evidence','',f"Generated: {payload['generatedAt']}",'',f'The bundled v{baseline_version} source baseline is compared with v{optimized_version} using clean package installations. Ratios are never multiplied across tests.','', '| Workload | Baseline median | Optimized median | Speedup | Reduction | Noise ceiling | Accepted |','|---|---:|---:|---:|---:|---:|---|']
for r in results:
    if not r.get('available'):
        lines.append(f"| `{r['script']}` | — | — | — | — | — | unavailable |")
    elif not (r.get('baseline',{}).get('passed') and r.get('optimized',{}).get('passed')):
        lines.append(f"| `{r['script']}` | failed | failed | — | — | — | no |")
    else:
        lines.append(f"| `{r['script']}` | {r['baseline']['medianSeconds']:.4f}s | {r['optimized']['medianSeconds']:.4f}s | {r['speedup']:.3f}× | {r['timeReductionPercent']:.2f}% | {r['noiseCeilingPercent']:.2f}% | {'yes' if r['accepted'] else 'no'} |")
lines += ['', '## Production bundle', '', f"- Baseline: {base_bytes:,} bytes", f"- Optimized: {opt_bytes:,} bytes", f"- Delta: {opt_bytes-base_bytes:+,} bytes", '', '## Evidence policy', '', '- Full command logs are stored under `benchmarks/results/logs/`.', '- A result below the acceptance threshold remains documented but is not presented as a proven win.', '- WebGPU results in this environment validate CPU-side command/resource work through the project’s Dawn test path; they are not a substitute for target-GPU frame timing.', '']
(OUT/'end-to-end.md').write_text('\n'.join(lines))
print(json.dumps(payload,indent=2))
if BASE_WORK is not None:
    shutil.rmtree(BASE_WORK, ignore_errors=True)
