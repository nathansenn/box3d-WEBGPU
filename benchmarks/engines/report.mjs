// Turns the raw runs of benchmarks/engines/run.mjs into the published comparison.
//
//   node benchmarks/engines/report.mjs [--raw benchmarks/results/logs/engines/latest.json]
//       writes public/benchmarks/benchmarks.json and docs/BENCHMARKS_ENGINES.md
//   node benchmarks/engines/report.mjs --raw main.json --replace again.json
//       the runs in again.json replace main.json's runs of the same scene and settings
//   node benchmarks/engines/report.mjs --render
//       rewrites docs/BENCHMARKS_ENGINES.md from the committed JSON (after editing the texts in notes.mjs, use --notes)
//   node benchmarks/engines/report.mjs --notes
//       copies the hand-written texts of notes.mjs into the committed JSON again, then renders
//
// The Markdown is a pure function of the JSON (renderMarkdown), so the two published files cannot disagree;
// tests/benchmarks/engine-comparison.test.mjs checks that.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCENES} from './scenes.mjs';
import {METHOD, SCENE_NOTES, ENGINE_NOTES, ACTIONS} from './notes.mjs';

export const SCHEMA = 'box3d-engine-comparison', VERSION = 1;
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const REPOSITORY = 'https://github.com/nathansenn/box3d-WEBGPU';
const THIS = 'box3d';
const GROUPS = [
  ['stacking', 'Stacking'], ['piles', 'Piles'], ['terrain', 'Terrain'], ['joints', 'Joints'], ['queries', 'Ray casts'], ['quality', 'Quality scenes'], ['checks', 'Scene checks'],
];

const round = (value, digits = 4) => value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toPrecision(digits));
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const deviation = values => { if (values.length < 2) return null; const m = mean(values); return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1)); };
function roundDeep(value) {
  if (typeof value === 'number') return round(value, 5);
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)]));
  return value;
}

