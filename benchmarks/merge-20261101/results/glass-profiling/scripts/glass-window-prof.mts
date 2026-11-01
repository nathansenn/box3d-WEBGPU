// Profile only a simulated-time window of the glass lab using the inspector API.
import {performance} from 'node:perf_hooks';
import inspector from 'node:inspector';
import {writeFileSync} from 'node:fs';
const [root, startArg, endArg, outFile] = process.argv.slice(2);
const models = await import(`${root}/src/studio/material-labs/models.ts`);
const model = new models.GlassModel({});
const start = Number(startArg), end = Number(endArg);
while (model.frame.time < start) model.step(models.DT);
const session = new inspector.Session(); session.connect();
const post = (m: string, p: any = {}) => new Promise<any>((res, rej) => session.post(m, p, (e: any, r: any) => e ? rej(e) : res(r)));
await post('Profiler.enable'); await post('Profiler.setSamplingInterval', {interval: 500}); await post('Profiler.start');
const t0 = performance.now(); let steps = 0;
while (model.frame.time < end) { model.step(models.DT); steps++; }
const wall = performance.now() - t0;
const {profile} = await post('Profiler.stop');
writeFileSync(outFile, JSON.stringify(profile));
const st = model.collisionWorld.stats;
console.log(JSON.stringify({window: [start, end], steps, meanStepMs: +(wall / steps).toFixed(1), contacts: st.contacts, candidatePairs: st.candidatePairs, dynamic: model.shardBodies.filter((b: any) => b.dynamic).length}));
