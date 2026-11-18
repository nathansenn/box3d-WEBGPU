/**
 * The panel of the SI cable-stayed bridge scene: live readouts in SI units, the controls, and a
 * small time history of the midspan deflection and one stay's tension on a 2D canvas.
 *
 * Every value is written with textContent; nothing here builds markup from data.
 */
import './si-bridge-panel.css';
import { SI_BRIDGE_EXAGGERATIONS, type SiBridgeScene, type SiBridgeSceneSettings } from './si-bridge-scene.ts';

export interface SiBridgePanelCallbacks {
  /** Mass, speed or wind changed: the scene is rebuilt with these settings and starts again. */
  onRestart(settings: SiBridgeSceneSettings): void;
  onPause(): void;
  isPaused(): boolean;
}
export interface SiBridgePanel {
  /** Show the panel for this scene (after a build or rebuild), or hide it with null. */
  attach(scene: SiBridgeScene | null): void;
  /** Call once per Lab tick that advanced the simulation: records one sample of the history. */
  sample(): void;
  /** Call once per rendered frame: refreshes the readouts a few times a second and redraws the plot when it changed. */
  refresh(now: number): void;
}

/** Seconds of history the plot keeps, at one sample per 1/60 s tick. */
const HISTORY_SECONDS = 30, HISTORY = HISTORY_SECONDS * 60;
/** The stay whose tension is plotted and read out: the longest main-span stay of the left tower. */
export const SI_BRIDGE_PLOTTED_STAY = 7;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const fixed = (value: number, digits: number): string => Number.isFinite(value) ? value.toFixed(digits) : '–';

