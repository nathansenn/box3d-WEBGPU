// Draws ./benchmarks.json (written by benchmarks/engines/report.mjs) as sortable tables and bar charts.
// No dependencies, no inline code, no requests other than the JSON next to this file.
const SCHEMA = 'box3d-engine-comparison', VERSION = 1, SVG = 'http://www.w3.org/2000/svg';

/** el('td', {class: 'num'}, 'text', node, ...) */
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) if (value !== null && value !== undefined && value !== false) node.setAttribute(name, value === true ? '' : value);
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
}
function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) if (value !== null && value !== undefined) node.setAttribute(name, value);
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
}
/** Text with `code spans` as nodes. The JSON is data, so it only ever becomes text nodes. */
const rich = text => String(text).split('`').map((part, i) => i % 2 ? el('code', {}, part) : part);
const fmt = value => value === null || value === undefined ? 'n/a' : Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : Math.abs(value) >= 1 ? value.toFixed(2) : String(Number(value.toPrecision(2)));
const kib = bytes => `${Math.round(bytes / 1024).toLocaleString('en-US')} KiB`;
const ratioText = value => `${value >= 10 ? value.toFixed(0) : value.toFixed(2)}x`;

/**
 * A table whose columns sort. columns: [{label, num, key(row) -> number|string|null, cell(row) -> text or nodes, title}].
 * A null key always sorts last.
 */
function sortable(table, caption, columns, rows, rowAttributes = () => ({})) {
  let sorted = -1, descending = false;
  const body = el('tbody');
  const headers = columns.map((column, index) => {
    const button = el('button', {type: 'button', title: column.title ?? null}, column.label);
    const th = el('th', {scope: 'col', class: column.num ? 'num' : null, 'aria-sort': 'none'}, button);
    button.addEventListener('click', () => {
      descending = sorted === index ? !descending : false;
      sorted = index;
      headers.forEach((other, i) => other.setAttribute('aria-sort', i === index ? (descending ? 'descending' : 'ascending') : 'none'));
      fill();
    });
    return th;
  });
  const fill = () => {
    const order = [...rows];
    if (sorted >= 0) {
      const key = columns[sorted].key;
      order.sort((a, b) => {
        const x = key(a), y = key(b);
        if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
        if (y === null || y === undefined) return -1;
        const result = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return descending ? -result : result;
      });
    }
    body.replaceChildren(...order.map(row => el('tr', rowAttributes(row), columns.map((column, i) => i === 0 ? el('th', {scope: 'row'}, column.cell(row)) : el('td', {class: column.num ? 'num' : column.small ? 'small' : null}, column.cell(row))))));
  };
  table.replaceChildren(el('caption', {class: 'visually-hidden'}, caption), el('thead', {}, el('tr', {}, headers)), body);
  fill();
  return {update(next) { rows = next; fill(); }};
}

