import { clamp, isFiniteArray, mat4LookAt, mat4Multiply, mat4Perspective, matrixColumnLength, type Mat4, type Vec3 } from './math';
import {
  FEATURED_SCENE_IDS,
  SCENES,
  SCENE_CATEGORIES,
  clampStress,
  getSceneById,
  getSceneByOrdinal,
  sceneLabel,
  sceneSearchText,
  type SceneCategory,
  type ScenePreset,
} from './scenes';
import { loadBestPhysicsBackend } from './physics/wasm';
import { WebGPURenderer } from './webgpu/renderer';
import type { CameraRig, DebugLine, PhysicsBackend } from './types';

type Ui = {
  canvas: HTMLCanvasElement;
  sceneButtons: HTMLElement;
  sceneTitle: HTMLElement;
  sceneSubtitle: HTMLElement;
  sceneDetails: HTMLElement;
  sceneSearch: HTMLInputElement;
  categoryFilter: HTMLSelectElement;
  sceneSelect: HTMLSelectElement;
  sceneCount: HTMLElement;
  prevScene: HTMLButtonElement;
  nextScene: HTMLButtonElement;
  randomScene: HTMLButtonElement;
  maxTour: HTMLButtonElement;
  bodyCount: HTMLElement;
  dynamicCount: HTMLElement;
  fps: HTMLElement;
  simMs: HTMLElement;
  upload: HTMLElement;
  backend: HTMLElement;
  hash: HTMLElement;
  warning: HTMLElement;
  log: HTMLElement;
  stress: HTMLInputElement;
  stressValue: HTMLElement;
  pause: HTMLButtonElement;
  step: HTMLButtonElement;
  reset: HTMLButtonElement;
  kick: HTMLButtonElement;
  explode: HTMLButtonElement;
  projectile: HTMLButtonElement;
  rain: HTMLButtonElement;
  debug: HTMLButtonElement;
  runTests: HTMLButtonElement;
};

const ui = getUi();
let backend: PhysicsBackend;
let renderer: WebGPURenderer;
let currentScene: ScenePreset = SCENES[0];
let camera: CameraRig = { ...currentScene.camera, target: [...currentScene.camera.target] as Vec3 };
let paused = false;
let debugEnabled = true;
let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let seed = 0xc0ffee;
let maxTourEnabled = false;
let maxTourSceneStartedAt = 0;
let maxTourActionDone = false;
let featuredCursor = 0;

function getUi(): Ui {
  const byId = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id) as T | null;
    if (!el) throw new Error(`Missing #${id}`);
    return el;
  };
  return {
    canvas: byId<HTMLCanvasElement>('gpu-canvas'),
    sceneButtons: byId('scene-buttons'),
    sceneTitle: byId('scene-title'),
    sceneSubtitle: byId('scene-subtitle'),
    sceneDetails: byId('scene-details'),
    sceneSearch: byId<HTMLInputElement>('scene-search'),
    categoryFilter: byId<HTMLSelectElement>('category-filter'),
    sceneSelect: byId<HTMLSelectElement>('scene-select'),
    sceneCount: byId('scene-count'),
    prevScene: byId<HTMLButtonElement>('prev-scene'),
    nextScene: byId<HTMLButtonElement>('next-scene'),
    randomScene: byId<HTMLButtonElement>('random-scene'),
    maxTour: byId<HTMLButtonElement>('max-tour'),
    bodyCount: byId('body-count'),
    dynamicCount: byId('dynamic-count'),
    fps: byId('fps'),
    simMs: byId('sim-ms'),
    upload: byId('upload'),
    backend: byId('backend'),
    hash: byId('hash'),
    warning: byId('warning'),
    log: byId('test-log'),
    stress: byId<HTMLInputElement>('stress'),
    stressValue: byId('stress-value'),
    pause: byId<HTMLButtonElement>('pause'),
    step: byId<HTMLButtonElement>('step'),
    reset: byId<HTMLButtonElement>('reset'),
    kick: byId<HTMLButtonElement>('kick'),
    explode: byId<HTMLButtonElement>('explode'),
    projectile: byId<HTMLButtonElement>('projectile'),
    rain: byId<HTMLButtonElement>('rain'),
    debug: byId<HTMLButtonElement>('debug'),
    runTests: byId<HTMLButtonElement>('run-tests'),
  };
}

function showFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<main class="fatal"><div><h1>Box3D WebGPU Lab did not start</h1><p>${escapeHtml(message)}</p></div></main>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setLog(message: string): void { ui.log.textContent = message; }
function appendLog(message: string): void { ui.log.textContent = `${ui.log.textContent}\n${message}`.trim(); }

function cameraViewProjection(): Mat4 {
  const aspect = ui.canvas.width / Math.max(1, ui.canvas.height);
  const target = camera.target;
  const cp = Math.cos(camera.pitch);
  const eye: Vec3 = [
    target[0] + Math.cos(camera.yaw) * cp * camera.distance,
    target[1] + Math.sin(camera.pitch) * camera.distance,
    target[2] + Math.sin(camera.yaw) * cp * camera.distance,
  ];
  const proj = mat4Perspective((62 * Math.PI) / 180, aspect, 0.05, 280);
  const view = mat4LookAt(eye, target, [0, 1, 0]);
  return mat4Multiply(proj, view);
}

function setCameraRig(next: CameraRig): void {
  camera = { yaw: next.yaw, pitch: next.pitch, distance: next.distance, target: [...next.target] as Vec3 };
}

function visibleScenes(): ScenePreset[] {
  const q = ui.sceneSearch.value.trim().toLowerCase();
  const category = ui.categoryFilter.value as SceneCategory | 'all';
  return SCENES.filter((scene) => {
    const categoryOk = category === 'all' || scene.category === category;
    const searchOk = q.length === 0 || sceneSearchText(scene).includes(q);
    return categoryOk && searchOk;
  });
}

function buildSceneBrowser(): void {
  ui.categoryFilter.innerHTML = '<option value="all">All categories</option>';
  for (const category of SCENE_CATEGORIES) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    ui.categoryFilter.appendChild(option);
  }
  renderSceneBrowser();
}

function renderSceneBrowser(): void {
  const scenes = visibleScenes();
  ui.sceneSelect.innerHTML = '';
  for (const scene of scenes) {
    const option = document.createElement('option');
    option.value = String(scene.id);
    option.textContent = sceneLabel(scene);
    option.selected = scene.id === currentScene.id;
    ui.sceneSelect.appendChild(option);
  }

  ui.sceneButtons.innerHTML = '';
  const featured = scenes.filter((scene) => FEATURED_SCENE_IDS.includes(scene.id)).slice(0, 24);
  const list = featured.length > 0 ? featured : scenes.slice(0, 24);
  for (const scene of list) {
    const button = document.createElement('button');
    button.textContent = sceneLabel(scene);
    button.title = scene.subtitle;
    button.className = scene.id === currentScene.id ? 'scene active' : 'scene';
    button.addEventListener('click', () => loadScene(scene));
    ui.sceneButtons.appendChild(button);
  }
  ui.sceneCount.textContent = `${scenes.length}/${SCENES.length} scenes`;
}

function updateSceneText(): void {
  ui.sceneTitle.textContent = sceneLabel(currentScene);
  ui.sceneSubtitle.textContent = currentScene.subtitle;
  ui.sceneDetails.textContent = currentScene.details;
  ui.stressValue.textContent = ui.stress.value;
  for (const button of Array.from(ui.sceneButtons.children)) {
    const b = button as HTMLButtonElement;
    b.classList.toggle('active', b.textContent?.startsWith(sceneLabel(currentScene)) ?? false);
  }
  ui.sceneSelect.value = String(currentScene.id);
}

function loadScene(scene: ScenePreset): void {
  currentScene = scene;
  featuredCursor = Math.max(0, FEATURED_SCENE_IDS.indexOf(scene.id));
  setCameraRig(scene.camera);
  ui.stress.value = String(scene.defaultStress);
  seed = (0xc0ffee + scene.id * 0x9e3779b9 + scene.variant * 0x45d9f3b) >>> 0;
  const count = backend.createScene(scene, clampStress(Number(ui.stress.value)), seed);
  renderer.uploadInstances(backend, count);
  maxTourSceneStartedAt = performance.now();
  maxTourActionDone = false;
  renderSceneBrowser();
  updateSceneText();
  updateStats(0, 0, 0, 0);
  setLog(`Loaded ${sceneLabel(scene)} · ${scene.category} · ${scene.family}/${scene.variant} · seed 0x${seed.toString(16)}.`);
}

