import {
  clamp,
  isFiniteArray,
  matrixColumnLength,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
  type Vec3,
} from './math';
import { CameraMatrixCache } from './camera';
import { FrameLineStager } from './frame-lines';
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
import {
  AAA_SHOWCASES,
  getShowcaseById,
  getShowcaseByOrdinal,
  sampleShowcaseCamera,
  sampleShowcaseCameraInto,
  type AAAShowcase,
  type ShowcaseBeat,
} from './showcases';
import { CinematicEffects } from './effects';
import { loadBestPhysicsBackend } from './physics/wasm';
import { WebGPURenderer } from './webgpu/renderer';
import { SOFT_INSTANCE_BUDGET, SoftSimulationSuite, type SoftSimulationFrame } from './soft/simulations';
import { initializeSoftKernelRuntime } from './soft/kernels';
import type { CameraRig, DebugLine, DynamicSurfaceFrame, PhysicsBackend, RenderQuality, RenderQualityId } from './types';

const MAX_EFFECT_INSTANCES = 1536;
const LIGHT_DIRECTION: Vec3 = vec3Normalize([0.42, -0.84, 0.34]);
const FOG_COLOR: Vec3 = [0.055, 0.085, 0.14];
const rigidDebugLines: DebugLine[] = [];
const rigidDebugLinePool: DebugLine[] = [];
const frameLineStager = new FrameLineStager();
const BOX_CORNER_SIGNS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
] as const;
const BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;

const QUALITY_PROFILES: Record<RenderQualityId, RenderQuality> = {
  performance: {
    id: 'performance', label: 'Performance', exposure: 1.0, bloomStrength: 0.08,
    fogDensity: 0.0035, shadowStrength: 0, effectBudget: 256, resolutionScale: 0.70,
    sampleCount: 1, shadowMapSize: 1024, shadowTapCount: 1,
  },
  balanced: {
    id: 'balanced', label: 'Balanced', exposure: 1.05, bloomStrength: 0.28,
    fogDensity: 0.0055, shadowStrength: 0.68, effectBudget: 512, resolutionScale: 0.85,
    sampleCount: 1, shadowMapSize: 1024, shadowTapCount: 1,
  },
  cinematic: {
    id: 'cinematic', label: 'Cinematic', exposure: 1.12, bloomStrength: 0.62,
    fogDensity: 0.0075, shadowStrength: 1, effectBudget: 1024, resolutionScale: 1.0,
    sampleCount: 4, shadowMapSize: 2048, shadowTapCount: 9,
  },
  ultra: {
    id: 'ultra', label: 'Ultra', exposure: 1.18, bloomStrength: 0.9,
    fogDensity: 0.009, shadowStrength: 1, effectBudget: 1536, resolutionScale: 1.15,
    sampleCount: 4, shadowMapSize: 2048, shadowTapCount: 9,
  },
};

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
  showcaseSelect: HTMLSelectElement;
  showcasePlay: HTMLButtonElement;
  showcaseRestart: HTMLButtonElement;
  showcaseNext: HTMLButtonElement;
  showcaseTitle: HTMLElement;
  showcaseTagline: HTMLElement;
  showcaseObjective: HTMLElement;
  cinematicStatus: HTMLElement;
  cinematicBeat: HTMLElement;
  cinematicProgress: HTMLElement;
  cinematicProgressBar: HTMLElement;
  bodyCount: HTMLElement;
  dynamicCount: HTMLElement;
  effectCount: HTMLElement;
  softSystem: HTMLElement;
  softNodes: HTMLElement;
  softConstraints: HTMLElement;
  softBreaks: HTMLElement;
  softEnergy: HTMLElement;
  fps: HTMLElement;
  simMs: HTMLElement;
  renderMs: HTMLElement;
  upload: HTMLElement;
  backend: HTMLElement;
  hash: HTMLElement;
  qualityStat: HTMLElement;
  warning: HTMLElement;
  log: HTMLElement;
  stress: HTMLInputElement;
  stressValue: HTMLElement;
  quality: HTMLSelectElement;
  speed: HTMLSelectElement;
  pause: HTMLButtonElement;
  step: HTMLButtonElement;
  reset: HTMLButtonElement;
  kick: HTMLButtonElement;
  explode: HTMLButtonElement;
  projectile: HTMLButtonElement;
  rain: HTMLButtonElement;
  debug: HTMLButtonElement;
  runTests: HTMLButtonElement;
  runTurboQuant: HTMLButtonElement;
};

const ui = getUi();
const effects = new CinematicEffects();
const cameraMatrixCache = new CameraMatrixCache();
let soft: SoftSimulationSuite;
let backend: PhysicsBackend;
let renderer: WebGPURenderer;
let currentScene: ScenePreset = SCENES[0];
let camera: CameraRig = cloneRig(currentScene.camera);
let paused = false;
let debugEnabled = false;
let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let seed = 0xc0ffee;
let quality: RenderQuality = QUALITY_PROFILES.cinematic;
let manualSpeed = 1;
let cinematicSpeed = 1;
let activeShowcase: AAAShowcase = AAA_SHOWCASES[0];
let cinematicPlaying = false;
let cinematicTime = 0;
let cinematicNextBeat = 0;
let maxTourEnabled = false;
let showcaseOrdinal = 0;
let globalTime = 0;

