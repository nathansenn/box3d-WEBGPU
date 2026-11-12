/**
 * The Lab's scene editor: the view and controller over the editing document
 * of src/lab/scene-editor-model.ts. It lives inside the Scenes panel.
 *
 * Editing is on the scene's initial state. Every command goes through the
 * document (validated by the scene format's validator and by a scratch build
 * in the engine); the world on screen is then rebuilt from the document.
 * Playing steps that world; Reset rebuilds it from the document again.
 *
 * Moving a body: drag it in the view (it slides on the horizontal plane
 * through the point that was grabbed; Shift moves it vertically), nudge it
 * with the arrow keys, or type its coordinates. There is no 3D gizmo.
 *
 * Every string that comes from a scene is written with textContent or as a
 * form value; nothing here builds markup from data.
 */
import './scene-editor.css';
import type { NativeBodyHandle, NativeWorldBackend } from '../engine/native-world.ts';
import { sceneHash, type Scene, type SceneBody, type SceneJoint, type SceneJointType, type SceneShape } from '../engine/scene-format.ts';
import type { DebugLine } from '../types.ts';
import { sceneStepsPerLabTick, LAB_TICK_SECONDS } from './scene-host.ts';
import { quoteForDisplay } from './scene-loading.ts';
import {
  AUTOSAVE_KEY, BODY_PRESETS, GRAVITY_PRESETS, IDENTITY, JOINT_TYPES, MATERIAL_PRESETS, MEASUREMENT_COLUMNS, MeasurementSeries, SceneDocument,
  add3, cameraProject, cameraRay, decodeAutosave, emptyScene, encodeAutosave, generatedShapeOf, gravityPresetOf, jointGeometryInScene, jointTraits, jointWorldGeometry,
  length3, materialPreset, presetShape, principalInertia, quatRotate, quaternionToEuler, rayPlaneY, resolvedMaterial, restingHeight, rulerMeasure, scale3,
  shapeLocalBounds, snapValue, stepWarnings, sub3,
  type BodyPresetId, type CameraRigLike, type EditorCommand, type GeneratedShape, type JointPatch, type MeasurementColumn, type Pose, type Quat, type TerrainFunction, type Vec3,
} from './scene-editor-model.ts';

/** What the editor needs from the Lab page (src/main.ts). */
export interface SceneEditorHost {
  readonly canvas: HTMLCanvasElement;
  /** Where the editor's controls go: an element inside the Scenes panel. */
  readonly mount: HTMLElement;
  camera(): CameraRigLike;
  /** Point the camera at a world position, keeping its angles. */
  lookAt(target: Vec3, distance?: number): void;
  /** Build `scene` in a scratch world. Returns the engine's message when it refuses the scene, null otherwise. */
  checkScene(scene: Scene): string | null;
  /** Replace the world on screen with `scene`, stopped at its initial state. `frame` also points the camera at it. Null on success, a message otherwise. */
  showScene(scene: Scene, frame: boolean): string | null;
  /** The world the scene on screen was built in, with its body handles by id. Null when it is not the editor's scene. */
  world(): { readonly native: NativeWorldBackend; readonly bodies: ReadonlyMap<string, NativeBodyHandle> } | null;
  setPlaying(playing: boolean): void;
  isPlaying(): boolean;
  /** Advance the paused world by one Lab tick. */
  stepOnce(): void;
  /** Lab ticks taken since the scene was built. */
  ticks(): number;
  /** Transforms were written to the native world while it is paused: publish them to the renderer. */
  transformsEdited(): void;
  /** Instance colours were written in the WASM heap: upload them again. */
  colorsEdited(): void;
  /** Lines drawn over the scene (selection frame, joints, ruler). */
  setLines(lines: readonly DebugLine[]): void;
  /** The editor was opened or closed. */
  activeChanged(active: boolean): void;
}

