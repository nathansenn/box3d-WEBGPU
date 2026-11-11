/**
 * The Lab's scene panel: open a scene or geometry file (button or drag and
 * drop), pick an example, copy a share link, download the scene and reset it.
 * It also shows what was loaded, the import notes and any error.
 *
 * Every string that comes from a file, a link or the address is written with
 * textContent; nothing here builds markup from input.
 */
import './scene-panel.css';
import { EXAMPLE_SCENE_NAMES, EXAMPLE_SCENE_TITLES } from './scene-loading.ts';

export interface ScenePanelCallbacks {
  onFiles(files: File[]): void;
  onExample(name: string): void;
  onCopyLink(): void;
  onDownload(): void;
  onReset(): void;
  /** Start an empty SI scene in the editor. */
  onNewScene(): void;
  /** Start or stop editing the scene on screen. */
  onEdit(): void;
}

export interface ScenePanelScene {
  readonly title: string;
  readonly summary: string;
  readonly notes: readonly string[];
}

export interface ScenePanel {
  showScene(scene: ScenePanelScene): void;
  /** No SI scene is on screen: the share, download and reset buttons are disabled. */
  showNoScene(): void;
  showError(title: string, lines: readonly string[], more: number, kept: string): void;
  clearError(): void;
  setStatus(text: string): void;
  openFileDialog(): void;
  expand(): void;
  scaleToFit(): boolean;
  /** Where the scene editor puts its controls. */
  readonly editorMount: HTMLElement;
  /** The editor is open: the panel is taller, and the Edit button stops editing. */
  setEditing(editing: boolean): void;
}