function getUi(): Ui {
  const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id) as T | null;
    if (!element) throw new Error(`Missing #${id}`);
    return element;
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
    showcaseSelect: byId<HTMLSelectElement>('showcase-select'),
    showcasePlay: byId<HTMLButtonElement>('showcase-play'),
    showcaseRestart: byId<HTMLButtonElement>('showcase-restart'),
    showcaseNext: byId<HTMLButtonElement>('showcase-next'),
    showcaseTitle: byId('showcase-title'),
    showcaseTagline: byId('showcase-tagline'),
    showcaseObjective: byId('showcase-objective'),
    cinematicStatus: byId('cinematic-status'),
    cinematicBeat: byId('cinematic-beat'),
    cinematicProgress: byId('cinematic-progress'),
    cinematicProgressBar: byId('cinematic-progress-bar'),
    bodyCount: byId('body-count'),
    dynamicCount: byId('dynamic-count'),
    effectCount: byId('effect-count'),
    softSystem: byId('soft-system'),
    softNodes: byId('soft-nodes'),
    softConstraints: byId('soft-constraints'),
    softBreaks: byId('soft-breaks'),
    softEnergy: byId('soft-energy'),
    fps: byId('fps'),
    simMs: byId('sim-ms'),
    renderMs: byId('render-ms'),
    upload: byId('upload'),
    backend: byId('backend'),
    hash: byId('hash'),
    qualityStat: byId('quality-stat'),
    warning: byId('warning'),
    log: byId('test-log'),
    stress: byId<HTMLInputElement>('stress'),
    stressValue: byId('stress-value'),
    quality: byId<HTMLSelectElement>('quality'),
    speed: byId<HTMLSelectElement>('speed'),
    pause: byId<HTMLButtonElement>('pause'),
    step: byId<HTMLButtonElement>('step'),
    reset: byId<HTMLButtonElement>('reset'),
    kick: byId<HTMLButtonElement>('kick'),
    explode: byId<HTMLButtonElement>('explode'),
    projectile: byId<HTMLButtonElement>('projectile'),
    rain: byId<HTMLButtonElement>('rain'),
    debug: byId<HTMLButtonElement>('debug'),
    runTests: byId<HTMLButtonElement>('run-tests'),
    runTurboQuant: byId<HTMLButtonElement>('run-turboquant'),
  };
}

function cloneRig(value: CameraRig): CameraRig {
  return { yaw: value.yaw, pitch: value.pitch, distance: value.distance, target: [...value.target] as Vec3 };
}

function showFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<main class="fatal"><div><p class="eyebrow">Startup fault</p><h1>Box3D WebGPU AAA Lab did not start</h1><p>${escapeHtml(message)}</p></div></main>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setLog(message: string): void {
  ui.log.textContent = message;
}

