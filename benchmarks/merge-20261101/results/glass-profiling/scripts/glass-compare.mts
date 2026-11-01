import {performance} from 'node:perf_hooks';
const [root, maxSimArg] = process.argv.slice(2);
const models = await import(`${root}/src/studio/material-labs/models.ts`);
const model = new models.GlassModel({});
const g = globalThis as any; const t0 = performance.now(); let lastT = 0;
let steps = 0, stepMs = 0, maxPen = 0, maxStep = 0; const all: number[] = [];
while (model.frame.time < Number(maxSimArg)) {
  const s0 = performance.now(); model.step(models.DT); const ms = performance.now() - s0; stepMs += ms; steps++; all.push(ms); maxStep = Math.max(maxStep, ms);
  maxPen = Math.max(maxPen, model.collisionWorld.stats.maxPenetration);
  if (model.frame.time - lastT >= 0.25 - 1e-9) {
    lastT = model.frame.time;
    const broken = model.frame.damage.reduce((a: number, b: number) => a + b, 0);
    console.log(JSON.stringify({t: +model.frame.time.toFixed(2), meanStepMs: +(stepMs / steps).toFixed(1), maxStepMs: +maxStep.toFixed(1), maxPenetrationMm: +(maxPen * 1000).toFixed(4), broken, contacts: model.collisionWorld.stats.contacts}));
    steps = 0; stepMs = 0; maxPen = 0; maxStep = 0;
  }
}
all.sort((a, b) => a - b);
console.log('summary', JSON.stringify({simS: +model.frame.time.toFixed(3), wallS: +((performance.now() - t0) / 1000).toFixed(1), p50: +all[Math.floor(all.length * .5)].toFixed(1), p95: +all[Math.floor(all.length * .95)].toFixed(1), max: +all[all.length - 1].toFixed(1), rr: g.__rr}));