/** The published report from the raw runs. */
export function buildReport(raw) {
  const sceneInfo = SCENES.map(scene => {
    const data = scene.build();
    return {id: scene.id, title: scene.title, group: scene.group, description: SCENE_NOTES[scene.id] ?? '', bodies: data.bodies.length, joints: data.joints.length, steps: data.steps, sleep: scene.sleep, rays: data.rays?.count ?? 0};
  });
  const engines = raw.engines.map(engine => {
    const version = raw.runs.find(run => run.engine === engine.id && run.version)?.version ?? 'not run';
    return {id: engine.id, name: engine.name, label: engine.label, package: engine.package, version, license: engine.license, precision: engine.precision, docs: engine.docs, defaults: engine.defaults, budget: engine.budget,
      bundle: engine.bundle, bytes: engine.bundle.reduce((sum, file) => sum + file.bytes, 0), gzipBytes: engine.bundle.reduce((sum, file) => sum + file.gzipBytes, 0), notes: ENGINE_NOTES[engine.id] ?? []};
  });
  const byKey = new Map();
  for (const run of raw.runs) {
    if (run.config === 'twice') continue;
    const key = `${run.config}|${run.scene}|${run.engine}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(run);
  }
  const results = [];
  for (const [key, runs] of byKey) {
    const [config, scene, engine] = key.split('|');
    runs.sort((a, b) => a.repeat - b.repeat);
    const ok = runs.filter(run => !run.failed), first = ok[0];
    const row = {scene, engine, config, status: ok.length === 0 ? 'failed' : ok.some(run => run.timedOut) ? 'timed-out' : 'ok', repeats: ok.length};
    if (!first) { row.error = runs[0].error; results.push(row); continue; }
    if (runs.length > ok.length) row.error = `${runs.length - ok.length} of ${runs.length} repeats failed: ${runs.find(run => run.failed).error}`;
    const means = ok.map(run => run.step.mean).filter(Number.isFinite);
    row.settings = first.settings;
    row.stepsDone = Math.min(...ok.map(run => run.stepsDone)); row.steps = first.steps;
    if (means.length) {
      row.stepMs = {mean: round(mean(means)), sd: round(deviation(means), 3), best: round(Math.min(...means)), p50: round(median(ok.map(run => run.step.p50))), p95: round(median(ok.map(run => run.step.p95))), max: round(Math.max(...ok.map(run => run.step.max)))};
      row.wallStepMs = {mean: round(mean(ok.map(run => run.stepWall.mean))), p95: round(median(ok.map(run => run.stepWall.p95)))};
    }
    row.constructionMs = round(median(ok.map(run => run.constructionMs)), 3);
    // Light scenes share a process, so their peak memory is not their own and is left out.
    const rss = ok.map(run => run.peakRssBytes).filter(value => typeof value === 'number');
    row.peakRssMb = rss.length ? round(median(rss) / 2 ** 20, 3) : null;
    row.wasmMemoryMb = first.wasmMemoryBytes ? round(Math.max(...ok.map(run => run.wasmMemoryBytes)) / 2 ** 20, 3) : null;
    row.loadAverage = [round(Math.min(...ok.map(run => run.loadAverage)), 3), round(Math.max(...ok.map(run => run.loadAverage)), 3)];
    row.quality = roundDeep(first.quality);
    if (first.rays) {
      row.rays = {count: first.rays.count, ms: round(median(ok.map(run => run.rays.bestMs))), sd: round(deviation(ok.map(run => run.rays.bestMs)), 3), hits: first.rays.hits, meanHitDistanceM: round(first.rays.meanHitDistanceM, 6)};
      row.rays.raysPerSecond = round(first.rays.count / (row.rays.ms / 1000), 3);
      if (first.rays.maxErrorM !== undefined) { row.rays.maxErrorMm = round(first.rays.maxErrorM * 1000, 3); row.rays.missed = first.rays.missed; }
    }
    const hashes = new Set(ok.filter(run => !run.timedOut).map(run => run.stateHash));
    row.repeatsIdentical = ok.filter(run => !run.timedOut).length >= 2 ? hashes.size === 1 : null;
    // Ratio to this engine inside each repeat.
    const reference = byKey.get(`${config}|${scene}|${THIS}`) ?? [], ratios = [];
    for (const run of ok) {
      const base = reference.find(r => r.repeat === run.repeat && !r.failed);
      // A ratio compares like with like: both runs must have covered the same steps (a run stopped at its budget has not).
      if (!base || base.stepsDone !== run.stepsDone) continue;
      const a = first.rays && !first.rays.expected ? run.rays.bestMs : run.step.mean, b = first.rays && !first.rays.expected ? base.rays.bestMs : base.step.mean;
      if (Number.isFinite(a) && Number.isFinite(b) && b > 0) ratios.push(a / b);
    }
    if (ratios.length) row.ratio = {median: round(median(ratios), 3), min: round(Math.min(...ratios), 3), max: round(Math.max(...ratios), 3)};
    results.push(row);
  }
  const determinism = engines.map(engine => {
    const twice = raw.runs.find(run => run.engine === engine.id && run.config === 'twice');
    const rows = results.filter(row => row.engine === engine.id && typeof row.repeatsIdentical === 'boolean');
    return {engine: engine.id, sameProcess: twice?.twice ? twice.twice.identical : null, sameProcessSteps: twice?.twice?.steps ?? null, sameProcessError: twice?.failed ? twice.error : null,
      comparedScenes: rows.length, identicalScenes: rows.filter(row => row.repeatsIdentical).length, differing: rows.filter(row => !row.repeatsIdentical).map(row => `${row.scene} (${row.config === 'default' ? 'default' : 'equal budget'})`)};
  });
  const finished = new Date(raw.finished);
  const report = {schema: SCHEMA, version: VERSION, generated: finished.toISOString().slice(0, 10), started: raw.started, finished: raw.finished, repository: REPOSITORY, thisEngine: THIS,
    machine: raw.machine, repeats: {default: raw.options.repeats, budget: raw.options.budgetRepeats}, stepBudgetMs: raw.options.stepBudgetMs, budgetPasses: 8,
    method: METHOD, actions: ACTIONS, groups: GROUPS.map(([id, title]) => ({id, title})), engines, scenes: sceneInfo, results, determinism};
  // Computed once here, so the page and the Markdown report say the same thing.
  report.summary = {timing: standings(report), quality: qualityStandings(report)};
  return report;
}

// ---- Markdown ------------------------------------------------------------------------------------------------------
const fmt = (value, digits = 3) => value === null || value === undefined ? 'n/a' : Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : Math.abs(value) >= 1 ? value.toFixed(2) : value.toPrecision(Math.min(digits, 2));
/** Columns after the first are right-aligned (numbers) unless `text` is set. */
const table = (headers, rows, text = false) => [`| ${headers.join(' | ')} |`, `| ${headers.map((h, i) => i === 0 || text ? '---' : '---:').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
const kb = bytes => `${(bytes / 1024).toFixed(0)} KiB`;

function finder(report) {
  const index = new Map(report.results.map(row => [`${row.config}|${row.scene}|${row.engine}`, row]));
  return (scene, engine, config = 'default') => index.get(`${config}|${scene}|${engine}`);
}
/** "12.3 (1.8x)" with markers for timed-out and failed rows. */
function timeCell(row, isThis) {
  if (!row) return 'not run';
  if (row.status === 'failed') return 'failed';
  const value = row.rays && row.rays.maxErrorMm === undefined ? row.rays.ms : row.stepMs?.mean;
  if (value === null || value === undefined) return 'n/a';
  const ratio = isThis || !row.ratio ? '' : ` (${row.ratio.median >= 10 ? row.ratio.median.toFixed(0) : row.ratio.median.toFixed(2)}x)`;
  return `${fmt(value)}${ratio}${row.status === 'timed-out' ? ' †' : ''}`;
}
/** Timing scenes where another engine is faster or slower than this one by more than 10 %. */
export function standings(report, config = 'default') {
  const find = finder(report), lines = [];
  for (const scene of report.scenes) {
    if (!['stacking', 'piles', 'terrain', 'joints', 'queries'].includes(scene.group)) continue;
    const own = find(scene.id, report.thisEngine, config);
    if (!own || own.status !== 'ok') { lines.push({scene: scene.id, title: scene.title, state: !own ? 'not run' : own.status}); continue; }
    const others = report.engines.filter(engine => engine.id !== report.thisEngine).map(engine => ({engine, row: find(scene.id, engine.id, config)})).filter(item => item.row?.ratio && item.row.status === 'ok');
    const faster = others.filter(item => item.row.ratio.median < 0.9).sort((a, b) => a.row.ratio.median - b.row.ratio.median);
    const rank = 1 + others.filter(item => item.row.ratio.median < 1).length;
    lines.push({scene: scene.id, title: scene.title, state: own.status, rank, of: others.length + 1, faster: faster.map(item => ({engine: item.engine.id, name: item.engine.name, ratio: item.row.ratio.median})),
      nextBest: others.length ? Math.min(...others.map(item => item.row.ratio.median)) : null});
  }
  return lines;
}

export function renderMarkdown(report) {
  const find = finder(report), engines = report.engines, out = [], names = engines.map(engine => engine.name);
  const scenesOf = group => report.scenes.filter(scene => scene.group === group);
  const own = report.thisEngine;
  out.push('# Engine comparison', '');
  out.push(`This engine against the current npm releases of other web physics engines, on identical scenes. Generated ${report.generated} by \`npm run bench:engines\` (\`benchmarks/engines/\`); the data is \`public/benchmarks/benchmarks.json\` (${report.schema} version ${report.version}) and the page is \`public/benchmarks/\`. Do not edit this file: change \`benchmarks/engines/notes.mjs\` or rerun, then \`node benchmarks/engines/report.mjs\`.`, '');
  out.push(`Machine: ${report.machine.cpu}, ${report.machine.logicalCpus} logical CPUs, ${report.machine.memoryGb} GiB, ${report.machine.platform}, Node ${report.machine.node} (V8 ${report.machine.v8}), flags \`${report.machine.nodeFlags}\`. ${report.machine.note[0].toUpperCase()}${report.machine.note.slice(1)}. Measured ${report.started.slice(0, 16).replace('T', ' ')} to ${report.finished.slice(0, 16).replace('T', ' ')} UTC. Repeats: up to ${report.repeats.default} for default settings and ${report.repeats.budget} for the equal-budget rows; fewer for the heavy scenes (see Method and the "repeats" column).`, '');
  out.push('Times are CPU milliseconds per 1/60 s step on one thread, mean over the run and over the repeats; "(1.8x)" is the median ratio to this engine inside each repeat (above 1 is slower than this engine). † marks a run stopped at its time budget.', '');

  // Where this engine stands.
  out.push('## Where this engine stands', '');
  const stand = report.summary.timing, losing = stand.filter(line => line.faster?.length), failing = stand.filter(line => line.state !== 'ok');
  const firsts = stand.filter(line => line.state === 'ok' && line.rank === 1);
  out.push(`Of ${stand.length} timed scenes at default settings, this engine is the fastest in ${firsts.length} and is beaten by more than 10 % in ${losing.length}.`, '');
  if (losing.length) {
    out.push('Scenes where another engine is more than 10 % faster:', '');
    for (const line of losing) out.push(`- **${line.title}**: ${line.faster.map(f => `${f.name} takes ${(f.ratio * 100).toFixed(0)} % of this engine's time`).join('; ')}.`);
    out.push('');
  }
  if (failing.length) { out.push('Scenes this engine did not finish:', ''); for (const line of failing) out.push(`- **${line.title}**: ${line.state}.`); out.push(''); }
  const qualityLosses = report.summary.quality;
  if (qualityLosses.length) { out.push('Quality measures where another engine does better by more than a tenth (default settings unless the line says 8 solver passes):', ''); for (const line of qualityLosses) out.push(`- ${line}`); out.push(''); }

  // Engines.
  out.push('## Engines', '');
  out.push(table(['Engine', 'Package and version', 'Licence', 'Shipped size (gzip)', 'Default solver settings', 'Equal budget (8 passes)'],
    engines.map(engine => [engine.label, `\`${engine.package}\` ${engine.version}`, engine.license, `${kb(engine.gzipBytes)} (${kb(engine.bytes)} raw)`, engine.defaults, engine.budget]), true), '');
  out.push('Shipped size is the engine\'s WASM and its JavaScript loader as found in the npm package (for this engine: `public/box3d/`), gzip -9. Files:', '');
  for (const engine of engines) out.push(`- ${engine.name}: ${engine.bundle.map(file => `\`${file.file}\` ${kb(file.bytes)}, gzip ${kb(file.gzipBytes)}`).join('; ')}`);
  out.push('', 'Setup notes and limits per engine (the documentation each adapter follows is linked in its source, `benchmarks/engines/adapters/`):', '');
  for (const engine of engines) { out.push(`- **${engine.name}** (${engine.docs.map((url, i) => `[${i + 1}](${url.startsWith('http') ? url : `${report.repository}/blob/main/${url}`})`).join(', ')})`); for (const note of engine.notes) out.push(`  - ${note}`); }
  out.push('');

  // Method.
  out.push('## Method', '');
  for (const line of report.method) out.push(`- ${line}`);
  out.push('');

  // Scenes.
  out.push('## Scenes', '', 'Defined in `benchmarks/engines/scenes.mjs`. "Awake" scenes keep every body awake in every engine; "sleep" scenes use each engine\'s own sleep policy.', '');
  out.push(table(['Scene', 'What it is', 'Bodies', 'Joints', 'Steps', 'Sleeping'], report.scenes.map(scene => [`${scene.title} (\`${scene.id}\`)`, scene.description, scene.bodies.toLocaleString('en-US'), scene.joints.toLocaleString('en-US'), String(scene.steps), scene.sleep === 'off' ? 'awake' : 'sleep'])), '');

  // Timing tables.
  for (const [config, title] of [['default', 'Step time, default settings'], ['8', 'Step time, equal budget (8 solver passes)']]) {
    out.push(`## ${title}`, '');
    if (config === '8') out.push('Every engine is set to 8 solver passes per step (see the engines table for the setting), on the scenes where the number of passes decides the answer or the cost. Havok has no such setting and is left out; cannon-es and ammo.js go from 10 iterations down to 8.', '');
    const rows = [];
    for (const group of ['stacking', 'piles', 'terrain', 'joints']) for (const scene of scenesOf(group)) {
      if (!engines.some(engine => find(scene.id, engine.id, config))) continue;
      rows.push([scene.title, ...engines.map(engine => timeCell(find(scene.id, engine.id, config), engine.id === own))]);
    }
    out.push(table(['Scene (ms per step)', ...names], rows), '');
  }

  // Detail per scene.
  out.push('## Step time in detail, default settings', '');
  out.push('mean, standard deviation of the mean across repeats, the best repeat, p50, p95 (medians over repeats) and the slowest single step of any repeat, in CPU ms; the mean wall time per step; construction (CPU ms, median); peak resident memory of the process (Node included, about 55 MiB empty) and the WASM heap; machine load average during the runs.', '');
  for (const group of ['stacking', 'piles', 'terrain', 'joints']) for (const scene of scenesOf(group)) {
    out.push(`### ${scene.title}`, '');
    out.push(table(['Engine', 'mean', 'sd', 'best', 'p50', 'p95', 'max', 'wall mean', 'x this', 'construct', 'peak RSS MiB', 'WASM MiB', 'load', 'repeats'], engines.map(engine => {
      const row = find(scene.id, engine.id);
      if (!row) return [engine.name, ...Array(13).fill('not run')];
      if (row.status === 'failed') return [engine.name, `failed: ${row.error}`, ...Array(12).fill('')];
      const s = row.stepMs ?? {};
      return [engine.name + (row.status === 'timed-out' ? ` † (${row.stepsDone} of ${row.steps} steps)` : ''), fmt(s.mean), fmt(s.sd), fmt(s.best), fmt(s.p50), fmt(s.p95), fmt(s.max), fmt(row.wallStepMs?.mean), row.ratio ? row.ratio.median.toFixed(2) : 'n/a',
        fmt(row.constructionMs), fmt(row.peakRssMb), fmt(row.wasmMemoryMb), `${row.loadAverage[0].toFixed(1)}-${row.loadAverage[1].toFixed(1)}`, String(row.repeats)];
    })), '');
    const remarks = sceneRemarks(report, scene);
    if (remarks.length) { for (const line of remarks) out.push(`- ${line}`); out.push(''); }
  }

  // Ray casts.
  out.push('## Ray casts', '');
  for (const scene of scenesOf('queries')) {
    out.push(`${scene.description}`, '');
    out.push(table(['Engine', 'ms for all rays', 'sd', 'rays per second', 'x this', 'hits', 'mean hit distance m', 'construct ms'], engines.map(engine => {
      const row = find(scene.id, engine.id);
      if (!row || row.status === 'failed') return [engine.name, row ? `failed: ${row.error}` : 'not run', '', '', '', '', '', ''];
      return [engine.name, fmt(row.rays.ms), fmt(row.rays.sd), Math.round(row.rays.raysPerSecond).toLocaleString('en-US'), row.ratio ? row.ratio.median.toFixed(2) : 'n/a', String(row.rays.hits), row.rays.meanHitDistanceM.toFixed(4), fmt(row.constructionMs)];
    })), '');
  }

  // Quality.
  out.push('## Quality', '', 'Default settings first; the equal-budget value follows after a slash where it was measured.', '');
  const q = (scene, engine, pick, config = 'default') => { const row = find(scene, engine, config); if (!row) return null; if (row.status === 'failed') return 'failed'; return pick(row.quality, row); };
  const both = (scene, engine, pick) => { const a = q(scene, engine, pick), b = q(scene, engine, pick, '8'); return b === null ? a ?? 'not run' : `${a ?? 'not run'} / ${b}`; };
  const num = (value, digits = 3, unit = '') => value === null || value === undefined ? 'n/a' : `${fmt(value, digits)}${unit}`;
  const qualityTable = (title, intro, columns) => {
    out.push(`### ${title}`, '', intro, '');
    out.push(table(['Engine', ...columns.map(column => column[0])], engines.map(engine => [engine.name, ...columns.map(column => both(column[1], engine.id, column[2]))])), '');
  };
  qualityTable('Stack stability and sleeping', 'The resting pyramids over 5 s with each engine\'s sleep policy: the largest distance any box moved from where it was placed, and the step at which the last body fell asleep ("never": still awake after 300 steps).', [
    ['10 rows: max drift mm', 'pyramid-10-sleep', v => `${num(v.maxDriftMm)}${v.standing ? '' : ' (fell)'}`], ['10 rows: asleep at step', 'pyramid-10-sleep', v => v.stepsToSleep ?? (v.awakeAtEnd === null ? 'no sleeping' : 'never')],
    ['20 rows: max drift mm', 'pyramid-20-sleep', v => `${num(v.maxDriftMm)}${v.standing ? '' : ' (fell)'}`], ['20 rows: asleep at step', 'pyramid-20-sleep', v => v.stepsToSleep ?? (v.awakeAtEnd === null ? 'no sleeping' : 'never')],
  ]);
  qualityTable('Chain stretch under a heavy end mass', 'Extra length of the hanging chain as a percentage of its length (0 for an ideal chain): after 5 s, and the largest value during the run. "ground": the end mass reached the ground, two chain lengths below.', [
    ['100 links: end %', 'chain-100', v => v.unstable ? 'unstable' : `${num(v.endStretchPercent)}${v.reachedGround ? ' (ground)' : ''}`], ['100 links: max %', 'chain-100', v => v.unstable ? 'unstable' : num(v.maxStretchPercent)],
    ['1,000 links: end %', 'chain-1000', v => v.unstable ? 'unstable' : `${num(v.endStretchPercent)}${v.reachedGround ? ' (ground)' : ''}`], ['1,000 links: max %', 'chain-1000', v => v.unstable ? 'unstable' : num(v.maxStretchPercent)],
  ]);
  qualityTable('Mass-ratio stacks', 'Largest overlap between neighbouring boxes (mm; 0 for rigid boxes) while the stack stands, or the step at which it collapsed (the heavy box left the top).', [
    ['4 boxes under 1:10', 'stack-10', stackCell], ['4 boxes under 1:100', 'stack-100', stackCell], ['4 boxes under 1:1000', 'stack-1000', stackCell], ['1 box under 1:1000', 'pair-1000', stackCell],
  ]);
  qualityTable('Pendulum and bouncing sphere against closed forms', 'Pendulum: energy change after 10 s as a percentage of m g L (0 exactly), and the error of the first period against the closed form (2.3726 s). Bounce: error of the first rebound height against e^2 h = 0.5 m.', [
    ['Pendulum energy %', 'pendulum', v => num(v.energyDriftPercent)], ['Pendulum period error %', 'pendulum', v => num(v.periodErrorPercent)], ['Pendulum arm error mm', 'pendulum', v => num(v.maxArmErrorMm)], ['Rebound error %', 'bounce', v => num(v.restitutionErrorPercent)],
  ]);
  qualityTable('Tunnelling, terrain and joints', 'Bullets that ended behind the 2 cm wall (of 50 against the static wall and 50 against the dynamic plate); bodies that ended more than 1 m under the terrain (of 2,000); the largest gap between the two anchor points of any ragdoll joint.', [
    ['Tunnelled, static wall', 'bullets', v => String(v.tunnelledStatic)], ['Tunnelled, dynamic plate', 'bullets', v => String(v.tunnelledDynamic)],
    ['Through the mesh', 'trimesh-2k', (v, row) => `${v.fellThrough}${row.status === 'timed-out' ? ' †' : ''}`], ['Through the height field', 'heightfield-2k', (v, row) => `${v.fellThrough}${row.status === 'timed-out' ? ' †' : ''}`],
    ['Ragdoll joint gap mm', 'ragdolls-100', (v, row) => `${num(v.maxJointGapMm)}${row.status === 'timed-out' ? ' †' : ''}`],
  ]);

  out.push('### Determinism', '', 'Same build, same machine. "Same process": the 1,000-box scene built and run twice in one process. "Across processes": scenes whose repeats (separate processes) all ended in the same state, of the scenes with at least two finished repeats.', '');
  out.push(table(['Engine', 'Same process', 'Across processes', 'Scenes that differed'], report.determinism.map(row => {
    const engine = engines.find(e => e.id === row.engine);
    return [engine.name, row.sameProcess === null ? (row.sameProcessError ? 'failed' : 'not run') : row.sameProcess ? 'identical' : 'different', `${row.identicalScenes} of ${row.comparedScenes}`, row.differing.join(', ') || 'none'];
  })), '');

  // Scene checks.
  out.push('### Scene checks', '', 'The terrain is the same surface in every engine: the largest difference between where a vertical ray hits and the height the scene defines there (180 rays).', '');
  out.push(table(['Engine', 'Mesh: max error mm', 'Mesh: rays missed', 'Height field: max error mm', 'Height field: rays missed'], engines.map(engine => {
    const cell = id => { const row = find(id, engine.id); return !row ? ['not run', ''] : row.status === 'failed' ? ['failed', ''] : [fmt(row.rays.maxErrorMm), String(row.rays.missed)]; };
    return [engine.name, ...cell('probe-trimesh'), ...cell('probe-heightfield')];
  })), '');

  // Failures.
  out.push('## Failed and unfinished runs', '');
  const problems = report.results.filter(row => row.status !== 'ok' || row.error);
  if (problems.length === 0) out.push('None.', '');
  else {
    out.push(table(['Engine', 'Scene', 'Settings', 'Result'], problems.map(row => [engines.find(e => e.id === row.engine).name, report.scenes.find(s => s.id === row.scene).title, row.config === 'default' ? 'default' : 'equal budget',
      row.status === 'failed' ? `failed: ${row.error}` : row.status === 'timed-out' ? `stopped at its time budget after ${row.stepsDone} of ${row.steps} steps (${fmt(row.stepMs?.mean)} ms per step)` : row.error]), true), '');
  }

  // Actions.
  out.push('## What was changed after measuring', '');
  if (report.actions.optimizations.length === 0) out.push('Nothing yet.', '');
  for (const item of report.actions.optimizations) { out.push(`### ${item.title}`, ''); for (const line of item.text) out.push(line, ''); }
  out.push('## Recommendations for the C side', '');
  if (report.actions.recommendations.length === 0) out.push('None yet.', '');
  for (const item of report.actions.recommendations) { out.push(`### ${item.title}`, ''); for (const line of item.text) out.push(line, ''); }

  out.push('## Reproducing', '', '```', 'npm ci', 'npm ci --prefix benchmarks/engines', 'npm run bench:engines          # every engine, every scene; one to two hours on a busy 4-core machine (--resume continues a stopped run)', 'npm run test:bench:engines     # the smoke variant in the pull-request gate: tiny scenes, no timing',
    'node benchmarks/engines/run.mjs --engines=box3d,rapier-simd --scenes=boxes-1k --repeats=3 --configs=default --no-report', '```', '',
    'The competitor engines are devDependencies of `benchmarks/engines/package.json` only; nothing the app or the kit ships imports them.', '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
function stackCell(v) {
  if (v.unstable) return 'unstable';
  return v.standing ? `${fmt(v.maxPenetrationMm)} mm` : `collapsed at step ${v.collapsedAtStep}`;
}
/** Lines under a scene's table: results that disqualify a timing (bodies lost, simulation unstable). */
function sceneRemarks(report, scene) {
  const lines = [];
  for (const engine of report.engines) {
    const row = report.results.find(r => r.scene === scene.id && r.engine === engine.id && r.config === 'default');
    if (!row || row.status === 'failed') continue;
    const v = row.quality ?? {};
    if (v.unstable) lines.push(`${engine.name}: the simulation became unstable (a coordinate beyond 10 km or not a number).`);
    if (v.belowGround) lines.push(`${engine.name}: ${v.belowGround} bodies ended below the ground.`);
    if (v.fellThrough) lines.push(`${engine.name}: ${v.fellThrough} bodies ended more than 1 m under the terrain.`);
    if (row.repeatsIdentical === false) lines.push(`${engine.name}: the repeats did not end in the same state.`);
  }
  return lines;
}
/** Quality measures (default settings) where another engine does better than this one, as sentences. */
function qualityStandings(report) {
  const find = finder(report), own = report.thisEngine, lines = [];
  const measures = [
    ['chain-100', 'Chain of 100 links, end stretch', v => Math.abs(v.endStretchPercent), '%'], ['chain-1000', 'Chain of 1,000 links, end stretch', v => Math.abs(v.endStretchPercent), '%'],
    ['pendulum', 'Pendulum energy drift', v => Math.abs(v.energyDriftPercent), '%'], ['pendulum', 'Pendulum period error', v => Math.abs(v.periodErrorPercent), '%'],
    ['bounce', 'Rebound height error', v => Math.abs(v.restitutionErrorPercent), '%'], ['bullets', 'Tunnelled bullets', v => v.tunnelled, ''],
    ['pyramid-10-sleep', 'Pyramid of 10 rows, drift', v => v.maxDriftMm, ' mm'], ['pyramid-20-sleep', 'Pyramid of 20 rows, drift', v => v.maxDriftMm, ' mm'],
    ['ragdolls-100', 'Ragdoll joint gap', v => v.maxJointGapMm, ' mm'], ['stack-10', 'Stack 1:10, penetration', v => v.standing ? v.maxPenetrationMm : Infinity, ' mm'], ['stack-100', 'Stack 1:100, penetration', v => v.standing ? v.maxPenetrationMm : Infinity, ' mm'],
    ['stack-1000', 'Stack 1:1000, penetration', v => v.standing ? v.maxPenetrationMm : Infinity, ' mm'], ['pair-1000', 'Pair 1:1000, penetration', v => v.standing ? v.maxPenetrationMm : Infinity, ' mm'],
  ];
  const show = (value, unit) => value === Infinity ? 'collapsed' : `${fmt(value)}${unit}`;
  for (const [config, suffix] of [['default', ''], ['8', ' at 8 solver passes']]) for (const [scene, base, pick, unit] of measures) {
    const mine = find(scene, own, config), label = `${base}${suffix}`;
    if (!mine && config !== 'default') continue;
    if (!mine || mine.status === 'failed' || mine.quality.unstable) { lines.push(`${label}: this engine failed or was unstable.`); continue; }
    const value = pick(mine.quality), better = [];
    for (const engine of report.engines) {
      if (engine.id === own) continue;
      const row = find(scene, engine.id, config);
      if (!row || row.status !== 'ok' || row.quality.unstable) continue;
      const other = pick(row.quality);
      if (other === null || other === undefined || Number.isNaN(other)) continue;
      // Better by more than 10 % of this engine's value (or by any amount when this engine collapsed).
      if (other < value && (value === Infinity || value - other > 0.1 * Math.abs(value))) better.push(`${engine.name} ${show(other, unit)}`);
    }
    if (value === Infinity && better.length === 0) lines.push(`${label}: collapsed, as in every other engine.`);
    else if (better.length) lines.push(`${label}: ${show(value, unit)} here; better: ${better.join(', ')}.`);
  }
  return lines;
}

async function main() {
  const args = process.argv.slice(2), jsonFile = path.join(root, 'public/benchmarks/benchmarks.json'), docFile = path.join(root, 'docs/BENCHMARKS_ENGINES.md');
  let report;
  if (args.includes('--render') || args.includes('--notes')) {
    report = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    if (args.includes('--notes')) {
      report.method = METHOD; report.actions = ACTIONS;
      for (const engine of report.engines) engine.notes = ENGINE_NOTES[engine.id] ?? [];
      for (const scene of report.scenes) scene.description = SCENE_NOTES[scene.id] ?? '';
      fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 1)}\n`);
    }
  } else {
    const rawFile = args.includes('--raw') ? path.resolve(args[args.indexOf('--raw') + 1]) : path.join(root, 'benchmarks/results/logs/engines/latest.json');
    const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
    // --replace <file>: runs of a later invocation (one scene measured again, for example with a larger time budget)
    // take the place of the main file's runs of the same scene and settings.
    for (let i = 0; i < args.length; i++) if (args[i] === '--replace') {
      const extra = JSON.parse(fs.readFileSync(path.resolve(args[i + 1]), 'utf8')), keys = new Set(extra.runs.map(run => `${run.config}|${run.scene}`));
      raw.runs = [...raw.runs.filter(run => !keys.has(`${run.config}|${run.scene}`)), ...extra.runs];
      if (extra.finished > raw.finished) raw.finished = extra.finished;
    }
    // The descriptive fields (label, licence, documentation followed, settings text) come from the adapters as they are now.
    for (const engine of raw.engines) {
      const {meta} = await import(`./adapters/${engine.id}.mjs`);
      Object.assign(engine, {name: meta.name, label: meta.label, license: meta.license, docs: meta.docs, defaults: meta.defaults, budget: meta.budget});
    }
    report = buildReport(raw);
    fs.mkdirSync(path.dirname(jsonFile), {recursive: true});
    fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 1)}\n`);
    console.log(`Wrote ${path.relative(root, jsonFile)}`);
  }
  fs.writeFileSync(docFile, renderMarkdown(report));
  console.log(`Wrote ${path.relative(root, docFile)}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error?.stack ?? error); process.exitCode = 1; });
