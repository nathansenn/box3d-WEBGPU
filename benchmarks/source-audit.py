#!/usr/bin/env python3
from pathlib import Path
import difflib,hashlib,json,os,time,subprocess,shutil,tempfile
root=Path(__file__).resolve().parent.parent
override=os.environ.get('BOX3D_BASELINE')
base=Path(override).expanduser().resolve() if override else None
extract=None
if base is None:
    archive=root/'benchmarks/baselines/box3d-webgpu-v1.2.0-source.tar.gz'
    if not archive.exists(): raise SystemExit(f'Bundled baseline archive missing: {archive}')
    extract=Path(tempfile.mkdtemp(prefix='box3d-webgpu-source-audit-'))
    subprocess.run(['tar','-xzf',str(archive),'-C',str(extract)],check=True)
    candidates=[q.parent for q in extract.rglob('package.json') if 'node_modules' not in q.parts]
    if not candidates: raise SystemExit(f'No package.json found in bundled baseline: {archive}')
    base=candidates[0]
if not base.exists(): raise SystemExit(f'Baseline tree missing: {base}')

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
include=('src/','wasm/','scripts/','vite.config','tsconfig','package.json','package-lock.json')
rels=set()
for tree in (base,root):
    for p in tree.rglob('*'):
        if not p.is_file() or any(x in p.parts for x in ('node_modules','dist','third_party','.git','benchmarks')):continue
        rel=p.relative_to(tree).as_posix()
        if rel.startswith(include) or rel in ('package.json','package-lock.json'):rels.add(rel)
rows=[]
for rel in sorted(rels):
    a=base/rel;b=root/rel
    if a.exists() and b.exists() and sha(a)==sha(b):continue
    at=a.read_text(errors='replace').splitlines() if a.exists() else []
    bt=b.read_text(errors='replace').splitlines() if b.exists() else []
    add=delete=0
    for line in difflib.ndiff(at,bt):
        if line.startswith('+ '):add+=1
        elif line.startswith('- '):delete+=1
    rows.append({'path':rel,'baselineExists':a.exists(),'optimizedExists':b.exists(),'baselineSha256':sha(a) if a.exists() else None,'optimizedSha256':sha(b) if b.exists() else None,'linesAdded':add,'linesDeleted':delete})
summary={'changedFiles':len(rows),'sourceFiles':sum(1 for r in rows if r['path'].startswith('src/')),'wasmFiles':sum(1 for r in rows if r['path'].startswith('wasm/')),'scripts':sum(1 for r in rows if r['path'].startswith('scripts/')),'linesAdded':sum(r['linesAdded'] for r in rows),'linesDeleted':sum(r['linesDeleted'] for r in rows)}
payload={'schema':1,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'baseline':str(base),'optimized':str(root),'summary':summary,'files':rows}
out=root/'benchmarks/results';out.mkdir(parents=True,exist_ok=True)
(out/'source-integration-audit.json').write_text(json.dumps(payload,indent=2)+'\n')
md=['# Source Integration Audit','',f"Changed implementation/configuration files: **{summary['changedFiles']}**",'',f"Source files: **{summary['sourceFiles']}** · WASM files: **{summary['wasmFiles']}** · scripts: **{summary['scripts']}**",'',f"Line delta: **+{summary['linesAdded']} / -{summary['linesDeleted']}**",'','| File | Added | Deleted | Baseline | Optimized |','|---|---:|---:|---|---|']
for r in rows:md.append(f"| `{r['path']}` | {r['linesAdded']} | {r['linesDeleted']} | {(r['baselineSha256'] or 'new')[:12]} | {(r['optimizedSha256'] or 'removed')[:12]} |")
(out/'source-integration-audit.md').write_text('\n'.join(md)+'\n')
print(json.dumps(summary,indent=2))
if extract is not None: shutil.rmtree(extract,ignore_errors=True)
