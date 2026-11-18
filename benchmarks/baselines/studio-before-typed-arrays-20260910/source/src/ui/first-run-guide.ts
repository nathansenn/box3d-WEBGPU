import './first-run-guide.css';

export const FIRST_RUN_GUIDE_STORAGE_KEY = 'box3d-guide-dismissed';
export const FIRST_RUN_GUIDE_CHANGED_EVENT = 'box3d-first-run-guide';

export const FIRST_RUN_GUIDE_COPY = {
  title: 'How to use',
  dismiss: 'Got it',
  dismissAria: 'Dismiss how to use',
  play: 'Play',
  applyForce: 'Apply force',
  reset: 'Reset',
  steps: [
    'Pick a specimen',
    'Watch it play (or hit Play)',
    'Drag to look around / Apply force to hit it',
  ],
} as const;

export type FirstRunGuideAction = 'play' | 'applyForce' | 'reset';

export type FirstRunGuideCallbacks = {
  readonly play: () => void;
  readonly applyForce: () => void;
  readonly reset: () => void;
};

export type FirstRunGuideOptions = {
  readonly mount: HTMLElement;
  readonly callbacks: FirstRunGuideCallbacks;
};

export type FirstRunGuideController = {
  readonly root: HTMLElement | null;
  readonly dismissed: boolean;
  dismiss(): void;
  destroy(): void;
};

const DISMISSED_VALUE = '1';

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(FIRST_RUN_GUIDE_STORAGE_KEY) === DISMISSED_VALUE;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    globalThis.localStorage?.setItem(FIRST_RUN_GUIDE_STORAGE_KEY, DISMISSED_VALUE);
  } catch {
    /* private mode / quota */
  }
}

function dispatchGuideChanged(): void {
  globalThis.dispatchEvent?.(new Event(FIRST_RUN_GUIDE_CHANGED_EVENT));
}

export function isFirstRunGuideDismissed(): boolean {
  return readDismissed();
}

export function persistFirstRunGuideDismissed(): void {
  writeDismissed();
  dispatchGuideChanged();
}

export function clearFirstRunGuideDismissed(): void {
  try {
    globalThis.localStorage?.removeItem(FIRST_RUN_GUIDE_STORAGE_KEY);
  } catch {
    /* private mode / quota */
  }
  dispatchGuideChanged();
}

function invokeAction(callbacks: FirstRunGuideCallbacks, action: FirstRunGuideAction): void {
  switch (action) {
    case 'play':
      callbacks.play();
      return;
    case 'applyForce':
      callbacks.applyForce();
      return;
    case 'reset':
      callbacks.reset();
      return;
    default: {
      const _never: never = action;
      throw new Error(`Unhandled first-run action: ${String(_never)}`);
    }
  }
}

function buildCard(): HTMLElement {
  const copy = FIRST_RUN_GUIDE_COPY;
  const root = document.createElement('aside');
  root.className = 'frg';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', copy.title);

  const card = document.createElement('div');
  card.className = 'frg-card';

  const header = document.createElement('header');
  header.className = 'frg-head';

  const title = document.createElement('h2');
  title.className = 'frg-title';
  title.textContent = copy.title;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'frg-dismiss';
  dismiss.dataset.frgDismiss = '';
  dismiss.setAttribute('aria-label', copy.dismissAria);
  dismiss.textContent = copy.dismiss;

  header.append(title, dismiss);

  const list = document.createElement('ol');
  list.className = 'frg-steps';
  for (const step of copy.steps) {
    const item = document.createElement('li');
    item.textContent = step;
    list.append(item);
  }

  const actions = document.createElement('div');
  actions.className = 'frg-actions';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'Try it now');

  const actionButtons: ReadonlyArray<{ action: FirstRunGuideAction; label: string; kind: string }> = [
    { action: 'play', label: copy.play, kind: 'primary' },
    { action: 'applyForce', label: copy.applyForce, kind: 'accent' },
    { action: 'reset', label: copy.reset, kind: 'ghost' },
  ];
  for (const spec of actionButtons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `frg-btn frg-btn-${spec.kind}`;
    button.dataset.frgAction = spec.action;
    button.textContent = spec.label;
    actions.append(button);
  }

  card.append(header, list, actions);
  root.append(card);
  return root;
}

function idleController(): FirstRunGuideController {
  return {
    root: null,
    dismissed: true,
    dismiss(): void {},
    destroy(): void {},
  };
}

export function mountFirstRunGuide(options: FirstRunGuideOptions): FirstRunGuideController {
  if (readDismissed()) return idleController();

  const root = buildCard();
  options.mount.append(root);

  const abort = new AbortController();
  const eventOptions: AddEventListenerOptions = { signal: abort.signal };
  let dismissed = false;

  const destroy = (): void => {
    abort.abort();
    root.remove();
  };

  const dismiss = (propagate = true): void => {
    if (dismissed) return;
    dismissed = true;
    if (propagate) persistFirstRunGuideDismissed();
    destroy();
  };

  globalThis.addEventListener(FIRST_RUN_GUIDE_CHANGED_EVENT, () => {
    if (readDismissed()) dismiss(false);
  }, eventOptions);

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-frg-dismiss]')) {
      dismiss();
      return;
    }
    const actionHost = target.closest('[data-frg-action]');
    if (!(actionHost instanceof HTMLElement)) return;
    const action = actionHost.dataset.frgAction;
    if (action === 'play' || action === 'applyForce' || action === 'reset') {
      invokeAction(options.callbacks, action);
    }
  }, eventOptions);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismiss();
  }, eventOptions);

  return {
    root,
    get dismissed() {
      return dismissed;
    },
    dismiss,
    destroy,
  };
}