function appendLog(message: string): void {
  const next = `${ui.log.textContent}\n${message}`.trim().split('\n').slice(-36).join('\n');
  ui.log.textContent = next;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function visibleScenes(): ScenePreset[] {
  const query = ui.sceneSearch.value.trim().toLowerCase();
  const category = ui.categoryFilter.value as SceneCategory | 'all';
  return SCENES.filter((scene) => {
    const categoryMatches = category === 'all' || scene.category === category;
    const searchMatches = query.length === 0 || sceneSearchText(scene).includes(query);
    return categoryMatches && searchMatches;
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
  const heroSceneIds = new Set(AAA_SHOWCASES.map((showcase) => showcase.sceneId));
  const featured = scenes.filter((scene) => heroSceneIds.has(scene.id) || FEATURED_SCENE_IDS.includes(scene.id)).slice(0, 24);
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

function buildShowcaseBrowser(): void {
  ui.showcaseSelect.innerHTML = '';
  for (const showcase of AAA_SHOWCASES) {
    const option = document.createElement('option');
    option.value = showcase.id;
    option.textContent = `${String(AAA_SHOWCASES.indexOf(showcase) + 1).padStart(2, '0')} · ${showcase.title}`;
    ui.showcaseSelect.appendChild(option);
  }
  selectShowcase(activeShowcase, false);
}

function selectShowcase(showcase: AAAShowcase, load = false): void {
  activeShowcase = showcase;
  showcaseOrdinal = Math.max(0, AAA_SHOWCASES.indexOf(showcase));
  ui.showcaseSelect.value = showcase.id;
  ui.showcaseTitle.textContent = showcase.title;
  ui.showcaseTagline.textContent = showcase.tagline;
  ui.showcaseObjective.textContent = showcase.objective;
  ui.cinematicProgress.textContent = `0.0 / ${showcase.duration.toFixed(1)} s`;
  ui.cinematicProgressBar.style.width = '0%';
  ui.cinematicBeat.textContent = 'Ready for director playback.';
  if (load) startShowcase(showcase);
}

function updateSceneText(): void {
  ui.sceneTitle.textContent = sceneLabel(currentScene);
  ui.sceneSubtitle.textContent = currentScene.subtitle;
  ui.sceneDetails.textContent = currentScene.details;
  ui.stressValue.textContent = ui.stress.value;
  for (const child of Array.from(ui.sceneButtons.children)) {
    const button = child as HTMLButtonElement;
    button.classList.toggle('active', button.textContent?.startsWith(sceneLabel(currentScene)) ?? false);
  }
  ui.sceneSelect.value = String(currentScene.id);
}

function loadScene(scene: ScenePreset, stressOverride?: number, keepCinematic = false): void {
  currentScene = scene;
  camera = cloneRig(scene.camera);
  const stress = clampStress(stressOverride ?? scene.defaultStress);
  ui.stress.value = String(stress);
  seed = (0xc0ffee + scene.id * 0x9e3779b9 + scene.variant * 0x45d9f3b) >>> 0;
  effects.clear(seed ^ 0xa11ce);
  const count = backend.createScene(scene, stress, seed);
  soft.createScene(scene, stress, seed);
  renderer.invalidateDynamicCaches();
  renderer.uploadInstances(backend, count);
  const softFrame = soft.buildFrame(false);
  renderer.uploadRopeGrid(softFrame.ropeGrid, count);
  renderer.uploadSurface(softFrame.surface);
  if (!keepCinematic) stopCinematic(false);
  renderSceneBrowser();
  updateSceneText();
  updateStats(0, 0, 0, 0, 0, softFrame);
  setLog(`Loaded ${sceneLabel(scene)} · ${scene.category} · ${scene.family}/${scene.variant} · seed 0x${seed.toString(16)}.`);
}

function reloadSceneWithCurrentStress(): void {
  seed = (seed + 0x10001) >>> 0;
  effects.clear(seed ^ 0xa11ce);
  const stress = clampStress(Number(ui.stress.value));
  const count = backend.createScene(currentScene, stress, seed);
  soft.createScene(currentScene, stress, seed);
  renderer.invalidateDynamicCaches();
  renderer.uploadInstances(backend, count);
  const softFrame = soft.buildFrame(false);
  renderer.uploadRopeGrid(softFrame.ropeGrid, count);
  renderer.uploadSurface(softFrame.surface);
  stopCinematic(false);
  updateSceneText();
  setLog(`Reloaded ${sceneLabel(currentScene)} at stress ${ui.stress.value}, seed 0x${seed.toString(16)}.`);
}

function loadRelativeScene(delta: number): void {
  loadScene(getSceneByOrdinal(currentScene.id + delta));
}

function loadRandomScene(): void {
  const next = SCENES[Math.floor(Math.random() * SCENES.length)] ?? SCENES[0];
  loadScene(next);
}

function startShowcase(showcase: AAAShowcase): void {
  selectShowcase(showcase, false);
  loadScene(getSceneById(showcase.sceneId), showcase.recommendedStress, true);
  cinematicPlaying = true;
  cinematicTime = 0;
  cinematicNextBeat = 0;
  cinematicSpeed = 1;
  paused = false;
  ui.pause.textContent = 'Pause';
  ui.cinematicStatus.textContent = maxTourEnabled ? 'DIRECTOR TOUR' : 'PLAYING';
  ui.cinematicStatus.classList.add('live');
  ui.showcasePlay.textContent = 'Pause Sequence';
  appendLog(`🎬 Director playback started: ${showcase.title}.`);
}

function stopCinematic(writeLog = true): void {
  const wasPlaying = cinematicPlaying;
  cinematicPlaying = false;
  cinematicSpeed = 1;
  ui.cinematicStatus.textContent = 'READY';
  ui.cinematicStatus.classList.remove('live');
  ui.showcasePlay.textContent = 'Play Sequence';
  if (writeLog && wasPlaying) appendLog('Director playback stopped; manual camera and controls restored.');
}

function toggleShowcasePlayback(): void {
  if (!cinematicPlaying) {
    if (cinematicTime >= activeShowcase.duration - 0.01) startShowcase(activeShowcase);
    else {
      cinematicPlaying = true;
      ui.cinematicStatus.textContent = 'PLAYING';
      ui.cinematicStatus.classList.add('live');
      ui.showcasePlay.textContent = 'Pause Sequence';
    }
  } else {
    cinematicPlaying = false;
    ui.cinematicStatus.textContent = 'PAUSED';
    ui.cinematicStatus.classList.remove('live');
    ui.showcasePlay.textContent = 'Resume Sequence';
  }
}

function toggleMaxTour(): void {
  maxTourEnabled = !maxTourEnabled;
  ui.maxTour.textContent = maxTourEnabled ? 'AAA Tour: On' : 'AAA Tour';
  ui.maxTour.classList.toggle('armed', maxTourEnabled);
  if (maxTourEnabled) {
    startShowcase(activeShowcase);
    appendLog(`🚀 AAA Director Tour enabled: all ${AAA_SHOWCASES.length} hero sequences will play automatically.`);
  }
}

function advanceShowcase(): void {
  selectShowcase(getShowcaseByOrdinal(showcaseOrdinal + 1), false);
  startShowcase(activeShowcase);
}

function executeBeat(beat: ShowcaseBeat): void {
  ui.cinematicBeat.innerHTML = `<strong>${escapeHtml(beat.label)}</strong><span>${escapeHtml(beat.detail)}</span>`;
  appendLog(`[${beat.at.toFixed(1)}s] ${beat.label}: ${beat.detail}`);
  const effectBudget = quality.effectBudget;
  const center = beat.center ?? [0, Math.max(2.5, camera.target[1]), 0];

  switch (beat.action) {
    case 'kick': {
      const strength = beat.strength ?? 9;
      backend.kick(strength);
      soft.kick(strength);
      effects.spawnImpulseDust([0, 0.15, 0], strength, effectBudget);
      break;
    }
    case 'explode': {
      const strength = beat.strength ?? 18;
      const radius = beat.radius ?? 9;
      backend.explode(center[0], center[1], center[2], strength, radius);
      soft.explode(center, strength, radius);
      effects.spawnExplosion(center, strength, effectBudget);
      break;
    }
    case 'projectile':
      fireProjectile();
      break;
    case 'rain': {
      const count = beat.count ?? 420;
      const added = backend.spawnRain(count, 19, 26);
      const softAdded = soft.spawnRain(count, 19, 26);
      effects.spawnRainFlash([0, 16, 0], effectBudget);
      appendLog(`Storm beat added ${added}/${count} rigid bodies and ${softAdded} soft/fluid impacts.`);
      break;
    }
    case 'slowmo':
      cinematicSpeed = 0.22;
      effects.addCameraShake(0.08);
      break;
    case 'normal-speed':
      cinematicSpeed = 1;
      break;
    case 'caption':
      break;
  }
}

function updateCinematic(deltaSeconds: number): void {
  if (!cinematicPlaying) return;
  cinematicTime += deltaSeconds;
  sampleShowcaseCameraInto(activeShowcase, cinematicTime, camera);

  while (cinematicNextBeat < activeShowcase.beats.length && activeShowcase.beats[cinematicNextBeat].at <= cinematicTime) {
    executeBeat(activeShowcase.beats[cinematicNextBeat]);
    cinematicNextBeat++;
  }

  const progress = clamp(cinematicTime / activeShowcase.duration, 0, 1);
  ui.cinematicProgress.textContent = `${Math.min(cinematicTime, activeShowcase.duration).toFixed(1)} / ${activeShowcase.duration.toFixed(1)} s`;
  ui.cinematicProgressBar.style.width = `${(progress * 100).toFixed(2)}%`;

  if (cinematicTime >= activeShowcase.duration) {
    cinematicTime = activeShowcase.duration;
    cinematicPlaying = false;
    cinematicSpeed = 1;
    ui.cinematicStatus.textContent = 'COMPLETE';
    ui.cinematicStatus.classList.remove('live');
    ui.showcasePlay.textContent = 'Replay Sequence';
    appendLog(`✅ Hero sequence complete: ${activeShowcase.title}.`);
    if (maxTourEnabled) advanceShowcase();
  }
}

function bindControls(): void {
  ui.canvas.addEventListener('pointerdown', (event) => {
    if (cinematicPlaying) stopCinematic();
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
    camera.pitch = clamp(camera.pitch - dy * 0.0045, 0.08, 1.3);
  });

  const releasePointer = (event: PointerEvent): void => {
    isDragging = false;
    try { ui.canvas.releasePointerCapture(event.pointerId); } catch { /* ignored */ }
  };
  ui.canvas.addEventListener('pointerup', releasePointer);
  ui.canvas.addEventListener('pointercancel', releasePointer);

  ui.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (cinematicPlaying) stopCinematic();
    camera.distance = clamp(camera.distance + event.deltaY * 0.018, 7, 120);
  }, { passive: false });

  ui.sceneSearch.addEventListener('input', renderSceneBrowser);
  ui.categoryFilter.addEventListener('change', renderSceneBrowser);
  ui.sceneSelect.addEventListener('change', () => loadScene(getSceneById(Number(ui.sceneSelect.value))));
  ui.prevScene.addEventListener('click', () => loadRelativeScene(-1));
  ui.nextScene.addEventListener('click', () => loadRelativeScene(1));
  ui.randomScene.addEventListener('click', loadRandomScene);
  ui.maxTour.addEventListener('click', toggleMaxTour);

  ui.showcaseSelect.addEventListener('change', () => selectShowcase(getShowcaseById(ui.showcaseSelect.value), false));
  ui.showcasePlay.addEventListener('click', toggleShowcasePlayback);
  ui.showcaseRestart.addEventListener('click', () => startShowcase(activeShowcase));
  ui.showcaseNext.addEventListener('click', advanceShowcase);

  ui.stress.addEventListener('input', () => { ui.stressValue.textContent = ui.stress.value; });
  ui.stress.addEventListener('change', reloadSceneWithCurrentStress);
  ui.quality.addEventListener('change', () => {
    quality = QUALITY_PROFILES[ui.quality.value as RenderQualityId] ?? QUALITY_PROFILES.cinematic;
    ui.qualityStat.textContent = quality.label;
    appendLog(`Render profile changed to ${quality.label}: exposure ${quality.exposure}, bloom ${quality.bloomStrength}, effects ${quality.effectBudget}.`);
  });
  ui.speed.addEventListener('change', () => {
    manualSpeed = clamp(Number(ui.speed.value), 0.05, 2);
  });

  ui.reset.addEventListener('click', reloadSceneWithCurrentStress);
  ui.pause.addEventListener('click', togglePause);
  ui.step.addEventListener('click', stepOnce);
  ui.kick.addEventListener('click', applyImpulse);
  ui.explode.addEventListener('click', applyExplosion);
  ui.projectile.addEventListener('click', fireProjectile);
  ui.rain.addEventListener('click', applyRain);
  ui.debug.addEventListener('click', toggleDebug);
  ui.runTests.addEventListener('click', runStateTests);
  ui.runTurboQuant.addEventListener('click', runTurboQuantBrowserProbe);

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.code === 'Space') { event.preventDefault(); applyImpulse(); }
    if (key === 'p') togglePause();
    if (key === 'n') stepOnce();
    if (key === 'e') applyExplosion();
    if (key === 'f') fireProjectile();
    if (key === 'r') loadRandomScene();
    if (key === 't') toggleMaxTour();
    if (key === 'c') toggleShowcasePlayback();
    if (key === 'd') toggleDebug();
    if (event.key === 'ArrowLeft') loadRelativeScene(-1);
    if (event.key === 'ArrowRight') loadRelativeScene(1);
    const number = Number.parseInt(event.key, 10);
    if (Number.isInteger(number) && number >= 1 && number <= 9) loadScene(getSceneById(number - 1));
  });

  window.addEventListener('pagehide', () => { backend.destroy(); soft.destroy(); });
}