const ACCEPT = '.json,.obj,.stl,.glb,.gltf,.bin,application/json,model/gltf-binary,model/gltf+json,model/stl,model/obj';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createScenePanel(callbacks: ScenePanelCallbacks): ScenePanel {
  const panel = element('section', 'lab-scene-panel');
  panel.id = 'lab-scene-panel';
  panel.setAttribute('aria-label', 'Scene: open, share and download');
  panel.dataset.collapsed = 'true';

  const toggle = element('button', 'lab-scene-toggle', 'Scenes');
  toggle.type = 'button';
  toggle.id = 'lab-scene-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'lab-scene-body');
  const setCollapsed = (collapsed: boolean): void => {
    panel.dataset.collapsed = String(collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? 'Scenes' : 'Hide';
    toggle.title = collapsed ? 'Open a scene or geometry file, pick an example, share the scene' : 'Hide the scene panel';
  };
  toggle.addEventListener('click', () => setCollapsed(panel.dataset.collapsed !== 'true'));

  const heading = element('p', 'lab-scene-heading', 'Scene · SI units');
  const title = element('h2', 'lab-scene-title', 'No scene file loaded');
  title.id = 'lab-scene-title';
  const summary = element('p', 'lab-scene-summary', 'Open a scene (.json) or geometry (.obj, .stl, .glb, .gltf), drop a file on the page, or pick an example.');
  summary.id = 'lab-scene-summary';
  const notes = element('ul', 'lab-scene-notes');
  notes.id = 'lab-scene-notes';

  const error = element('div', 'lab-scene-error');
  error.id = 'lab-scene-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const file = element('input', 'lab-scene-file');
  file.type = 'file';
  file.id = 'lab-scene-file';
  file.accept = ACCEPT;
  file.multiple = true;
  file.tabIndex = -1;
  file.setAttribute('aria-hidden', 'true');
  file.addEventListener('change', () => {
    const files = Array.from(file.files ?? []);
    file.value = '';
    if (files.length > 0) callbacks.onFiles(files);
  });

  const button = (id: string, label: string, hint: string, action: () => void): HTMLButtonElement => {
    const node = element('button', '', label);
    node.type = 'button';
    node.id = id;
    node.title = hint;
    node.addEventListener('click', action);
    return node;
  };
  const open = button('lab-scene-open', 'Open file…', 'Open a scene (.json) or geometry (.obj, .stl, .glb, .gltf)', () => file.click());
  const copy = button('lab-scene-copy', 'Copy share link', 'Copy a link that carries the whole scene as it is now', callbacks.onCopyLink);
  const download = button('lab-scene-download', 'Download scene (.json)', 'Save the scene as it is now', callbacks.onDownload);
  const reset = button('lab-scene-reset', 'Reset', 'Load the scene again from its start', callbacks.onReset);
  const create = button('lab-scene-new', 'New scene', 'Start an empty SI scene with a ground slab in the editor', callbacks.onNewScene);
  const edit = button('lab-scene-edit', 'Edit', 'Edit this scene: add, move and change bodies and joints', callbacks.onEdit);
  edit.setAttribute('aria-pressed', 'false');
  const actions = element('div', 'lab-scene-actions');
  actions.append(create, open, edit, copy, download, reset);
  const editorMount = element('div', 'lab-scene-editor-mount');
  editorMount.id = 'lab-scene-editor-mount';

  const row = element('div', 'lab-scene-row');
  const examples = element('select', '');
  examples.id = 'lab-scene-example';
  examples.setAttribute('aria-label', 'Example scenes');
  const placeholder = element('option', '', 'Example scenes…');
  placeholder.value = '';
  examples.append(placeholder);
  for (const name of EXAMPLE_SCENE_NAMES) {
    const option = element('option', '', EXAMPLE_SCENE_TITLES[name] ?? name);
    option.value = name;
    examples.append(option);
  }
  examples.addEventListener('change', () => {
    const name = examples.value;
    examples.value = '';
    if (name) callbacks.onExample(name);
  });
  const fitLabel = element('label', '');
  fitLabel.title = 'Read large files as millimetres or scale them to about 2 m, so a CAD part is not a kilometre across. Applies to the next geometry file.';
  const fit = element('input', '');
  fit.type = 'checkbox';
  fit.id = 'lab-scene-fit';
  fit.checked = true;
  fitLabel.append(fit, document.createTextNode('Scale imported geometry to fit'));
  row.append(examples, fitLabel);

  const status = element('p', 'lab-scene-status');
  status.id = 'lab-scene-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const body = element('div', '');
  body.id = 'lab-scene-body';
  body.append(heading, title, summary, error, notes, actions, row, status, file, editorMount);
  panel.append(toggle, body);
  document.body.append(panel);

  const drop = element('div', 'lab-scene-drop', 'Drop a scene (.json) or geometry (.obj, .stl, .glb, .gltf) to open it');
  drop.hidden = true;
  document.body.append(drop);
  const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  let depth = 0;
  window.addEventListener('dragenter', (event) => { if (hasFiles(event)) { depth++; drop.hidden = false; } });
  window.addEventListener('dragleave', (event) => { if (hasFiles(event)) { depth = Math.max(0, depth - 1); if (depth === 0) drop.hidden = true; } });
  window.addEventListener('dragover', (event) => { if (hasFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    drop.hidden = true;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) callbacks.onFiles(files);
  });

  const setSceneButtons = (enabled: boolean): void => { copy.disabled = !enabled; download.disabled = !enabled; reset.disabled = !enabled; edit.disabled = !enabled; };
  setSceneButtons(false);
  setCollapsed(true);

  return {
    showScene(scene) {
      title.textContent = scene.title;
      summary.textContent = scene.summary;
      notes.replaceChildren(...scene.notes.map(note => element('li', '', note)));
      setSceneButtons(true);
      setCollapsed(false);
    },
    showNoScene() {
      title.textContent = 'No scene file loaded';
      summary.textContent = 'Open a scene (.json) or geometry (.obj, .stl, .glb, .gltf), drop a file on the page, or pick an example.';
      notes.replaceChildren();
      setSceneButtons(false);
    },
    showError(errorTitle, lines, more, kept) {
      const list = element('ul', '');
      list.append(...lines.map(line => element('li', '', line)));
      const children: Node[] = [element('strong', '', errorTitle), list];
      if (more > 0) children.push(element('p', '', `…and ${more} more ${more === 1 ? 'problem' : 'problems'}.`));
      children.push(element('p', '', kept));
      error.replaceChildren(...children);
      error.hidden = false;
      status.textContent = '';
      setCollapsed(false);
    },
    clearError() { error.hidden = true; error.replaceChildren(); },
    setStatus(text) { status.textContent = text; },
    openFileDialog() { setCollapsed(false); file.click(); },
    expand() { setCollapsed(false); },
    scaleToFit() { return fit.checked; },
    editorMount,
    setEditing(editing) {
      panel.dataset.editing = String(editing);
      edit.textContent = editing ? 'Stop editing' : 'Edit';
      edit.title = editing ? 'Close the editor and keep the scene on screen' : 'Edit this scene: add, move and change bodies and joints';
      edit.setAttribute('aria-pressed', String(editing));
      copy.title = editing ? 'Copy a link that carries the edited scene (its initial state)' : 'Copy a link that carries the whole scene as it is now';
      download.title = editing ? 'Save the edited scene (its initial state)' : 'Save the scene as it is now';
      reset.title = editing ? 'Return to the edited initial state' : 'Load the scene again from its start';
      if (editing) setCollapsed(false);
    },
  };
}
