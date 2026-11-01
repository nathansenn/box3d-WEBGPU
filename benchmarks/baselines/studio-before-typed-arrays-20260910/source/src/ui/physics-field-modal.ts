import './physics-field-modal.css';

export const PHYSICS_FIELD_MODAL_VIEWS = ['run', 'channels', 'modes', 'notes'] as const;
export type PhysicsFieldModalView = (typeof PHYSICS_FIELD_MODAL_VIEWS)[number];

export const PHYSICS_FIELD_RUN_STATES = [
  'idle',
  'preflight',
  'armed',
  'running',
  'paused',
  'complete',
  'aborted',
  'error',
] as const;
export type PhysicsFieldRunState = (typeof PHYSICS_FIELD_RUN_STATES)[number];

export const PHYSICS_FIELD_IDS = [
  'trigger',
  'inputRange',
  'averaging',
  'coherenceThreshold',
] as const;
export type PhysicsFieldId = (typeof PHYSICS_FIELD_IDS)[number];

export type PhysicsFieldChannelStatus = 'nominal' | 'warning' | 'fault' | 'offline';
export type PhysicsFieldTone = 'good' | 'caution' | 'info' | 'fault';
export type PhysicsFieldCaptureStatus = 'accepted' | 'rejected' | 'armed' | 'empty';

export type PhysicsFieldChannel = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly status: PhysicsFieldChannelStatus;
};

export type PhysicsFieldStatusTile = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: PhysicsFieldTone;
  readonly icon: string;
  readonly editable?: boolean;
};

export type PhysicsFieldCapture = {
  readonly id: string;
  readonly label: string;
  readonly sampleCount: number;
  readonly status: PhysicsFieldCaptureStatus;
};

export type PhysicsFieldMode = {
  readonly id: string;
  readonly label: string;
  readonly frequencyLabel: string;
  readonly dampingLabel: string;
  readonly active: boolean;
  readonly available: boolean;
};

export type PhysicsFieldNote = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
};

export type PhysicsFieldChartSeries = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly color?: string;
  readonly dashed?: boolean;
};

export type PhysicsFieldChartUpdate = {
  readonly x?: readonly number[];
  readonly series: readonly PhysicsFieldChartSeries[];
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly cursorX?: number;
  readonly xDomain?: readonly [number, number];
  readonly yDomain?: readonly [number, number];
};

export type PhysicsFieldModalState = {
  readonly title: string;
  readonly projectLabel: string;
  readonly testLabel: string;
  readonly synced: boolean;
  readonly clockLabel: string;
  readonly readiness: string;
  readonly runState: PhysicsFieldRunState;
  readonly runMessage: string;
  readonly triggerValue: string;
  readonly triggerDetail: string;
  readonly inputRangeValue: string;
  readonly inputRangeDetail: string;
  readonly averagingValue: string;
  readonly averagingDetail: string;
  readonly channels: readonly PhysicsFieldChannel[];
  readonly statusTiles: readonly PhysicsFieldStatusTile[];
  readonly safetyCopy: string;
  readonly frequencyLabel: string;
  readonly dampingLabel: string;
  readonly coherenceLabel: string;
  readonly captures: readonly PhysicsFieldCapture[];
  readonly captureQueue: string;
  readonly activeView: PhysicsFieldModalView;
  readonly armLabel: string;
  readonly abortEnabled: boolean;
  readonly abortLabel: string;
  readonly provenance: string;
  readonly modeTitle: string;
  readonly modes: readonly PhysicsFieldMode[];
  readonly notes: readonly PhysicsFieldNote[];
  readonly editorField: PhysicsFieldId | null;
};

export type PhysicsFieldModalUpdate = Partial<Omit<PhysicsFieldModalState, 'channels' | 'statusTiles' | 'captures' | 'modes' | 'notes'>> & {
  readonly channels?: readonly PhysicsFieldChannel[];
  readonly statusTiles?: readonly PhysicsFieldStatusTile[];
  readonly captures?: readonly PhysicsFieldCapture[];
  readonly modes?: readonly PhysicsFieldMode[];
  readonly notes?: readonly PhysicsFieldNote[];
  readonly frequencyChart?: PhysicsFieldChartUpdate;
  readonly coherenceChart?: PhysicsFieldChartUpdate;
};

export type PhysicsFieldChange = {
  readonly field: PhysicsFieldId;
  readonly value: string;
  readonly detail: string;
};

export type PhysicsFieldModalCallbacks = {
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
  readonly onArm?: () => void | Promise<void>;
  readonly onAbort?: () => void | Promise<void>;
  readonly onViewChange?: (view: PhysicsFieldModalView) => void;
  readonly onFieldActivate?: (field: PhysicsFieldId) => void;
  readonly onFieldChange?: (change: PhysicsFieldChange) => void;
  readonly onCaptureSelect?: (index: number, capture: PhysicsFieldCapture) => void;
  readonly onModeSelect?: (modeId: string) => void;
  readonly onAnnotation?: () => void;
  readonly onOrbit?: () => void;
  readonly onMenu?: () => void;
};

export type PhysicsFieldModalOptions = {
  readonly mount?: HTMLElement;
  readonly viewport?: HTMLElement;
  readonly idPrefix?: string;
  readonly initial?: PhysicsFieldModalUpdate;
  readonly callbacks?: PhysicsFieldModalCallbacks;
  readonly closeOnOverlay?: boolean;
  readonly closeOnEscape?: boolean;
};

export type PhysicsFieldModalController = {
  readonly root: HTMLDialogElement;
  open(update?: PhysicsFieldModalUpdate): void;
  close(): void;
  update(update: PhysicsFieldModalUpdate): void;
  isOpen(): boolean;
  getState(): PhysicsFieldModalState;
  attachViewport(viewport: HTMLElement | null): void;
  setCallbacks(callbacks: PhysicsFieldModalCallbacks): void;
  destroy(): void;
};

const CHART_CYAN = '#20c8f4';
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SENSOR_POSITIONS = [
  { id: 'a1', left: '12%' },
  { id: 'a2', left: '28%' },
  { id: 'a3', left: '48%' },
  { id: 'a4', left: '68%' },
  { id: 'a5', left: '84%' },
] as const;

const DEFAULT_CHANNELS: readonly PhysicsFieldChannel[] = [
  { id: 'a1', label: 'A1', value: '-1.2 dB', status: 'nominal' },
  { id: 'a2', label: 'A2', value: '-0.8 dB', status: 'nominal' },
  { id: 'a3', label: 'A3', value: '-0.5 dB', status: 'nominal' },
  { id: 'a4', label: 'A4', value: '-0.3 dB', status: 'nominal' },
  { id: 'a5', label: 'A5', value: '-0.2 dB', status: 'nominal' },
];