function togglePause(): void {
  paused = !paused;
  ui.pause.textContent = paused ? 'Resume' : 'Pause';
}

function stepOnce(): void {
  const start = performance.now();
  backend.step(1 / 60, 4);
  soft.step(1 / 60, 4);
  effects.update(1 / 60);
  updateStats(0, performance.now() - start, 0, renderer.uploadedMegabytes(), 1, soft.buildFrame(debugEnabled));
}

function applyImpulse(): void {
  backend.kick(10);
  soft.kick(10);
  effects.spawnImpulseDust([0, 0.15, 0], 10, quality.effectBudget);
  appendLog('Applied a broad structural impulse and cinematic dust pulse.');
}

function applyExplosion(): void {
  const center: Vec3 = [camera.target[0], Math.max(2.8, camera.target[1] * 0.72), camera.target[2]];
  backend.explode(center[0], center[1], center[2], 22, 18);
  soft.explode(center, 22, 18);
  effects.spawnExplosion(center, 22, quality.effectBudget);
  appendLog('Applied a controlled radial blast with shockwave, sparks, smoke, and camera shake.');
}

function fireProjectile(): void {
  const target: Vec3 = [camera.target[0], Math.max(3.5, camera.target[1]), camera.target[2]];
  const start: Vec3 = [
    target[0] - Math.cos(camera.yaw) * 31,
    target[1] + 2.4,
    target[2] - Math.sin(camera.yaw) * 31,
  ];
  const direction = vec3Normalize(vec3Sub(target, start));
  const speed = 31;
  const velocity = vec3Scale(direction, speed);
  velocity[1] += 1.8;
  const index = backend.launchProjectile(start[0], start[1], start[2], velocity[0], velocity[1], velocity[2], 0.88);
  const softIndex = soft.launchProjectile(start, velocity, 0.88);
  effects.spawnProjectileMuzzle(start, velocity, quality.effectBudget);
  appendLog(index >= 0 || softIndex >= 0
    ? `Projectile launched · rigid #${index >= 0 ? index : 'n/a'} · ${soft.kind()} interaction ${softIndex >= 0 ? `#${softIndex}` : 'inactive'}.`
    : 'Projectile failed: body capacity reached or no interactive simulation is active.');
}

