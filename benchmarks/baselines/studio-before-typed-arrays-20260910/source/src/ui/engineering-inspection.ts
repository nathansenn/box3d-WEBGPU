import type {
  EngineeringAssemblyComponent,
  EngineeringAuthoredDimension,
  EngineeringBounds,
  EngineeringComponentKind,
  EngineeringDimensionAxis,
  EngineeringEvidenceRole,
  EngineeringLimitStatus,
  EngineeringModelDetailLevel,
  EngineeringModelManifest,
  EngineeringModelOwner,
} from '../workbench/engineering-model';

export const ENGINEERING_VIEW_IDS = ['authored', 'front', 'side', 'plan', 'fit'] as const;
export type EngineeringViewId = (typeof ENGINEERING_VIEW_IDS)[number];

export type EngineeringInspectionElements = {
  readonly model: HTMLElement;
  readonly revision: HTMLElement;
  readonly coordinateSystem: HTMLElement;
  readonly units: HTMLElement;
  readonly provenance: HTMLElement;
  readonly viewControls: HTMLElement;
  readonly selection: HTMLElement;
  readonly clearSelection: HTMLButtonElement;
  readonly componentList: HTMLElement;
  readonly dimensionList: HTMLElement;
  readonly limitList: HTMLElement;
};

export type EngineeringInspectionCallbacks = {
  readonly onSelect: (component: EngineeringAssemblyComponent | null) => void;
  readonly onView: (view: EngineeringViewId) => void;
};

export type EngineeringInspectionController = {
  readonly render: (manifest: EngineeringModelManifest) => void;
  readonly selectComponent: (componentId: string | null) => void;
  readonly setActiveView: (view: EngineeringViewId) => void;
  readonly getSelectedComponent: () => EngineeringAssemblyComponent | null;
};

type KindFamily = 'setup' | 'sensors' | 'context';
type MetricRow = readonly [label: string, value: string, source: string];
type ChipAttribute = 'authority' | 'evidence';
type StatusToken = 'bound' | 'available' | 'not-modeled';
type HowToUseAction = {
  readonly title: string;
  readonly detail: string;
};

export const INSPECTION_HOW_TO_USE = {
  title: 'How to use',
  unitsNote: 'Readings use normalized sim units.',
  actions: [
    { title: 'Pick a specimen', detail: 'Choose one from the list on the left.' },
    { title: 'Apply force, then press Play', detail: 'Watch the hit in the viewport and graphs.' },
    { title: 'Drag to look around', detail: 'Orbit the view. Reset restores the specimen.' },
  ],
} as const satisfies {
  readonly title: string;
  readonly unitsNote: string;
  readonly actions: readonly HowToUseAction[];
};

function ownerLabel(owner: EngineeringModelOwner): string {
  switch (owner) {
    case 'solver-runtime': return 'Solver';
    case 'workbench-definition': return 'Defined';
    case 'renderer-presentation': return 'Visual';
    default: {
      const _never: never = owner;
      throw new Error(`Unhandled model owner: ${String(_never)}`);
    }
  }
}

function evidenceLabel(role: EngineeringEvidenceRole): string {
  switch (role) {
    case 'scope-container': return 'Scope';
    case 'numerical-state': return 'Evidence';
    case 'boundary-condition': return 'Boundary';
    case 'derived-measurement': return 'Derived';
    case 'presentation-only': return 'Excluded';
    default: {
      const _never: never = role;
      throw new Error(`Unhandled evidence role: ${String(_never)}`);
    }
  }
}

function limitLabel(status: EngineeringLimitStatus): string {
  switch (status) {
    case 'represented': return 'Represented';
    case 'reduced-order': return 'Reduced';
    case 'not-modeled': return 'Not modeled';
    case 'presentation-only': return 'Visual only';
    default: {
      const _never: never = status;
      throw new Error(`Unhandled limit status: ${String(_never)}`);
    }
  }
}