function reloadSceneWithCurrentStress(): void {
  seed = (seed + 0x10001) >>> 0;
  const count = backend.createScene(currentScene, clampStress(Number(ui.stress.value)), seed);
  renderer.uploadInstances(backend, count);
  maxTourSceneStartedAt = performance.now();
  maxTourActionDone = false;
  updateSceneText();
  setLog(`Reloaded ${sceneLabel(currentScene)} at stress ${ui.stress.value}, seed 0x${seed.toString(16)}.`);
}

function loadRelativeScene(delta: number): void {
  const next = getSceneByOrdinal(currentScene.id + delta);
  loadScene(next);
}

function loadRandomScene(): void {
  const next = SCENES[Math.floor(Math.random() * SCENES.length)] ?? SCENES[0];
  loadScene(next);
}

function toggleMaxTour(): void {
  maxTourEnabled = !maxTourEnabled;
  ui.maxTour.textContent = maxTourEnabled ? 'Max Tour: On' : 'Max Tour';
  if (maxTourEnabled) {
    featuredCursor = Math.max(0, FEATURED_SCENE_IDS.indexOf(currentScene.id));
    maxTourSceneStartedAt = performance.now();
    maxTourActionDone = false;
    appendLog('🚀 Max Tour enabled: cycling through featured capability scenes with automatic impulses/projectiles/rain.');
  }
}

function advanceMaxTour(): void {
  featuredCursor = (featuredCursor + 1) % FEATURED_SCENE_IDS.length;
  loadScene(getSceneById(FEATURED_SCENE_IDS[featuredCursor] ?? 0));
}

function runTourAction(scene: ScenePreset): void {
  if (scene.family === 'rain') {
    const added = backend.spawnRain(220 * clampStress(Number(ui.stress.value)), 18, 24);
    appendLog(`Tour action: spawned ${added} extra rain bodies.`);
  } else if (scene.family === 'skyscraper' || scene.family === 'demolition' || scene.family === 'architecture') {
    fireProjectile();
  } else if (scene.family === 'bridge' || scene.family === 'warehouse') {
    backend.explode(0, 3.2, 0, 16, 14);
    appendLog('Tour action: controlled explosion impulse applied.');
  } else {
    backend.kick(9.5);
    appendLog('Tour action: global impulse kick applied.');
  }
}

function bindControls(): void {
  ui.canvas.addEventListener('pointerdown', (event) => {
    isDragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    ui.canvas.setPointerCapture(event.pointerId);
  });

  ui.canvas.addEventListener('pointermove', (event) => {
    if (!isDragging) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    camera.yaw -= dx * 0.006;
    camera.pitch = clamp(camera.pitch - dy * 0.0045, -1.32, 0.12);
  });

  ui.canvas.addEventListener('pointerup', (event) => {
    isDragging = false;
    try { ui.canvas.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  });

  ui.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.distance = clamp(camera.distance + event.deltaY * 0.018, 8, 100);
  }, { passive: false });

  ui.sceneSearch.addEventListener('input', renderSceneBrowser);
  ui.categoryFilter.addEventListener('change', renderSceneBrowser);
  ui.sceneSelect.addEventListener('change', () => loadScene(getSceneById(Number(ui.sceneSelect.value))));
  ui.prevScene.addEventListener('click', () => loadRelativeScene(-1));
  ui.nextScene.addEventListener('click', () => loadRelativeScene(1));
  ui.randomScene.addEventListener('click', loadRandomScene);
  ui.maxTour.addEventListener('click', toggleMaxTour);

  ui.stress.addEventListener('input', () => { ui.stressValue.textContent = ui.stress.value; });
  ui.stress.addEventListener('change', reloadSceneWithCurrentStress);
  ui.reset.addEventListener('click', reloadSceneWithCurrentStress);
  ui.pause.addEventListener('click', togglePause);
  ui.step.addEventListener('click', () => stepOnce());
  ui.kick.addEventListener('click', () => backend.kick(9.5));
  ui.explode.addEventListener('click', () => backend.explode(0, 3.2, 0, 22, 18));
  ui.projectile.addEventListener('click', fireProjectile);
  ui.rain.addEventListener('click', () => {
    const added = backend.spawnRain(160 * clampStress(Number(ui.stress.value)), 18, 24);
    appendLog(`Spawned ${added} rain bodies.`);
  });
  ui.debug.addEventListener('click', () => {
    debugEnabled = !debugEnabled;
    ui.debug.textContent = debugEnabled ? 'Debug: On' : 'Debug: Off';
  });
  ui.runTests.addEventListener('click', runBrowserSmokeTests);

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.code === 'Space') { event.preventDefault(); backend.kick(9.5); }
    if (key === 'p') togglePause();
    if (key === 'n') stepOnce();
    if (key === 'e') backend.explode(0, 3.2, 0, 22, 18);
    if (key === 'f') fireProjectile();
    if (key === 'r') loadRandomScene();
    if (key === 't') toggleMaxTour();
    if (event.key === 'ArrowLeft') loadRelativeScene(-1);
    if (event.key === 'ArrowRight') loadRelativeScene(1);
    if (key === 'd') {
      debugEnabled = !debugEnabled;
      ui.debug.textContent = debugEnabled ? 'Debug: On' : 'Debug: Off';
    }
    const number = Number.parseInt(event.key, 10);
    if (Number.isInteger(number) && number >= 1 && number <= 9) {
      loadScene(getSceneById(number - 1));
    }
  });

  window.addEventListener('pagehide', () => backend.destroy());
}