function applyRain(): void {
  const requested = 180 * clampStress(Number(ui.stress.value));
  const added = backend.spawnRain(requested, 20, 27);
  const softAdded = soft.spawnRain(requested, 20, 27);
  effects.spawnRainFlash([0, 16, 0], quality.effectBudget);
  appendLog(`Spawned ${added}/${requested} rigid stress bodies plus ${softAdded} cloth/rope/water impact particles.`);
}

function toggleDebug(): void {
  debugEnabled = !debugEnabled;
  ui.debug.textContent = debugEnabled ? 'Diagnostics: On' : 'Diagnostics: Off';
  ui.debug.classList.toggle('armed', debugEnabled);
}

function updateStats(
  fps: number,
  simMs: number,
  renderMs: number,
  uploadMb: number,
  steps: number,
  softFrame: SoftSimulationFrame,
): void {
  ui.bodyCount.textContent = String(backend.bodyCount());
  ui.dynamicCount.textContent = String(backend.dynamicCount());
  ui.effectCount.textContent = String(effects.particleCount());
  ui.softSystem.textContent = softFrame.kind === 'none' ? 'Rigid only' : softFrame.kind.toUpperCase();
  ui.softNodes.textContent = softFrame.nodeCount.toLocaleString();
  ui.softConstraints.textContent = softFrame.constraintCount.toLocaleString();
  ui.softBreaks.textContent = softFrame.brokenCount.toLocaleString();
  ui.softEnergy.textContent = softFrame.energy.toFixed(2);
  if (fps > 0) ui.fps.textContent = String(Math.round(fps));
  ui.simMs.textContent = `${simMs.toFixed(2)} ms`;
  ui.renderMs.textContent = `${renderMs.toFixed(2)} ms`;
  ui.upload.textContent = `${uploadMb.toFixed(2)} MB`;
  ui.backend.textContent = softFrame.kind === 'none' ? backend.name : `${backend.name} + ${softFrame.label}`;
  const combinedHash = (backend.replayHash() ^ Math.imul(softFrame.hash >>> 0, 0x9e3779b1)) >>> 0;
  ui.hash.textContent = `0x${combinedHash.toString(16).padStart(8, '0')}`;
  ui.qualityStat.textContent = quality.label;
  if (steps > 0) ui.simMs.title = `${steps} fixed simulation step(s) this frame`;
}

function buildDebugLines(): DebugLine[] {
  const lines = rigidDebugLines;
  lines.length = 0;
  if (!debugEnabled) return lines;
  const gridExtent = 44;
  for (let i = -gridExtent; i <= gridExtent; i += 2) {
    const major = i % 10 === 0;
    const alpha = major ? 0.42 : 0.17;
    appendRigidDebugLine(lines, -gridExtent, 0.018, i, gridExtent, 0.018, i, 0.22, 0.48, 0.68, alpha);
    appendRigidDebugLine(lines, i, 0.018, -gridExtent, i, 0.018, gridExtent, 0.22, 0.48, 0.68, alpha);
  }
  appendRigidDebugLine(lines, -10, 0.05, 0, 10, 0.05, 0, 1, 0.12, 0.14, 0.95);
  appendRigidDebugLine(lines, 0, 0.05, -10, 0, 0.05, 10, 0.1, 0.72, 1, 0.95);
  appendRigidDebugLine(lines, 0, 0.05, 0, 0, 10, 0, 0.25, 1, 0.35, 0.95);

  const count = Math.min(backend.bodyCount(), 280);
  const heap = backend.HEAPF32;
  const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
  const stride = count > 150 ? 7 : count > 80 ? 4 : 2;
  for (let i = 0; i < count; i += stride) {
    const offset = matrixStart + i * 16;
    const cx = heap[offset + 12];
    const cy = heap[offset + 13];
    const cz = heap[offset + 14];
    const hx = matrixColumnLength(heap, offset, 0);
    const hy = matrixColumnLength(heap, offset, 1);
    const hz = matrixColumnLength(heap, offset, 2);
    if (!Number.isFinite(cx + cy + cz + hx + hy + hz)) continue;
    addBoxWire(lines, cx, cy, cz, hx, hy, hz);
  }
  return lines;
}

