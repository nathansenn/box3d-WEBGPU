/**
 * The readout of a coupled scene in the Physics Lab: the clock and the cost of a step, the
 * simulation's energy ledger by subsystem, and the latest events. It uses the styles of the SI
 * bridge panel (si-bridge-panel.css).
 *
 * Every value is written with textContent; nothing here builds markup from data.
 */
import './si-bridge-panel.css';
import type { CoupledSceneView } from './coupled-scene.ts';

export interface CoupledPanel {
  /** Show the panel for this scene, or hide it with null. */
  attach(view: CoupledSceneView | null, title?: string): void;
  /** Call once per rendered frame: refreshes the readouts about four times a second. */
  refresh(now: number): void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
/** Joules with a unit prefix, four significant digits. */
export function formatJoules(value: number): string {
  if (!Number.isFinite(value)) return '–';
  const size = Math.abs(value);
  if (size >= 1e6) return `${(value / 1e6).toPrecision(4)} MJ`;
  if (size >= 1e3) return `${(value / 1e3).toPrecision(4)} kJ`;
  if (size >= 1 || size === 0) return `${value.toPrecision(4)} J`;
  return `${(value * 1e3).toPrecision(4)} mJ`;
}

export function createCoupledPanel(): CoupledPanel {
  const panel = element('section', 'lab-bridge-panel');
  panel.id = 'lab-coupled-panel';
  panel.setAttribute('aria-label', 'Coupled scene: energy ledger and events');
  panel.hidden = true;
  const toggle = element('button', 'lab-bridge-toggle', 'Hide');
  toggle.type = 'button'; toggle.id = 'lab-coupled-toggle'; toggle.setAttribute('aria-expanded', 'true');
  toggle.addEventListener('click', () => {
    const collapsed = panel.dataset.collapsed !== 'true';
    panel.dataset.collapsed = String(collapsed); toggle.textContent = collapsed ? 'Show' : 'Hide'; toggle.setAttribute('aria-expanded', String(!collapsed));
  });
  const title = element('h2', 'lab-bridge-title', 'Coupled scene');
  panel.append(toggle, element('p', 'lab-bridge-heading', 'One stepping loop · energy ledger and events'), title);

  const clock = element('dl', 'lab-bridge-readouts');
  const readout = (parent: HTMLElement, id: string, label: string): HTMLElement => {
    const value = element('dd', '', '–'); value.id = `lab-coupled-${id}`;
    parent.append(element('dt', '', label), value);
    return value;
  };
  const time = readout(clock, 'time', 'Time · step'), cost = readout(clock, 'cost', 'Step cost'), order = readout(clock, 'order', 'Step order');
  panel.append(clock, element('p', 'lab-bridge-heading', 'Energy by subsystem (total · balance)'));
  const ledger = element('dl', 'lab-bridge-readouts'); ledger.id = 'lab-coupled-ledger';
  panel.append(ledger, element('p', 'lab-bridge-heading', 'Latest events'));
  const events = element('ol', 'lab-bridge-note'); events.id = 'lab-coupled-events';
  events.style.margin = '0 0 6px'; events.style.paddingLeft = '1.3em';
  panel.append(events,
    element('p', 'lab-bridge-note', 'Balance is total minus the energy that came in through declared boundaries; it falls with drag, friction and numerical damping. Rigid bodies are in the ledger only when a coupling touches them.'));
  document.body.append(panel);

  let view: CoupledSceneView | null = null, last = -Infinity;
  const show = (): void => {
    if (!view) return;
    const r = view.readout();
    time.textContent = `${r.time.toFixed(2)} s · ${r.tick} × ${(r.dt * 1000).toFixed(2)} ms`;
    cost.textContent = Number.isFinite(r.stepMs) ? `${r.stepMs.toFixed(2)} ms (${(100 * r.stepMs / (r.dt * 1000)).toFixed(0)}% of real time)` : '–';
    order.textContent = r.order.join(' → ');
    const rows: HTMLElement[] = [];
    for (const entry of r.energy.entries) {
      const value = element('dd', '', `${formatJoules(entry.total)} · ${formatJoules(entry.balance)}`);
      value.title = Object.entries(entry.parts).map(([name, joules]) => `${name} ${formatJoules(joules)}`).join(', ');
      rows.push(element('dt', '', `${entry.id} (${entry.domain === 'thermal' ? 'thermal' : entry.kind})`), value);
    }
    rows.push(element('dt', '', 'Sum'), element('dd', '', `${formatJoules(r.energy.total)} · ${formatJoules(r.energy.balance)}`));
    ledger.replaceChildren(...rows);
    events.replaceChildren(...(r.events.length === 0
      ? [element('li', '', 'None yet.')]
      : r.events.slice().reverse().map(e => element('li', '', `${e.tick} · ${e.source} · ${e.type}${e.detail ? ` · ${e.detail}` : ''}`))));
    if (r.eventCount > r.events.length) events.append(element('li', '', `… ${r.eventCount - r.events.length} earlier`));
  };
  return {
    attach(next, name) {
      view = next;
      panel.hidden = next === null;
      if (name) title.textContent = name;
      last = -Infinity;
      if (next) show();
    },
    refresh(now) {
      if (!view || now - last < 250) return;
      last = now;
      show();
    },
  };
}