function kindLabel(kind: EngineeringComponentKind): string {
  switch (kind) {
    case 'assembly': return 'Experiment';
    case 'specimen': return 'Specimen';
    case 'fixture': return 'Fixture';
    case 'load-train': return 'Load train';
    case 'instrumentation': return 'Sensor';
    case 'environment': return 'Environment';
    case 'effect': return 'Effect';
    default: {
      const _never: never = kind;
      throw new Error(`Unhandled component kind: ${String(_never)}`);
    }
  }
}

function kindFamily(kind: EngineeringComponentKind): KindFamily {
  switch (kind) {
    case 'assembly':
    case 'specimen':
    case 'fixture':
    case 'load-train':
      return 'setup';
    case 'instrumentation':
      return 'sensors';
    case 'environment':
    case 'effect':
      return 'context';
    default: {
      const _never: never = kind;
      throw new Error(`Unhandled component kind: ${String(_never)}`);
    }
  }
}

function familyLabel(family: KindFamily): string {
  switch (family) {
    case 'setup': return 'Setup';
    case 'sensors': return 'Sensors';
    case 'context': return 'Context';
    default: {
      const _never: never = family;
      throw new Error(`Unhandled kind family: ${String(_never)}`);
    }
  }
}

function ownerToken(owner: EngineeringModelOwner, evidence: EngineeringEvidenceRole): string {
  if (evidence === 'derived-measurement') return 'derived';
  switch (owner) {
    case 'solver-runtime': return 'solver-native';
    case 'workbench-definition': return 'definition';
    case 'renderer-presentation': return 'presentation';
    default: {
      const _never: never = owner;
      throw new Error(`Unhandled model owner: ${String(_never)}`);
    }
  }
}

function evidenceToken(role: EngineeringEvidenceRole): StatusToken {
  switch (role) {
    case 'numerical-state':
    case 'boundary-condition':
      return 'bound';
    case 'presentation-only':
      return 'not-modeled';
    case 'scope-container':
    case 'derived-measurement':
      return 'available';
    default: {
      const _never: never = role;
      throw new Error(`Unhandled evidence role: ${String(_never)}`);
    }
  }
}

function dimensionSource(authority: EngineeringAuthoredDimension['authority']): string {
  switch (authority) {
    case 'authored-scene': return 'Authored';
    default: {
      const _never: never = authority;
      throw new Error(`Unhandled dimension authority: ${String(_never)}`);
    }
  }
}

function limitToken(status: EngineeringLimitStatus): StatusToken {
  switch (status) {
    case 'represented': return 'bound';
    case 'reduced-order': return 'available';
    case 'not-modeled':
    case 'presentation-only':
      return 'not-modeled';
    default: {
      const _never: never = status;
      throw new Error(`Unhandled limit status: ${String(_never)}`);
    }
  }
}

function solverLabel(solver: EngineeringModelManifest['solver']): string {
  switch (solver) {
    case 'material-lattice': return 'Reduced-order beam lattice';
    case 'pbd-cloth': return 'Position-based cloth';
    case 'pbd-rope': return 'Position-based rope';
    case 'shallow-water': return 'Linear 2.5D shallow water';
    case 'box3d-rigid': return 'Box3D rigid bodies';
    case 'combined-material': return 'Three-rig material coordinator';
    default: {
      const _never: never = solver;
      throw new Error(`Unhandled solver: ${String(_never)}`);
    }
  }
}

function detailLabel(level: EngineeringModelDetailLevel): string {
  switch (level) {
    case 'flagship': return 'Authored flagship';
    case 'catalog': return 'Catalog';
    default: {
      const _never: never = level;
      throw new Error(`Unhandled detail level: ${String(_never)}`);
    }
  }
}

function axisLabel(axis: EngineeringDimensionAxis): string {
  switch (axis) {
    case 'X': return 'X';
    case 'Y': return 'Y';
    case 'Z': return 'Z';
    case 'radial': return 'Radial';
    case 'span': return 'Span';
    default: {
      const _never: never = axis;
      throw new Error(`Unhandled dimension axis: ${String(_never)}`);
    }
  }
}

