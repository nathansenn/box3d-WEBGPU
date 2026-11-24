/**
 * flow-demo.html: four flow studies run in a worker on this page (box3d-webgpu-kit/flow) and drawn with
 * box3d-webgpu-kit/flow-three: streamlines coloured by speed, surfaces by pressure coefficient, slices, a speed legend
 * and the flow rates of the openings. `?study=car|cylinder|manifold|tank` picks one; `window.flowDemo` reports the
 * state (for the screenshot script).
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {createFlowView, flowLegend} from '../../packages/box3d-kit/src/flow-three.ts';
import {DEMO_STUDIES} from './studies.ts';

type Result = any;
const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const state: {status: 'running' | 'done' | 'error'; id: string; result: Result | null; error: string | null} = {status: 'running', id: '', result: null, error: null};
(window as unknown as {flowDemo: typeof state}).flowDemo = state;

const canvas = $('view') as HTMLCanvasElement, renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f5f7);
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
const controls = new OrbitControls(camera, canvas);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8b939c, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 6, 4); scene.add(sun);
let view: ReturnType<typeof createFlowView> | null = null, extras: THREE.Object3D[] = [], labels: {element: HTMLElement; at: THREE.Vector3}[] = [];

function resize() {
  const box = canvas.parentElement!.getBoundingClientRect();
  renderer.setSize(box.width, box.height, false); camera.aspect = box.width / Math.max(1, box.height); camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const select = $('study') as HTMLSelectElement;
for (const s of DEMO_STUDIES) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.title; select.append(o); }
select.value = DEMO_STUDIES.some(s => s.id === params.get('study')) ? params.get('study')! : 'car';
select.onchange = () => { const u = new URL(location.href); u.searchParams.set('study', select.value); location.href = u.href; };

const fmt = (v: number, d = 3) => Number.isFinite(v) ? Number(v.toPrecision(d)).toString() : '–';
function table(rows: [string, string][]) { $('metrics').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join(''); }

function show(demo: (typeof DEMO_STUDIES)[number], result: Result) {
  if (view) { scene.remove(view.group); view.dispose(); }
  for (const e of extras) scene.remove(e);
  extras = []; labels.forEach(l => l.element.remove()); labels = [];
  view = createFlowView(THREE as never, result, {surface: demo.surface ?? 'plain', surfaceOpacity: demo.surfaceOpacity ?? 1, tubeRadius: 0.22 * result.setup.lattice.cell, sliceOpacity: 0.85, colorBy: demo.colorBy ?? 'speed'});
  scene.add(view.group);
  // the ground of an external study, and the outline of the box
  const ext = result.setup.external, g = result.setup.grid;
  if (ext?.ground) {
    const w = g.max[0] - g.min[0], d = g.max[2] - g.min[2], plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({color: 0xd5d9de, roughness: 0.9}));
    plane.rotation.x = -Math.PI / 2; plane.position.set((g.min[0] + g.max[0]) / 2, ext.ground.height - 0.002, (g.min[2] + g.max[2]) / 2); scene.add(plane); extras.push(plane);
  }
  const box = new THREE.Box3(new THREE.Vector3(...g.min), new THREE.Vector3(...g.max)), helper = new THREE.Box3Helper(box, 0x9aa4ad); scene.add(helper); extras.push(helper);
  // labels: flow rates at the openings of an internal study
  for (const p of result.setup.patches ?? []) {
    const row = result.flow.patches.find((r: Result) => r.name === p.name);
    const shape = (demo.study as any).internal?.[p.kind === 'inlet' ? 'inlets' : 'outlets']?.find((o: Result) => o.name === p.name)?.shape;
    if (!row || !shape) continue;
    const el = document.createElement('div'); el.className = 'label ' + p.kind;
    el.textContent = `${p.name}: ${fmt(Math.abs(row.flowRate) * 1000, 3)} L/s ${p.kind === 'inlet' ? 'in' : 'out'}`;
    $('labels').append(el); labels.push({element: el, at: new THREE.Vector3(...shape.center)});
  }
  // legend
  const legend = $('legend') as HTMLCanvasElement, ctx = legend.getContext('2d')!;
  ctx.clearRect(0, 0, legend.width, legend.height);
  flowLegend(ctx as never, {min: view.range[0], max: view.range[1], title: view.colorBy === 'speed' ? 'Velocity' : 'Pressure', unit: view.colorBy === 'speed' ? 'm/s' : 'Pa', x: 12, y: 10, height: 200, color: '#1c2530'});
  if (demo.surface === 'cp') { flowLegend(ctx as never, {min: -1.5, max: 1, title: 'Cp (surface)', colormap: 'coolwarm', x: 100, y: 10, height: 200, ticks: 6, color: '#1c2530'}); }
  // numbers
  const c = result.forces.coefficients, r = result.run, rows: [string, string][] = [
    ['Cells (box / fluid)', `${result.setup.lattice.cells.toLocaleString()} / ${result.setup.lattice.fluidCells.toLocaleString()}`],
    ['Cell size', `${fmt(result.setup.grid.cell * 1000)} mm`], ['Reynolds number', fmt(result.setup.reynolds)], ['Turbulence model', result.setup.turbulence.model],
    ['Steps, simulated time', `${r.steps}, ${fmt(r.time)} s`], ['Wall time', `${fmt(r.wallTime)} s (${fmt(r.cellUpdatesPerSecond / 1e6)} M cell updates/s)`], ['Converged', `${r.converged} (${r.reason})`]];
  if (c) rows.push(['Cd / Cl / Cs', `${fmt(c.cd)} / ${fmt(c.cl)} / ${fmt(c.cs)}`], ['Reference area', `${fmt(c.referenceArea)} m²`], ['Largest surface Cp', fmt(Math.max(...(result.surface ?? []).map((s: Result) => s.cpMax)))]);
  if (result.wake?.shedding) rows.push(['Strouhal number', fmt(result.wake.shedding.strouhal)]);
  if (!c) rows.push(['Mass balance', fmt(result.flow.massBalance, 2)], ...result.flow.splits.map((s: Result) => [`Split to ${s.name}`, `${fmt(100 * s.fraction)} %`] as [string, string]),
    ...result.flow.pressureDrops.slice(0, 3).map((d: Result) => [`Δp ${d.from} → ${d.to}`, `${fmt(d.static)} Pa`] as [string, string]));
  table(rows);
  $('warnings').textContent = result.warnings.join('\n');
}

function frame() {
  controls.update(); renderer.render(scene, camera);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const l of labels) { const p = l.at.clone().project(camera); l.element.style.left = `${(p.x + 1) / 2 * w}px`; l.element.style.top = `${(1 - p.y) / 2 * h}px`; l.element.style.display = p.z < 1 ? '' : 'none'; }
  requestAnimationFrame(frame);
}

const demo = DEMO_STUDIES.find(s => s.id === select.value)!;
state.id = demo.id;
$('title').textContent = demo.title; $('caption').textContent = demo.caption;
camera.position.set(...demo.camera.position); controls.target.set(...demo.camera.target);
resize(); frame();
// `?result=<url>`: draw a result document computed elsewhere (the same study run by runFlowStudy on Node) instead of
// running the study here
const resultUrl = params.get('result');
if (resultUrl) {
  fetch(resultUrl).then(r => r.json()).then(result => { ($('bar') as HTMLProgressElement).value = 1; $('status').textContent = `Loaded ${resultUrl} (computed in ${fmt(result.run.wallTime)} s).`; state.result = result; show(demo, result); state.status = 'done'; })
    .catch(error => { state.status = 'error'; state.error = String(error); $('status').textContent = `Error: ${error}`; });
} else {
const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});
worker.onmessage = (event: MessageEvent<any>) => {
  const m = event.data;
  if (m.type === 'setup') $('status').textContent = `Running: ${m.fluidCells.toLocaleString()} fluid cells of ${fmt(m.cell * 1000)} mm, Re ${fmt(m.reynolds)}, up to ${m.maxSteps} steps…`;
  else if (m.type === 'progress') { ($('bar') as HTMLProgressElement).value = m.fraction; $('status').textContent = `Step ${m.step} of at most ${m.maxSteps} (${m.phase}), ${fmt(m.seconds)} s` + (m.coefficients ? `, Cd ${fmt(m.coefficients.cd)}` : `, mass balance ${fmt(m.massBalance, 2)}`); }
  else if (m.type === 'result') { ($('bar') as HTMLProgressElement).value = 1; $('status').textContent = `Done in ${fmt(m.result.run.wallTime)} s.`; state.result = m.result; show(demo, m.result); state.status = 'done'; }
  else if (m.type === 'error') { state.status = 'error'; state.error = m.message; $('status').textContent = `Error: ${m.message}`; }
};
worker.postMessage({id: demo.id});
}