function appendRigidDebugLine(
  lines: DebugLine[], ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  r: number, g: number, b: number, a: number,
): void {
  const index = lines.length;
  let line = rigidDebugLinePool[index];
  if (!line) {
    line = { ax, ay, az, bx, by, bz, r, g, b, a };
    rigidDebugLinePool[index] = line;
  } else {
    line.ax = ax; line.ay = ay; line.az = az;
    line.bx = bx; line.by = by; line.bz = bz;
    line.r = r; line.g = g; line.b = b; line.a = a;
  }
  lines[index] = line;
}

function addBoxWire(lines: DebugLine[], cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
  for (const [a, b] of BOX_EDGES) {
    const p = BOX_CORNER_SIGNS[a];
    const q = BOX_CORNER_SIGNS[b];
    appendRigidDebugLine(
      lines,
      cx + p[0] * hx, cy + p[1] * hy, cz + p[2] * hz,
      cx + q[0] * hx, cy + q[1] * hy, cz + q[2] * hz,
      0.42, 0.82, 1, 0.25,
    );
  }
}


function extractSurfaceState(surface: DynamicSurfaceFrame): Float32Array {
  if (surface.path === 'gpu-cloth') return surface.positions.slice(0, surface.vertexCount * 3);
  if (surface.path === 'gpu-water') {
    const output = new Float32Array(surface.vertexCount * 3);
    output.set(surface.eta.subarray(0, surface.vertexCount), 0);
    output.set(surface.u.subarray(0, surface.vertexCount), surface.vertexCount);
    output.set(surface.v.subarray(0, surface.vertexCount), surface.vertexCount * 2);
    return output;
  }
  const output = new Float32Array(surface.vertexCount * 3);
  const view = new DataView(surface.vertices.buffer, surface.vertices.byteOffset, surface.vertices.byteLength);
  for (let i = 0; i < surface.vertexCount; i++) {
    const source = i * surface.vertexStride;
    const target = i * 3;
    output[target] = view.getFloat32(source, true);
    output[target + 1] = view.getFloat32(source + 4, true);
    output[target + 2] = view.getFloat32(source + 8, true);
  }
  return output;
}

function surfaceStateIsFinite(surface: DynamicSurfaceFrame): boolean {
  if (surface.path === 'gpu-cloth') return isFiniteArray(surface.positions) && isFiniteArray(surface.restPositions);
  if (surface.path === 'gpu-water') return isFiniteArray(surface.eta) && isFiniteArray(surface.u) && isFiniteArray(surface.v);
  return isFiniteArray(surface.vertices);
}