function viewLabel(view: EngineeringViewId): string {
  switch (view) {
    case 'authored': return 'Authored';
    case 'front': return 'Front';
    case 'side': return 'Side';
    case 'plan': return 'Plan';
    case 'fit': return 'Fit';
    default: {
      const _never: never = view;
      throw new Error(`Unhandled inspection view: ${String(_never)}`);
    }
  }
}

function isEngineeringViewId(value: string | undefined): value is EngineeringViewId {
  return ENGINEERING_VIEW_IDS.some((id) => id === value);
}

function componentAccent(component: EngineeringAssemblyComponent): string {
  if (component.evidenceRole === 'derived-measurement') return '#f6d64a';
  switch (component.owner) {
    case 'solver-runtime': return '#68df55';
    case 'workbench-definition': return '#29c8ff';
    case 'renderer-presentation': return '#8a666d';
    default: {
      const _never: never = component.owner;
      throw new Error(`Unhandled model owner: ${String(_never)}`);
    }
  }
}

function formatSimValue(value: number): string {
  const amount = value.toFixed(value < 1 ? 2 : 1);
  return `${amount} sim units`;
}

function dimensionValue(dimension: EngineeringAuthoredDimension): string {
  return formatSimValue(dimension.value);
}

function boundsExtents(bounds: EngineeringBounds): { readonly span: number; readonly height: number; readonly depth: number } {
  return {
    span: bounds.max[0] - bounds.min[0],
    height: bounds.max[1] - bounds.min[1],
    depth: bounds.max[2] - bounds.min[2],
  };
}

function specimenMaterial(manifest: EngineeringModelManifest): string {
  const specimen = manifest.components.find((component) => component.kind === 'specimen' && component.material);
  return specimen?.material ?? 'Workbench material preset';
}

function tapCount(manifest: EngineeringModelManifest): number {
  const taps = manifest.components.find((component) => (
    component.kind === 'instrumentation' && component.quantity >= 5
  ));
  return taps?.quantity ?? manifest.components
    .filter((component) => component.kind === 'instrumentation')
    .reduce((sum, component) => sum + component.quantity, 0);
}

function thicknessDimension(manifest: EngineeringModelManifest): EngineeringAuthoredDimension | undefined {
  return manifest.dimensions.find((dimension) => /gauge|thickness|wall/i.test(dimension.label));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  return result;
}

function badge(label: string, attribute: ChipAttribute, value: string): HTMLSpanElement {
  const result = element('span', 'assembly-badge');
  result.textContent = label;
  result.dataset[attribute] = value;
  return result;
}

function heading(title: string): HTMLHeadingElement {
  const result = element('h4', 'assembly-section-heading');
  result.textContent = title;
  return result;
}

function metricRow(cells: readonly string[], header: boolean): HTMLDivElement {
  const row = element('div', 'assembly-dimension-row');
  row.setAttribute('role', 'row');
  if (header) row.dataset.dimensionHeader = '';
  for (const label of cells) {
    const cell = element('span');
    cell.setAttribute('role', header ? 'columnheader' : 'cell');
    cell.textContent = label;
    row.append(cell);
  }
  return row;
}

function metricTable(rows: readonly MetricRow[], emptyLabel = 'No authored values'): HTMLDivElement {
  const table = element('div', 'assembly-dimension-list');
  table.setAttribute('role', 'table');
  table.append(metricRow(['Feature', 'Value', 'Source'], true));
  if (rows.length === 0) {
    table.append(metricRow([emptyLabel, '—', 'Catalog'], false));
    return table;
  }
  for (const row of rows) table.append(metricRow(row, false));
  return table;
}