/** One small horizontal bar chart: the mean per engine, a tick at p95, this engine highlighted. */
function chart(report, find, scene, config, pick) {
  const rows = report.engines.map(engine => ({engine, row: find(scene.id, engine.id, config)})).filter(item => item.row);
  const values = rows.map(item => pick(item.row)).filter(v => v && Number.isFinite(v.mean));
  const fastest = values.length ? Math.min(...values.map(v => v.mean)) : 1;
  // Scale: up to six times the fastest; anything longer is cut and marked.
  const limit = Math.min(Math.max(...values.map(v => Math.max(v.mean, v.p95 ?? 0)), fastest), fastest * 6);
  const labelW = 86, valueW = 96, width = 360, barW = width - labelW - valueW, rowH = 19, height = rows.length * rowH + 6;
  const root = svg('svg', {viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${scene.title}: ${rows.map(item => { const v = pick(item.row); return `${item.engine.name} ${v ? fmt(v.mean) : item.row.status}`; }).join(', ')}`});
  root.append(svg('line', {class: 'axis', x1: labelW, y1: 0, x2: labelW, y2: height}));
  rows.forEach((item, index) => {
    const y = index * rowH + 4, own = item.engine.id === report.thisEngine, value = pick(item.row);
    root.append(svg('text', {x: labelW - 6, y: y + 11, 'text-anchor': 'end', class: own ? 'own-label' : null}, item.engine.name));
    if (!value || !Number.isFinite(value.mean)) { root.append(svg('text', {x: labelW + 6, y: y + 11, class: 'missing'}, item.row.status === 'failed' ? 'failed' : 'no data')); return; }
    const cut = value.mean > limit, w = Math.max(1, Math.min(1, value.mean / limit) * barW);
    root.append(svg('rect', {class: `bar ${item.row.status === 'timed-out' ? 'unfinished' : own ? 'own' : 'other'}`, x: labelW, y, width: w.toFixed(1), height: 12}));
    if (cut) root.append(svg('path', {class: 'cut', d: `M${labelW + barW - 9} ${y - 1} l5 7 l-5 7`}));
    else if (value.p95 && value.p95 <= limit) root.append(svg('rect', {class: 'tick', x: (labelW + value.p95 / limit * barW - 1).toFixed(1), y: y - 2, width: 2, height: 16}));
    const ratio = !own && item.row.ratio ? ` ${ratioText(item.row.ratio.median)}` : '';
    root.append(svg('text', {x: labelW + barW + 6, y: y + 11, class: 'value'}, `${fmt(value.mean)}${value.unit ?? ''}${ratio}${item.row.status === 'timed-out' ? ' †' : ''}`));
  });
  return el('figure', {class: 'chart'}, el('figcaption', {}, scene.title, el('span', {class: 'sub'}, `${scene.bodies.toLocaleString('en-US')} bodies${scene.joints ? `, ${scene.joints.toLocaleString('en-US')} joints` : ''}${scene.rays ? `, ${scene.rays.toLocaleString('en-US')} rays` : `, ${scene.steps} steps`}`)), root);
}

function draw(report) {
  if (report?.schema !== SCHEMA || report.version !== VERSION) throw new Error(`benchmarks.json is not ${SCHEMA} version ${VERSION}`);
  const index = new Map(report.results.map(row => [`${row.config}|${row.scene}|${row.engine}`, row]));
  const find = (scene, engine, config = 'default') => index.get(`${config}|${scene}|${engine}`);
  const engineOf = id => report.engines.find(engine => engine.id === id), sceneOf = id => report.scenes.find(scene => scene.id === id);
  const timed = report.scenes.filter(scene => ['stacking', 'piles', 'terrain', 'joints'].includes(scene.group));
  const ownAttributes = row => ({class: (row.engine?.id ?? row.engine ?? row.id) === report.thisEngine ? 'own' : null});

  const status = document.getElementById('status'), stand = report.summary.timing.filter(line => line.state === 'ok');
  const firsts = stand.filter(line => line.rank === 1).length, losses = report.summary.timing.filter(line => line.faster?.length);
  status.textContent = `Measured ${report.generated} on ${report.machine.cpu} (${report.machine.logicalCpus} logical CPUs, one thread per run). ${report.engines.length} engine builds, ${report.scenes.length} scenes, up to ${report.repeats.default} repeats per scene.`;
  status.classList.add('ok');

  // Where this engine stands.
  document.getElementById('standing-lede').textContent = `Of ${report.summary.timing.length} timed scenes at default settings, this engine is the fastest in ${firsts} and is beaten by more than 10 % in ${losses.length}. Both lists below are computed from the measurements.`;
  document.getElementById('losses').replaceChildren(...(losses.length ? losses.map(line => el('li', {}, el('strong', {}, line.title), ': ', line.faster.map(f => `${f.name} takes ${(f.ratio * 100).toFixed(0)} % of this engine's time`).join('; '), '.')) : [el('li', {}, 'None.')]));
  document.getElementById('quality-losses').replaceChildren(...(report.summary.quality.length ? report.summary.quality.map(line => el('li', {}, line)) : [el('li', {}, 'None.')]));

  // Charts.
  const grid = document.getElementById('chart-grid');
  const drawCharts = () => {
    const config = document.querySelector('input[name="config"]:checked').value;
    grid.replaceChildren(...timed.filter(scene => report.engines.some(engine => find(scene.id, engine.id, config))).map(scene => chart(report, find, scene, config, row => row.stepMs ?? null)));
  };
  for (const input of document.querySelectorAll('input[name="config"]')) input.addEventListener('change', drawCharts);
  drawCharts();

  // Engines.
  sortable(document.getElementById('engines-table'), 'Engine builds, versions, licences, sizes and solver settings', [
    {label: 'Engine', key: e => e.name, cell: e => e.label},
    {label: 'Package', key: e => e.package, cell: e => [el('code', {}, e.package), ` ${e.version}`]},
    {label: 'Licence', key: e => e.license, cell: e => e.license},
    {label: 'Shipped, gzip', num: true, key: e => e.gzipBytes, cell: e => kib(e.gzipBytes), title: 'WASM and JavaScript loader as found in the npm package, gzip -9'},
    {label: 'Shipped, raw', num: true, key: e => e.bytes, cell: e => kib(e.bytes)},
    {label: 'Default solver settings', small: true, key: e => e.defaults, cell: e => e.defaults},
    {label: 'Equal budget', small: true, key: e => e.budget, cell: e => e.budget},
  ], report.engines, ownAttributes);
  document.getElementById('engine-notes').replaceChildren(...report.engines.map(engine => el('details', {class: 'notes'}, el('summary', {}, `${engine.name}: setup, limits and documentation followed`),
    el('ul', {}, engine.notes.map(note => el('li', {}, rich(note))), el('li', {}, 'Documentation: ', engine.docs.map((url, i) => [i ? ', ' : '', el('a', {href: url.startsWith('http') ? url : `${report.repository}/blob/main/${url}`}, url.replace(/^https?:\/\//, ''))])),
      el('li', {}, 'Files measured for size: ', engine.bundle.map((file, i) => [i ? '; ' : '', el('code', {}, file.file), ` ${kib(file.bytes)}, gzip ${kib(file.gzipBytes)}`]))))));

  // Every timing.
  const sceneFilter = document.getElementById('scene-filter'), engineFilter = document.getElementById('engine-filter'), configFilter = document.getElementById('config-filter');
  sceneFilter.replaceChildren(el('option', {value: ''}, 'All timed scenes'), ...timed.map(scene => el('option', {value: scene.id}, scene.title)));
  engineFilter.replaceChildren(el('option', {value: ''}, 'All engines'), ...report.engines.map(engine => el('option', {value: engine.id}, engine.name)));
  const detailRows = () => report.results.filter(row => row.config === configFilter.value && timed.some(scene => scene.id === row.scene) && (!sceneFilter.value || row.scene === sceneFilter.value) && (!engineFilter.value || row.engine === engineFilter.value));
  const step = name => ({label: name, num: true, key: row => row.stepMs?.[name] ?? null, cell: row => fmt(row.stepMs?.[name])});
  const detail = sortable(document.getElementById('detail-table'), 'Step time, construction time and memory per scene and engine', [
    {label: 'Scene', key: row => timed.findIndex(scene => scene.id === row.scene), cell: row => sceneOf(row.scene).title},
    {label: 'Engine', key: row => engineOf(row.engine).name, cell: row => [engineOf(row.engine).name, row.status === 'ok' ? null : [' ', el('span', {class: `badge ${row.status === 'failed' ? 'bad' : 'plain-badge'}`}, row.status === 'failed' ? 'failed' : `stopped at step ${row.stepsDone}`)]]},
    {...step('mean'), title: 'CPU ms per step, mean over the run and the repeats'}, {...step('sd'), title: 'Standard deviation of the mean across repeats'}, {...step('best'), title: 'The fastest repeat'}, step('p50'), step('p95'), {...step('max'), title: 'The slowest single step of any repeat'},
    {label: 'wall', num: true, key: row => row.wallStepMs?.mean ?? null, cell: row => fmt(row.wallStepMs?.mean), title: 'Wall-clock ms per step: includes waiting for a core on the shared machine'},
    {label: 'x this', num: true, key: row => row.ratio?.median ?? null, cell: row => row.ratio ? el('span', {class: row.engine === report.thisEngine ? null : row.ratio.median < 0.9 ? 'faster' : row.ratio.median > 1.1 ? 'slower' : null}, ratioText(row.ratio.median)) : 'n/a', title: 'Median ratio to this engine inside each repeat; below 1 is faster than this engine'},
    {label: 'construct', num: true, key: row => row.constructionMs ?? null, cell: row => fmt(row.constructionMs), title: 'World, bodies, joints and the first step, CPU ms'},
    {label: 'RSS MiB', num: true, key: row => row.peakRssMb ?? null, cell: row => fmt(row.peakRssMb), title: 'Peak resident memory of the process, Node included'},
    {label: 'WASM MiB', num: true, key: row => row.wasmMemoryMb ?? null, cell: row => fmt(row.wasmMemoryMb)},
    {label: 'load', num: true, key: row => row.loadAverage?.[1] ?? null, cell: row => row.loadAverage ? `${row.loadAverage[0].toFixed(1)}-${row.loadAverage[1].toFixed(1)}` : 'n/a', title: 'Machine load average while this row was measured'},
  ], detailRows(), ownAttributes);
  for (const control of [sceneFilter, engineFilter, configFilter]) control.addEventListener('change', () => detail.update(detailRows()));

  // Ray casts.
  const rayScene = report.scenes.find(scene => scene.group === 'queries');
  if (rayScene) {
    document.getElementById('rays-lede').textContent = rayScene.description;
    document.getElementById('rays-chart').replaceChildren(chart(report, find, rayScene, 'default', row => row.rays ? {mean: row.rays.ms, unit: ' ms'} : null));
    sortable(document.getElementById('rays-table'), 'Ray cast time, throughput and hit counts per engine', [
      {label: 'Engine', key: row => engineOf(row.engine).name, cell: row => engineOf(row.engine).name},
      {label: 'ms for all rays', num: true, key: row => row.rays?.ms ?? null, cell: row => row.status === 'failed' ? 'failed' : fmt(row.rays?.ms)},
      {label: 'rays per second', num: true, key: row => row.rays?.raysPerSecond ?? null, cell: row => row.rays ? Math.round(row.rays.raysPerSecond).toLocaleString('en-US') : 'n/a'},
      {label: 'x this', num: true, key: row => row.ratio?.median ?? null, cell: row => row.ratio ? ratioText(row.ratio.median) : 'n/a'},
      {label: 'hits', num: true, key: row => row.rays?.hits ?? null, cell: row => row.rays ? row.rays.hits.toLocaleString('en-US') : 'n/a'},
      {label: 'mean hit distance m', num: true, key: row => row.rays?.meanHitDistanceM ?? null, cell: row => row.rays ? row.rays.meanHitDistanceM.toFixed(4) : 'n/a'},
    ], report.results.filter(row => row.scene === rayScene.id && row.config === 'default'), ownAttributes);
  }

  // Quality.
  const q = (scene, pick) => engine => { const row = find(scene, engine.id); return !row || row.status === 'failed' || !row.quality ? null : pick(row.quality, row); };
  const number = (scene, label, pick, unit = '', title) => ({label, num: true, title, key: q(scene, pick), cell: engine => { const row = find(scene, engine.id); if (!row) return 'not run'; if (row.status === 'failed') return 'failed'; const v = pick(row.quality, row); return v === null || v === undefined ? 'n/a' : v === Infinity ? 'collapsed' : `${fmt(v)}${unit}${row.status === 'timed-out' ? ' †' : ''}`; }});
  const stack = scene => ({label: sceneOf(scene)?.title.replace('Stack of ', '').replace(' light boxes under one ', ' under ') ?? scene, num: true, key: q(scene, v => v.standing ? v.maxPenetrationMm : 1e9 - v.collapsedAtStep),
    cell: engine => { const row = find(scene, engine.id); if (!row || row.status === 'failed') return row ? 'failed' : 'not run'; const v = row.quality; return v.standing ? `${fmt(v.maxPenetrationMm)} mm` : el('span', {class: 'badge bad'}, `collapsed at step ${v.collapsedAtStep}`); }});
  const sleepCell = scene => ({label: `${scene.includes('20') ? '20' : '10'} rows: asleep at step`, num: true, key: q(scene, v => v.stepsToSleep ?? 1e9), cell: engine => { const v = find(scene, engine.id)?.quality; return !v ? 'n/a' : v.stepsToSleep ?? (v.awakeAtEnd === null ? 'no sleeping' : 'never'); }});
  const name = {label: 'Engine', key: engine => engine.name, cell: engine => engine.name};
  const groups = [
    ['Chain stretch under a heavy end mass', 'Extra length of the hanging chain as a percentage of its length; 0 for an ideal chain.', [name,
      number('chain-100', '100 links: after 5 s', v => v.endStretchPercent, ' %'), number('chain-100', '100 links: largest', v => v.maxStretchPercent, ' %'),
      number('chain-1000', '1,000 links: after 5 s', v => v.endStretchPercent, ' %'), number('chain-1000', '1,000 links: largest', v => v.maxStretchPercent, ' %')]],
    ['Mass-ratio stacks', 'Largest overlap between neighbouring boxes while the stack stands; 0 for rigid boxes.', [name, stack('stack-10'), stack('stack-100'), stack('stack-1000'), stack('pair-1000')]],
    ['Pendulum and bouncing sphere against closed forms', 'Energy change of a frictionless pendulum after 10 s (0 exactly), error of its first period, and error of the first rebound height of a sphere with restitution 0.5.', [name,
      number('pendulum', 'energy after 10 s', v => v.energyDriftPercent, ' %'), number('pendulum', 'period error', v => v.periodErrorPercent, ' %'), number('pendulum', 'arm length error', v => v.maxArmErrorMm, ' mm'), number('bounce', 'rebound height error', v => v.restitutionErrorPercent, ' %')]],
    ['Stack stability and sleeping', 'Resting pyramids over 5 s with each engine\'s own sleep policy: how far any box moved, and when the last body fell asleep.', [name,
      number('pyramid-10-sleep', '10 rows: largest drift', v => v.maxDriftMm, ' mm'), sleepCell('pyramid-10-sleep'), number('pyramid-20-sleep', '20 rows: largest drift', v => v.maxDriftMm, ' mm'), sleepCell('pyramid-20-sleep')]],
    ['Tunnelling, terrain and joints', 'Bullets at 200 m/s that ended behind a 2 cm wall (of 50 each), bodies that ended under the terrain (of 2,000), and the largest gap that opened in a ragdoll joint.', [name,
      number('bullets', 'through the static wall', v => v.tunnelledStatic), number('bullets', 'through the dynamic plate', v => v.tunnelledDynamic), number('trimesh-2k', 'through the mesh', v => v.fellThrough), number('heightfield-2k', 'through the height field', v => v.fellThrough),
      number('ragdolls-100', 'ragdoll joint gap', v => v.maxJointGapMm, ' mm')]],
  ];
  document.getElementById('quality-tables').replaceChildren(...groups.map(([title, text, columns]) => {
    const table = el('table', {class: 'sortable'});
    sortable(table, title, columns, report.engines, ownAttributes);
    return el('div', {}, el('h3', {}, title), el('p', {class: 'meta'}, text), el('div', {class: 'scroll', role: 'region', 'aria-label': title, tabindex: '0'}, table));
  }));

  // Determinism, memory and size.
  const determinism = id => report.determinism.find(row => row.engine === id);
  const memoryScene = find('boxes-5k', report.thisEngine) ? 'boxes-5k' : 'boxes-1k';
  sortable(document.getElementById('determinism-table'), 'Determinism, memory and shipped size per engine', [
    name,
    {label: 'Same process, run twice', key: engine => determinism(engine.id)?.sameProcess ?? null, cell: engine => { const d = determinism(engine.id); return d?.sameProcess === null || !d ? 'not run' : el('span', {class: `badge ${d.sameProcess ? 'good' : 'bad'}`}, d.sameProcess ? 'identical' : 'different'); }},
    {label: 'Separate processes', num: true, key: engine => { const d = determinism(engine.id); return d && d.comparedScenes ? d.identicalScenes / d.comparedScenes : null; }, cell: engine => { const d = determinism(engine.id); return d ? `${d.identicalScenes} of ${d.comparedScenes} scenes identical` : 'n/a'; }},
    {label: 'Scenes that differed', small: true, key: engine => determinism(engine.id)?.differing.length ?? null, cell: engine => determinism(engine.id)?.differing.join(', ') || 'none'},
    {label: `Peak RSS, ${sceneOf(memoryScene).title.replace('Box pile drop, ', '')}`, num: true, key: engine => find(memoryScene, engine.id)?.peakRssMb ?? null, cell: engine => { const row = find(memoryScene, engine.id); return row?.peakRssMb ? `${fmt(row.peakRssMb)} MiB` : 'n/a'; }, title: 'Peak resident memory of the Node process'},
    {label: 'WASM heap', num: true, key: engine => find(memoryScene, engine.id)?.wasmMemoryMb ?? null, cell: engine => { const row = find(memoryScene, engine.id); return row?.wasmMemoryMb ? `${fmt(row.wasmMemoryMb)} MiB` : 'n/a'; }},
    {label: 'Shipped, gzip', num: true, key: engine => engine.gzipBytes, cell: engine => kib(engine.gzipBytes)},
  ], report.engines, ownAttributes);

  // Failures.
  const problems = report.results.filter(row => row.status !== 'ok' || row.error);
  document.getElementById('failures-table').replaceChildren(el('thead', {}, el('tr', {}, ['Engine', 'Scene', 'Settings', 'Result'].map(text => el('th', {scope: 'col'}, el('span', {}, text))))),
    el('tbody', {}, problems.length ? problems.map(row => el('tr', {}, el('th', {scope: 'row'}, engineOf(row.engine).name), el('td', {}, sceneOf(row.scene).title), el('td', {}, row.config === 'default' ? 'default' : 'equal budget'),
      el('td', {class: 'small'}, row.status === 'failed' ? `Failed: ${row.error}` : row.status === 'timed-out' ? `Stopped at its time budget after ${row.stepsDone} of ${row.steps} steps (${fmt(row.stepMs?.mean)} ms per step).` : row.error)))
      : el('tr', {}, el('td', {colspan: '4'}, 'None.'))));

  // Actions.
  const block = item => el('div', {class: 'action'}, el('h4', {}, item.title), item.text.map(line => el('p', {}, rich(line))));
  document.getElementById('optimizations').replaceChildren(...(report.actions.optimizations.length ? report.actions.optimizations.map(block) : [el('p', {class: 'meta'}, 'Nothing yet.')]));
  document.getElementById('recommendations').replaceChildren(...(report.actions.recommendations.length ? report.actions.recommendations.map(block) : [el('p', {class: 'meta'}, 'None yet.')]));

  // Method.
  document.getElementById('machine').textContent = `${report.machine.cpu}, ${report.machine.logicalCpus} logical CPUs, ${report.machine.memoryGb} GiB, ${report.machine.platform}, Node ${report.machine.node} (V8 ${report.machine.v8}), flags ${report.machine.nodeFlags}. ${report.machine.note}. Measured ${report.started.slice(0, 16).replace('T', ' ')} to ${report.finished.slice(0, 16).replace('T', ' ')} UTC.`;
  document.getElementById('method-list').replaceChildren(...report.method.map(line => el('li', {}, rich(line))));
  document.getElementById('schema').textContent = `${report.schema} version ${report.version}`;
  for (const id of ['standing', 'charts', 'engines', 'detail', 'rays', 'quality', 'determinism', 'failures', 'actions', 'method']) document.getElementById(id).hidden = false;
  if (location.hash.length > 1) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({behavior: 'instant'});
}

fetch(new URL('./benchmarks.json', import.meta.url), {credentials: 'same-origin'})
  .then(response => { if (!response.ok) throw new Error(`benchmarks.json: HTTP ${response.status}`); return response.json(); })
  .then(draw)
  .catch(error => {
    const status = document.getElementById('status');
    status.classList.add('bad');
    status.replaceChildren(`The results could not be loaded (${error.message}). The same report is in `, el('a', {href: 'https://github.com/nathansenn/box3d-WEBGPU/blob/main/docs/BENCHMARKS_ENGINES.md'}, 'docs/BENCHMARKS_ENGINES.md'), '.');
  });