function togglePause(): void {
  paused = !paused;
  ui.pause.textContent = paused ? 'Resume' : 'Pause';
}

function stepOnce(): void {
  const start = performance.now();
  backend.step(1 / 60, 4);
  backend.step(1 / 60, 4);
  updateStats(0, performance.now() - start, renderer.uploadedMegabytes(), 1);
}

function fireProjectile(): void {
  const x = Math.cos(camera.yaw) * -28;
  const z = Math.sin(camera.yaw) * -28;
  const vx = -x * 0.95;
  const vz = -z * 0.95;
  const index = backend.launchProjectile(x, Math.max(4, camera.target[1] + 2), z, vx, 2.5, vz, 0.8);
  appendLog(index >= 0 ? `Projectile launched as body #${index}.` : 'Projectile failed: max body count reached or WASM export missing.');
}

function updateStats(fps: number, simMs: number, uploadMb: number, steps: number): void {
  ui.bodyCount.textContent = String(backend.bodyCount());
  ui.dynamicCount.textContent = String(backend.dynamicCount());
  if (fps > 0) ui.fps.textContent = String(Math.round(fps));
  ui.simMs.textContent = `${simMs.toFixed(2)} ms`;
  ui.upload.textContent = `${uploadMb.toFixed(2)} MB`;
  ui.backend.textContent = backend.name;
  ui.hash.textContent = `0x${backend.replayHash().toString(16).padStart(8, '0')}`;
  if (steps > 0) ui.simMs.title = `${steps} fixed simulation step(s) this frame`;
}

function buildDebugLines(): DebugLine[] {
  if (!debugEnabled) return [];
  const lines: DebugLine[] = [];
  const gridExtent = 44;
  for (let i = -gridExtent; i <= gridExtent; i += 2) {
    lines.push({ ax: -gridExtent, ay: 0.015, az: i, bx: gridExtent, by: 0.015, bz: i, r: 0.25, g: 0.34, b: 0.45, a: 0.32 });
    lines.push({ ax: i, ay: 0.015, az: -gridExtent, bx: i, by: 0.015, bz: gridExtent, r: 0.25, g: 0.34, b: 0.45, a: 0.32 });
  }
  lines.push({ ax: -8, ay: 0.04, az: 0, bx: 8, by: 0.04, bz: 0, r: 0.9, g: 0.15, b: 0.16, a: 0.9 });
  lines.push({ ax: 0, ay: 0.04, az: -8, bx: 0, by: 0.04, bz: 8, r: 0.1, g: 0.65, b: 0.9, a: 0.9 });
  lines.push({ ax: 0, ay: 0.04, az: 0, bx: 0, by: 8, bz: 0, r: 0.25, g: 0.9, b: 0.25, a: 0.9 });

  const count = Math.min(backend.bodyCount(), 200);
  const heap = backend.HEAPF32;
  const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
  for (let i = 0; i < count; i++) {
    const o = matrixStart + i * 16;
    const cx = heap[o + 12];
    const cy = heap[o + 13];
    const cz = heap[o + 14];
    const hx = matrixColumnLength(heap, o, 0);
    const hy = matrixColumnLength(heap, o, 1);
    const hz = matrixColumnLength(heap, o, 2);
    if (!Number.isFinite(cx + cy + cz + hx + hy + hz)) continue;
    if (i % 5 !== 0 && count > 80) continue;
    addBoxWire(lines, cx, cy, cz, hx, hy, hz);
  }
  return lines;
}