const DEFAULT_TILES: readonly PhysicsFieldStatusTile[] = [
  { id: 'preflight', icon: 'ph-check-circle', label: 'PREFLIGHT', value: 'All Checks Pass', tone: 'good' },
  { id: 'accel-zero', icon: 'ph-waveform', label: 'ACCEL ZERO', value: 'All taps quiet', tone: 'good' },
  { id: 'overload', icon: 'ph-gauge', label: 'OVERLOAD HEADROOM', value: '18.6 dB', tone: 'good' },
  { id: 'coherence', icon: 'ph-wave-sine', label: 'COHERENCE THRESHOLD', value: '0.80', tone: 'good', editable: true },
  { id: 'sampling', icon: 'ph-pulse', label: 'SAMPLING RATE', value: '480 S/s', tone: 'good' },
  { id: 'filter', icon: 'ph-faders', label: 'ANTI-ALIAS FILTER', value: 'Hann · 240 Hz Nyquist', tone: 'good' },
  { id: 'calibration', icon: 'ph-calendar', label: 'CALIBRATION', value: 'Not attached', tone: 'caution' },
  { id: 'twin', icon: 'ph-cube', label: 'DIGITAL TWIN', value: 'REV 1.2.0 Deterministic', tone: 'good' },
];

const DEFAULT_CAPTURES: readonly PhysicsFieldCapture[] = [
  { id: '001', label: '001', sampleCount: 4096, status: 'accepted' },
  { id: '002', label: '002', sampleCount: 4096, status: 'accepted' },
  { id: '003', label: '003', sampleCount: 4096, status: 'accepted' },
  { id: '004', label: '004', sampleCount: 0, status: 'armed' },
  { id: '005', label: '005', sampleCount: 0, status: 'empty' },
  { id: '006', label: '006', sampleCount: 0, status: 'empty' },
];

const DEFAULT_MODES: readonly PhysicsFieldMode[] = [
  { id: 'mode-1', label: 'Dominant output peak', frequencyLabel: '— model Hz', dampingLabel: '— %', active: true, available: true },
  { id: 'mode-2', label: 'Additional peak', frequencyLabel: 'Unavailable', dampingLabel: '—', active: false, available: false },
  { id: 'mode-3', label: 'Additional peak', frequencyLabel: 'Unavailable', dampingLabel: '—', active: false, available: false },
];

function defaultState(): PhysicsFieldModalState {
  return {
    title: 'FIELD MODAL TEST',
    projectLabel: 'CANT-BEAM-01',
    testLabel: 'IMPACT-001',
    synced: true,
    clockLabel: 'CLK 100%',
    readiness: 'SAFE',
    runState: 'armed',
    runMessage: 'Ready for impact',
    triggerValue: '1.00',
    triggerDetail: 'POS PEAK',
    inputRangeValue: '0–40',
    inputRangeDetail: 'NORM',
    averagingValue: '8',
    averagingDetail: 'LINEAR',
    channels: DEFAULT_CHANNELS,
    statusTiles: DEFAULT_TILES,
    safetyCopy: 'Confirm the reduced-model impulse is within declared limits before impact.',
    frequencyLabel: '—',
    dampingLabel: '—',
    coherenceLabel: '—',
    captures: DEFAULT_CAPTURES,
    captureQueue: '3 ACCEPTED · 0 REJECTED\n3 ACCEPTED REQUIRED',
    activeView: 'run',
    armLabel: 'ARM TEST',
    abortEnabled: true,
    abortLabel: 'ABORT',
    provenance: 'REDUCED NUMERICAL MODEL',
    modeTitle: 'DOMINANT OUTPUT PEAK',
    modes: DEFAULT_MODES,
    notes: [],
    editorField: null,
  };
}

function defaultFrequencyChart(): PhysicsFieldChartUpdate {
  const x = Array.from({ length: 80 }, (_, index) => index / 79 * 40);
  const values = x.map((hz) => {
    const primary = -14 + 22 * Math.exp(-((hz - 8.4) ** 2) / 7.5);
    const secondary = 4 * Math.exp(-((hz - 21.5) ** 2) / 28);
    return primary + secondary;
  });
  return {
    x,
    series: [{ id: 'response-spectrum', label: 'Derived response spectrum', values, color: CHART_CYAN }],
    xLabel: 'model Hz',
    yLabel: 'relative amplitude (dB)',
  };
}

