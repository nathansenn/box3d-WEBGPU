import {
  clamp,
  isFiniteArray,
  mat4LookAt,
  mat4Multiply,
  mat4Orthographic,
  mat4Perspective,
  matrixColumnLength,
  vec3Add,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
  type Mat4,
  type Vec3,
} from './math';
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
  type AAAShowcase,
  type ShowcaseBeat,
} from './showcases';
import { CinematicEffects } from './effects';
import { loadBestPhysicsBackend } from './physics/wasm';
import { WebGPURenderer } from './webgpu/renderer';
import type { CameraRig, DebugLine, PhysicsBackend, RenderQuality, RenderQualityId } from './types';

const MAX_EFFECT_INSTANCES = 1536;
const LIGHT_DIRECTION: Vec3 = vec3Normalize([0.42, -0.84, 0.34]);
const FOG_COLOR: Vec3 = [0.055, 0.085, 0.14];

const QUALITY_PROFILES: Record<RenderQualityId, RenderQuality> = {
  performance: {
    id: 'performance', label: 'Performance', exposure: 1.0, bloomStrength: 0.08,
    fogDensity: 0.0035, shadowStrength: 0, effectBudget: 256, resolutionScale: 0.70,
  },
  balanced: {
    id: 'balanced', label: 'Balanced', exposure: 1.05, bloomStrength: 0.28,
    fogDensity: 0.0055, shadowStrength: 0.68, effectBudget: 512, resolutionScale: 0.85,
  },
  cinematic: {
    id: 'cinematic', label: 'Cinematic', exposure: 1.12, bloomStrength: 0.62,
    fogDensity: 0.0075, shadowStrength: 1, effectBudget: 1024, resolutionScale: 1.0,
  },
  ultra: {
    id: 'ultra', label: 'Ultra', exposure: 1.18, bloomStrength: 0.9,
    fogDensity: 0.009, shadowStrength: 1, effectBudget: 1536, resolutionScale: 1.15,
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
};

const ui = getUi();
const effects = new CinematicEffects();
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

function cameraMatrices(rig: CameraRig): { viewProjection: Mat4; lightViewProjection: Mat4; eye: Vec3 } {
  const aspect = ui.canvas.width / Math.max(1, ui.canvas.height);
  const cp = Math.cos(rig.pitch);
  const eye: Vec3 = [
    rig.target[0] + Math.cos(rig.yaw) * cp * rig.distance,
    rig.target[1] + Math.sin(rig.pitch) * rig.distance,
    rig.target[2] + Math.sin(rig.yaw) * cp * rig.distance,
  ];
  const projection = mat4Perspective((58 * Math.PI) / 180, aspect, 0.08, 360);
  const view = mat4LookAt(eye, rig.target, [0, 1, 0]);

  const shadowExtent = clamp(rig.distance * 1.35, 34, 86);
  const lightEye = vec3Sub(rig.target, vec3Scale(LIGHT_DIRECTION, 92));
  const lightView = mat4LookAt(lightEye, rig.target, [0, 1, 0]);
  const lightProjection = mat4Orthographic(-shadowExtent, shadowExtent, -shadowExtent, shadowExtent, 0.1, 190);

  return {
    viewProjection: mat4Multiply(projection, view),
    lightViewProjection: mat4Multiply(lightProjection, lightView),
    eye,
  };
}

function cameraWithShake(): CameraRig {
  const shake = effects.cameraShake();
  return {
    yaw: camera.yaw + shake.yaw,
    pitch: clamp(camera.pitch + shake.pitch, 0.08, 1.3),
    distance: camera.distance,
    target: vec3Add(camera.target, shake.targetOffset),
  };
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
  renderer.uploadInstances(backend, count);
  if (!keepCinematic) stopCinematic(false);
  renderSceneBrowser();
  updateSceneText();
  updateStats(0, 0, 0, 0, 0);
  setLog(`Loaded ${sceneLabel(scene)} · ${scene.category} · ${scene.family}/${scene.variant} · seed 0x${seed.toString(16)}.`);
}

function reloadSceneWithCurrentStress(): void {
  seed = (seed + 0x10001) >>> 0;
  effects.clear(seed ^ 0xa11ce);
  const count = backend.createScene(currentScene, clampStress(Number(ui.stress.value)), seed);
  renderer.uploadInstances(backend, count);
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
    appendLog('🚀 AAA Director Tour enabled: all 24 hero sequences will play automatically.');
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
      effects.spawnImpulseDust([0, 0.15, 0], strength, effectBudget);
      break;
    }
    case 'explode': {
      const strength = beat.strength ?? 18;
      const radius = beat.radius ?? 9;
      backend.explode(center[0], center[1], center[2], strength, radius);
      effects.spawnExplosion(center, strength, effectBudget);
      break;
    }
    case 'projectile':
      fireProjectile();
      break;
    case 'rain': {
      const count = beat.count ?? 420;
      const added = backend.spawnRain(count, 19, 26);
      effects.spawnRainFlash([0, 16, 0], effectBudget);
      appendLog(`Storm beat added ${added}/${count} physics bodies.`);
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
  camera = sampleShowcaseCamera(activeShowcase, cinematicTime);

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
  ui.runTests.addEventListener('click', runBrowserSmokeTests);

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

  window.addEventListener('pagehide', () => backend.destroy());
}

function togglePause(): void {
  paused = !paused;
  ui.pause.textContent = paused ? 'Resume' : 'Pause';
}

function stepOnce(): void {
  const start = performance.now();
  backend.step(1 / 60, 4);
  effects.update(1 / 60);
  updateStats(0, performance.now() - start, 0, renderer.uploadedMegabytes(), 1);
}

function applyImpulse(): void {
  backend.kick(10);
  effects.spawnImpulseDust([0, 0.15, 0], 10, quality.effectBudget);
  appendLog('Applied a broad structural impulse and cinematic dust pulse.');
}

function applyExplosion(): void {
  const center: Vec3 = [camera.target[0], Math.max(2.8, camera.target[1] * 0.72), camera.target[2]];
  backend.explode(center[0], center[1], center[2], 22, 18);
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
  effects.spawnProjectileMuzzle(start, velocity, quality.effectBudget);
  appendLog(index >= 0 ? `Projectile launched as body #${index}.` : 'Projectile failed: body capacity reached or WASM export unavailable.');
}

function applyRain(): void {
  const requested = 180 * clampStress(Number(ui.stress.value));
  const added = backend.spawnRain(requested, 20, 27);
  effects.spawnRainFlash([0, 16, 0], quality.effectBudget);
  appendLog(`Spawned ${added}/${requested} stress-rain bodies.`);
}

function toggleDebug(): void {
  debugEnabled = !debugEnabled;
  ui.debug.textContent = debugEnabled ? 'Diagnostics: On' : 'Diagnostics: Off';
  ui.debug.classList.toggle('armed', debugEnabled);
}

function updateStats(fps: number, simMs: number, renderMs: number, uploadMb: number, steps: number): void {
  ui.bodyCount.textContent = String(backend.bodyCount());
  ui.dynamicCount.textContent = String(backend.dynamicCount());
  ui.effectCount.textContent = String(effects.particleCount());
  if (fps > 0) ui.fps.textContent = String(Math.round(fps));
  ui.simMs.textContent = `${simMs.toFixed(2)} ms`;
  ui.renderMs.textContent = `${renderMs.toFixed(2)} ms`;
  ui.upload.textContent = `${uploadMb.toFixed(2)} MB`;
  ui.backend.textContent = backend.name;
  ui.hash.textContent = `0x${backend.replayHash().toString(16).padStart(8, '0')}`;
  ui.qualityStat.textContent = quality.label;
  if (steps > 0) ui.simMs.title = `${steps} fixed simulation step(s) this frame`;
}

function buildDebugLines(): DebugLine[] {
  if (!debugEnabled) return [];
  const lines: DebugLine[] = [];
  const gridExtent = 44;
  for (let i = -gridExtent; i <= gridExtent; i += 2) {
    const major = i % 10 === 0;
    const alpha = major ? 0.42 : 0.17;
    lines.push({ ax: -gridExtent, ay: 0.018, az: i, bx: gridExtent, by: 0.018, bz: i, r: 0.22, g: 0.48, b: 0.68, a: alpha });
    lines.push({ ax: i, ay: 0.018, az: -gridExtent, bx: i, by: 0.018, bz: gridExtent, r: 0.22, g: 0.48, b: 0.68, a: alpha });
  }
  lines.push({ ax: -10, ay: 0.05, az: 0, bx: 10, by: 0.05, bz: 0, r: 1, g: 0.12, b: 0.14, a: 0.95 });
  lines.push({ ax: 0, ay: 0.05, az: -10, bx: 0, by: 0.05, bz: 10, r: 0.1, g: 0.72, b: 1, a: 0.95 });
  lines.push({ ax: 0, ay: 0.05, az: 0, bx: 0, by: 10, bz: 0, r: 0.25, g: 1, b: 0.35, a: 0.95 });

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

function addBoxWire(lines: DebugLine[], cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
  const points = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ] as const;
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  for (const [a, b] of edges) {
    const p = points[a];
    const q = points[b];
    lines.push({ ax: p[0], ay: p[1], az: p[2], bx: q[0], by: q[1], bz: q[2], r: 0.42, g: 0.82, b: 1, a: 0.25 });
  }
}

async function runBrowserSmokeTests(): Promise<void> {
  const restoreScene = currentScene;
  const restoreStress = Number(ui.stress.value);
  const restoreShowcase = activeShowcase;
  stopCinematic(false);
  setLog(`AAA browser validation starting across ${SCENES.length} physics recipes and ${AAA_SHOWCASES.length} hero sequences...`);
  let scenePassed = 0;
  let showcasePassed = 0;

  for (const scene of SCENES) {
    backend.createScene(scene, 1, (0xabc000 + scene.id) >>> 0);
    for (let i = 0; i < 3; i++) backend.step(1 / 60, 1);
    const count = backend.bodyCount();
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(count, 32) * 16);
    if (count > 0 && isFiniteArray(matrices) && backend.replayHash() !== 0) scenePassed++;
    else appendLog(`❌ ${sceneLabel(scene)} produced invalid body/matrix/hash state.`);
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
  currentScene = restoreScene;
  selectShowcase(restoreShowcase, false);
  camera = cloneRig(restoreScene.camera);
  effects.clear(seed ^ 0xa11ce);
  updateSceneText();
  appendLog(`✅ Validation complete: ${scenePassed}/${SCENES.length} scenes, ${showcasePassed}/${AAA_SHOWCASES.length} hero sequences, effects ${effectsFinite ? 'passed' : 'failed'}.`);
}

async function main(): Promise<void> {
  const loaded = await loadBestPhysicsBackend();
  backend = loaded.backend;
  renderer = await WebGPURenderer.create(ui.canvas, backend.maxBodies + MAX_EFFECT_INSTANCES);
  ui.warning.textContent = loaded.warning
    ? `Preview backend active: ${loaded.warning} Build WASM for native Box3D collision and solver fidelity.`
    : 'Native Box3D WASM backend loaded. Full solver fidelity is active.';
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
        accumulator -= fixedStep;
        steps++;
      }
      effects.update(deltaSeconds * effectiveSpeed);
    } else {
      backend.syncTransforms();
    }
    const simMs = performance.now() - simStart;

    const frameRig = cameraWithShake();
    const matrices = cameraMatrices(frameRig);
    renderer.writeSceneUniforms({
      viewProjection: matrices.viewProjection,
      lightViewProjection: matrices.lightViewProjection,
      cameraPosition: matrices.eye,
      timeSeconds: globalTime,
      lightDirection: LIGHT_DIRECTION,
      quality,
      fogColor: FOG_COLOR,
    });

    let uploadedBytes = renderer.uploadInstances(backend, backend.bodyCount());
    const effectFrame = effects.buildFrame(quality.effectBudget);
    uploadedBytes += renderer.uploadEffects(effectFrame.matrices, effectFrame.colors, backend.bodyCount(), effectFrame.count);
    const lines = [...buildDebugLines(), ...effectFrame.debugLines];
    const renderMs = renderer.render(backend.bodyCount() + effectFrame.count, lines);

    fpsFrames++;
    if (now - fpsLast >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsLast);
      fpsFrames = 0;
      fpsLast = now;
    }
    updateStats(fps, simMs, renderMs, uploadedBytes / (1024 * 1024), steps);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch(showFatal);