function addBoxWire(lines: DebugLine[], cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
  const r = 0.78;
  const g = 0.86;
  const b = 1;
  const a = 0.28;
  const pts = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ] as const;
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const;
  for (const [aa, bb] of edges) {
    const p = pts[aa];
    const q = pts[bb];
    lines.push({ ax: p[0], ay: p[1], az: p[2], bx: q[0], by: q[1], bz: q[2], r, g, b, a });
  }
}

async function runBrowserSmokeTests(): Promise<void> {
  const restoreScene = currentScene;
  const restoreStress = Number(ui.stress.value);
  setLog(`Browser smoke tests starting across ${SCENES.length} scenes...`);
  let passed = 0;
  const familyStats = new Map<string, number>();
  for (const scene of SCENES) {
    backend.createScene(scene, 1, (0xabc000 + scene.id) >>> 0);
    for (let i = 0; i < 4; i++) backend.step(1 / 60, 1);
    const count = backend.bodyCount();
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(count, 24) * 16);
    if (count <= 0 || !isFiniteArray(matrices)) {
      appendLog(`❌ ${sceneLabel(scene)}: invalid body count or matrix buffer.`);
      continue;
    }
    passed++;
    familyStats.set(scene.family, (familyStats.get(scene.family) ?? 0) + 1);
    if (scene.id % 10 === 9) appendLog(`✅ ${scene.category}/${scene.family}: ${familyStats.get(scene.family) ?? 0} scenes passed; last hash 0x${backend.replayHash().toString(16)}.`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  backend.createScene(restoreScene, restoreStress, seed);
  currentScene = restoreScene;
  updateSceneText();
  appendLog(`Browser smoke tests complete: ${passed}/${SCENES.length} passed.`);
}

async function main(): Promise<void> {
  const loaded = await loadBestPhysicsBackend();
  backend = loaded.backend;
  renderer = await WebGPURenderer.create(ui.canvas, backend.maxBodies);
  ui.warning.textContent = loaded.warning ? `Running fallback physics until WASM is built: ${loaded.warning}` : 'Box3D WASM loaded successfully.';
  buildSceneBrowser();
  bindControls();
  loadScene(currentScene);

  const fixedStep = 1 / 60;
  const subSteps = 4;
  let last = performance.now();
  let accumulator = 0;
  let fpsFrames = 0;
  let fpsLast = last;
  let fps = 0;

  function frame(now: number): void {
    const deltaSeconds = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (maxTourEnabled) {
      const elapsed = now - maxTourSceneStartedAt;
      if (!maxTourActionDone && elapsed > 2400) {
        maxTourActionDone = true;
        runTourAction(currentScene);
      }
      if (elapsed > currentScene.tourSeconds * 1000) advanceMaxTour();
    }

    let steps = 0;
    const simStart = performance.now();
    if (!paused) {
      accumulator += deltaSeconds;
      while (accumulator >= fixedStep && steps < 6) {
        backend.step(fixedStep, subSteps);
        accumulator -= fixedStep;
        steps++;
      }
    } else {
      backend.syncTransforms();
    }
    const simMs = performance.now() - simStart;

    renderer.writeCamera(cameraViewProjection());
    const bytes = renderer.uploadInstances(backend, backend.bodyCount());
    renderer.render(backend.bodyCount(), buildDebugLines());

    fpsFrames++;
    if (now - fpsLast >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsLast);
      fpsFrames = 0;
      fpsLast = now;
    }
    updateStats(fps, simMs, bytes / (1024 * 1024), steps);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch(showFatal);
