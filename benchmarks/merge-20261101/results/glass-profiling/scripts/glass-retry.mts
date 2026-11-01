import {performance} from 'node:perf_hooks';
const [root, maxSimArg] = process.argv.slice(2);
const models = await import(`${root}/src/studio/material-labs/models.ts`);
const model = new models.GlassModel({});
const g = globalThis as any; const t0 = performance.now(); let lastT = 0;
const snap = () => JSON.parse(JSON.stringify(g.__rr));
let prev = snap(); let steps = 0; let stepMs = 0;
while (model.frame.time < Number(maxSimArg)) {
  const s0 = performance.now(); model.step(models.DT); stepMs += performance.now() - s0; steps++;
  if (model.frame.time - lastT >= 0.25 - 1e-9) {
    lastT = model.frame.time; const now = snap();
    const diff = (a: any, b: any) => Object.fromEntries(Object.keys(a).map(k => [k, Object.fromEntries(Object.keys(a[k]).map(l => [l, a[k][l] - (b[k]?.[l] ?? 0)]).filter(([, v]) => v))]));
    console.log(JSON.stringify({t: +model.frame.time.toFixed(2), meanStepMs: +(stepMs / steps).toFixed(1), d: diff(now, prev)}));
    prev = now; steps = 0; stepMs = 0;
  }
}
console.log('total', JSON.stringify(g.__rr), 'wall', ((performance.now() - t0) / 1000).toFixed(1));