export interface SceneEditorState {
  readonly active: boolean;
  readonly mode: 'edit' | 'run';
  readonly playing: boolean;
  readonly selection: readonly string[];
  readonly bodies: readonly string[];
  readonly joints: readonly string[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoDepth: number;
  readonly sceneHash: string | null;
  readonly message: string;
  /** The message is a refusal or another problem. */
  readonly error: boolean;
  /** How many messages have been shown: it changes with every action, also when the text repeats. */
  readonly messages: number;
  readonly time: number;
  readonly samples: number;
  readonly tracked: string | null;
  readonly ruler: { readonly a: Vec3; readonly b: Vec3; readonly distance: number } | null;
  readonly recovery: boolean;
  readonly warnings: readonly string[];
  /** Lines the editor is drawing over the scene: selection frames, joints, the ruler. */
  readonly overlayLines: number;
}

export interface SceneEditor {
  readonly active: boolean;
  /** Start editing `scene` (a new empty scene when omitted). Returns false, with the reason shown, when it cannot be edited. */
  open(scene?: unknown): boolean;
  /** Replace the document's scene (a file, an example); undoable. */
  replace(scene: unknown): boolean;
  close(): void;
  /** The world was replaced by something that is not the editor's scene. */
  detached(): void;
  /** The document's scene: the initial state that Copy share link and Download save. */
  scene(): Scene | null;
  reset(): void;
  /** Pointer events on the canvas. True when the editor used the event (the camera must not orbit). */
  pointerDown(event: PointerEvent): boolean;
  pointerMove(event: PointerEvent): boolean;
  pointerUp(event: PointerEvent): boolean;
  /** A key pressed anywhere on the page. True when the editor used it. */
  keyDown(event: KeyboardEvent): boolean;
  keyUp(event: KeyboardEvent): void;
  /** One Lab tick was simulated. */
  afterStep(): void;
  /** Once per rendered frame. */
  frame(now: number): void;
  state(): SceneEditorState;
  /** Where a body's centre is on the page, in client pixels: for tests and tools. */
  screenPosition(id: string): { x: number; y: number; visible: boolean } | null;
  csv(): string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const show = (value: number, digits = 6): string => Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '';
const DEG = 180 / Math.PI;
const SELECT_TINT: Vec3 = [1, 0.5, 0.04];
const PLOTS: { readonly id: string; readonly label: string; readonly unit: string; readonly traces: readonly { readonly column: MeasurementColumn; readonly label: string; readonly color: string }[] }[] = [
  { id: 'position', label: 'Position', unit: 'm', traces: [{ column: 'x_m', label: 'x', color: '#ff7a6b' }, { column: 'y_m', label: 'y (height)', color: '#68df55' }, { column: 'z_m', label: 'z', color: '#5ec8ff' }] },
  { id: 'velocity', label: 'Velocity', unit: 'm/s', traces: [{ column: 'vx_m_per_s', label: 'vx', color: '#ff7a6b' }, { column: 'vy_m_per_s', label: 'vy', color: '#68df55' }, { column: 'vz_m_per_s', label: 'vz', color: '#5ec8ff' }, { column: 'speed_m_per_s', label: 'speed', color: '#f3f4f2' }] },
  { id: 'energy', label: 'Energy', unit: 'J', traces: [{ column: 'kinetic_translational_J', label: 'kinetic (translation)', color: '#ffb347' }, { column: 'kinetic_rotational_J', label: 'kinetic (rotation)', color: '#d68cff' }, { column: 'potential_J', label: 'potential', color: '#5ec8ff' }, { column: 'total_J', label: 'total', color: '#f3f4f2' }] },
];

export function createSceneEditor(host: SceneEditorHost): SceneEditor {
  let doc: SceneDocument | null = null;
  let active = false;
  let mode: 'edit' | 'run' = 'edit';
  let selection: string[] = [];
  let message = '';
  let messageIsError = false;
  let messageCount = 0;
  let gridOn = true, gridSize = 0.25, surfaceSnap = true;
  // "Select several": a click or tap adds to the selection without a modifier key (for touch).
  let multiSelect = false;
  let addPreset: BodyPresetId = 'box', addJointType: SceneJointType = 'revolute';
  let pick: { readonly kind: 'anchor' | 'anchorB'; readonly joint: string } | { readonly kind: 'ruler' } | null = null;
  let ruler: { a: Vec3 | null; b: Vec3 | null } = { a: null, b: null };
  let trackChoice = '';
  let plotId = 'position';
  let plotDirty = true;
  const series = new MeasurementSeries(3600);
  let seriesBody: string | null = null;
  let recovery: { readonly scene: Scene; readonly savedAt: string } | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLive = -Infinity;
  // Rows of the colour stream the editor has tinted: the colour the engine wrote, and the tint that replaced it.
  let tinted = new Map<number, { original: [number, number, number]; tint: [number, number, number] }>();
  let tintWorld: NativeWorldBackend | null = null;
  let linesKey = '';
  let lineCount = 0;
  let drag: {
    pointer: number; id: string; startX: number; startY: number; moved: boolean; planeY: number; offset: Vec3; start: Vec3; rotation: Quat; position: [number, number, number]; vertical: boolean;
  } | null = null;
  let emptyClick: { pointer: number; x: number; y: number } | null = null;

  // --- skeleton -----------------------------------------------------------------------------
  const root = el('div', 'lab-editor');
  root.id = 'lab-editor';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Scene editor');
  root.hidden = true;

  const bar = el('div', 'lab-editor-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Simulation and history');
  const button = (id: string, label: string, hint: string, action: () => void): HTMLButtonElement => {
    const node = el('button', '', label);
    node.type = 'button'; node.id = `lab-editor-${id}`; node.title = hint;
    node.addEventListener('click', action);
    return node;
  };
  const playButton = button('play', 'Play', 'Run the simulation from where it is', () => togglePlay());
  const stepButton = button('step', 'Step', 'Advance the simulation by one tick of 1/60 s', () => stepOnce());
  const resetButton = button('reset', 'Reset', 'Return to the edited initial state', () => reset());
  const undoButton = button('undo', 'Undo', 'Undo the last change (Ctrl+Z or Cmd+Z)', () => undo());
  const redoButton = button('redo', 'Redo', 'Redo the change that was undone (Shift+Ctrl+Z or Shift+Cmd+Z)', () => redo());
  const clock = el('output', 'lab-editor-clock', 't = 0.00 s');
  clock.id = 'lab-editor-clock';
  clock.setAttribute('aria-label', 'Simulated time');
  bar.append(playButton, stepButton, resetButton, undoButton, redoButton, clock);

  const alert = el('div', 'lab-editor-alert');
  alert.id = 'lab-editor-recovery';
  alert.setAttribute('role', 'alert');
  alert.hidden = true;
  const status = el('p', 'lab-editor-message');
  status.id = 'lab-editor-message';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const section = (id: string, title: string, open: boolean): { details: HTMLDetailsElement; summary: HTMLElement; body: HTMLDivElement } => {
    const details = el('details', 'lab-editor-section'), summary = el('summary', '', title), body = el('div', 'lab-editor-section-body');
    details.id = `lab-editor-details-${id}`; details.open = open;
    body.id = `lab-editor-section-${id}`;
    details.append(summary, body);
    return { details, summary, body };
  };
  const addSection = section('add', 'Add', true), outlineSection = section('outline', 'Outline', true), inspectorSection = section('inspector', 'Inspector', true);
  const worldSection = section('world', 'World', false), detailsSection = section('details', 'Scene details', false), measureSection = section('measure', 'Measure', false);
  const help = el('p', 'lab-editor-help', 'Click a body to select it (Shift adds to the selection). Drag a body to slide it over the ground plane; hold Shift to raise or lower it. Arrow keys nudge in x and z, Page Up and Page Down in y. Delete removes, Ctrl/Cmd+D duplicates, Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z redoes, Escape deselects.');
  root.append(bar, alert, status, addSection.details, outlineSection.details, inspectorSection.details, worldSection.details, detailsSection.details, measureSection.details, help);
  host.mount.append(root);

  // The plot canvas and its controls are built once, so a redraw never moves the focus.
  const plot = el('canvas', 'lab-editor-plot');
  plot.id = 'lab-editor-plot';
  plot.width = 680; plot.height = 260;
  plot.setAttribute('role', 'img');
  const plotLegend = el('p', 'lab-editor-legend');
  const measureControls = el('div', 'lab-editor-measure-controls'), rulerOut = el('output', 'lab-editor-ruler-out');
  rulerOut.id = 'lab-editor-ruler-out';
  measureSection.body.append(measureControls, plot, plotLegend);

  // --- small form builders ------------------------------------------------------------------
  const field = (parent: HTMLElement, id: string, label: string, control: HTMLElement): void => {
    const text = el('label', '', label);
    text.htmlFor = control.id = `lab-editor-${id}`;
    parent.append(text, control);
  };
  const numberInput = (value: number, commit: (value: number) => void, options: { readonly step?: number; readonly min?: number; readonly max?: number; readonly disabled?: boolean } = {}): HTMLInputElement => {
    const input = el('input');
    input.type = 'number'; input.step = options.step === undefined ? 'any' : String(options.step);
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    input.value = show(value);
    input.disabled = options.disabled ?? false;
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(parsed)) { say('Enter a number.', true); scheduleRender(); return; }
      commit(parsed);
    });
    return input;
  };
  const number = (parent: HTMLElement, id: string, label: string, value: number, commit: (value: number) => void, options: { readonly step?: number; readonly min?: number; readonly max?: number; readonly disabled?: boolean } = {}): void => {
    field(parent, id, label, numberInput(value, commit, options));
  };
  /** Three numbers on one row: a group labelled once, each input labelled for assistive technology. */
  const vector = (parent: HTMLElement, id: string, label: string, value: Vec3, commit: (value: [number, number, number]) => void, disabled = false, axes: readonly string[] = ['x', 'y', 'z']): void => {
    const group = el('div', 'lab-editor-vector'), caption = el('span', '', label);
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
    caption.id = `lab-editor-${id}-label`;
    const current: [number, number, number] = [value[0], value[1], value[2]];
    const row = el('div', 'lab-editor-vector-row');
    axes.forEach((axis, k) => {
      const input = numberInput(value[k]!, (next) => { current[k] = next; commit([current[0], current[1], current[2]]); }, { disabled });
      input.id = `lab-editor-${id}-${axis}`;
      input.setAttribute('aria-label', `${label}: ${axis}`);
      const tag = el('span', 'lab-editor-axis', axis);
      tag.setAttribute('aria-hidden', 'true');
      row.append(tag, input);
    });
    group.append(row);
    parent.append(caption, group);
  };
  const select = (parent: HTMLElement, id: string, label: string, options: readonly (readonly [string, string])[], value: string, commit: (value: string) => void, disabled = false): HTMLSelectElement => {
    const node = el('select');
    for (const [key, text] of options) { const option = el('option', '', text); option.value = key; node.append(option); }
    node.value = value; node.disabled = disabled;
    node.addEventListener('change', () => commit(node.value));
    field(parent, id, label, node);
    return node;
  };
  const check = (parent: HTMLElement, id: string, label: string, value: boolean, commit: (value: boolean) => void, disabled = false): HTMLInputElement => {
    const wrap = el('label', 'lab-editor-check'), input = el('input');
    input.type = 'checkbox'; input.id = `lab-editor-${id}`; input.checked = value; input.disabled = disabled;
    input.addEventListener('change', () => commit(input.checked));
    wrap.append(input, document.createTextNode(label));
    parent.append(wrap);
    return input;
  };
  const textInput = (parent: HTMLElement, id: string, label: string, value: string, commit: (value: string) => void, disabled = false, maxLength = 64): HTMLInputElement => {
    const input = el('input');
    input.type = 'text'; input.value = value; input.maxLength = maxLength; input.disabled = disabled; input.spellcheck = false; input.autocomplete = 'off';
    input.addEventListener('change', () => commit(input.value));
    field(parent, id, label, input);
    return input;
  };
  const grid = (): HTMLDivElement => el('div', 'lab-editor-grid');
  const actions = (...nodes: HTMLElement[]): HTMLDivElement => { const row = el('div', 'lab-editor-actions'); row.append(...nodes); return row; };
  const heading = (text: string): HTMLElement => el('h3', 'lab-editor-subhead', text);

  // --- messages -----------------------------------------------------------------------------
  function say(text: string, error = false): void {
    message = quoteForDisplay(text, 600);
    messageIsError = error;
    messageCount++;
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  // --- document changes ---------------------------------------------------------------------
  function scene(): Scene { return doc!.scene; }
  const bodyOf = (id: string): SceneBody | null => doc?.body(id) ?? null;
  const jointOf = (id: string): SceneJoint | null => doc?.joint(id) ?? null;
  const selectedBodies = (): SceneBody[] => selection.map(bodyOf).filter((body): body is SceneBody => body !== null);

  function pruneSelection(): void {
    selection = selection.filter(id => bodyOf(id) !== null || jointOf(id) !== null);
  }

  /** Show the document's scene in the world, stopped at its start. */
  function rebuild(frame = false): boolean {
    untint();
    const error = host.showScene(scene(), frame);
    mode = 'edit';
    series.clear(); seriesBody = null; plotDirty = true;
    linesKey = '';
    if (error !== null) { say(`The scene could not be shown: ${error}`, true); return false; }
    return true;
  }

  function scheduleAutosave(): void {
    if (recovery !== null) return;   // An older autosave is waiting for an answer: do not overwrite it.
    if (autosaveTimer !== null) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      if (!doc || !active) return;
      try {
        const text = encodeAutosave(doc.scene, new Date().toISOString());
        if (text === null) window.localStorage.removeItem(AUTOSAVE_KEY); else window.localStorage.setItem(AUTOSAVE_KEY, text);
      } catch { /* storage is full, blocked or absent: autosave is a convenience, not a requirement */ }
    }, 400);
  }

  /** Apply a command. A refusal is shown and changes nothing. */
  function run(command: EditorCommand, mergeKey: string | null = null, selectCreated = true): boolean {
    if (!doc) return false;
    if (mode === 'run') { say('The simulation has moved on. Press Reset to return to the initial state, then edit.', true); scheduleRender(); return false; }
    const result = doc.apply(command, mergeKey);
    if (!result.ok) { say(`Not changed. ${result.message}`, true); scheduleRender(); return false; }
    if (selectCreated && result.created.length > 0) selection = [...result.created];
    pruneSelection();
    say([`${result.label}.`, ...result.notes].join(' '));
    rebuild();
    scheduleAutosave();
    scheduleRender();
    return true;
  }

  function undo(): void {
    if (!doc) return;
    if (mode === 'run') { say('Press Reset before undoing: the simulation has moved on.', true); return; }
    const label = doc.undo();
    if (label === null) { say('Nothing to undo.'); return; }
    pruneSelection(); say(`Undone: ${label}.`); rebuild(); scheduleAutosave(); scheduleRender();
  }
  function redo(): void {
    if (!doc) return;
    if (mode === 'run') { say('Press Reset before redoing: the simulation has moved on.', true); return; }
    const label = doc.redo();
    if (label === null) { say('Nothing to redo.'); return; }
    pruneSelection(); say(`Redone: ${label}.`); rebuild(); scheduleAutosave(); scheduleRender();
  }

  // --- selection ----------------------------------------------------------------------------
  function setSelection(ids: readonly string[], announce = true): void {
    selection = ids.filter((id, k) => ids.indexOf(id) === k && (bodyOf(id) !== null || jointOf(id) !== null));
    doc?.breakMerge();
    linesKey = '';
    if (announce) say(selection.length === 0 ? 'Nothing selected.' : `Selected ${selection.map(id => `"${id}"`).join(' and ')}.`);
    scheduleRender();
  }
  function toggleSelection(id: string, additive: boolean): void {
    if (!additive) { setSelection([id]); return; }
    setSelection(selection.includes(id) ? selection.filter(other => other !== id) : [...selection, id]);
  }

  // --- world access -------------------------------------------------------------------------
  function livePose(id: string | null): Pose | null {
    if (id === null) return { position: [0, 0, 0], rotation: IDENTITY };
    const world = host.world(), handle = world?.bodies.get(id);
    if (!world || !handle) return null;
    try { const state = world.native.bodyState(handle); return { position: state.position, rotation: state.rotation }; } catch { return null; }
  }
  function bodyAtToken(token: bigint): string | null {
    const world = host.world();
    if (!world) return null;
    for (const [id, handle] of world.bodies) if (handle.token === token) return id;
    return null;
  }
  function rayAt(event: { clientX: number; clientY: number }): { origin: Vec3; direction: Vec3 } {
    const bounds = host.canvas.getBoundingClientRect();
    const u = (event.clientX - bounds.left) / Math.max(1, bounds.width), v = (event.clientY - bounds.top) / Math.max(1, bounds.height);
    return cameraRay(host.camera(), host.canvas.width / Math.max(1, host.canvas.height), u, v);
  }
  /** The nearest thing a ray hits: the id of a scene body (null for the ground slab or a body the Lab added) and the point. */
  function cast(origin: Vec3, direction: Vec3, reach = 2000, ignore: string | null = null): { id: string | null; point: Vec3 } | null {
    const world = host.world();
    if (!world) return null;
    try {
      const ignoreBody = ignore !== null ? world.bodies.get(ignore) : undefined;
      const [result] = world.native.queryBatch([{ kind: 'ray', origin, translation: scale3(direction, reach), limit: 1, ...(ignoreBody ? { filter: { ignoreBody } } : {}) }]);
      const hit = result && result.kind === 'ray' ? result.hits[0] : undefined;
      return hit ? { id: bodyAtToken(hit.body.token), point: hit.point } : null;
    } catch { return null; }
  }
  /** The height of whatever is below a point, or null when nothing is. */
  function surfaceBelow(x: number, z: number, from: number, ignore: string | null = null): number | null {
    return cast([x, from, z], [0, -1, 0], from + 1000, ignore)?.point[1] ?? null;
  }
  /** The y at which a shape rests on what is below (x, z), looking down from `from`. */
  function restOn(shape: SceneShape, rotation: Quat, x: number, z: number, from: number, ignore: string | null): number | null {
    if (shape.kind === 'heightfield') return null;
    const surface = surfaceBelow(x, z, from, ignore);
    return surface === null ? null : restingHeight(shape, rotation, surface);
  }

  // --- actions ------------------------------------------------------------------------------
  function addBody(): void {
    if (!doc) return;
    const { shape } = presetShape(addPreset), target = host.camera().target;
    const snap = (value: number): number => gridOn ? snapValue(value, gridSize) : Number(value.toPrecision(4));
    const x = snap(target[0]), z = snap(target[2]);
    let y: number | null = shape.kind === 'heightfield' ? 0 : null;
    if (y === null && surfaceSnap) y = restOn(shape, IDENTITY, x, z, 500, null);
    if (y === null) y = restingHeight(shape, IDENTITY, 0);
    run({ type: 'addBody', preset: addPreset, position: [x, y, z] });
  }
  function addJoint(): void {
    const bodies = selectedBodies();
    if (bodies.length === 0 || bodies.length > 2) { say('Select one body (to join it to the world) or two bodies, then add the joint.', true); return; }
    const [a, b] = bodies;
    run({ type: 'addJoint', jointType: addJointType, bodyA: b ? a!.id : null, bodyB: b ? b.id : a!.id });
  }
  function deleteSelection(): void {
    if (!doc || selection.length === 0) { say('Nothing is selected.'); return; }
    // Joints first: deleting a body removes its joints, and they may be selected too.
    const ids = [...selection].sort((p, q) => Number(bodyOf(p) !== null) - Number(bodyOf(q) !== null));
    for (const id of ids) {
      if (jointOf(id)) { if (!run({ type: 'deleteJoint', id })) return; }
      else if (bodyOf(id)) { if (!run({ type: 'deleteBody', id })) return; }
    }
  }
  function duplicateSelection(): void {
    const bodies = selectedBodies();
    if (bodies.length === 0) { say('Select a body to duplicate.'); return; }
    const created: string[] = [];
    for (const body of bodies) {
      const offset: Vec3 = [gridOn ? Math.max(gridSize, snapValue(2 * shapeLocalBounds(body.shape).max[0] + gridSize, gridSize)) : 2 * shapeLocalBounds(body.shape).max[0] + 0.1, 0, 0];
      const before = new Set(scene().bodies.map(other => other.id));
      if (!run({ type: 'duplicateBody', id: body.id, offset }, null, false)) return;
      created.push(...scene().bodies.map(other => other.id).filter(id => !before.has(id)));
    }
    setSelection(created, false);
  }
  function nudge(dx: number, dy: number, dz: number, big: boolean): void {
    const bodies = selectedBodies();
    if (bodies.length === 0) { say('Select a body to move it with the arrow keys.'); return; }
    const stepSize = (gridOn ? gridSize : 0.1) * (big ? 10 : 1);
    for (const body of bodies) {
      const p = body.position, next: [number, number, number] = [p[0] + dx * stepSize, p[1] + dy * stepSize, p[2] + dz * stepSize];
      if (gridOn) { if (dx) next[0] = snapValue(next[0], gridSize); if (dy) next[1] = snapValue(next[1], gridSize); if (dz) next[2] = snapValue(next[2], gridSize); }
      if (!run({ type: 'setTransform', id: body.id, position: next }, `nudge:${body.id}`)) return;
    }
  }
  function dropToSurface(id: string): void {
    const body = bodyOf(id);
    if (!body) return;
    const y = restOn(body.shape, body.rotation ?? IDENTITY, body.position[0], body.position[2], Math.max(500, body.position[1] + 1), id);
    if (y === null) { say(body.shape.kind === 'heightfield' ? 'A height field is placed by its corner; it does not drop.' : 'There is nothing below it to rest on.', true); return; }
    run({ type: 'setTransform', id, position: [body.position[0], y, body.position[2]] });
  }

  function togglePlay(): void {
    if (!doc) return;
    const playing = !host.isPlaying();
    if (playing) beginRun();
    host.setPlaying(playing);
    say(playing ? 'Playing. The inspector shows live values; press Reset to edit again.' : `Paused at t = ${time().toFixed(2)} s.`);
    scheduleRender();
  }
  function beginRun(): void {
    if (mode === 'run') return;
    mode = 'run';
    untint();
    doc?.breakMerge();
    sample();   // the state at t = 0
  }
  function stepOnce(): void {
    if (!doc) return;
    if (host.isPlaying()) host.setPlaying(false);
    beginRun();
    host.stepOnce();
    say(`Stepped to t = ${time().toFixed(3)} s.`);
    scheduleRender();
  }
  function reset(): void {
    if (!doc) return;
    host.setPlaying(false);
    if (rebuild()) say('Reset to the edited initial state.');
    scheduleRender();
  }
  function time(): number {
    const step = doc?.scene.world?.step ?? LAB_TICK_SECONDS;
    return host.ticks() * sceneStepsPerLabTick(step) * step;
  }

  // --- measurement --------------------------------------------------------------------------
  function trackedId(): string | null {
    if (trackChoice !== '' && bodyOf(trackChoice)) return trackChoice;
    return selectedBodies()[0]?.id ?? null;
  }
  function sample(): void {
    const id = trackedId(), world = host.world();
    if (id !== seriesBody) { series.clear(); seriesBody = id; }
    const body = id !== null ? bodyOf(id) : null, handle = id !== null ? world?.bodies.get(id) : undefined;
    if (!body || !world || !handle) return;
    try {
      const state = world.native.bodyState(handle);
      // With massData the body's inertia is not its shape's, and the editor does not read the tensor back: the rotational term is then left out.
      series.push(time(), state, scene().world?.gravity ?? [0, -9.81, 0], body.massData ? null : principalInertia(body.shape, state.mass));
      plotDirty = true;
    } catch { /* the body is gone */ }
  }
  function drawPlot(): void {
    const context = plot.getContext('2d'), group = PLOTS.find(candidate => candidate.id === plotId) ?? PLOTS[0]!;
    if (!context) return;
    const width = plot.width, height = plot.height, left = 8, right = width - 8, top = 30, bottom = height - 26;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0e1113'; context.fillRect(0, 0, width, height);
    context.strokeStyle = '#2b3236'; context.lineWidth = 1;
    context.beginPath();
    for (let i = 0; i <= 4; i++) { const x = left + (right - left) * i / 4; context.moveTo(x, top); context.lineTo(x, bottom); }
    context.moveTo(left, top); context.lineTo(right, top); context.moveTo(left, bottom); context.lineTo(right, bottom);
    context.stroke();
    context.font = '20px system-ui, sans-serif'; context.textBaseline = 'alphabetic'; context.fillStyle = '#a8adae';
    const times = series.column('time_s');
    plot.setAttribute('aria-label', seriesBody === null || times.length === 0
      ? `${group.label} over time: no samples yet. Select a body and press Play.`
      : `${group.label} of ${seriesBody} in ${group.unit} over ${times.length} samples, from ${times[0]!.toFixed(2)} to ${times.at(-1)!.toFixed(2)} seconds`);
    if (times.length < 2) {
      context.textAlign = 'center';
      context.fillText(seriesBody === null ? 'Select a body, then press Play' : 'Press Play to record', (left + right) / 2, (top + bottom) / 2);
      return;
    }
    const columns = group.traces.map(trace => series.column(trace.column));
    let low = Infinity, high = -Infinity;
    for (const column of columns) for (const value of column) if (Number.isFinite(value)) { if (value < low) low = value; if (value > high) high = value; }
    if (!(high >= low)) { low = 0; high = 1; }
    const pad = Math.max((high - low) * 0.08, high === low ? Math.max(1e-3, Math.abs(high) * 0.05) : 0);
    low -= pad; high += pad;
    const t0 = times[0]!, t1 = times.at(-1)!, span = Math.max(1e-9, t1 - t0);
    context.lineWidth = 2.5;
    columns.forEach((column, k) => {
      context.strokeStyle = group.traces[k]!.color;
      context.beginPath();
      let drawing = false;
      for (let i = 0; i < column.length; i++) {
        const value = column[i]!;
        if (!Number.isFinite(value)) { drawing = false; continue; }
        const x = left + (right - left) * (times[i]! - t0) / span, y = bottom - (bottom - top) * (value - low) / (high - low);
        if (drawing) context.lineTo(x, y); else { context.moveTo(x, y); drawing = true; }
      }
      context.stroke();
    });
    context.fillStyle = '#a8adae';
    context.textAlign = 'left'; context.fillText(`${show(high, 4)} ${group.unit}`, left, 22); context.fillText(`${show(low, 4)} ${group.unit}  ·  ${t0.toFixed(2)} s`, left, height - 5);
    context.textAlign = 'right'; context.fillText(`${t1.toFixed(2)} s`, right, height - 5);
  }
  function downloadCsv(): void {
    if (series.length === 0) { say('There is nothing recorded yet. Select a body and press Play.', true); return; }
    const blob = new Blob([series.toCsv()], { type: 'text/csv' }), href = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `measure-${(seriesBody ?? 'body').replace(/[^A-Za-z0-9._-]+/g, '-')}.csv`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    say(`Saved ${anchor.download}: ${series.length} rows, columns ${MEASUREMENT_COLUMNS.join(', ')}.`);
  }
  function rulerText(): string {
    if (ruler.a === null) return pick?.kind === 'ruler' ? 'Click the first point in the view.' : 'No measurement.';
    if (ruler.b === null) return 'Click the second point in the view.';
    const m = rulerMeasure(ruler.a, ruler.b);
    return `Distance ${show(m.distance, 5)} m  (Δx ${show(m.delta[0], 4)} m, Δy ${show(m.delta[1], 4)} m, Δz ${show(m.delta[2], 4)} m; horizontal ${show(m.horizontal, 5)} m)`;
  }

  // --- overlay: tint and lines --------------------------------------------------------------
  function untint(): void {
    const world = host.world();
    if (tinted.size > 0 && world && world.native === tintWorld) {
      try {
        const start = Number(world.native._b3w_colors_ptr()) / 4, heap = world.native.HEAPF32, count = world.native.bodyCount();
        for (const [row, entry] of tinted) {
          if (row >= count) continue;
          // Only undo what is still ours: the engine may have rewritten the row.
          if (heap[start + row * 4] === Math.fround(entry.tint[0]) && heap[start + row * 4 + 1] === Math.fround(entry.tint[1]) && heap[start + row * 4 + 2] === Math.fround(entry.tint[2])) {
            heap[start + row * 4] = entry.original[0]; heap[start + row * 4 + 1] = entry.original[1]; heap[start + row * 4 + 2] = entry.original[2];
          }
        }
        host.colorsEdited();
      } catch { /* the world was replaced */ }
    }
    tinted = new Map(); tintWorld = null;
  }
  /** Tint the selected bodies through the instance colour stream, and keep the tint if the engine rewrites a row. */
  function syncTint(): void {
    const world = host.world();
    if (!world || !active) { tinted = new Map(); tintWorld = null; return; }
    if (tintWorld !== world.native) { tinted = new Map(); tintWorld = world.native; }
    const wanted = new Set<number>();
    for (const id of selection) {
      const handle = world.bodies.get(id);
      if (!handle) continue;
      const row = world.native.bodyIndex(handle);
      if (row !== null) wanted.add(row);
    }
    if (wanted.size === 0 && tinted.size === 0) return;
    const start = Number(world.native._b3w_colors_ptr()) / 4, heap = world.native.HEAPF32, count = world.native.bodyCount();
    let changed = false;
    for (const [row, entry] of tinted) {
      if (wanted.has(row) || row >= count) continue;
      const o = start + row * 4;
      if (heap[o] === Math.fround(entry.tint[0]) && heap[o + 1] === Math.fround(entry.tint[1]) && heap[o + 2] === Math.fround(entry.tint[2])) { heap[o] = entry.original[0]; heap[o + 1] = entry.original[1]; heap[o + 2] = entry.original[2]; changed = true; }
      tinted.delete(row);
    }
    for (const row of wanted) {
      if (row >= count) continue;
      const o = start + row * 4, entry = tinted.get(row);
      if (entry && heap[o] === Math.fround(entry.tint[0]) && heap[o + 1] === Math.fround(entry.tint[1]) && heap[o + 2] === Math.fround(entry.tint[2])) continue;
      const original: [number, number, number] = [heap[o]!, heap[o + 1]!, heap[o + 2]!];
      const tint: [number, number, number] = [original[0] * 0.3 + SELECT_TINT[0] * 0.7, original[1] * 0.3 + SELECT_TINT[1] * 0.7, original[2] * 0.3 + SELECT_TINT[2] * 0.7];
      heap[o] = tint[0]; heap[o + 1] = tint[1]; heap[o + 2] = tint[2];
      tinted.set(row, { original, tint });
      changed = true;
    }
    if (changed) host.colorsEdited();
  }

  function buildLines(): void {
    if (!doc || !active) { if (linesKey !== 'off') { linesKey = 'off'; lineCount = 0; host.setLines([]); } return; }
    const moving = host.isPlaying() || drag !== null;
    const key = `${doc.revision}|${mode}|${host.ticks()}|${selection.join(',')}|${ruler.a?.join(',') ?? ''}|${ruler.b?.join(',') ?? ''}`;
    if (!moving && key === linesKey) return;
    linesKey = key;
    const lines: DebugLine[] = [];
    const line = (a: Vec3, b: Vec3, color: readonly [number, number, number], alpha = 1): void => { lines.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], r: color[0], g: color[1], b: color[2], a: alpha }); };
    const cross = (p: Vec3, size: number, color: readonly [number, number, number]): void => {
      line([p[0] - size, p[1], p[2]], [p[0] + size, p[1], p[2]], color); line([p[0], p[1] - size, p[2]], [p[0], p[1] + size, p[2]], color); line([p[0], p[1], p[2] - size], [p[0], p[1], p[2] + size], color);
    };
    // A frame around each selected body: the box of its shape, turned with the body.
    for (const body of selectedBodies()) {
      const pose = livePose(body.id) ?? { position: body.position, rotation: body.rotation ?? IDENTITY }, bounds = shapeLocalBounds(body.shape);
      const pad = 0.02, lo = bounds.min.map(value => value - pad), hi = bounds.max.map(value => value + pad);
      const corner = (i: number): Vec3 => add3(pose.position, quatRotate(pose.rotation, [i & 1 ? hi[0]! : lo[0]!, i & 2 ? hi[1]! : lo[1]!, i & 4 ? hi[2]! : lo[2]!]));
      for (const [p, q] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const) line(corner(p), corner(q), [1, 0.78, 0.2]);
    }
    // Joints: a cross at each anchor, a line between the two, and the axis.
    // Lines are depth-tested, and an anchor is usually inside a body: the markers are sized to reach out of it.
    const reach = Math.max(0.2, host.camera().distance * 0.06);
    for (const joint of scene().joints ?? []) {
      const poseA = livePose(joint.bodyA), poseB = livePose(joint.bodyB);
      if (!poseA || !poseB) continue;
      const chosen = selection.includes(joint.id), color: readonly [number, number, number] = chosen ? [1, 0.78, 0.2] : [0.25, 0.9, 1];
      const g = jointWorldGeometry(joint, poseA, poseB);
      cross(g.anchorA, reach * 0.6, color);
      if (length3(sub3(g.anchorA, g.anchorB)) > 1e-4) { cross(g.anchorB, reach * 0.4, color); line(g.anchorA, g.anchorB, color, 0.9); }
      if (g.axis) line(sub3(g.anchorA, scale3(g.axis, reach * 1.8)), add3(g.anchorA, scale3(g.axis, reach * 1.8)), chosen ? [1, 1, 1] : [1, 0.35, 0.85]);
      for (const [id, anchor] of [[joint.bodyA, g.anchorA], [joint.bodyB, g.anchorB]] as const) {
        const pose = livePose(id);
        if (id !== null && pose) line(pose.position, anchor, color, 0.45);
      }
    }
    if (ruler.a) cross(ruler.a, reach * 0.3, [1, 1, 0.3]);
    if (ruler.a && ruler.b) { cross(ruler.b, reach * 0.3, [1, 1, 0.3]); line(ruler.a, ruler.b, [1, 1, 0.3]); }
    lineCount = lines.length;
    host.setLines(lines);
  }

  // --- rendering the panel ------------------------------------------------------------------
  function scheduleRender(): void {
    if (renderTimer !== null) return;
    // After the current event: by then the focus has moved on (Tab out of a field), and it is restored by id.
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 0);
  }

  function render(): void {
    if (!active || !doc) return;
    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement.id : '';
    const running = mode === 'run', playing = host.isPlaying();
    playButton.textContent = playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-pressed', String(playing));
    undoButton.disabled = !doc.canUndo || running; redoButton.disabled = !doc.canRedo || running;
    undoButton.title = doc.undoLabel ? `Undo: ${doc.undoLabel} (Ctrl+Z or Cmd+Z)` : 'Nothing to undo';
    redoButton.title = doc.redoLabel ? `Redo: ${doc.redoLabel} (Shift+Ctrl+Z or Shift+Cmd+Z)` : 'Nothing to redo';
    resetButton.disabled = !running;
    root.dataset.mode = mode;
    renderRecovery(); renderAdd(running); renderOutline(); renderInspector(running); renderWorld(running); renderDetails(running); renderMeasure();
    if (focused) { const node = document.getElementById(focused); if (node instanceof HTMLElement && !(node as HTMLInputElement).disabled) node.focus({ preventScroll: true }); }
    plotDirty = true;
  }

  function renderRecovery(): void {
    alert.hidden = recovery === null;
    if (recovery === null) { alert.replaceChildren(); return; }
    if (alert.childElementCount > 0) return;
    const saved = new Date(recovery.savedAt), title = recovery.scene.meta?.title ? quoteForDisplay(recovery.scene.meta.title, 60) : 'Untitled scene';
    const text = el('p', '', `An autosaved scene was found: “${title}”, ${recovery.scene.bodies.length} ${recovery.scene.bodies.length === 1 ? 'body' : 'bodies'} and ${(recovery.scene.joints ?? []).length} joints, saved ${Number.isNaN(saved.getTime()) ? recovery.savedAt : saved.toLocaleString()}. Autosave is paused until you choose.`);
    const recover = button('recover', 'Recover it', 'Open the autosaved scene here (undoable)', () => {
      const found = recovery;
      recovery = null;
      if (found && replace(found.scene)) say('The autosaved scene was recovered. Undo returns to the scene that was open.');
      scheduleRender();
    });
    const discard = button('discard', 'Discard it', 'Delete the autosaved scene', () => {
      recovery = null;
      try { window.localStorage.removeItem(AUTOSAVE_KEY); } catch { /* nothing to remove */ }
      say('The autosaved scene was discarded.');
      scheduleAutosave(); scheduleRender();
    });
    alert.append(text, actions(recover, discard));
  }

  function renderAdd(running: boolean): void {
    const body = addSection.body, shapes = grid(), joints = grid();
    select(shapes, 'add-shape', 'Shape', BODY_PRESETS.map(preset => [preset.id, preset.label] as const), addPreset, (value) => { addPreset = value as BodyPresetId; });
    const addBodyButton = button('add-body', 'Add body', 'Add this shape at the point the camera looks at', addBody);
    addBodyButton.disabled = running;
    const snapRow = el('div', 'lab-editor-row');
    check(snapRow, 'grid-on', 'Snap to grid', gridOn, (value) => { gridOn = value; scheduleRender(); });
    const size = numberInput(gridSize, (value) => { if (value > 0) gridSize = value; else say('The grid size must be above 0.', true); scheduleRender(); }, { min: 0.001, step: 0.05 });
    size.id = 'lab-editor-grid-size'; size.setAttribute('aria-label', 'Grid size in metres'); size.disabled = !gridOn;
    snapRow.append(size, el('span', 'lab-editor-unit', 'm'));
    check(snapRow, 'surface-snap', 'Rest on the surface below', surfaceSnap, (value) => { surfaceSnap = value; });
    const selected = selectedBodies();
    select(joints, 'add-joint-type', 'Joint', JOINT_TYPES.map(type => [type, type] as const), addJointType, (value) => { addJointType = value as SceneJointType; });
    const addJointButton = button('add-joint', 'Add joint', 'Join the two selected bodies, or the one selected body to the world', addJoint);
    addJointButton.disabled = running || selected.length === 0 || selected.length > 2;
    const hint = el('p', 'lab-editor-hint', selected.length === 2 ? `Between "${selected[0]!.id}" and "${selected[1]!.id}".` : selected.length === 1 ? `Between "${selected[0]!.id}" and the world. Select a second body (Shift+click, Shift+Enter in the outline, or "Select several") to join two bodies.` : 'Select one or two bodies first.');
    hint.id = 'lab-editor-add-joint-hint';
    addJointButton.setAttribute('aria-describedby', hint.id);
    body.replaceChildren(shapes, actions(addBodyButton), snapRow, joints, actions(addJointButton), hint);
  }

  function renderOutline(): void {
    const bodies = scene().bodies, joints = scene().joints ?? [];
    outlineSection.summary.textContent = `Outline · ${bodies.length} ${bodies.length === 1 ? 'body' : 'bodies'}, ${joints.length} ${joints.length === 1 ? 'joint' : 'joints'}`;
    const list = el('div', 'lab-editor-outline');
    list.id = 'lab-editor-outline-list';
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-multiselectable', 'true'); list.setAttribute('aria-label', 'Bodies and joints');
    const items: { id: string; text: string }[] = [
      ...bodies.map(body => ({ id: body.id, text: `${body.id}  ·  ${generatedShapeOf(body)?.preset ?? body.shape.kind}, ${body.type ?? (body.shape.kind === 'mesh' || body.shape.kind === 'heightfield' ? 'static' : 'dynamic')}` })),
      ...joints.map(joint => ({ id: joint.id, text: `${joint.id}  ·  ${joint.type} joint, ${joint.bodyA ?? 'world'} – ${joint.bodyB ?? 'world'}` })),
    ];
    if (items.length === 0) { list.append(el('p', 'lab-editor-hint', 'The scene is empty. Add a body above.')); outlineSection.body.replaceChildren(list); return; }
    const tabStop = items.find(item => selection.includes(item.id))?.id ?? items[0]!.id;
    const nodes: HTMLElement[] = [];
    items.forEach((item, index) => {
      const option = el('div', 'lab-editor-option', item.text);
      option.id = `lab-editor-item-${item.id}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(selection.includes(item.id)));
      option.tabIndex = item.id === tabStop ? 0 : -1;
      option.addEventListener('click', (event) => { toggleSelection(item.id, multiSelect || event.shiftKey || event.ctrlKey || event.metaKey); });
      option.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleSelection(item.id, multiSelect || event.shiftKey || event.ctrlKey || event.metaKey); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault(); event.stopPropagation();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : Math.max(0, Math.min(nodes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
          nodes.forEach((node, k) => { node.tabIndex = k === next ? 0 : -1; });
          nodes[next]!.focus();
        }
      });
      nodes.push(option);
    });
    list.append(...nodes);
    const row = el('div', 'lab-editor-row');
    check(row, 'multi-select', 'Select several (a click adds to the selection)', multiSelect, (value) => { multiSelect = value; });
    outlineSection.body.replaceChildren(list, row);
  }

  function renderInspector(running: boolean): void {
    const body = inspectorSection.body;
    const one = selection.length === 1 ? selection[0]! : null, asBody = one ? bodyOf(one) : null, asJoint = one ? jointOf(one) : null;
    inspectorSection.summary.textContent = one ? `Inspector · ${one}` : selection.length > 1 ? `Inspector · ${selection.length} selected` : 'Inspector';
    if (asBody) { body.replaceChildren(...bodyInspector(asBody, running)); return; }
    if (asJoint) { body.replaceChildren(...jointInspector(asJoint, running)); return; }
    if (selection.length > 1) {
      const bodies = selectedBodies(), nodes: HTMLElement[] = [el('p', 'lab-editor-hint', `Selected: ${selection.join(', ')}.`)];
      if (bodies.length === 2) {
        const a = livePose(bodies[0]!.id)?.position ?? bodies[0]!.position, b = livePose(bodies[1]!.id)?.position ?? bodies[1]!.position;
        nodes.push(el('p', '', `Centre to centre: ${show(length3(sub3(b, a)), 5)} m.`));
      }
      const remove = button('delete', 'Delete selected', 'Delete everything selected (Delete)', deleteSelection);
      remove.disabled = running;
      nodes.push(actions(remove));
      body.replaceChildren(...nodes);
      return;
    }
    body.replaceChildren(el('p', 'lab-editor-hint', 'Select a body or a joint: click it in the view, or choose it in the outline.'));
  }

  function bodyInspector(body: SceneBody, running: boolean): HTMLElement[] {
    const id = body.id, nodes: HTMLElement[] = [], fixedKind = body.shape.kind === 'mesh' || body.shape.kind === 'heightfield';
    if (running) {
      const live = el('dl', 'lab-editor-live');
      live.id = 'lab-editor-live';
      nodes.push(el('p', 'lab-editor-hint', 'Live values (read-only while the simulation has moved on; Reset to edit).'), live);
    }
    const g = grid();
    textInput(g, 'name', 'Name', id, value => run({ type: 'rename', id, newId: value.trim() }), running);
    select(g, 'type', 'Type', [['dynamic', 'dynamic (moves, has mass)'], ['kinematic', 'kinematic (moved by velocity)'], ['static', 'static (fixed)']], body.type ?? (fixedKind ? 'static' : 'dynamic'),
      value => run({ type: 'setBodyType', id, bodyType: value as 'static' | 'kinematic' | 'dynamic' }), running || fixedKind);
    vector(g, 'position', body.shape.kind === 'heightfield' ? 'Corner position (m)' : 'Position (m)', body.position, value => run({ type: 'setTransform', id, position: value }), running);
    vector(g, 'rotation', 'Rotation (degrees, about x, y, z)', quaternionToEuler(body.rotation ?? IDENTITY), value => run({ type: 'setTransform', id, rotationEuler: value }), running);
    nodes.push(g, heading('Shape'), shapeFields(body, running));

    const material = resolvedMaterial(scene(), body), m = grid();
    const names = [...new Set([...MATERIAL_PRESETS.map(preset => preset.name), ...Object.keys(scene().materials ?? {})])];
    select(m, 'material', 'Material', [['', 'custom values'], ...names.map(name => [name, materialPreset(name) ? `${materialPreset(name)!.label} (library)` : name] as const)], body.material ?? '',
      value => run({ type: 'setMaterial', id, material: value === '' ? null : value }), running);
    number(m, 'density', 'Density (kg/m³)', material.density, value => run({ type: 'setMaterial', id, material: null, density: value }), { min: 0, disabled: running });
    number(m, 'friction', 'Friction (–)', material.friction, value => run({ type: 'setMaterial', id, material: null, friction: value }), { min: 0, step: 0.05, disabled: running });
    number(m, 'restitution', 'Restitution (–)', material.restitution, value => run({ type: 'setMaterial', id, material: null, restitution: value }), { min: 0, step: 0.05, disabled: running });
    const color = el('input');
    color.type = 'color'; color.value = `#${(material.color & 0xFFFFFF).toString(16).padStart(6, '0')}`; color.disabled = running;
    color.addEventListener('change', () => run({ type: 'setColor', id, color: Number.parseInt(color.value.slice(1), 16) }));
    field(m, 'color', 'Colour', color);
    const mass = el('output', '', massText(id)); mass.id = 'lab-editor-mass';
    m.append(el('span', '', 'Mass (kg)'), mass);
    nodes.push(heading('Material'), m);
    const preset = body.material ? materialPreset(body.material) : null;
    if (preset) nodes.push(el('p', 'lab-editor-hint', `Values of the material library (${preset.library}; sources in docs/MATERIALS.md), not a measurement of a particular sample.${preset.unverified.length ? ` Not from a source: ${preset.unverified.join(', ')}.` : ''} Changing a number makes the material custom.`));

    const v = grid();
    vector(v, 'linear-velocity', 'Initial velocity (m/s)', body.linearVelocity ?? [0, 0, 0], value => run({ type: 'setVelocity', id, linear: value }), running);
    vector(v, 'angular-velocity', 'Initial angular velocity (rad/s)', body.angularVelocity ?? [0, 0, 0], value => run({ type: 'setVelocity', id, angular: value }), running);
    nodes.push(heading('Initial velocity'), v);

    const flags = el('div', 'lab-editor-row');
    for (const [key, label] of [['bullet', 'Bullet (swept, for fast bodies)'], ['sensor', 'Sensor (detects, does not collide)'], ['hitEvents', 'Hit events'], ['neverSleeps', 'Never sleeps'], ['lockRotation', 'Lock rotation']] as const) {
      check(flags, `flag-${key}`, label, body[key] ?? false, value => run({ type: 'setFlags', id, flags: { [key]: value } }), running);
    }
    const f = grid();
    number(f, 'linear-damping', 'Linear damping (1/s)', body.linearDamping ?? 0, value => run({ type: 'setFlags', id, flags: { linearDamping: value } }), { min: 0, disabled: running });
    number(f, 'angular-damping', 'Angular damping (1/s)', body.angularDamping ?? 0, value => run({ type: 'setFlags', id, flags: { angularDamping: value } }), { min: 0, disabled: running });
    number(f, 'gravity-scale', 'Gravity scale (–)', body.gravityScale ?? 1, value => run({ type: 'setFlags', id, flags: { gravityScale: value } }), { disabled: running });
    nodes.push(heading('Flags'), flags, f);

    const c = grid(), filter = body.filter ?? {};
    const setFilter = (patch: { categoryBits?: string; maskBits?: string; groupIndex?: number }): void => {
      const next = { categoryBits: filter.categoryBits ?? '1', maskBits: filter.maskBits ?? '18446744073709551615', groupIndex: filter.groupIndex ?? 0, ...patch };
      run({ type: 'setFilter', id, filter: next });
    };
    textInput(c, 'category-bits', 'Category bits (decimal)', filter.categoryBits ?? '1', value => setFilter({ categoryBits: value.trim() }), running, 20);
    textInput(c, 'mask-bits', 'Collides with (mask bits, decimal)', filter.maskBits ?? '18446744073709551615', value => setFilter({ maskBits: value.trim() }), running, 20);
    number(c, 'group-index', 'Group (negative: never collide within it)', filter.groupIndex ?? 0, value => setFilter({ groupIndex: value }), { step: 1, disabled: running });
    const clear = button('filter-clear', 'Default filter', 'Collide with everything again', () => run({ type: 'setFilter', id, filter: null }));
    clear.disabled = running || body.filter === undefined;
    nodes.push(heading('Collision filter'), c, actions(clear));

    const duplicate = button('duplicate', 'Duplicate', 'Copy this body beside itself (Ctrl+D or Cmd+D)', duplicateSelection);
    const remove = button('delete', 'Delete', 'Delete this body and its joints (Delete)', deleteSelection);
    const drop = button('drop', 'Rest on surface below', 'Move it straight down or up until it touches what is below it', () => dropToSurface(id));
    const frame = button('frame', 'Look at', 'Point the camera at this body', () => { const p = livePose(id)?.position ?? body.position; host.lookAt(p); });
    duplicate.disabled = remove.disabled = drop.disabled = running;
    nodes.push(actions(duplicate, remove, drop, frame));
    return nodes;
  }

  function massText(id: string): string {
    const world = host.world(), handle = world?.bodies.get(id);
    if (!world || !handle) return '–';
    try { const mass = world.native.bodyState(handle).mass; return mass > 0 ? show(mass, 5) : '0 (static or kinematic)'; } catch { return '–'; }
  }

  function shapeFields(body: SceneBody, running: boolean): HTMLElement {
    const id = body.id, shape = body.shape, g = grid(), generated = generatedShapeOf(body);
    const regenerate = (next: GeneratedShape): void => { run({ type: 'setGenerated', id, generated: next }); };
    if (shape.kind === 'box') {
      vector(g, 'size', 'Size (m)', [2 * shape.halfExtents[0], 2 * shape.halfExtents[1], 2 * shape.halfExtents[2]], value => run({ type: 'setShape', id, shape: { kind: 'box', halfExtents: [value[0] / 2, value[1] / 2, value[2] / 2] } }), running);
    } else if (shape.kind === 'sphere') {
      number(g, 'radius', 'Radius (m)', shape.radius, value => run({ type: 'setShape', id, shape: { kind: 'sphere', radius: value } }), { min: 0, step: 0.05, disabled: running });
    } else if (shape.kind === 'capsule') {
      number(g, 'radius', 'Radius (m)', shape.radius, value => run({ type: 'setShape', id, shape: { ...shape, radius: value } }), { min: 0, step: 0.05, disabled: running });
      number(g, 'length', 'Length between cap centres (m)', 2 * shape.halfLength, value => run({ type: 'setShape', id, shape: { ...shape, halfLength: value / 2 } }), { min: 0, step: 0.05, disabled: running });
    } else if (generated?.preset === 'wedge') {
      vector(g, 'size', 'Wedge size (m)', generated.size, value => regenerate({ preset: 'wedge', size: value }), running);
    } else if (generated?.preset === 'cylinder' || generated?.preset === 'cone') {
      number(g, 'radius', 'Radius (m)', generated.radius, value => regenerate({ ...generated, radius: value }), { min: 0, step: 0.05, disabled: running });
      number(g, 'height', 'Height (m)', generated.height, value => regenerate({ ...generated, height: value }), { min: 0, step: 0.05, disabled: running });
    } else if (generated?.preset === 'ramp') {
      number(g, 'ramp-length', 'Length (m)', generated.length, value => regenerate({ ...generated, length: value }), { min: 0, disabled: running });
      number(g, 'ramp-height', 'Height (m)', generated.height, value => regenerate({ ...generated, height: value }), { min: 0, disabled: running });
      number(g, 'ramp-width', 'Width (m)', generated.width, value => regenerate({ ...generated, width: value }), { min: 0, disabled: running });
    } else if (generated?.preset === 'terrain') {
      select(g, 'terrain-fn', 'Terrain', [['flat', 'flat'], ['slope', 'slope along +x'], ['hills', 'hills (seeded noise)']], generated.fn, value => regenerate({ ...generated, fn: value as TerrainFunction, amplitude: value === 'flat' ? 0 : generated.amplitude || 1 }), running);
      number(g, 'terrain-count-x', 'Samples along x', generated.countX, value => regenerate({ ...generated, countX: Math.round(value) }), { min: 2, max: 257, step: 1, disabled: running });
      number(g, 'terrain-count-z', 'Samples along z', generated.countZ, value => regenerate({ ...generated, countZ: Math.round(value) }), { min: 2, max: 257, step: 1, disabled: running });
      number(g, 'terrain-spacing', 'Spacing (m)', generated.spacing, value => regenerate({ ...generated, spacing: value }), { min: 0, disabled: running });
      number(g, 'terrain-height', 'Height (m)', generated.amplitude, value => regenerate({ ...generated, amplitude: value }), { disabled: running || generated.fn === 'flat' });
      number(g, 'terrain-seed', 'Seed', generated.seed, value => regenerate({ ...generated, seed: Math.round(value) >>> 0 }), { min: 0, step: 1, disabled: running || generated.fn !== 'hills' });
      g.append(el('span', '', 'Extent (m)'), el('output', '', `${show((generated.countX - 1) * generated.spacing, 4)} × ${show((generated.countZ - 1) * generated.spacing, 4)}`));
    } else {
      const bounds = shapeLocalBounds(shape), size = bounds.max.map((value, k) => show(value - bounds.min[k]!, 4)).join(' × ');
      const count = shape.kind === 'compound' ? `${shape.shapes.length} shapes` : shape.kind === 'hull' ? `${shape.points.length / 3} points` : shape.kind === 'mesh' ? `${shape.indices.length / 3} triangles` : `${(shape as { countX: number }).countX} × ${(shape as { countZ: number }).countZ} samples`;
      g.append(el('span', '', shape.kind === 'compound' ? 'Compound' : `Imported ${shape.kind}`), el('output', '', `${count}, ${size} m. Its geometry is not editable here.`));
    }
    return g;
  }

  function jointInspector(joint: SceneJoint, running: boolean): HTMLElement[] {
    const id = joint.id, traits = jointTraits(joint.type), nodes: HTMLElement[] = [], g = grid();
    const patch = (value: JointPatch): boolean => run({ type: 'setJoint', id, patch: value });
    const bodies: (readonly [string, string])[] = [['', 'world (fixed)'], ...scene().bodies.map(body => [body.id, body.id] as const)];
    let geometry: ReturnType<typeof jointGeometryInScene> | null = null;
    try { geometry = jointGeometryInScene(scene(), joint); } catch { geometry = null; }
    textInput(g, 'name', 'Name', id, value => run({ type: 'rename', id, newId: value.trim() }), running);
    select(g, 'joint-type', 'Type', JOINT_TYPES.map(type => [type, type] as const), joint.type, value => patch({ jointType: value as SceneJointType }), running);
    select(g, 'joint-a', 'Body A', bodies, joint.bodyA ?? '', value => patch({ bodyA: value === '' ? null : value }), running);
    select(g, 'joint-b', 'Body B', bodies, joint.bodyB ?? '', value => patch({ bodyB: value === '' ? null : value }), running);
    if (geometry) {
      vector(g, 'anchor', joint.type === 'distance' ? 'Anchor on A (world, m)' : 'Anchor (world, m)', geometry.anchorA.map(value => Number(value.toPrecision(6))) as unknown as Vec3, value => patch({ anchor: value }), running);
      if (joint.type === 'distance') vector(g, 'anchor-b', 'Anchor on B (world, m)', geometry.anchorB.map(value => Number(value.toPrecision(6))) as unknown as Vec3, value => patch({ anchorB: value }), running);
      if (geometry.axis) vector(g, 'axis', `${traits.axisLabel} (world direction)`, geometry.axis.map(value => Number(value.toPrecision(5))) as unknown as Vec3, value => patch({ axis: value }), running);
    }
    nodes.push(g);
    const picks: HTMLElement[] = [];
    const pickAnchor = button('pick-anchor', pick?.kind === 'anchor' ? 'Click a point in the view…' : 'Pick anchor in view', 'Then click a point on a body or the ground: the anchor moves there', () => { pick = pick?.kind === 'anchor' ? null : { kind: 'anchor', joint: id }; say(pick ? 'Click a point on a body or the ground to set the anchor. Escape cancels.' : 'Picking cancelled.'); scheduleRender(); });
    pickAnchor.disabled = running; pickAnchor.setAttribute('aria-pressed', String(pick?.kind === 'anchor'));
    picks.push(pickAnchor);
    if (joint.type === 'distance') {
      const pickB = button('pick-anchor-b', pick?.kind === 'anchorB' ? 'Click a point in the view…' : 'Pick anchor on B in view', 'Then click a point on a body or the ground: the anchor on body B moves there', () => { pick = pick?.kind === 'anchorB' ? null : { kind: 'anchorB', joint: id }; say(pick ? 'Click a point on a body or the ground to set the anchor on B. Escape cancels.' : 'Picking cancelled.'); scheduleRender(); });
      pickB.disabled = running; pickB.setAttribute('aria-pressed', String(pick?.kind === 'anchorB'));
      picks.push(pickB);
    }
    if (traits.axis !== null) {
      for (const [name, axis] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]] as const) {
        const set = button(`axis-${name}`, `Axis ${name}`, `Set the axis to the world ${name} axis`, () => patch({ axis }));
        set.disabled = running;
        picks.push(set);
      }
    }
    nodes.push(actions(...picks));

    const angle = traits.limits === 'angle', toUi = (value: number, isAngle: boolean): number => isAngle ? Number((value * DEG).toPrecision(6)) : value, fromUi = (value: number, isAngle: boolean): number => isAngle ? value / DEG : value;
    const optional = (key: string, label: string, enabled: boolean, enable: () => void, disable: () => void, build: (parent: HTMLElement) => void): void => {
      const box = el('div', 'lab-editor-optional');
      check(box, `${key}-on`, label, enabled, (value) => { if (value) enable(); else disable(); }, running);
      if (enabled) { const inner = grid(); build(inner); box.append(inner); }
      nodes.push(box);
    };
    if (traits.length) {
      const l = grid();
      number(l, 'length', 'Rest length (m)', joint.length ?? 1, value => patch({ length: value }), { min: 0, disabled: running });
      nodes.push(l);
    }
    if (traits.limits !== null) {
      const unit = angle ? 'degrees' : 'm', limits = joint.limits ?? (angle ? { lower: -Math.PI / 4, upper: Math.PI / 4 } : traits.length ? { lower: Math.max(0.01, (joint.length ?? 1) * 0.5), upper: (joint.length ?? 1) * 1.5 } : { lower: -0.5, upper: 0.5 });
      optional('limits', joint.type === 'spherical' ? 'Twist limits' : joint.type === 'distance' ? 'Length limits' : 'Limits', joint.limits !== undefined, () => patch({ limits }), () => patch({ limits: null }), (parent) => {
        number(parent, 'limit-lower', `Lower (${unit})`, toUi(limits.lower, angle), value => patch({ limits: { lower: fromUi(value, angle), upper: limits.upper } }), { disabled: running });
        number(parent, 'limit-upper', `Upper (${unit})`, toUi(limits.upper, angle), value => patch({ limits: { lower: limits.lower, upper: fromUi(value, angle) } }), { disabled: running });
      });
    }
    if (traits.coneAngle) {
      optional('cone', 'Cone limit', joint.coneAngle !== undefined, () => patch({ coneAngle: Math.PI / 6 }), () => patch({ coneAngle: null }), (parent) => {
        number(parent, 'cone-angle', 'Cone half-angle (degrees)', toUi(joint.coneAngle ?? 0, true), value => patch({ coneAngle: value / DEG }), { min: 0, max: 180, disabled: running });
      });
    }
    if (traits.motor !== null) {
      const angular = traits.motor === 'angular', motor = joint.motor ?? { speed: angular ? Math.PI : 1, maxForce: 100 };
      optional('motor', 'Motor', joint.motor !== undefined, () => patch({ motor }), () => patch({ motor: null }), (parent) => {
        number(parent, 'motor-speed', angular ? 'Speed (degrees/s)' : 'Speed (m/s)', toUi(motor.speed, angular), value => patch({ motor: { speed: fromUi(value, angular), maxForce: motor.maxForce } }), { disabled: running });
        number(parent, 'motor-force', angular ? 'Maximum torque (N m)' : 'Maximum force (N)', motor.maxForce, value => patch({ motor: { speed: motor.speed, maxForce: value } }), { min: 0, disabled: running });
      });
    }
    if (traits.spring !== null) {
      const spring = joint.spring ?? { hertz: 2, dampingRatio: 0.7 }, targetAngle = traits.spring === 'angle';
      optional('spring', joint.type === 'wheel' ? 'Suspension spring' : 'Spring', joint.spring !== undefined, () => patch({ spring }), () => patch({ spring: null }), (parent) => {
        number(parent, 'spring-hertz', 'Frequency (Hz)', spring.hertz, value => patch({ spring: { ...spring, hertz: value } }), { min: 0, disabled: running });
        number(parent, 'spring-damping', 'Damping ratio (–)', spring.dampingRatio, value => patch({ spring: { ...spring, dampingRatio: value } }), { min: 0, step: 0.1, disabled: running });
        if (traits.spring !== 'none-target') number(parent, 'spring-target', targetAngle ? 'Target (degrees)' : 'Target (m)', toUi(spring.target ?? 0, targetAngle), value => patch({ spring: { ...spring, target: fromUi(value, targetAngle) } }), { disabled: running });
      });
    }
    const stiffness = joint.stiffness ?? { hertz: 60, dampingRatio: 2 };
    optional('stiffness', 'Custom stiffness (default 60 Hz, damping ratio 2)', joint.stiffness !== undefined, () => patch({ stiffness }), () => patch({ stiffness: null }), (parent) => {
      number(parent, 'stiffness-hertz', 'Stiffness (Hz)', stiffness.hertz, value => patch({ stiffness: { ...stiffness, hertz: value } }), { min: 0, disabled: running });
      number(parent, 'stiffness-damping', 'Damping ratio (–)', stiffness.dampingRatio ?? 2, value => patch({ stiffness: { ...stiffness, dampingRatio: value } }), { min: 0, step: 0.1, disabled: running });
    });
    const row = el('div', 'lab-editor-row');
    check(row, 'collide-connected', 'The two bodies collide with each other', joint.collideConnected ?? false, value => patch({ collideConnected: value }), running);
    const remove = button('delete', 'Delete joint', 'Delete this joint (Delete)', deleteSelection);
    remove.disabled = running;
    nodes.push(row, actions(remove), el('p', 'lab-editor-hint', 'The anchor and axis are set for the bodies as they stand: the scene as drawn is the joint\'s zero position. Angles are in degrees here and radians in the file.'));
    return nodes;
  }

  function renderWorld(running: boolean): void {
    const world = scene().world ?? {}, gravity = world.gravity ?? [0, -9.81, 0], step = world.step ?? 1 / 60, g = grid();
    const preset = gravityPresetOf(gravity);
    select(g, 'gravity-preset', 'Gravity', [...GRAVITY_PRESETS.map(entry => [entry.id, entry.label] as const), ['custom', 'custom']], preset, (value) => {
      const chosen = GRAVITY_PRESETS.find(entry => entry.id === value);
      if (chosen) run({ type: 'setWorld', world: { gravity: chosen.gravity } }); else scheduleRender();
    }, running);
    vector(g, 'gravity', 'Gravity vector (m/s²)', gravity, value => run({ type: 'setWorld', world: { gravity: value } }), running);
    number(g, 'step-rate', 'Step rate (Hz; the step is 1 / rate)', Number((1 / step).toPrecision(9)), value => run({ type: 'setWorld', world: { step: 1 / value } }), { min: 30, step: 30, disabled: running });
    number(g, 'sub-steps', 'Sub-steps per step (1 to 16)', world.subSteps ?? 4, value => run({ type: 'setWorld', world: { subSteps: value } }), { min: 1, max: 16, step: 1, disabled: running });
    number(g, 'seed', 'Seed', world.seed ?? 1, value => run({ type: 'setWorld', world: { seed: value } }), { min: 0, step: 1, disabled: running });
    const row = el('div', 'lab-editor-row');
    check(row, 'ground', 'Ground slab (static, 88 m × 88 m, top at y = 0)', world.ground ?? true, value => run({ type: 'setWorld', world: { ground: value } }), running);
    const notes: string[] = [...stepWarnings(scene())], perTick = LAB_TICK_SECONDS / step;
    if (Math.abs(perTick - Math.round(perTick)) > 1e-6) notes.push(`The Lab draws 60 frames of simulation a second and takes ${sceneStepsPerLabTick(step)} of these steps per frame, so this scene plays at ${show(sceneStepsPerLabTick(step) * step / LAB_TICK_SECONDS, 3)} times real speed. Rates that are multiples of 60 Hz play at real speed.`);
    const list = el('ul', 'lab-editor-warnings');
    list.id = 'lab-editor-warnings';
    list.append(...notes.map(note => el('li', '', note)));
    worldSection.summary.textContent = notes.length > 0 ? `World · ${notes.length} ${notes.length === 1 ? 'warning' : 'warnings'}` : 'World';
    worldSection.body.replaceChildren(g, row, notes.length > 0 ? list : el('p', 'lab-editor-hint', `Step ${show(step * 1000, 4)} ms, ${world.subSteps ?? 4} sub-steps. No step warnings.`));
  }

  function renderDetails(running: boolean): void {
    const meta = scene().meta ?? {}, g = grid();
    textInput(g, 'title', 'Title', meta.title ?? '', value => run({ type: 'setMeta', title: value.trim() }), running, 200);
    textInput(g, 'author', 'Author', meta.author ?? '', value => run({ type: 'setMeta', author: value.trim() }), running, 200);
    const description = el('textarea');
    description.rows = 3; description.value = meta.description ?? ''; description.maxLength = 4096; description.disabled = running;
    description.addEventListener('change', () => run({ type: 'setMeta', description: description.value.trim() }));
    field(g, 'description', 'Description', description);
    detailsSection.body.replaceChildren(g, el('p', 'lab-editor-hint', 'Copy share link and Download scene, above, save this document: the initial state, not the moment the simulation has reached. The document is also autosaved in this browser.'));
  }

  function renderMeasure(): void {
    const bodies = scene().bodies, g = grid();
    select(g, 'track', 'Body to record', [['', 'the selected body'], ...bodies.map(body => [body.id, body.id] as const)], bodyOf(trackChoice) ? trackChoice : '', (value) => { trackChoice = value; series.clear(); seriesBody = null; plotDirty = true; scheduleRender(); });
    select(g, 'plot-quantity', 'Plot', PLOTS.map(entry => [entry.id, `${entry.label} (${entry.unit})`] as const), plotId, (value) => { plotId = value; plotDirty = true; scheduleRender(); });
    const exportCsv = button('csv', 'Export CSV', 'Save every recorded column of the tracked body as a .csv file', downloadCsv);
    const clear = button('clear-series', 'Clear', 'Forget the recorded samples', () => { series.clear(); plotDirty = true; say('The recording was cleared.'); });
    const rulerPick = button('ruler-pick', pick?.kind === 'ruler' ? 'Click two points…' : 'Ruler: pick two points', 'Then click two points in the view to measure the distance between them', () => {
      pick = pick?.kind === 'ruler' ? null : { kind: 'ruler' };
      if (pick) ruler = { a: null, b: null };
      linesKey = ''; say(pick ? 'Click the first point in the view. Escape cancels.' : 'Ruler cancelled.'); scheduleRender();
    });
    rulerPick.setAttribute('aria-pressed', String(pick?.kind === 'ruler'));
    const rulerBodies = button('ruler-bodies', 'Ruler: between selected bodies', 'Measure between the centres of the two selected bodies', () => {
      const two = selectedBodies();
      if (two.length !== 2) { say('Select exactly two bodies to measure between their centres.', true); return; }
      ruler = { a: livePose(two[0]!.id)?.position ?? two[0]!.position, b: livePose(two[1]!.id)?.position ?? two[1]!.position };
      pick = null; linesKey = ''; say(rulerText()); scheduleRender();
    });
    const rulerClear = button('ruler-clear', 'Clear ruler', 'Remove the ruler', () => { ruler = { a: null, b: null }; pick = null; linesKey = ''; scheduleRender(); });
    rulerOut.textContent = rulerText();
    const group = PLOTS.find(candidate => candidate.id === plotId) ?? PLOTS[0]!;
    plotLegend.replaceChildren(...group.traces.map((trace) => { const item = el('span', '', trace.label); item.style.color = trace.color; return item; }));
    const tracked = trackedId();
    measureControls.replaceChildren(g, actions(exportCsv, clear), el('p', 'lab-editor-hint',
      `${tracked ? `Recording "${tracked}"` : 'No body to record'}: one sample per tick of 1/60 s while the simulation runs, up to ${series.capacity} (a minute). Energy is ½mv² + ½ω·Iω − m g·r; the rotation term is left out for hulls and meshes, whose inertia the engine does not report.`),
      actions(rulerPick, rulerBodies, rulerClear), rulerOut);
  }

  /** While the simulation has moved on: the selected body's state, a few times a second. */
  function renderLive(): void {
    const live = document.getElementById('lab-editor-live'), id = selection.length === 1 ? selection[0]! : null, world = host.world();
    if (!live || id === null || !world) return;
    const handle = world.bodies.get(id);
    if (!handle) return;
    let state;
    try { state = world.native.bodyState(handle); } catch { return; }
    const euler = quaternionToEuler(state.rotation), rows: [string, string][] = [
      ['Position (m)', state.position.map(value => value.toFixed(3)).join(', ')],
      ['Rotation (degrees)', euler.map(value => value.toFixed(1)).join(', ')],
      ['Velocity (m/s)', `${state.linearVelocity.map(value => value.toFixed(3)).join(', ')}  ·  speed ${length3(state.linearVelocity).toFixed(3)}`],
      ['Angular velocity (rad/s)', state.angularVelocity.map(value => value.toFixed(3)).join(', ')],
      ['Mass (kg)', state.mass > 0 ? show(state.mass, 5) : '0 (static or kinematic)'],
      ['State', `${state.type}, ${state.awake ? 'awake' : 'asleep'}`],
    ];
    if (live.childElementCount !== rows.length * 2) live.replaceChildren(...rows.flatMap(([label]) => [el('dt', '', label), el('dd')]));
    rows.forEach(([, value], k) => { live.children[k * 2 + 1]!.textContent = value; });
  }

  // --- pointer ------------------------------------------------------------------------------
  function pointerDown(event: PointerEvent): boolean {
    if (!active || !doc || event.button !== 0) return false;
    const ray = rayAt(event), hit = cast(ray.origin, ray.direction);
    if (pick !== null) {
      if (!hit) { say('Nothing was hit there. Click a point on a body or the ground.', true); return true; }
      const point: Vec3 = [Number(hit.point[0].toPrecision(6)), Number(hit.point[1].toPrecision(6)), Number(hit.point[2].toPrecision(6))];
      if (pick.kind === 'ruler') {
        if (ruler.a === null || ruler.b !== null) ruler = { a: point, b: null }; else { ruler = { a: ruler.a, b: point }; pick = null; }
        linesKey = ''; say(rulerText()); scheduleRender();
      } else {
        const target = pick; pick = null;
        run({ type: 'setJoint', id: target.joint, patch: target.kind === 'anchor' ? { anchor: point } : { anchorB: point } });
      }
      return true;
    }
    if (!hit || hit.id === null) { emptyClick = { pointer: event.pointerId, x: event.clientX, y: event.clientY }; return false; }
    const additive = multiSelect || event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) { toggleSelection(hit.id, true); return true; }
    if (!selection.includes(hit.id) || selection.length !== 1) setSelection([hit.id]);
    const body = bodyOf(hit.id);
    if (mode === 'edit' && body) {
      drag = {
        pointer: event.pointerId, id: hit.id, startX: event.clientX, startY: event.clientY, moved: false, planeY: hit.point[1], offset: sub3(body.position, hit.point),
        start: body.position, rotation: body.rotation ?? IDENTITY, position: [body.position[0], body.position[1], body.position[2]], vertical: false,
      };
      try { host.canvas.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    }
    return true;
  }

  function pointerMove(event: PointerEvent): boolean {
    if (!drag || event.pointerId !== drag.pointer) return false;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return true;
    drag.moved = true;
    const next: [number, number, number] = [drag.position[0], drag.position[1], drag.position[2]];
    if (event.shiftKey) {
      // Vertical: metres per pixel at the body's distance from the eye.
      const camera = host.camera(), bounds = host.canvas.getBoundingClientRect();
      const depth = Math.max(0.1, cameraProject(camera, host.canvas.width / Math.max(1, host.canvas.height), drag.start).depth);
      const perPixel = 2 * Math.tan(58 * Math.PI / 360) * depth / Math.max(1, bounds.height);
      next[1] = drag.start[1] + (drag.startY - event.clientY) * perPixel;
      if (gridOn) next[1] = snapValue(next[1], gridSize);
      drag.vertical = true;
    } else {
      const ray = rayAt(event), point = rayPlaneY(ray.origin, ray.direction, drag.planeY);
      if (!point) return true;
      next[0] = point[0] + drag.offset[0]; next[2] = point[2] + drag.offset[2];
      if (gridOn) { next[0] = snapValue(next[0], gridSize); next[2] = snapValue(next[2], gridSize); }
    }
    if (!next.every(Number.isFinite) || next.some(value => Math.abs(value) > 1e5)) return true;
    drag.position = next;
    // Preview: move the body in the paused world. The command is applied when the pointer is released.
    const world = host.world(), handle = world?.bodies.get(drag.id);
    if (world && handle) { try { world.native.setBodyTransform(handle, next, drag.rotation); host.transformsEdited(); } catch { /* the preview is optional */ } }
    return true;
  }

  function pointerUp(event: PointerEvent): boolean {
    if (emptyClick && event.pointerId === emptyClick.pointer) {
      const still = Math.hypot(event.clientX - emptyClick.x, event.clientY - emptyClick.y) < 4;
      emptyClick = null;
      if (still && active && selection.length > 0 && event.type === 'pointerup') setSelection([]);
      return false;
    }
    if (!drag || event.pointerId !== drag.pointer) return false;
    const done = drag;
    drag = null;
    try { host.canvas.releasePointerCapture(event.pointerId); } catch { /* ignored */ }
    if (!done.moved) return true;
    if (event.type !== 'pointerup') { rebuild(); scheduleRender(); return true; }   // cancelled: put the body back
    const body = bodyOf(done.id), position = done.position;
    if (body && surfaceSnap && !done.vertical) {
      const y = restOn(body.shape, done.rotation, position[0], position[2], Math.max(500, position[1] + 1), done.id);
      if (y !== null) position[1] = y;
    }
    if (!run({ type: 'setTransform', id: done.id, position })) rebuild();
    return true;
  }

  // --- keyboard -----------------------------------------------------------------------------
  function keyDown(event: KeyboardEvent): boolean {
    if (!active || !doc || event.defaultPrevented || event.isComposing) return false;
    const target = event.target instanceof Element ? event.target : null;
    const typing = target !== null && target.closest('input:not([type="checkbox"]):not([type="color"]), textarea, select, [contenteditable="true"]') !== null;
    const command = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (event.key === 'Escape') {
      if (typing && target instanceof HTMLElement) { target.blur(); host.canvas.focus({ preventScroll: true }); return true; }
      if (pick !== null) { pick = null; linesKey = ''; say('Picking cancelled.'); scheduleRender(); return true; }
      if (selection.length > 0) setSelection([]);
      return true;
    }
    // In a text or number field the keys belong to the field (its own undo, arrows, Delete).
    if (typing) return false;
    if (command && !event.altKey && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return true; }
    if (command && !event.altKey && !event.shiftKey && key === 'y') { event.preventDefault(); redo(); return true; }
    if (command && !event.altKey && !event.shiftKey && key === 'd') { event.preventDefault(); duplicateSelection(); return true; }
    if (command || event.altKey) return false;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return true; }
    const inList = target !== null && target.closest('[role="option"], summary') !== null;
    const moves: { readonly [key: string]: readonly [number, number, number] } = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 0, -1], ArrowDown: [0, 0, 1], PageUp: [0, 1, 0], PageDown: [0, -1, 0] };
    const move = moves[event.key];
    if (move && !inList) { event.preventDefault(); nudge(move[0], move[1], move[2], event.shiftKey); return true; }
    return false;
  }
  function keyUp(event: KeyboardEvent): void {
    if (active && (event.key.startsWith('Arrow') || event.key.startsWith('Page'))) doc?.breakMerge();
  }

  // --- open and close -----------------------------------------------------------------------
  function open(input: unknown = emptyScene()): boolean {
    let next: SceneDocument;
    try {
      next = new SceneDocument(input, { accept: candidate => host.checkScene(candidate) });
    } catch (error) {
      say(`This scene cannot be edited: ${error instanceof Error ? error.message : String(error)}`, true);
      return false;
    }
    doc = next;
    active = true; selection = []; mode = 'edit'; pick = null; ruler = { a: null, b: null }; trackChoice = '';
    root.hidden = false;
    host.activeChanged(true);
    host.setPlaying(false);
    recovery = null;
    try {
      const found = decodeAutosave(window.localStorage.getItem(AUTOSAVE_KEY));
      if (found && found.scene.bodies.length > 0 && sceneHash(found.scene) !== sceneHash(doc.scene)) recovery = found;
    } catch { /* no storage: nothing to recover */ }
    alert.replaceChildren();
    // The Scenes panel shows why when the scene cannot be put on screen (no native engine, for example).
    if (!rebuild(true)) { close(); return false; }
    say(`Editing “${quoteForDisplay(doc.scene.meta?.title ?? 'Untitled scene', 80)}”. Changes apply to the initial state.`);
    render();
    // The panel is at the end of the page's tab order: start the keyboard there.
    playButton.focus({ preventScroll: true });
    return true;
  }
  function replace(input: unknown): boolean {
    if (!doc || !active) return open(input);
    host.setPlaying(false);
    if (mode === 'run') rebuild();
    const result = doc.apply({ type: 'replaceScene', scene: input });
    if (!result.ok) { say(`Not opened. ${result.message}`, true); scheduleRender(); return false; }
    selection = [];
    say('Opened in the editor. Undo returns to the scene before.');
    rebuild(true); scheduleAutosave(); scheduleRender();
    return true;
  }
  function close(): void {
    if (!active) return;
    untint();
    active = false; drag = null; pick = null; emptyClick = null;
    root.hidden = true;
    linesKey = 'off'; host.setLines([]);
    if (autosaveTimer !== null) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    host.activeChanged(false);
  }

  return {
    get active() { return active; },
    open, replace, close,
    detached() { tinted = new Map(); tintWorld = null; close(); },
    scene: () => (active && doc ? doc.scene : null),
    reset,
    pointerDown, pointerMove, pointerUp, keyDown, keyUp,
    afterStep() { if (active && mode === 'run') sample(); },
    frame(now) {
      if (!active || !doc) return;
      // Something other than the editor's own buttons advanced the world (the Lab's run controls, the console).
      if (mode === 'edit' && host.ticks() > 0) { beginRun(); scheduleRender(); }
      if (mode === 'edit') syncTint();
      buildLines();
      if (now - lastLive < 200) return;
      lastLive = now;
      clock.textContent = `t = ${time().toFixed(2)} s`;
      if (mode === 'run') renderLive();
      if (plotDirty && measureSection.details.open) { plotDirty = false; drawPlot(); }
      const playing = host.isPlaying();
      if ((playButton.textContent === 'Pause') !== playing) scheduleRender();
    },
    state() {
      const m = ruler.a && ruler.b ? rulerMeasure(ruler.a, ruler.b) : null;
      return {
        active, mode, playing: active && host.isPlaying(), selection: [...selection],
        bodies: doc ? doc.scene.bodies.map(body => body.id) : [], joints: doc ? (doc.scene.joints ?? []).map(joint => joint.id) : [],
        canUndo: doc?.canUndo ?? false, canRedo: doc?.canRedo ?? false, undoDepth: doc?.undoDepth ?? 0,
        sceneHash: active && doc ? sceneHash(doc.scene) : null, message, error: messageIsError, messages: messageCount, time: active && doc ? time() : 0, samples: series.length, tracked: seriesBody,
        ruler: m && ruler.a && ruler.b ? { a: ruler.a, b: ruler.b, distance: m.distance } : null, recovery: recovery !== null,
        warnings: doc ? stepWarnings(doc.scene) : [], overlayLines: active ? lineCount : 0,
      };
    },
    screenPosition(id) {
      const pose = livePose(id);
      if (!pose || !active) return null;
      const bounds = host.canvas.getBoundingClientRect(), seen = cameraProject(host.camera(), host.canvas.width / Math.max(1, host.canvas.height), pose.position);
      return { x: bounds.left + seen.u * bounds.width, y: bounds.top + seen.v * bounds.height, visible: seen.depth > 0 && seen.u >= 0 && seen.u <= 1 && seen.v >= 0 && seen.v <= 1 };
    },
    csv: () => series.toCsv(),
  };
}

/** Whether the address asks for the editor: `?edit=1`. */
export function editRequested(search: string): boolean {
  try { return new URLSearchParams(search).get('edit') === '1'; } catch { return false; }
}