function subsection(title: string, ...children: readonly Node[]): HTMLElement {
  const wrap = element('div', 'assembly-subsection');
  wrap.append(heading(title), ...children);
  return wrap;
}

function statusCard(
  title: string,
  detail: string,
  chip: string,
  state: StatusToken,
): HTMLDivElement {
  const row = element('div', 'assembly-limit-item');
  row.dataset.state = state;
  row.setAttribute('role', 'status');
  const copy = element('div', 'assembly-limit-copy');
  const subject = element('strong');
  subject.textContent = title;
  const disclosure = element('span');
  disclosure.textContent = detail;
  copy.append(subject, disclosure);
  row.append(copy, badge(chip, 'evidence', state));
  return row;
}

function setSubsectionHeading(host: HTMLElement, title: string): void {
  const node = host.closest('.assembly-subsection')?.querySelector('.assembly-section-heading');
  if (node) node.textContent = title;
}

function orderedComponents(
  components: readonly EngineeringAssemblyComponent[],
): EngineeringAssemblyComponent[] {
  const byParent = new Map<string | undefined, EngineeringAssemblyComponent[]>();
  for (const component of components) {
    const siblings = byParent.get(component.parentId) ?? [];
    siblings.push(component);
    byParent.set(component.parentId, siblings);
  }
  const ordered: EngineeringAssemblyComponent[] = [];
  const visit = (parentId: string | undefined): void => {
    for (const child of byParent.get(parentId) ?? []) {
      ordered.push(child);
      visit(child.id);
    }
  };
  visit(undefined);
  const seen = new Set(ordered.map((component) => component.id));
  for (const component of components) {
    if (seen.has(component.id)) continue;
    ordered.push(component);
    visit(component.id);
  }
  return ordered;
}

/**
 * DOM-only linked assembly/schedule view. Selection callbacks are deliberately
 * presentation scoped; this controller cannot mutate a solver or run record.
 */