function medianSample(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

async function runTurboQuantBrowserProbe(): Promise<void> {
  ui.runTurboQuant.disabled = true;
  const originalText = ui.runTurboQuant.textContent;
  ui.runTurboQuant.textContent = 'Measuring…';
  setLog('TurboQuant target-device probe: collecting a deterministic simulation stream…');
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    const { TurboQuantDeltaStream, turboQuantError, turboQuantPacketBytes } = await import('./compression/turboquant');
    const probe = new SoftSimulationSuite();
    const probeSeed = (seed ^ 0x715517) >>> 0;
    const created = probe.createScene(currentScene, Number(ui.stress.value), probeSeed);
    const frames: Float32Array[] = [];
    let sourceLabel = 'deterministic synthetic state';

    if (created) {
      for (let frameIndex = 0; frameIndex < 48; frameIndex++) {
        if (frameIndex === 12) probe.kick(11);
        if (frameIndex === 24) probe.launchProjectile([-10, 8, 0], [22, -1.5, 1], 0.5);
        if (frameIndex === 36) probe.explode([0, 4, 0], 15, 8);
        probe.step(1 / 60, 4);
        const frame = probe.buildFrame(false);
        const vector = frame.surface
          ? extractSurfaceState(frame.surface)
          : frame.matrices.slice(0, frame.instanceCount * 16);
        if (vector.length > 0 && (frames.length === 0 || vector.length === frames[0].length)) frames.push(vector);
        if ((frameIndex & 15) === 15) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      sourceLabel = `${currentScene.title} ${probe.buildFrame(false).kind} state`;
      probe.destroy();
    }

    if (frames.length < 8) {
      probe.destroy();
      const length = 19_320;
      for (let frameIndex = 0; frameIndex < 48; frameIndex++) {
        const vector = new Float32Array(length);
        for (let i = 0; i < length; i++) {
          vector[i] = Math.sin(i * 0.007 + frameIndex * 0.031) * 3 + Math.cos(i * 0.0017 - frameIndex * 0.013);
        }
        frames.push(vector);
      }
    }

    const length = frames[0].length;
    const options = { bits: 4 as const, blockSize: 64, rotation: 'structured' as const, centered: false, seed: 0x715517 };
    const sampleCount = 5;
    const rawSamples: number[] = [];
    const turboSamples: number[] = [];
    const rawTarget = new Float32Array(length);

    const runRaw = (): void => {
      for (const frame of frames) rawTarget.set(frame);
    };
    const runTurbo = (): void => {
      const encoder = new TurboQuantDeltaStream(length, options);
      const decoder = new TurboQuantDeltaStream(length, options);
      for (const frame of frames) decoder.decodeFrame(encoder.encodeFrame(frame));
    };

    runRaw();
    runTurbo();
    for (let sample = 0; sample < sampleCount; sample++) {
      let start = performance.now();
      runRaw();
      rawSamples.push(performance.now() - start);
      start = performance.now();
      runTurbo();
      turboSamples.push(performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const encoder = new TurboQuantDeltaStream(length, options);
    const decoder = new TurboQuantDeltaStream(length, options);
    let error2 = 0;
    let reference2 = 0;
    let packetBytes = 0;
    for (const frame of frames) {
      const packet = encoder.encodeFrame(frame);
      const reconstructed = decoder.decodeFrame(packet);
      packetBytes = turboQuantPacketBytes(packet);
      const error = turboQuantError(frame, reconstructed);
      error2 += error.mse * frame.length;
      for (let i = 0; i < frame.length; i++) reference2 += frame[i] * frame[i];
    }
    const relativeL2 = Math.sqrt(error2 / Math.max(1e-30, reference2));
    const rawBytes = length * 4;
    const rawMsPerFrame = medianSample(rawSamples) / frames.length;
    const turboMsPerFrame = medianSample(turboSamples) / frames.length;
    const localSpeedup = rawMsPerFrame / turboMsPerFrame;
    const bytesSaved = rawBytes - packetBytes;
    const breakEvenMbPerSecond = bytesSaved > 0 ? (bytesSaved / (turboMsPerFrame / 1000)) / 1_000_000 : 0;
    const decision = localSpeedup >= 1
      ? 'This device measured a local win; verify visually before enabling a lossy path.'
      : 'Raw local transfer wins. Keep TurboQuant for slower network/storage boundaries.';

    setLog([
      'TurboQuant predictive 4-bit target-device probe',
      `Source: ${sourceLabel}`,
      `Vector: ${length.toLocaleString()} floats · ${frames.length} frames`,
      `Payload: ${(rawBytes / 1024).toFixed(2)} KiB → ${(packetBytes / 1024).toFixed(2)} KiB (${(rawBytes / packetBytes).toFixed(2)}× smaller)`,
      `Raw copy: ${rawMsPerFrame.toFixed(4)} ms/frame`,
      `TurboQuant encode + decode: ${turboMsPerFrame.toFixed(4)} ms/frame`,
      `Local end-to-end speed: ${localSpeedup.toFixed(4)}×`,
      `Predictive relative L2 error: ${(relativeL2 * 100).toFixed(3)}%`,
      `Modeled link break-even: ${breakEvenMbPerSecond.toFixed(1)} MB/s`,
      `Decision: ${decision}`,
    ].join('\n'));
  } catch (error) {
    setLog(`TurboQuant probe failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    ui.runTurboQuant.disabled = false;
    ui.runTurboQuant.textContent = originalText;
  }
}

async function runStateTests(): Promise<void> {
  const restoreScene = currentScene;
  const restoreStress = Number(ui.stress.value);
  const restoreShowcase = activeShowcase;
  stopCinematic(false);
  setLog(`AAA state validation starting across ${SCENES.length} physics recipes and ${AAA_SHOWCASES.length} hero sequences...`);
  let scenePassed = 0;
  let showcasePassed = 0;

  for (const scene of SCENES) {
    const testSeed = (0xabc000 + scene.id) >>> 0;
    backend.createScene(scene, 1, testSeed);
    soft.createScene(scene, 1, testSeed);
    for (let i = 0; i < 3; i++) { backend.step(1 / 60, 1); soft.step(1 / 60, 1); }
    const count = backend.bodyCount();
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(count, 32) * 16);
    const softFrame = soft.buildFrame(false);
    const softValidation = soft.validate();
    const surfaceFinite = !softFrame.surface || (surfaceStateIsFinite(softFrame.surface) && softFrame.surface.indexCount > 0);
    const ropeFinite = !softFrame.ropeGrid || (
      softFrame.ropeGrid.nodeCount > 0 &&
      softFrame.ropeGrid.segmentCount > 0 &&
      isFiniteArray(softFrame.ropeGrid.positions) &&
      isFiniteArray(softFrame.ropeGrid.segments)
    );
    if (count > 0 && isFiniteArray(matrices) && backend.replayHash() !== 0 && softValidation.ok && surfaceFinite && ropeFinite) scenePassed++;
    else appendLog(`❌ ${sceneLabel(scene)} invalid: rigid=${count > 0 && isFiniteArray(matrices)}, soft=${softValidation.message}.`);
    if (scene.id % 25 === 24) {
      appendLog(`Physics recipes: ${scenePassed}/${scene.id + 1} passed.`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  for (const showcase of AAA_SHOWCASES) {
    const samples = [0, showcase.duration * 0.25, showcase.duration * 0.5, showcase.duration * 0.75, showcase.duration];
    const camerasFinite = samples.every((time) => {
      const sampled = sampleShowcaseCamera(showcase, time);
      return Number.isFinite(sampled.yaw + sampled.pitch + sampled.distance + sampled.target[0] + sampled.target[1] + sampled.target[2]);
    });
    const beatsSorted = showcase.beats.every((beat, index) => index === 0 || beat.at >= showcase.beats[index - 1].at);
    if (camerasFinite && beatsSorted && showcase.beats.length >= 6) showcasePassed++;
    else appendLog(`❌ ${showcase.title} has invalid camera or beat data.`);
  }

  effects.clear(0x515151);
  effects.spawnExplosion([0, 3, 0], 18, quality.effectBudget);
  effects.update(1 / 60);
  const effectFrame = effects.buildFrame(quality.effectBudget);
  const effectsFinite = effectFrame.count > 0 && isFiniteArray(effectFrame.matrices) && isFiniteArray(effectFrame.colors);

  backend.createScene(restoreScene, restoreStress, seed);
  soft.createScene(restoreScene, restoreStress, seed);
  renderer.invalidateDynamicCaches();
  currentScene = restoreScene;
  selectShowcase(restoreShowcase, false);
  camera = cloneRig(restoreScene.camera);
  effects.clear(seed ^ 0xa11ce);
  updateSceneText();
  appendLog(`✅ State validation complete: ${scenePassed}/${SCENES.length} scenes, ${showcasePassed}/${AAA_SHOWCASES.length} hero sequences, effects ${effectsFinite ? 'passed' : 'failed'}.`);
}

async function main(): Promise<void> {
  const physicsPromise = loadBestPhysicsBackend();
  const softRuntimePromise = initializeSoftKernelRuntime();
  const rendererPromise = physicsPromise.then(({ backend: selectedBackend }) =>
    WebGPURenderer.create(ui.canvas, selectedBackend.maxBodies + SOFT_INSTANCE_BUDGET + MAX_EFFECT_INSTANCES));
  const [loaded, softRuntime, loadedRenderer] = await Promise.all([
    physicsPromise,
    softRuntimePromise,
    rendererPromise,
  ]);
  backend = loaded.backend;
  soft = new SoftSimulationSuite(softRuntime.module);
  renderer = loadedRenderer;
  const softBackend = softRuntime.available ? `${softRuntime.variant.toUpperCase()} soft kernels` : 'JavaScript soft fallback';
  ui.warning.textContent = loaded.warning
    ? `Preview backend active: ${loaded.warning} ${softBackend}; GPU-resident intact cloth and water plus compute-expanded rope rendering are active. Build Box3D WASM for native rigid-body fidelity.`
    : `Native Box3D WASM rigid-body backend loaded with ${softBackend}, GPU cloth, GPU water, and compute-expanded rope rendering.`;
  ui.warning.classList.toggle('native', !loaded.warning);

  buildSceneBrowser();
  buildShowcaseBrowser();
  bindControls();
  ui.quality.value = quality.id;
  ui.speed.value = '1';
  loadScene(currentScene);

  const fixedStep = 1 / 60;
  const subSteps = 4;
  let last = performance.now();
  let accumulator = 0;
  let fpsFrames = 0;
  let fpsLast = last;
  let fps = 0;
  let statsLast = 0;
  let statsFrames = 0;
  let statsSteps = 0;
  let statsSimMs = 0;
  let statsRenderMs = 0;
  let statsUploadedBytes = 0;

  function frame(now: number): void {
    const deltaSeconds = Math.min(0.1, (now - last) / 1000);
    last = now;
    globalTime += deltaSeconds;
    updateCinematic(deltaSeconds);

    const effectiveSpeed = manualSpeed * cinematicSpeed;
    let steps = 0;
    const simStart = performance.now();
    if (!paused) {
      accumulator += deltaSeconds * effectiveSpeed;
      while (accumulator >= fixedStep && steps < 8) {
        backend.step(fixedStep, subSteps);
        soft.step(fixedStep, subSteps);
        accumulator -= fixedStep;
        steps++;
      }
      effects.update(deltaSeconds * effectiveSpeed);
    }
    const simMs = performance.now() - simStart;

    const matrices = cameraMatrixCache.resolve(
      camera,
      effects.cameraShake(),
      ui.canvas.width / Math.max(1, ui.canvas.height),
      LIGHT_DIRECTION,
    );
    renderer.writeSceneUniforms({
      viewProjection: matrices.viewProjection,
      lightViewProjection: matrices.lightViewProjection,
      cameraPosition: matrices.eye,
      timeSeconds: globalTime,
      lightDirection: LIGHT_DIRECTION,
      quality,
      fogColor: FOG_COLOR,
    });

    const rigidCount = backend.bodyCount();
    let uploadedBytes = renderer.uploadInstances(backend, rigidCount);
    const softFrame = soft.buildFrame(debugEnabled);
    const ropeCount = softFrame.ropeGrid?.segmentCount ?? 0;
    uploadedBytes += renderer.uploadRopeGrid(softFrame.ropeGrid, rigidCount);
    const softCpuBase = rigidCount + ropeCount;
    uploadedBytes += renderer.uploadSoftInstances(
      softFrame.matrices,
      softFrame.colors,
      softCpuBase,
      softFrame.instanceCount,
      softFrame.frameVersion,
    );
    const effectFrame = effects.buildFrame(quality.effectBudget);
    const effectBase = softCpuBase + softFrame.instanceCount;
    uploadedBytes += renderer.uploadEffects(
      effectFrame.matrices,
      effectFrame.colors,
      effectBase,
      effectFrame.count,
      effectFrame.frameVersion,
    );
    uploadedBytes += renderer.uploadSurface(softFrame.surface);
    const backendFrameVersion = backend.frameVersion();
    const combinedFrameLines = frameLineStager.resolve(
      debugEnabled,
      backendFrameVersion,
      softFrame.frameVersion,
      effectFrame.frameVersion,
      buildDebugLines,
      softFrame.debugLines,
      effectFrame.debugLines,
    );
    const lineFrameVersion = debugEnabled
      ? (Math.imul(backendFrameVersion, 0x9e3779b1) ^ Math.imul(softFrame.frameVersion, 0x85ebca6b) ^ effectFrame.frameVersion ^ 0x80000000) >>> 0
      : effectFrame.frameVersion;
    const renderMs = renderer.render(effectBase + effectFrame.count, combinedFrameLines, lineFrameVersion);
    statsFrames++;
    statsSteps += steps;
    statsSimMs += simMs;
    statsRenderMs += renderMs;
    statsUploadedBytes += uploadedBytes;

    fpsFrames++;
    if (now - fpsLast >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsLast);
      fpsFrames = 0;
      fpsLast = now;
    }
    if (now - statsLast >= 200) {
      const divisor = Math.max(1, statsFrames);
      updateStats(
        fps,
        statsSimMs / divisor,
        statsRenderMs / divisor,
        statsUploadedBytes / divisor / (1024 * 1024),
        statsSteps,
        softFrame,
      );
      statsFrames = 0;
      statsSteps = 0;
      statsSimMs = 0;
      statsRenderMs = 0;
      statsUploadedBytes = 0;
      statsLast = now;
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch(showFatal);