export function createSiBridgePanel(callbacks: SiBridgePanelCallbacks): SiBridgePanel {
  const panel = element('section', 'lab-bridge-panel');
  panel.id = 'lab-bridge-panel';
  panel.setAttribute('aria-label', 'Cable-stayed bridge: readouts and controls');
  panel.hidden = true;
  const toggle = element('button', 'lab-bridge-toggle', 'Hide');
  toggle.type = 'button'; toggle.id = 'lab-bridge-toggle'; toggle.setAttribute('aria-expanded', 'true');
  toggle.addEventListener('click', () => {
    const collapsed = panel.dataset.collapsed !== 'true';
    panel.dataset.collapsed = String(collapsed); toggle.textContent = collapsed ? 'Show' : 'Hide'; toggle.setAttribute('aria-expanded', String(!collapsed));
  });
  panel.append(toggle, element('p', 'lab-bridge-heading', 'SI scene · validated frame and cable solvers'), element('h2', 'lab-bridge-title', 'Cable-stayed bridge'));

  const readouts = element('dl', 'lab-bridge-readouts');
  const readout = (id: string, label: string): HTMLElement => {
    const value = element('dd', '', '–'); value.id = `lab-bridge-${id}`;
    readouts.append(element('dt', '', label), value);
    return value;
  };
  const out = {
    time: readout('time', 'Time'),
    midspan: readout('midspan', 'Midspan deflection'),
    maxTension: readout('max-tension', 'Max stay tension'),
    stayTension: readout('stay-tension', `Stay ${SI_BRIDGE_PLOTTED_STAY + 1} tension`),
    towerMoment: readout('tower-moment', 'Tower base moment (x = 30 m)'),
    deck: readout('deck', 'Deck stress / yield'),
    vehicle: readout('vehicle', 'Vehicle position'),
    energy: readout('energy', 'Total energy'),
    reaction: readout('reaction', 'Reactions / weight'),
    cost: readout('cost', 'Step cost'),
  };
  panel.append(readouts);

  const plot = element('canvas', 'lab-bridge-plot');
  plot.id = 'lab-bridge-plot';
  plot.width = 696; plot.height = 264;
  plot.setAttribute('role', 'img');
  plot.setAttribute('aria-label', `Midspan deflection in millimetres and stay ${SI_BRIDGE_PLOTTED_STAY + 1} tension in kilonewtons over the last ${HISTORY_SECONDS} seconds`);
  const legend = element('p', 'lab-bridge-legend');
  const legendDeflection = element('span', 'deflection', 'midspan deflection (mm)'), legendTension = element('span', 'tension', `stay ${SI_BRIDGE_PLOTTED_STAY + 1} tension (kN)`);
  legend.append(legendDeflection, legendTension);
  panel.append(plot, legend);

  const controls = element('div', 'lab-bridge-controls');
  const slider = (id: string, label: string, min: number, max: number, step: number, format: (value: number) => string): { input: HTMLInputElement; show: () => void } => {
    const input = element('input', ''), text = element('label', '', label), value = element('output', '');
    input.type = 'range'; input.id = `lab-bridge-${id}`; input.min = String(min); input.max = String(max); input.step = String(step);
    text.htmlFor = input.id; value.htmlFor.add(input.id);
    const show = (): void => { value.textContent = format(Number(input.value)); };
    input.addEventListener('input', show);
    controls.append(text, input, value);
    return { input, show };
  };
  const mass = slider('mass', 'Vehicle mass', 0, 60, 1, value => value === 0 ? 'none' : `${value} t`);
  const speed = slider('speed', 'Vehicle speed', 0, 40, 1, value => `${value} m/s`);
  const wind = slider('wind', 'Wind on deck', 0, 5, 0.5, value => `${value.toFixed(1)} kN/m`);
  panel.append(controls);

  const actions = element('div', 'lab-bridge-actions');
  const staySelect = element('select', ''); staySelect.id = 'lab-bridge-stay'; staySelect.setAttribute('aria-label', 'Stay to fail');
  const failButton = element('button', '', 'Fail stay'); failButton.type = 'button'; failButton.id = 'lab-bridge-fail';
  const exaggeration = element('select', ''); exaggeration.id = 'lab-bridge-exaggeration';
  const exaggerationLabel = element('label', '', 'Deflection drawn'); exaggerationLabel.htmlFor = exaggeration.id;
  for (const factor of SI_BRIDGE_EXAGGERATIONS) { const option = element('option', '', factor === 1 ? '×1 (true scale)' : `×${factor} (exaggerated)`); option.value = String(factor); exaggeration.append(option); }
  const pauseButton = element('button', '', 'Pause'); pauseButton.type = 'button'; pauseButton.id = 'lab-bridge-pause';
  const resetButton = element('button', '', 'Reset'); resetButton.type = 'button'; resetButton.id = 'lab-bridge-reset';
  actions.append(staySelect, failButton, exaggerationLabel, exaggeration, pauseButton, resetButton);
  const status = element('p', 'lab-bridge-status'); status.id = 'lab-bridge-status'; status.setAttribute('role', 'status');
  panel.append(actions, status,
    element('p', 'lab-bridge-note', 'Model: linear beam elements for deck and towers, axial tension-only stays, the vehicle a rigid body pinned to the two deck nodes it stands between. Mass, speed and wind restart the run.'),
    element('p', 'lab-bridge-note', 'Not modelled: contact between wheels and deck, buckling, yielding, cable sag, aerodynamics beyond a static wind load. The ratios are linear-elastic indicators, not a design check.'));
  document.body.append(panel);

  let scene: SiBridgeScene | null = null;
  const deflection = new Float32Array(HISTORY), tension = new Float32Array(HISTORY);
  let head = 0, count = 0, plotDirty = true, lastReadout = -Infinity, cost = NaN;

  const settings = (): SiBridgeSceneSettings => ({ vehicleMass: Number(mass.input.value) * 1000, vehicleSpeed: Number(speed.input.value), windLoad: Number(wind.input.value) * 1000 });
  for (const control of [mass, speed, wind]) control.input.addEventListener('change', () => { if (scene) callbacks.onRestart(settings()); });
  resetButton.addEventListener('click', () => { if (scene) callbacks.onRestart(settings()); });
  pauseButton.addEventListener('click', () => { callbacks.onPause(); pauseButton.textContent = callbacks.isPaused() ? 'Resume' : 'Pause'; });
  failButton.addEventListener('click', () => {
    if (!scene) return;
    const index = Number(staySelect.value);
    status.textContent = scene.failStay(index)
      ? `Stay ${index + 1} let go of the deck at ${scene.model.out.time.toFixed(2)} s; it hangs from the tower.`
      : `Stay ${index + 1} has already failed.`;
  });
  exaggeration.addEventListener('change', () => { if (scene) scene.exaggeration = Number(exaggeration.value); });

  function drawPlot(): void {
    const context = plot.getContext('2d');
    if (!context) return;
    const width = plot.width, height = plot.height, left = 8, right = width - 8, top = 26, bottom = height - 22;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0e1113'; context.fillRect(0, 0, width, height);
    context.strokeStyle = '#2b3236'; context.lineWidth = 1;
    context.beginPath();
    for (let i = 0; i <= 3; i++) { const x = left + (right - left) * i / 3; context.moveTo(x, top); context.lineTo(x, bottom); }
    context.moveTo(left, top); context.lineTo(right, top); context.moveTo(left, bottom); context.lineTo(right, bottom);
    context.stroke();
    context.font = '20px system-ui, sans-serif'; context.textBaseline = 'alphabetic';
    context.fillStyle = '#8b9296';
    context.textAlign = 'left'; context.fillText(`−${HISTORY_SECONDS} s`, left, height - 4);
    context.textAlign = 'right'; context.fillText('now', right, height - 4);
    const trace = (values: Float32Array, color: string, unit: string, digits: number, align: CanvasTextAlign): void => {
      if (count < 2) return;
      let low = Infinity, high = -Infinity;
      for (let i = 0; i < count; i++) { const v = values[(head - 1 - i + 2 * HISTORY) % HISTORY]; if (v < low) low = v; if (v > high) high = v; }
      // Never a flat line across the middle for a quiet signal: at least this much of the unit from bottom to top.
      const floor = unit === 'mm' ? 0.5 : 5, pad = Math.max((high - low) * 0.08, (floor - (high - low)) / 2, 0);
      low -= pad; high += pad;
      context.strokeStyle = color; context.lineWidth = 2.5; context.beginPath();
      for (let i = 0; i < count; i++) {
        const v = values[(head - count + i + 2 * HISTORY) % HISTORY], x = right - (right - left) * (count - 1 - i) / (HISTORY - 1), y = bottom - (bottom - top) * (v - low) / (high - low);
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
      context.fillStyle = color; context.textAlign = align;
      context.fillText(`${low.toFixed(digits)} to ${high.toFixed(digits)} ${unit}`, align === 'left' ? left : right, 20);
    };
    trace(deflection, '#5ec8ff', 'mm', 1, 'left');
    trace(tension, '#ffb347', 'kN', 0, 'right');
  }

  function showReadouts(): void {
    if (!scene) return;
    const model = scene.model, o = model.out, stay = Math.min(SI_BRIDGE_PLOTTED_STAY, o.stayTension.length - 1);
    out.time.textContent = `${fixed(o.time, 2)} s`;
    out.midspan.textContent = `${fixed(o.midspanDeflection * 1e3, 2)} mm`;
    out.maxTension.textContent = `${fixed(o.maxStayTension / 1e3, 1)} kN · ${fixed(100 * o.maxStayUtilisation, 1)} % of break`;
    out.stayTension.textContent = model.failed.includes(stay) ? `${fixed(o.stayTension[stay] / 1e3, 1)} kN (failed)` : `${fixed(o.stayTension[stay] / 1e3, 1)} kN`;
    out.towerMoment.textContent = `${fixed(o.towerBase[5] / 1e3, 0)} kN m · ${fixed(100 * o.towerUtilisation, 1)} % of yield`;
    out.deck.textContent = `${fixed(100 * o.deckUtilisation, 1)} %`;
    out.vehicle.textContent = model.vehicle ? `${fixed(o.vehicleX, 1)} m of ${fixed(scene.layout.length, 0)} m · ${fixed(model.vehicle.mass / 1e3, 1)} t` : 'no vehicle';
    out.energy.textContent = `${fixed(model.energy() / 1e3, 2)} kJ`;
    out.reaction.textContent = fixed(o.totalReaction[1] / model.totalWeight(), 4);
    const mean = scene.takeStepCost();
    if (Number.isFinite(mean)) cost = mean;
    out.cost.textContent = Number.isFinite(cost) ? `${fixed(cost, 2)} ms · real-time ×${fixed(model.dt * 1e3 / cost, 1)}` : '–';
    pauseButton.textContent = callbacks.isPaused() ? 'Resume' : 'Pause';
  }

  return {
    attach(next) {
      scene = next;
      panel.hidden = next === null;
      head = 0; count = 0; plotDirty = true; lastReadout = -Infinity; cost = NaN;
      if (!next) return;
      mass.input.value = String(Math.round(next.settings.vehicleMass / 1000)); speed.input.value = String(next.settings.vehicleSpeed); wind.input.value = String(next.settings.windLoad / 1000);
      mass.show(); speed.show(); wind.show();
      staySelect.replaceChildren();
      next.layout.stays.forEach((stay, index) => {
        const option = element('option', '', `Stay ${index + 1} · deck x = ${next.layout.positions[3 * stay.deckNode].toFixed(0)} m`);
        option.value = String(index); staySelect.append(option);
      });
      staySelect.value = String(Math.min(SI_BRIDGE_PLOTTED_STAY, next.layout.stays.length - 1));
      exaggeration.value = String(next.exaggeration);
      status.textContent = '';
      showReadouts(); drawPlot();
    },
    sample() {
      if (!scene) return;
      const o = scene.model.out;
      deflection[head] = o.midspanDeflection * 1e3; tension[head] = o.stayTension[Math.min(SI_BRIDGE_PLOTTED_STAY, o.stayTension.length - 1)] / 1e3;
      head = (head + 1) % HISTORY; if (count < HISTORY) count++;
      plotDirty = true;
    },
    refresh(now) {
      if (!scene || now - lastReadout < 200) return;
      lastReadout = now;
      showReadouts();
      if (plotDirty) { plotDirty = false; drawPlot(); }
    },
  };
}