export function createEngineeringInspection(
  ui: EngineeringInspectionElements,
  callbacks: EngineeringInspectionCallbacks,
): EngineeringInspectionController {
  let manifest: EngineeringModelManifest | null = null;
  let selectedComponent: EngineeringAssemblyComponent | null = null;
  const componentRows = new Map<string, HTMLButtonElement>();
  const detailsHost = element('div');
  detailsHost.dataset.inspectionDetails = '';
  const helpHost = element('div');
  helpHost.dataset.inspectionHelp = '';

  const attachHelpHost = (): void => {
    const panel = ui.model.closest('.inspector-section');
    const title = panel?.querySelector('h3');
    const identity = ui.model.closest('.assembly-identity');
    if (title) {
      if (helpHost.previousElementSibling !== title) title.after(helpHost);
      return;
    }
    if (identity && helpHost.nextElementSibling !== identity) identity.before(helpHost);
  };

  const attachDetailsHost = (): void => {
    const identity = ui.model.closest('.assembly-identity');
    if (!identity || detailsHost.parentElement === identity.parentElement) return;
    identity.after(detailsHost);
  };

  const renderHelp = (): void => {
    attachHelpHost();
    if (!helpHost.parentElement) return;
    // First-run overlay is the single How-to. Dismissing it (Got it) hides
    // this docked copy as well; the header How to use control can reopen it.
    helpHost.replaceChildren();
  };

  const setActiveView = (view: EngineeringViewId): void => {
    for (const button of ui.viewControls.querySelectorAll<HTMLButtonElement>('[data-engineering-view]')) {
      const id = button.dataset.engineeringView;
      if (!isEngineeringViewId(id)) continue;
      const candidate = id;
      button.setAttribute('aria-pressed', String(candidate === view));
      button.textContent = viewLabel(candidate);
      button.title = `${viewLabel(candidate)} is a perspective inspection preset, not an orthographic CAD projection.`;
    }
  };

  const renderIdentity = (value: EngineeringModelManifest): void => {
    ui.model.textContent = value.title;
    ui.revision.textContent = value.revision.toUpperCase();
    ui.coordinateSystem.textContent = `${value.coordinateFrame.upAxis}-up · RH`;
    ui.units.textContent = 'Normalized sim units';
    ui.provenance.textContent = `${detailLabel(value.detailLevel)} definition · ${solverLabel(value.solver)} · ownership and evidence scope declared per component.`;
    ui.provenance.title = `${value.summary} ${value.coordinateFrame.scaleDisclosure}`;

    const kicker = ui.model.closest('.assembly-identity-primary')?.querySelector('.assembly-kicker');
    if (kicker) kicker.textContent = 'Load case';

    const panel = ui.model.closest('.inspector-section');
    const title = panel?.querySelector('h3');
    if (title) title.textContent = 'Inspection';

    const meta = ui.coordinateSystem.closest('dl');
    if (meta) {
      const ensure = (key: string, label: string): HTMLElement => {
        let dd = meta.querySelector<HTMLElement>(`[data-inspection-meta="${key}"]`);
        if (!dd) {
          const wrap = element('div');
          const dt = element('dt');
          dt.textContent = label;
          dd = element('dd');
          dd.dataset.inspectionMeta = key;
          wrap.append(dt, dd);
          meta.append(wrap);
        }
        return dd;
      };
      ensure('solver', 'Solver').textContent = solverLabel(value.solver);
      ensure('fidelity', 'Fidelity').textContent = 'Reduced numerical model';
    }
  };

  const renderHeadings = (): void => {
    setSubsectionHeading(ui.viewControls, 'Inspection views');
    setSubsectionHeading(ui.componentList, 'Experiment');
    setSubsectionHeading(ui.dimensionList, 'Reference dimensions');
    setSubsectionHeading(ui.limitList, 'Simulation limits');
    const selectionKicker = ui.selection.previousElementSibling;
    if (selectionKicker) selectionKicker.textContent = 'Component';
  };

  const renderComponents = (value: EngineeringModelManifest): void => {
    componentRows.clear();
    const byId = new Map(value.components.map((component) => [component.id, component] as const));
    const depthFor = (component: EngineeringAssemblyComponent): number => {
      let depth = 0;
      let parentId = component.parentId;
      const visited = new Set<string>();
      while (parentId && depth < 3 && !visited.has(parentId)) {
        visited.add(parentId);
        depth++;
        parentId = byId.get(parentId)?.parentId;
      }
      return depth;
    };

    const fragment = document.createDocumentFragment();
    let lastFamily: KindFamily | null = null;
    for (const component of orderedComponents(value.components)) {
      const parent = component.parentId ? byId.get(component.parentId) : undefined;
      const topLevel = !parent || parent.kind === 'assembly';
      const family = kindFamily(component.kind);
      if (topLevel && component.kind !== 'assembly' && family !== lastFamily) {
        const group = element('div', 'assembly-section-heading');
        group.setAttribute('role', 'presentation');
        group.textContent = familyLabel(family);
        fragment.append(group);
        lastFamily = family;
      }

      const row = element('button', 'assembly-component-row');
      row.type = 'button';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', 'false');
      row.dataset.componentId = component.id;
      const depth = depthFor(component);
      row.dataset.depth = String(depth);
      row.setAttribute('aria-level', String(depth + 1));
      row.title = component.note;
      row.style.setProperty('--component-accent', componentAccent(component));

      const copy = element('span', 'assembly-component-copy');
      const name = element('strong');
      name.textContent = component.label;
      const detail = element('small');
      const material = component.material ? ` · ${component.material}` : '';
      detail.textContent = `${kindLabel(component.kind)} · qty ${component.quantity}${material}`;
      copy.append(name, detail);

      const badges = element('span', 'assembly-component-badges');
      badges.append(
        badge(ownerLabel(component.owner), 'authority', ownerToken(component.owner, component.evidenceRole)),
        badge(evidenceLabel(component.evidenceRole), 'evidence', evidenceToken(component.evidenceRole)),
      );
      row.append(copy, badges);
      row.addEventListener('click', () => selectComponent(component.id));
      componentRows.set(component.id, row);
      fragment.append(row);
    }
    ui.componentList.replaceChildren(fragment);
  };

  const renderDimensions = (value: EngineeringModelManifest): void => {
    const rows: MetricRow[] = value.dimensions.map((dimension) => [
      `${dimension.label} (${axisLabel(dimension.axis)})`,
      dimensionValue(dimension),
      dimensionSource(dimension.authority),
    ]);
    if (selectedComponent?.bounds) {
      const extents = boundsExtents(selectedComponent.bounds);
      rows.push(
        [`Selected span (X)`, formatSimValue(extents.span), 'Derived'],
        [`Selected height (Y)`, formatSimValue(extents.height), 'Derived'],
        [`Selected depth (Z)`, formatSimValue(extents.depth), 'Derived'],
      );
    }
    ui.dimensionList.replaceChildren(...Array.from(metricTable(rows, 'No authored dimensions').children));
  };

  const renderLimits = (value: EngineeringModelManifest): void => {
    const fragment = document.createDocumentFragment();
    const represented = value.limits.filter((limit) => limit.status === 'represented').length;
    const reduced = value.limits.filter((limit) => limit.status === 'reduced-order').length;
    fragment.append(statusCard(
      'Scope declared',
      `${represented} represented · ${reduced} reduced-order · Physical PASS/FAIL unavailable without imported calibration.`,
      'Declared',
      represented > 0 ? 'bound' : 'available',
    ));
    fragment.append(statusCard(
      'Simulation limits',
      'Normalized envelope is declared on this definition. This is not a physical safety interlock.',
      'OK',
      'bound',
    ));
    for (const limit of value.limits) {
      const row = element('div', 'assembly-limit-item');
      row.dataset.state = limitToken(limit.status);
      row.setAttribute('role', 'listitem');
      const copy = element('div', 'assembly-limit-copy');
      const subject = element('strong');
      subject.textContent = limit.subject;
      const disclosure = element('span');
      disclosure.textContent = limit.disclosure;
      copy.append(subject, disclosure);
      row.append(copy, badge(limitLabel(limit.status), 'evidence', limitToken(limit.status)));
      fragment.append(row);
    }
    ui.limitList.replaceChildren(fragment);
  };

  const renderDetails = (value: EngineeringModelManifest): void => {
    attachDetailsHost();
    if (!detailsHost.parentElement) return;

    const thickness = thicknessDimension(value);
    const sensors = value.components.filter((component) => component.kind === 'instrumentation');
    const taps = tapCount(value);
    const selected = selectedComponent;

    const loadCaseRows: MetricRow[] = [
      ['Load case name', value.title, 'Definition'],
      ['Control mode', 'Normalized load', 'Definition'],
      ['Target', 'Authored actuator target', 'Simulation units'],
      ['Model rate', '1.00 × model time', 'Solver-native'],
      ['Hold at peak', 'Not timed', 'Not modeled'],
    ];
    const forceRows: MetricRow[] = [
      ['Magnitude', 'Normalized live control', 'Force tab'],
      ['Radius', 'Normalized footprint', 'Force tab'],
      ['Impulse', 'Normalized broad impulse', 'Force tab'],
    ];
    const materialRows: MetricRow[] = [
      ['Material', selected?.material ?? specimenMaterial(value), selected ? kindLabel(selected.kind) : 'Specimen'],
      ['Yield strength', 'Reduced preset', 'Not calibrated'],
      ['Hardening', 'Reduced preset', 'Not calibrated'],
      ['Thickness', thickness ? dimensionValue(thickness) : 'Display thickness only', thickness ? 'Authored' : 'Not modeled'],
    ];
    const solverRows: MetricRow[] = [
      ['Type', solverLabel(value.solver), 'Solver-native'],
      ['Time step', '1 / 60 model s', 'Solver-native'],
      ['Substeps', 'Live control · 1–8', 'Live control'],
      ['Iterations', 'Not exposed', 'Solver-native'],
      ['Collision', 'Solver-defined', 'Solver-native'],
      ['Adaptive time step', 'Off · fixed step', 'Solver-native'],
    ];
    const alignmentRows: MetricRow[] = [
      ['Trigger source', 'Not mapped', 'Import required'],
      ['Trigger threshold', '0.2 normalized', 'Definition'],
      ['Trigger offset', '0 samples', 'Locked'],
      ['Time zero adjust', 'Locked', 'Definition'],
    ];
    const contactRows: MetricRow[] = [
      ['Algorithm', 'Not exposed', 'Solver-native'],
      ['Friction (µ)', 'Not exposed', 'Not modeled'],
      ['Stabilization', 'Not exposed', 'Not modeled'],
      ['Adaptive stiffness', 'Not exposed', 'Not modeled'],
    ];
    const uncertaintyRows: MetricRow[] = [
      ['Force', 'Unavailable', 'Import required'],
      ['Displacement', 'Unavailable', 'Import required'],
      ['Time', 'Unavailable', 'Import required'],
    ];
    const correlationRows: MetricRow[] = [
      ['Response', 'Compatible archived channel', 'Import required'],
      ['Weighting', 'Uniform · fixed', 'Definition'],
      ['Smoothing', '5-point · fixed', 'Definition'],
      ['Workbench agreement', 'Not scored', 'Reference required'],
    ];
    const fieldRows: MetricRow[] = [
      ['Model state', 'Definition ready', 'Inspection'],
      ['Model input', 'Normalized tip impulse', 'Derived'],
      ['Declared range', '0–40 normalized', 'Definition'],
      ['Averaging', 'Single capture · Hann', 'Derived'],
      ['Input range', 'Normalized impulse', 'Definition'],
    ];
    const qualityRows: MetricRow[] = value.limits.slice(0, 4).map((limit) => [
      limit.subject,
      limitLabel(limit.status),
      limit.status === 'represented' ? 'Bound' : 'Disclosure',
    ]);

    const channelHealth = element('div', 'assembly-limit-list');
    if (sensors.length === 0) {
      channelHealth.append(statusCard('Sensors', 'No derived channels are declared on this definition.', 'None', 'not-modeled'));
    } else {
      for (const sensor of sensors) {
        const row = element('div', 'assembly-limit-item');
        row.dataset.state = evidenceToken(sensor.evidenceRole);
        row.setAttribute('role', 'listitem');
        const copy = element('div', 'assembly-limit-copy');
        const subject = element('strong');
        subject.textContent = sensor.label;
        const disclosure = element('span');
        disclosure.textContent = `${kindLabel(sensor.kind)} · qty ${sensor.quantity} · ${sensor.note}`;
        copy.append(subject, disclosure);
        row.append(copy, badge(evidenceLabel(sensor.evidenceRole), 'evidence', evidenceToken(sensor.evidenceRole)));
        channelHealth.append(row);
      }
    }
    if (taps > 0) {
      const tapRow = element('div', 'assembly-limit-item');
      tapRow.dataset.state = 'available';
      const copy = element('div', 'assembly-limit-copy');
      const subject = element('strong');
      subject.textContent = 'Derived response taps';
      const disclosure = element('span');
      disclosure.textContent = `${taps} scaled taps of solver response; not independent sensors or physical DAQ.`;
      copy.append(subject, disclosure);
      const chips = element('span', 'assembly-component-badges');
      const shown = Math.min(taps, 5);
      for (let index = 1; index <= shown; index++) {
        chips.append(badge(`P${index}`, 'evidence', 'available'));
      }
      tapRow.append(copy, chips);
      channelHealth.append(tapRow);
    }

    const preflight = element('div', 'assembly-limit-list');
    const preflightItems: ReadonlyArray<readonly [string, string, StatusToken]> = [
      ['Preflight', 'Definition loaded', 'bound'],
      ['Baseline', 'Undamaged model', 'bound'],
      ['Parameter limits', 'Declared range', 'available'],
      ['Ensemble input', 'Captures not in this panel', 'not-modeled'],
      ['Sample rate', '60 model Hz', 'available'],
      ['Window', 'Hann', 'available'],
      ['Calibration', 'Not attached', 'not-modeled'],
      ['Model build', 'Deterministic', 'bound'],
    ];
    for (const [label, valueText, state] of preflightItems) {
      preflight.append(statusCard(label, valueText, state === 'bound' ? 'OK' : state === 'available' ? 'Info' : 'Open', state));
    }

    const advanced = element('details', 'assembly-subsection');
    const summary = element('summary', 'assembly-section-heading');
    summary.textContent = 'Advanced';
    advanced.append(
      summary,
      heading('Alignment'),
      metricTable(alignmentRows),
      heading('Contact scope'),
      metricTable(contactRows),
      heading('Uncertainty'),
      metricTable(uncertaintyRows),
      heading('Model comparison'),
      metricTable(correlationRows),
      heading('Model quality'),
      metricTable(qualityRows, 'No quality disclosures'),
      heading('Camera calibration'),
      metricTable([
        ['Camera', 'Presentation orbit only', 'Visual'],
        ['Focal length', 'Unavailable', 'Not modeled'],
        ['Distortion', 'Unavailable', 'Not modeled'],
      ]),
    );

    detailsHost.replaceChildren(
      subsection('Status', statusCard(
        selected ? selected.label : 'Inspection ready',
        selected
          ? `${kindLabel(selected.kind)} · ${ownerLabel(selected.owner)} · ${evidenceLabel(selected.evidenceRole)}`
          : 'Select a component to inspect bounds. Numerical state is not mutated from this panel.',
        selected ? evidenceLabel(selected.evidenceRole) : 'Ready',
        selected ? evidenceToken(selected.evidenceRole) : 'available',
      )),
      subsection('Load case', metricTable(loadCaseRows)),
      subsection('Force', metricTable(forceRows)),
      subsection('Material', metricTable(materialRows)),
      subsection('Solver', metricTable(solverRows)),
      subsection('Channel health', channelHealth),
      subsection('Model state', metricTable(fieldRows)),
      subsection('Preflight', preflight),
      advanced,
    );
  };

  const selectComponent = (componentId: string | null): void => {
    selectedComponent = componentId && manifest
      ? manifest.components.find((component) => component.id === componentId) ?? null
      : null;
    for (const [id, row] of componentRows) row.setAttribute('aria-selected', String(id === selectedComponent?.id));
    ui.selection.textContent = selectedComponent?.label ?? 'None';
    ui.selection.title = selectedComponent?.note ?? '';
    ui.clearSelection.disabled = selectedComponent === null;
    if (manifest) {
      renderDimensions(manifest);
      renderDetails(manifest);
    }
    callbacks.onSelect(selectedComponent);
  };

  for (const button of ui.viewControls.querySelectorAll<HTMLButtonElement>('[data-engineering-view]')) {
    button.addEventListener('click', () => {
      const value = button.dataset.engineeringView;
      if (!isEngineeringViewId(value)) return;
      const view = value;
      setActiveView(view);
      callbacks.onView(view);
    });
  }
  ui.clearSelection.addEventListener('click', () => selectComponent(null));

  const render = (value: EngineeringModelManifest): void => {
    manifest = value;
    renderIdentity(value);
    renderHelp();
    renderHeadings();
    renderComponents(value);
    renderLimits(value);
    setActiveView('authored');
    selectComponent(null);
  };

  return {
    render,
    selectComponent,
    setActiveView,
    getSelectedComponent: () => selectedComponent,
  };
}