function defaultCoherenceChart(): PhysicsFieldChartUpdate {
  const x = Array.from({ length: 80 }, (_, index) => index / 79 * 40);
  const values = x.map((hz) => {
    const peak = Math.exp(-((hz - 8.4) ** 2) / 18);
    return Math.min(1, 0.18 + 0.74 * peak);
  });
  return {
    x,
    series: [{ id: 'relative-amplitude', label: 'Relative spectral amplitude', values, color: CHART_CYAN }],
    xLabel: 'model Hz',
    yLabel: 'relative amplitude',
    yDomain: [0, 1],
  };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Physics field modal element not found: ${selector}`);
  return element;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function channelIcon(status: PhysicsFieldChannelStatus): string {
  switch (status) {
    case 'nominal': return 'ph-check-circle';
    case 'warning': return 'ph-warning';
    case 'fault': return 'ph-x-circle';
    case 'offline': return 'ph-minus-circle';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function captureIcon(status: PhysicsFieldCaptureStatus): string {
  switch (status) {
    case 'accepted': return 'ph-check-circle';
    case 'rejected': return 'ph-x-circle';
    case 'armed': return 'ph-play';
    case 'empty': return '';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function captureStatusText(capture: PhysicsFieldCapture): string {
  switch (capture.status) {
    case 'accepted': return `${capture.sampleCount} SAMPLES`;
    case 'rejected': return 'REJECTED';
    case 'armed': return 'ARM NEXT';
    case 'empty': return '—';
    default: {
      const exhaustive: never = capture.status;
      return exhaustive;
    }
  }
}

function runPresentation(state: PhysicsFieldRunState): {
  label: string;
  message: string;
  readiness: string;
  armLabel: string;
  abortEnabled: boolean;
  chipTone: 'safe' | 'caution' | 'fault';
} {
  switch (state) {
    case 'idle':
      return { label: 'IDLE', message: 'Preflight required', readiness: 'PREFLIGHT', armLabel: 'ARM TEST', abortEnabled: false, chipTone: 'caution' };
    case 'preflight':
      return { label: 'PREFLIGHT', message: 'Checking model', readiness: 'CHECKING', armLabel: 'ARM TEST', abortEnabled: true, chipTone: 'caution' };
    case 'armed':
      return { label: 'ARMED', message: 'Ready for impact', readiness: 'SAFE', armLabel: 'ARM TEST', abortEnabled: true, chipTone: 'safe' };
    case 'running':
      return { label: 'RUNNING', message: 'Acquiring capture', readiness: 'ACQUIRING', armLabel: 'PAUSE', abortEnabled: true, chipTone: 'safe' };
    case 'paused':
      return { label: 'PAUSED', message: 'Capture paused', readiness: 'PAUSED', armLabel: 'RESUME', abortEnabled: true, chipTone: 'caution' };
    case 'complete':
      return { label: 'COMPLETE', message: 'Review capture', readiness: 'REVIEW', armLabel: 'ARM TEST', abortEnabled: false, chipTone: 'safe' };
    case 'aborted':
      return { label: 'ABORTED', message: 'Capture rejected', readiness: 'ABORTED', armLabel: 'ARM TEST', abortEnabled: false, chipTone: 'fault' };
    case 'error':
      return { label: 'ERROR', message: 'Model error', readiness: 'ERROR', armLabel: 'ARM TEST', abortEnabled: false, chipTone: 'fault' };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function fieldEditorCopy(field: PhysicsFieldId): { title: string; valueLabel: string; detailLabel: string; details: readonly string[] } {
  switch (field) {
    case 'trigger':
      return { title: 'TRIGGER', valueLabel: 'Normalized peak', detailLabel: 'Mode', details: ['POS PEAK', 'TIP PEAK', 'RMS'] };
    case 'inputRange':
      return { title: 'INPUT RANGE', valueLabel: 'Declared range', detailLabel: 'Units', details: ['NORM', 'MODEL'] };
    case 'averaging':
      return { title: 'AVERAGING', valueLabel: 'Count', detailLabel: 'Window', details: ['LINEAR', 'EXP'] };
    case 'coherenceThreshold':
      return { title: 'COHERENCE THRESHOLD', valueLabel: 'Threshold', detailLabel: 'Provenance', details: ['DERIVED', 'IMPORTED'] };
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

function viewLabel(view: PhysicsFieldModalView): string {
  switch (view) {
    case 'run': return 'Run';
    case 'channels': return 'Channels';
    case 'modes': return 'Modes';
    case 'notes': return 'Notes';
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}

function isFieldId(value: string | undefined): value is PhysicsFieldId {
  return PHYSICS_FIELD_IDS.includes(value as PhysicsFieldId);
}

function isViewId(value: string | undefined): value is PhysicsFieldModalView {
  return PHYSICS_FIELD_MODAL_VIEWS.includes(value as PhysicsFieldModalView);
}

function markup(prefix: string): string {
  const id = (suffix: string): string => `${prefix}-${suffix}`;
  const sensors = SENSOR_POSITIONS.map((sensor) => (
    `<span class="phys-field-sensor" data-phys-sensor="${sensor.id}" style="left:${sensor.left};top:48%"><i class="ph ph-check-circle" aria-hidden="true"></i><b></b></span>`
  )).join('');
  const channels = DEFAULT_CHANNELS.map((channel) => (
    `<button class="phys-field-channel" type="button" data-phys-channel="${channel.id}" aria-label="Channel ${channel.label}"><i class="ph ph-check-circle" aria-hidden="true"></i><b>${channel.label}</b><small data-phys-channel-value>${channel.value}</small></button>`
  )).join('');
  const tiles = DEFAULT_TILES.map((tile) => (
    `<button class="phys-field-tile" type="button" data-phys-tile="${tile.id}" data-tone="${tile.tone}" ${tile.editable ? `data-phys-field="coherenceThreshold"` : ''} aria-label="${tile.label}"><i class="ph ${tile.icon}" aria-hidden="true"></i><span class="phys-field-tile__label">${tile.label}</span><strong class="phys-field-tile__value">${tile.value}</strong></button>`
  )).join('');
  const captures = Array.from({ length: 6 }, (_, index) => (
    `<button class="phys-field-capture" type="button" data-phys-capture="${index}"><strong>${String(index + 1).padStart(3, '0')}</strong><span>—</span></button>`
  )).join('');
  const modeDots = DEFAULT_MODES.map((mode) => (
    `<button type="button" data-phys-mode-dot="${mode.id}" aria-label="${mode.label}" aria-pressed="${mode.active ? 'true' : 'false'}" ${mode.available ? '' : 'disabled'} ${mode.active ? 'class="is-active"' : ''}></button>`
  )).join('');

  return `
    <div class="phys-field-frame">
      <header class="phys-field-topbar">
        <button class="phys-field-title" type="button" data-phys-action="menu" id="${id('title')}">
          <span data-phys-title>FIELD MODAL TEST</span>
          <i class="ph ph-caret-down" aria-hidden="true"></i>
        </button>
        <div class="phys-field-context">
          <i class="ph ph-folder" aria-hidden="true"></i>
          <span>Project: <strong data-phys-project>CANT-BEAM-01</strong><br>Test: <strong data-phys-test>IMPACT-001</strong></span>
        </div>
        <span class="phys-field-chip phys-field-chip--sync" data-phys-chip="sync"><i class="ph ph-link" aria-hidden="true"></i><span>SYNCED</span></span>
        <span class="phys-field-chip phys-field-chip--clock" data-phys-chip="clock"><i class="ph ph-pulse" aria-hidden="true"></i><span data-phys-clock>CLK 100%</span></span>
        <span class="phys-field-chip phys-field-chip--safe" data-phys-chip="safe"><i class="ph ph-shield-check" aria-hidden="true"></i><strong data-phys-readiness>SAFE</strong></span>
        <button class="phys-field-icon-btn" type="button" data-phys-action="menu" aria-label="Open field menu"><i class="ph ph-list" aria-hidden="true"></i></button>
      </header>

      <section class="phys-field-viewport" aria-label="Cantilever specimen viewport">
        <div class="phys-field-viewport-slot" data-phys-viewport>
          <div class="phys-field-empty"><i class="ph ph-cube" aria-hidden="true"></i><span>Live WebGPU specimen viewport</span></div>
        </div>
        <div class="phys-field-mode-copy">
          <strong data-phys-mode-title>DOMINANT OUTPUT PEAK</strong>
          <span>peak = <b data-phys-frequency>—</b> model Hz</span>
          <span>bandwidth proxy = <b data-phys-damping>—</b> %</span>
        </div>
        <button class="phys-field-orbit" type="button" data-phys-action="orbit"><i class="ph ph-cube-focus" aria-hidden="true"></i> RESET VIEW</button>
        <span class="phys-field-impact"><strong>INPUT</strong><i class="ph ph-arrow-down" aria-hidden="true"></i></span>
        ${sensors}
        <div class="phys-field-quality">
          <h2>CHANNEL HEALTH <i class="ph ph-info" aria-hidden="true"></i></h2>
          <p><i class="ph ph-check-circle" aria-hidden="true"></i><strong data-phys-health-summary>NOMINAL</strong></p>
          <span>Five derived taps of one solver probe · not independent sensors</span>
        </div>
        <div class="phys-field-mode-dots" aria-label="Extracted peaks">${modeDots}</div>
        <div class="phys-field-axis" aria-hidden="true"><span class="phys-field-axis-x">X</span><span class="phys-field-axis-y">Y</span><span class="phys-field-axis-z">Z</span></div>
        <span class="phys-field-badge" data-phys-provenance>REDUCED NUMERICAL MODEL</span>
      </section>

      <section class="phys-field-sheet" data-phys-sheet>
        <button class="phys-field-handle" type="button" data-phys-action="handle" aria-label="Dismiss field modal"></button>
        <div class="phys-field-sheet-body" data-phys-run-view>
          <section class="phys-field-controls" aria-label="Field acquisition controls">
            <div class="phys-field-summary">
              <article class="phys-field-state">
                <h2>TEST STATE</h2>
                <strong class="phys-field-state__label" data-phys-run-state>ARMED</strong>
                <span data-phys-run-message>Ready for impact</span>
              </article>
              <article class="phys-field-metrics" aria-label="Editable acquisition fields">
                <button class="phys-field-metric" type="button" data-phys-field="trigger">
                  <span class="phys-field-metric__label">TRIGGER</span>
                  <strong class="phys-field-metric__value" data-phys-trigger-value>1.00</strong>
                  <span class="phys-field-metric__detail" data-phys-trigger-detail>POS PEAK</span>
                </button>
                <button class="phys-field-metric" type="button" data-phys-field="inputRange">
                  <span class="phys-field-metric__label">INPUT RANGE</span>
                  <strong class="phys-field-metric__value" data-phys-range-value>0–40</strong>
                  <span class="phys-field-metric__detail" data-phys-range-detail>NORM</span>
                </button>
                <button class="phys-field-metric" type="button" data-phys-field="averaging">
                  <span class="phys-field-metric__label">AVERAGING</span>
                  <strong class="phys-field-metric__value" data-phys-avg-value>8</strong>
                  <span class="phys-field-metric__detail" data-phys-avg-detail>LINEAR</span>
                </button>
              </article>
              <article class="phys-field-health">
                <h2>CHANNEL HEALTH</h2>
                <div class="phys-field-health__row">${channels}</div>
              </article>
            </div>
            <div class="phys-field-strip" aria-label="Preflight status">${tiles}</div>
            <div class="phys-field-actions">
              <button class="phys-field-arm" type="button" data-phys-action="arm"><i class="ph ph-hammer" aria-hidden="true"></i><span data-phys-arm-label>ARM TEST</span></button>
              <button class="phys-field-abort" type="button" data-phys-action="abort"><i class="ph ph-octagon" aria-hidden="true"></i><span data-phys-abort-label>ABORT</span></button>
            </div>
            <p class="phys-field-safety"><i class="ph ph-info" aria-hidden="true"></i><span data-phys-safety>Confirm the reduced-model impulse is within declared limits before impact.</span></p>
          </section>

          <section class="phys-field-charts" aria-label="Field response charts">
            <article class="phys-field-chart">
              <header><h2>FREQUENCY RESPONSE</h2><span><strong data-phys-frequency-chart>—</strong> model Hz</span></header>
              <canvas data-phys-chart="frequency" role="img" aria-label="Frequency response spectrum"></canvas>
            </article>
            <article class="phys-field-chart">
              <header><h2>COHERENCE</h2><span>Threshold <strong data-phys-coherence-chart>—</strong></span></header>
              <canvas data-phys-chart="coherence" role="img" aria-label="Relative spectral amplitude"></canvas>
            </article>
          </section>

          <section class="phys-field-captures" aria-label="Event capture strip">
            <header><h2>EVENT / CAPTURE STRIP</h2></header>
            <div class="phys-field-capture-list">
              ${captures}
              <strong class="phys-field-queue"><i class="ph ph-note-pencil" aria-hidden="true"></i><span data-phys-queue>3 ACCEPTED · 0 REJECTED<br>3 ACCEPTED REQUIRED</span></strong>
            </div>
            <button class="phys-field-annotate" type="button" data-phys-action="annotate"><i class="ph ph-bookmark-simple" aria-hidden="true"></i> ADD ANNOTATION MARKER</button>
          </section>
        </div>

        <section class="phys-field-alt" data-phys-alt-view hidden>
          <h2 data-phys-alt-title>CHANNELS</h2>
          <p data-phys-alt-copy></p>
          <div class="phys-field-alt-list" data-phys-alt-list></div>
        </section>

        <nav class="phys-field-nav" aria-label="Field modal views">
          <button class="is-active" type="button" data-phys-view="run" aria-pressed="true"><i class="ph ph-pulse" aria-hidden="true"></i>RUN</button>
          <button type="button" data-phys-view="channels" aria-pressed="false"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i>CHANNELS</button>
          <button type="button" data-phys-view="modes" aria-pressed="false"><i class="ph ph-wave-sine" aria-hidden="true"></i>MODES</button>
          <button type="button" data-phys-view="notes" aria-pressed="false"><i class="ph ph-notebook" aria-hidden="true"></i>NOTES</button>
        </nav>
      </section>
    </div>

    <form class="phys-field-editor" data-phys-editor hidden>
      <header>
        <h3 id="${id('editor-title')}" data-phys-editor-title>TRIGGER</h3>
        <button class="phys-field-icon-btn" type="button" data-phys-action="close-editor" aria-label="Close field editor"><i class="ph ph-x" aria-hidden="true"></i></button>
      </header>
      <label> <span data-phys-editor-value-label>Value</span>
        <input id="${id('editor-value')}" name="value" type="text" autocomplete="off" data-phys-editor-value>
      </label>
      <label> <span data-phys-editor-detail-label>Detail</span>
        <select id="${id('editor-detail')}" name="detail" data-phys-editor-detail></select>
      </label>
      <div class="phys-field-editor__actions">
        <button type="button" data-phys-action="close-editor">CANCEL</button>
        <button class="phys-field-arm" type="submit">APPLY</button>
      </div>
    </form>

    <div class="phys-field-sr" aria-live="polite" data-phys-live></div>
  `;
}

function drawChart(canvas: HTMLCanvasElement, model: PhysicsFieldChartUpdate): void {
  if (canvas.offsetWidth <= 0 || canvas.offsetHeight <= 0) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const displayWidth = width / ratio;
  const displayHeight = height / ratio;
  context.clearRect(0, 0, displayWidth, displayHeight);
  const padding = { left: 38, right: 10, top: 20, bottom: 24 };
  const plotWidth = Math.max(1, displayWidth - padding.left - padding.right);
  const plotHeight = Math.max(1, displayHeight - padding.top - padding.bottom);
  const maxLength = Math.max(0, ...model.series.map((series) => series.values.length));
  const xValues = model.x && model.x.length >= maxLength
    ? model.x
    : Array.from({ length: maxLength }, (_, index) => index);
  const finiteY = model.series.flatMap((series) => series.values).filter(Number.isFinite);
  const finiteX = xValues.filter(Number.isFinite);
  const xMin = model.xDomain?.[0] ?? Math.min(...finiteX, 0);
  const xMax = model.xDomain?.[1] ?? Math.max(...finiteX, 1);
  let yMin = model.yDomain?.[0] ?? Math.min(...finiteY, 0);
  let yMax = model.yDomain?.[1] ?? Math.max(...finiteY, 1);
  if (Math.abs(yMax - yMin) < 1e-9) { yMin -= 1; yMax += 1; }
  const xScale = (value: number): number => padding.left + (value - xMin) / Math.max(1e-9, xMax - xMin) * plotWidth;
  const yScale = (value: number): number => padding.top + (1 - (value - yMin) / Math.max(1e-9, yMax - yMin)) * plotHeight;

  context.font = '10px IBM Plex Mono, SFMono-Regular, monospace';
  context.fillStyle = '#778083';
  context.strokeStyle = '#2b3133';
  context.lineWidth = 1;
  context.setLineDash([]);
  for (let index = 0; index <= 4; index++) {
    const y = padding.top + plotHeight * index / 4;
    context.beginPath(); context.moveTo(padding.left, y + 0.5); context.lineTo(padding.left + plotWidth, y + 0.5); context.stroke();
    context.fillText((yMax - (yMax - yMin) * index / 4).toFixed(Math.abs(yMax - yMin) <= 2 ? 1 : 0), 2, y + 3);
  }
  for (let index = 0; index <= 5; index++) {
    const x = padding.left + plotWidth * index / 5;
    context.beginPath(); context.moveTo(x + 0.5, padding.top); context.lineTo(x + 0.5, padding.top + plotHeight); context.stroke();
  }

  model.series.forEach((series, seriesIndex) => {
    context.strokeStyle = series.color ?? (seriesIndex === 0 ? CHART_CYAN : '#9b59ff');
    context.lineWidth = 1.6;
    context.setLineDash(series.dashed ? [5, 4] : []);
    context.beginPath();
    series.values.forEach((value, index) => {
      const x = xScale(xValues[index] ?? index);
      const y = yScale(value);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  });
  context.setLineDash([]);
  if (model.cursorX !== undefined) {
    context.strokeStyle = '#ff7900';
    context.setLineDash([3, 3]);
    const cursor = xScale(model.cursorX);
    context.beginPath(); context.moveTo(cursor, padding.top); context.lineTo(cursor, padding.top + plotHeight); context.stroke();
    context.setLineDash([]);
  }
  context.fillStyle = '#8e9699';
  if (model.xLabel) context.fillText(model.xLabel, padding.left + plotWidth / 2 - context.measureText(model.xLabel).width / 2, displayHeight - 5);
  if (model.yLabel) {
    context.save();
    context.translate(10, padding.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(model.yLabel, -context.measureText(model.yLabel).width / 2, 0);
    context.restore();
  }
}

/**
 * Portrait field-modal editor matching `physics-workbench-field-modal-v2.png`.
 * Overlay click and Escape dismiss the dialog; `update()` patches live values.
 */
export function createPhysicsFieldModal(options: PhysicsFieldModalOptions = {}): PhysicsFieldModalController {
  const prefix = options.idPrefix ?? 'phys-field';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error('Physics field modal idPrefix must begin with a letter and contain only letters, numbers, hyphens, or underscores.');
  }

  const closeOnOverlay = options.closeOnOverlay !== false;
  const closeOnEscape = options.closeOnEscape !== false;
  let callbacks: PhysicsFieldModalCallbacks = options.callbacks ?? {};
  let state = defaultState();
  let frequencyChart = defaultFrequencyChart();
  let coherenceChart = defaultCoherenceChart();
  let destroyed = false;
  let previousFocus: HTMLElement | null = null;
  let viewport: HTMLElement | null = null;
  let viewportMarker: Comment | null = null;
  let handleDragging = false;
  let handleStartY = 0;

  const root = document.createElement('dialog');
  root.className = 'phys-field-modal';
  root.id = `${prefix}-root`;
  root.setAttribute('aria-labelledby', `${prefix}-title`);
  root.innerHTML = markup(prefix);
  (options.mount ?? document.body).append(root);

  const liveRegion = required<HTMLElement>(root, '[data-phys-live]');
  const editor = required<HTMLFormElement>(root, '[data-phys-editor]');
  const editorValue = required<HTMLInputElement>(root, '[data-phys-editor-value]');
  const editorDetail = required<HTMLSelectElement>(root, '[data-phys-editor-detail]');
  const altView = required<HTMLElement>(root, '[data-phys-alt-view]');
  const altList = required<HTMLElement>(root, '[data-phys-alt-list]');
  const sheet = required<HTMLElement>(root, '[data-phys-sheet]');
  const frequencyCanvas = required<HTMLCanvasElement>(root, '[data-phys-chart="frequency"]');
  const coherenceCanvas = required<HTMLCanvasElement>(root, '[data-phys-chart="coherence"]');
  const abortController = new AbortController();
  const eventOptions: AddEventListenerOptions = { signal: abortController.signal };

  const announce = (message: string): void => {
    liveRegion.textContent = '';
    window.setTimeout(() => { if (!destroyed) liveRegion.textContent = message; }, 20);
  };

  const setText = (selector: string, value: string): void => {
    for (const node of root.querySelectorAll<HTMLElement>(selector)) node.textContent = value;
  };

  const drawCharts = (): void => {
    drawChart(frequencyCanvas, frequencyChart);
    drawChart(coherenceCanvas, coherenceChart);
  };

  const closeEditor = (): void => {
    state = { ...state, editorField: null };
    editor.hidden = true;
    for (const metric of root.querySelectorAll('.phys-field-metric, .phys-field-tile')) {
      metric.classList.remove('is-active');
    }
  };

  const fieldValue = (field: PhysicsFieldId): { value: string; detail: string } => {
    switch (field) {
      case 'trigger': return { value: state.triggerValue, detail: state.triggerDetail };
      case 'inputRange': return { value: state.inputRangeValue, detail: state.inputRangeDetail };
      case 'averaging': return { value: state.averagingValue, detail: state.averagingDetail };
      case 'coherenceThreshold':
        return { value: state.statusTiles.find((tile) => tile.id === 'coherence')?.value ?? '0.80', detail: 'DERIVED' };
      default: {
        const exhaustive: never = field;
        return exhaustive;
      }
    }
  };

  const openEditor = (field: PhysicsFieldId): void => {
    const copy = fieldEditorCopy(field);
    const current = fieldValue(field);
    const currentValue = current.value;
    const currentDetail = current.detail;
    state = { ...state, editorField: field };
    editor.hidden = false;
    setText('[data-phys-editor-title]', copy.title);
    setText('[data-phys-editor-value-label]', copy.valueLabel);
    setText('[data-phys-editor-detail-label]', copy.detailLabel);
    editorValue.value = currentValue;
    editorDetail.replaceChildren();
    for (const detail of copy.details) {
      const option = document.createElement('option');
      option.value = detail;
      option.textContent = detail;
      option.selected = detail === currentDetail;
      editorDetail.append(option);
    }
    for (const metric of root.querySelectorAll<HTMLElement>('[data-phys-field]')) {
      metric.classList.toggle('is-active', metric.dataset.physField === field);
    }
    editorValue.focus();
    callbacks.onFieldActivate?.(field);
    announce(`${copy.title} editor open.`);
  };

  const renderChannels = (): void => {
    for (const channel of state.channels) {
      for (const node of root.querySelectorAll<HTMLElement>(`[data-phys-channel="${CSS.escape(channel.id)}"], [data-phys-sensor="${CSS.escape(channel.id)}"]`)) {
        node.dataset.channelStatus = channel.status;
        const label = node.querySelector('b');
        if (label) label.textContent = channel.label;
        const value = node.querySelector('[data-phys-channel-value], small');
        if (value && node.matches('[data-phys-channel]')) value.textContent = channel.value;
        const icon = node.querySelector('i.ph');
        if (icon) icon.className = `ph ${channelIcon(channel.status)}`;
        if (node.matches('[data-phys-channel]')) {
          node.setAttribute('aria-label', `Channel ${channel.label}, ${channel.status}, ${channel.value}`);
        }
      }
    }
    const faulted = state.channels.some((channel) => channel.status === 'fault' || channel.status === 'offline');
    const warned = state.channels.some((channel) => channel.status === 'warning');
    setText('[data-phys-health-summary]', faulted ? 'FAULT' : warned ? 'WARNING' : 'NOMINAL');
  };

  const renderTiles = (): void => {
    for (const tile of state.statusTiles) {
      const node = root.querySelector<HTMLElement>(`[data-phys-tile="${CSS.escape(tile.id)}"]`);
      if (!node) continue;
      node.dataset.tone = tile.tone;
      const label = node.querySelector('.phys-field-tile__label');
      const value = node.querySelector('.phys-field-tile__value');
      const icon = node.querySelector('i.ph');
      if (label) label.textContent = tile.label;
      if (value) value.textContent = tile.value;
      if (icon) icon.className = `ph ${tile.icon}`;
      node.setAttribute('aria-label', `${tile.label}: ${tile.value}`);
    }
  };

  const renderCaptures = (): void => {
    const slots = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-phys-capture]'));
    slots.forEach((slot, index) => {
      const capture = state.captures[index] ?? { id: String(index + 1).padStart(3, '0'), label: String(index + 1).padStart(3, '0'), sampleCount: 0, status: 'empty' as const };
      slot.classList.toggle('is-empty', capture.status === 'empty');
      slot.classList.toggle('is-active', capture.status === 'armed');
      slot.classList.toggle('is-accepted', capture.status === 'accepted');
      slot.classList.toggle('is-rejected', capture.status === 'rejected');
      slot.disabled = capture.status === 'empty';
      slot.setAttribute('aria-label', `${capture.label}, ${capture.status}${capture.sampleCount ? `, ${capture.sampleCount} samples` : ''}`);
      const label = slot.querySelector('strong');
      const status = slot.querySelector('span');
      if (label) label.textContent = capture.label;
      if (status) status.textContent = captureStatusText(capture);
      slot.querySelector('i')?.remove();
      const iconName = captureIcon(capture.status);
      if (iconName) {
        const icon = document.createElement('i');
        icon.className = `ph ${iconName}`;
        icon.setAttribute('aria-hidden', 'true');
        slot.append(icon);
      }
    });
    const accepted = state.captures.filter((capture) => capture.status === 'accepted').length;
    const rejected = state.captures.filter((capture) => capture.status === 'rejected').length;
    const queue = state.captureQueue.includes('\n')
      ? state.captureQueue
      : `${accepted} ACCEPTED · ${rejected} REJECTED\n${accepted >= 3 ? 'PROCESSING READY' : `${3 - accepted} ACCEPTED REQUIRED`}`;
    for (const node of root.querySelectorAll<HTMLElement>('[data-phys-queue]')) {
      node.replaceChildren();
      const lines = queue.split('\n');
      lines.forEach((line, index) => {
        if (index > 0) node.append(document.createElement('br'));
        node.append(line);
      });
    }
  };

  const renderAltView = (): void => {
    const view = state.activeView;
    altView.hidden = view === 'run';
    if (view === 'run') return;
    const title = required<HTMLElement>(root, '[data-phys-alt-title]');
    const copy = required<HTMLElement>(root, '[data-phys-alt-copy]');
    title.textContent = viewLabel(view).toUpperCase();
    altList.replaceChildren();
    const appendRow = (icon: string, heading: string, detail: string, trailing?: string): HTMLButtonElement => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'phys-field-alt-row';
      const glyph = document.createElement('i');
      glyph.className = `ph ${icon}`;
      glyph.setAttribute('aria-hidden', 'true');
      const copyBlock = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = heading;
      const small = document.createElement('small');
      small.textContent = detail;
      copyBlock.append(strong, small);
      row.append(glyph, copyBlock);
      if (trailing !== undefined) {
        const extra = document.createElement('span');
        extra.textContent = trailing;
        row.append(extra);
      }
      altList.append(row);
      return row;
    };
    switch (view) {
      case 'channels':
        copy.textContent = 'Five derived taps of one solver probe. These are not independent accelerometers.';
        for (const channel of state.channels) appendRow(channelIcon(channel.status), channel.label, channel.status, channel.value);
        return;
      case 'modes':
        copy.textContent = 'Peak list from the reduced-order spectrum. Damping stays unavailable unless both half-power crossings exist.';
        for (const mode of state.modes) {
          const row = appendRow('ph-wave-sine', mode.label, mode.frequencyLabel, mode.dampingLabel);
          row.classList.toggle('is-active', mode.active);
          row.disabled = !mode.available;
          row.dataset.physMode = mode.id;
          row.setAttribute('aria-pressed', String(mode.active));
        }
        return;
      case 'notes':
        copy.textContent = 'Annotation markers are presentation-only and do not enter the numerical record.';
        if (state.notes.length === 0) {
          const empty = document.createElement('p');
          empty.textContent = 'No annotation markers in this capture set.';
          altList.append(empty);
          return;
        }
        for (const note of state.notes) appendRow('ph-bookmark-simple', note.label, note.detail);
        return;
      default: {
        const exhaustive: never = view;
        return exhaustive;
      }
    }
  };

  const render = (): void => {
    const presentation = runPresentation(state.runState);
    root.dataset.runState = state.runState;
    root.dataset.view = state.activeView;
    setText('[data-phys-title]', state.title);
    setText('[data-phys-project]', state.projectLabel);
    setText('[data-phys-test]', state.testLabel);
    setText('[data-phys-clock]', state.clockLabel);
    setText('[data-phys-readiness]', state.readiness || presentation.readiness);
    setText('[data-phys-run-state]', presentation.label);
    setText('[data-phys-run-message]', state.runMessage || presentation.message);
    setText('[data-phys-trigger-value]', state.triggerValue);
    setText('[data-phys-trigger-detail]', state.triggerDetail);
    setText('[data-phys-range-value]', state.inputRangeValue);
    setText('[data-phys-range-detail]', state.inputRangeDetail);
    setText('[data-phys-avg-value]', state.averagingValue);
    setText('[data-phys-avg-detail]', state.averagingDetail);
    setText('[data-phys-safety]', state.safetyCopy);
    setText('[data-phys-frequency]', state.frequencyLabel);
    setText('[data-phys-frequency-chart]', state.frequencyLabel);
    setText('[data-phys-damping]', state.dampingLabel);
    setText('[data-phys-coherence-chart]', state.coherenceLabel);
    setText('[data-phys-arm-label]', state.armLabel || presentation.armLabel);
    setText('[data-phys-abort-label]', state.abortLabel);
    setText('[data-phys-provenance]', state.provenance);
    setText('[data-phys-mode-title]', state.modeTitle);
    const syncChip = required<HTMLElement>(root, '[data-phys-chip="sync"] span');
    syncChip.textContent = state.synced ? 'SYNCED' : 'OFFLINE';
    required<HTMLElement>(root, '[data-phys-chip="sync"]').classList.toggle('phys-field-chip--fault', !state.synced);
    const safeChip = required<HTMLElement>(root, '[data-phys-chip="safe"]');
    safeChip.classList.toggle('phys-field-chip--safe', presentation.chipTone === 'safe');
    safeChip.classList.toggle('phys-field-chip--caution', presentation.chipTone === 'caution');
    safeChip.classList.toggle('phys-field-chip--fault', presentation.chipTone === 'fault');
    const abortButton = required<HTMLButtonElement>(root, '[data-phys-action="abort"]');
    abortButton.disabled = !state.abortEnabled || !presentation.abortEnabled;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-phys-view]')) {
      const active = button.dataset.physView === state.activeView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-phys-mode-dot]')) {
      const mode = state.modes.find((item) => item.id === button.dataset.physModeDot);
      button.classList.toggle('is-active', Boolean(mode?.active));
      button.setAttribute('aria-pressed', String(Boolean(mode?.active)));
      button.disabled = !mode?.available;
    }
    renderChannels();
    renderTiles();
    renderCaptures();
    renderAltView();
    window.requestAnimationFrame(drawCharts);
  };

  const applyUpdate = (update: PhysicsFieldModalUpdate): void => {
    if (destroyed) return;
    if (update.runState && !PHYSICS_FIELD_RUN_STATES.includes(update.runState)) return;
    if (update.activeView && !PHYSICS_FIELD_MODAL_VIEWS.includes(update.activeView)) return;
    const {
      frequencyChart: nextFrequencyChart,
      coherenceChart: nextCoherenceChart,
      ...rest
    } = update;
    const nextState: PhysicsFieldRunState = rest.runState ?? state.runState;
    const presentation = runPresentation(nextState);
    state = {
      ...state,
      ...rest,
      runState: nextState,
      runMessage: rest.runMessage ?? state.runMessage,
      readiness: rest.readiness ?? (rest.runState ? presentation.readiness : state.readiness),
      armLabel: rest.armLabel ?? (rest.runState ? presentation.armLabel : state.armLabel),
      abortEnabled: rest.abortEnabled ?? (rest.runState ? presentation.abortEnabled : state.abortEnabled),
      channels: rest.channels ?? state.channels,
      statusTiles: rest.statusTiles ?? state.statusTiles,
      captures: rest.captures ?? state.captures,
      modes: rest.modes ?? state.modes,
      notes: rest.notes ?? state.notes,
      editorField: rest.editorField === undefined ? state.editorField : rest.editorField,
    };
    if (nextFrequencyChart) frequencyChart = nextFrequencyChart;
    if (nextCoherenceChart) coherenceChart = nextCoherenceChart;
    render();
  };

  const setView = (view: PhysicsFieldModalView): void => {
    if (state.activeView === view) return;
    closeEditor();
    state = { ...state, activeView: view };
    render();
    callbacks.onViewChange?.(view);
    announce(`${viewLabel(view)} view selected.`);
  };

  const restoreViewport = (): void => {
    if (viewport && viewportMarker?.parentNode) {
      viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
    }
    viewport?.classList.remove('phys-field-attached-viewport');
  };

  const attachViewport = (nextViewport: HTMLElement | null): void => {
    if (destroyed) return;
    restoreViewport();
    viewportMarker?.remove();
    viewport = nextViewport;
    if (!nextViewport) {
      viewportMarker = null;
      return;
    }
    viewportMarker = document.createComment(`${prefix}-viewport-origin`);
    nextViewport.parentNode?.insertBefore(viewportMarker, nextViewport);
    required<HTMLElement>(root, '[data-phys-viewport]').append(nextViewport);
    nextViewport.classList.add('phys-field-attached-viewport');
  };

  const close = (): void => {
    if (destroyed || !root.open) return;
    closeEditor();
    sheet.style.transform = '';
    root.close();
  };

  const open = (update?: PhysicsFieldModalUpdate): void => {
    if (destroyed) return;
    if (update) applyUpdate(update);
    if (root.open) {
      render();
      return;
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.showModal();
    render();
    const arm = root.querySelector<HTMLButtonElement>('[data-phys-action="arm"]');
    arm?.focus({ preventScroll: true });
    callbacks.onOpen?.();
    announce(`${state.title} open.`);
  };

  const focusables = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => !element.closest('[hidden]'));

  root.addEventListener('click', (event) => {
    if (closeOnOverlay && event.target === root) {
      close();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const actionButton = target?.closest<HTMLButtonElement>('[data-phys-action]');
    const action = actionButton?.dataset.physAction;
    if (action === 'arm') { void callbacks.onArm?.(); return; }
    if (action === 'abort') { void callbacks.onAbort?.(); return; }
    if (action === 'orbit') { callbacks.onOrbit?.(); announce('Specimen view reset.'); return; }
    if (action === 'menu') { callbacks.onMenu?.(); return; }
    if (action === 'annotate') { callbacks.onAnnotation?.(); announce('Annotation marker requested.'); return; }
    if (action === 'close-editor' || action === 'handle') {
      if (action === 'handle') close();
      else closeEditor();
      return;
    }
    const fieldButton = target?.closest<HTMLElement>('[data-phys-field]');
    if (fieldButton && isFieldId(fieldButton.dataset.physField)) {
      openEditor(fieldButton.dataset.physField);
      return;
    }
    const viewButton = target?.closest<HTMLButtonElement>('[data-phys-view]');
    if (viewButton && isViewId(viewButton.dataset.physView)) {
      setView(viewButton.dataset.physView);
      return;
    }
    const captureButton = target?.closest<HTMLButtonElement>('[data-phys-capture]');
    if (captureButton) {
      const index = Number(captureButton.dataset.physCapture);
      const capture = state.captures[index];
      if (capture) callbacks.onCaptureSelect?.(index, capture);
      return;
    }
    const modeButton = target?.closest<HTMLButtonElement>('[data-phys-mode-dot], [data-phys-mode]');
    const modeId = modeButton?.dataset.physModeDot ?? modeButton?.dataset.physMode;
    if (modeId) {
      state = {
        ...state,
        modes: state.modes.map((mode) => ({ ...mode, active: mode.id === modeId })),
        modeTitle: state.modes.find((mode) => mode.id === modeId)?.label.toUpperCase() ?? state.modeTitle,
      };
      render();
      callbacks.onModeSelect?.(modeId);
    }
  }, eventOptions);

  root.addEventListener('cancel', (event) => {
    if (state.editorField) {
      event.preventDefault();
      closeEditor();
      return;
    }
    if (!closeOnEscape) event.preventDefault();
  }, eventOptions);

  root.addEventListener('close', () => {
    closeEditor();
    sheet.style.transform = '';
    previousFocus?.focus({ preventScroll: true });
    previousFocus = null;
    callbacks.onClose?.();
  }, eventOptions);

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !root.open) return;
    const nodes = focusables();
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, eventOptions);

  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = state.editorField;
    if (!field) return;
    const value = editorValue.value.trim();
    const detail = editorDetail.value;
    const change = { field, value, detail } as const;
    if (field === 'trigger') state = { ...state, triggerValue: value, triggerDetail: detail };
    else if (field === 'inputRange') state = { ...state, inputRangeValue: value, inputRangeDetail: detail };
    else if (field === 'averaging') state = { ...state, averagingValue: value, averagingDetail: detail };
    else if (field === 'coherenceThreshold') {
      state = {
        ...state,
        statusTiles: state.statusTiles.map((tile) => tile.id === 'coherence' ? { ...tile, value } : tile),
        coherenceLabel: value,
      };
    } else {
      const exhaustive: never = field;
      return exhaustive;
    }
    closeEditor();
    render();
    callbacks.onFieldChange?.(change);
    announce(`${fieldEditorCopy(field).title} updated.`);
  }, eventOptions);

  const handle = required<HTMLButtonElement>(root, '[data-phys-action="handle"]');
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    handleDragging = true;
    handleStartY = event.clientY;
    handle.setPointerCapture(event.pointerId);
  }, eventOptions);
  handle.addEventListener('pointermove', (event) => {
    if (!handleDragging) return;
    const delta = Math.max(0, event.clientY - handleStartY);
    sheet.style.transform = `translateY(${delta}px)`;
  }, eventOptions);
  const endHandleDrag = (event: PointerEvent): void => {
    if (!handleDragging) return;
    handleDragging = false;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    const delta = event.clientY - handleStartY;
    sheet.style.transform = '';
    if (delta > 80) close();
  };
  handle.addEventListener('pointerup', endHandleDrag, eventOptions);
  handle.addEventListener('pointercancel', endHandleDrag, eventOptions);

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => drawCharts());
  resizeObserver?.observe(frequencyCanvas);
  resizeObserver?.observe(coherenceCanvas);

  if (options.initial) applyUpdate(options.initial);
  else render();
  if (options.viewport) attachViewport(options.viewport);

  return {
    root,
    open,
    close,
    update: applyUpdate,
    isOpen: () => root.open,
    getState: () => state,
    attachViewport,
    setCallbacks: (next) => { callbacks = next; },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      abortController.abort();
      resizeObserver?.disconnect();
      if (root.open) root.close();
      restoreViewport();
      viewportMarker?.remove();
      root.remove();
    },
  };
}
