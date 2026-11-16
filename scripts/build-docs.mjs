// Builds the documentation site into public/docs/ (static HTML, no framework; `npm run build` runs it first).
//   node scripts/build-docs.mjs            write public/docs/
//   node scripts/build-docs.mjs --check    build in memory and check it: every internal link and anchor resolves, every page has
//                                          one h1, the API reference covers every export, and the count of public symbols without a
//                                          doc comment has not gone up. Nothing is written. `npm run docs:check` in validate:pr.
// Sources: docs/site/*.md (the guides), the solver and reference pages in docs/*.md, packages/box3d-kit/api/API.md (generated from
// the kit's .d.ts files), the example scenes of src/engine/scene-format.ts, public/validation/validation.json and the changelogs.
// The output is not committed: it is a build product, excluded from the source manifest like dist/.
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, canonicalize, normalizeScene, sceneHash} from '../src/engine/scene-format.ts';

const root = fileURLToPath(new URL('..', import.meta.url)), out = join(root, 'public/docs');
const read = file => readFileSync(join(root, file), 'utf8');
const REPO = 'https://github.com/nathansenn/box3d-WEBGPU/blob/main/';
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = text => text.toLowerCase().replace(/`/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

// ---- the pages ----
const GUIDES = [['getting-started', 'Getting started'], ['concepts/worlds-and-units', 'Worlds and units'], ['concepts/shapes', 'Shapes'], ['concepts/joints', 'Joints'], ['concepts/events', 'Events and queries'],
  ['concepts/stepping-loop', 'The stepping loop'], ['concepts/coupling', 'Coupling'], ['concepts/checkpoints', 'Checkpoints'], ['concepts/determinism', 'Determinism'], ['concepts/scene-files', 'Scene files'], ['concepts/materials', 'Materials']];
// One page per solver or subsystem, from the document that specifies and validates it.
const SOLVERS = [['simulation', 'SIMULATION', 'One stepping loop'], ['water-coupling', 'WATER_COUPLING', 'Water basin and floating bodies'], ['closed-water', 'CLOSED_WATER', 'Closed water basin'],
  ['compliant-cable', 'COMPLIANT_CABLE', 'Cables'], ['nonlinear-cable', 'NONLINEAR_CABLE', 'Cables: the nonlinear solver'], ['frame-mechanics', 'FRAME_MECHANICS', 'Frames'], ['structure-coupling', 'STRUCTURE_COUPLING', 'Cables and frames with rigid bodies'],
  ['heat-transfer', 'HEAT_TRANSFER', 'Heat'], ['solid-mechanics', 'SOLID_MECHANICS', 'Deformable solids'], ['solid-contact', 'SOLID_CONTACT', 'Solids in contact with rigid bodies'], ['solid-fracture', 'SOLID_FRACTURE', 'Fracture'],
  ['cloth', 'CLOTH', 'Cloth'], ['granular', 'GRANULAR', 'Grains'], ['fluid', 'FLUID', 'Fluid in a volume and free surface'], ['shallow-water', 'SHALLOW_WATER', 'Shallow water on terrain'],
  ['checkpoints', 'CHECKPOINTS', 'Exact checkpoints'], ['scene-format', 'SCENE_FORMAT', 'The scene format'], ['scene-editor', 'SCENE_EDITOR', 'The scene editor'], ['robot-import', 'ROBOT_IMPORT', 'Robots: URDF and MJCF'], ['materials', 'MATERIALS', 'The material library']];
const REFERENCE = [['errors', 'docs/ERRORS.md', 'Errors and diagnostics'], ['robustness', 'docs/ROBUSTNESS.md', 'Robustness'], ['api-stability', 'docs/API_STABILITY.md', 'Versions and API stability'], ['provenance', 'docs/PROVENANCE.md', 'Provenance and bill of materials'], ['benchmarks', 'docs/ENGINE_BENCHMARKS.md', 'Engine benchmarks'], ['roadmap', 'docs/ROADMAP.md', 'Roadmap'],
  ['changelog', 'CHANGELOG.md', 'Changelog'], ['kit-changelog', 'packages/box3d-kit/CHANGELOG.md', 'Kit changelog'], ['kit-readme', 'packages/box3d-kit/README.md', 'The kit, feature by feature']].filter(([, file]) => existsSync(join(root, file)));
// Where a link to a source document goes on the site.
const DOC_PAGES = new Map([...SOLVERS.map(([name, file]) => [`docs/${file}.md`, `solvers/${name}.html`]), ...REFERENCE.map(([name, file]) => [file, `reference/${name}.html`]), ['docs/VALIDATION.md', '../validation/index.html'],
  ['packages/box3d-kit/api/API.md', 'api/index.html']]);

// ---- Markdown ----
// The subset the repository's documents use: headings, paragraphs, fenced code, lists (nested by indentation), tables,
// block quotes, rules, and inline code, emphasis, links and images. Everything else is text; all text is escaped.
function inline(text, ctx, held = []) {
  // Finished pieces of HTML are parked in `held` and put back at the end; a link's label shares the list, so that a
  // code span inside a label (parked before the link was seen) is found again.
  const top = arguments.length < 3;
  const hold = html => { held.push(html); return `\u0000${held.length - 1}\u0000`; };
  let s = text.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => hold(`<a href="${esc(ctx.link(url))}">${esc(alt || url)}</a>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => { const href = ctx.link(url); return hold(`<a href="${esc(href)}"${/^https?:/.test(href) ? ' rel="noopener"' : ''}>${inline(label, ctx, held)}</a>`); });
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url) => hold(`<a href="${esc(url)}" rel="noopener">${esc(url)}</a>`));
  s = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  if (!top) return s;
  for (let pass = 0; pass < 4 && s.includes('\u0000'); pass++) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
  return s;
}
export function markdown(source, ctx) {
  const lines = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').split('\n'), html = [], headings = [], used = new Map();
  const id = text => { const base = slug(text), n = used.get(base) ?? 0; used.set(base, n + 1); return n ? `${base}-${n}` : base; };
  let i = 0;
  const list = indent => {
    const ordered = /^\s*\d+\.\s/.test(lines[i]), items = [];
    while (i < lines.length) {
      const match = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
      if (!match || match[1].length < indent) break;
      if (match[1].length > indent) { items[items.length - 1] += list(match[1].length); continue; }
      let text = match[3]; i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*([-*]|\d+\.)\s/.test(lines[i]) && /^\s+/.test(lines[i]) && !/^\s*```/.test(lines[i])) text += ` ${lines[i++].trim()}`;
      items.push(inline(text, ctx));
      if (i < lines.length && /^\s*```/.test(lines[i]) && lines[i].search(/\S/) > indent) items[items.length - 1] += fence();
    }
    return `<${ordered ? 'ol' : 'ul'}>${items.map(item => `<li>${item}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  };
  const fence = () => {
    const open = /^\s*```\s*([\w-]*)/.exec(lines[i]), indent = lines[i].search(/\S/), body = [];
    i++;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++].slice(Math.min(indent, lines[i - 1].search(/\S|$/))));
    i++;
    return `<pre${open[1] ? ` data-lang="${esc(open[1])}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    if (/^\s*```/.test(line)) { html.push(fence()); continue; }
    const heading = /^(#{1,5})\s+(.*?)\s*#*$/.exec(line);
    if (heading) { const level = heading[1].length, text = heading[2], anchor = id(text.replace(/[`*]/g, '')); headings.push({level, text, id: anchor}); html.push(`<h${level} id="${anchor}">${inline(text, ctx)}</h${level}>`); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { html.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) { const quote = []; while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, '')); html.push(`<blockquote>${markdown(quote.join('\n'), ctx).html}</blockquote>`); continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = row => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
      const head = cells(line); i += 2;
      const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      html.push(`<div class="scroll" role="region" tabindex="0" aria-label="Table"><table><thead><tr>${head.map(cell => `<th scope="col">${inline(cell, ctx)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) { html.push(list(line.search(/\S/))); continue; }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*```/.test(lines[i]) && !/^#{1,5}\s/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(/^\s*\|/.test(lines[i]) && paragraph.length === 0) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) paragraph.push(lines[i++].trim());
    if (paragraph.length === 0) paragraph.push(lines[i++].trim());   // a line no rule above takes, such as a table row without its header
    html.push(`<p>${inline(paragraph.join(' '), ctx)}</p>`);
  }
  return {html: html.join('\n'), headings};
}

// ---- pages ----
const pages = new Map();   // output path -> {title, section, body, headings, source}
const assets = new Map();  // output path -> text
const search = [];
/** A link written in a source document at `sourceFile`, as a link from the page at `pagePath`. */
function linker(sourceFile, pagePath) {
  const here = posix.dirname(pagePath), relative = target => posix.relative(here, target) || posix.basename(target);
  return {link(url) {
    if (/^(https?:|mailto:|#)/.test(url)) return url;
    const [path, hash = ''] = url.split('#'), anchor = hash ? `#${hash}` : '';
    if (sourceFile.startsWith('docs/site/')) return url;                         // guides are written with site links already
    const target = posix.normalize(posix.join(posix.dirname(sourceFile), path));
    if (DOC_PAGES.has(target)) return relative(DOC_PAGES.get(target)) + anchor;
    return REPO + target + anchor;                                               // a source file or a document that has no page here
  }};
}
function page(path, section, title, sourceFile, text, extra = {}) {
  const ctx = linker(sourceFile, path), {html, headings} = markdown(text, ctx);
  pages.set(path, {title, section, body: html, headings, source: sourceFile, ...extra});
  search.push({t: title, k: section, u: path, d: ''});
  for (const h of headings) if (h.level === 2) search.push({t: h.text.replace(/[`*]/g, ''), k: title, u: `${path}#${h.id}`, d: ''});
}
for (const [name, title] of GUIDES) page(`guide/${name}.html`, 'Guide', title, `docs/site/${name.split('/').pop()}.md`, read(`docs/site/${name.split('/').pop()}.md`));
for (const [name, file, title] of SOLVERS) page(`solvers/${name}.html`, 'Solvers', title, `docs/${file}.md`, read(`docs/${file}.md`));
for (const [name, file, title] of REFERENCE) page(`reference/${name}.html`, 'Reference', title, file, read(file));

// ---- API reference, from the generated API.md ----
const api = read('packages/box3d-kit/api/API.md'), entries = [];
let undocumented = 0;
for (const part of api.split(/^## /m).slice(1)) {
  const specifier = /^`([^`]+)`/.exec(part)[1], name = specifier === 'box3d-webgpu-kit' ? 'index-entry' : specifier.split('/').pop(), path = `api/${name}.html`, symbols = [];
  for (const block of part.split(/^### /m).slice(1)) {
    const [, symbol, kind] = /^(\S+) · (\w+)/.exec(block), rest = block.slice(block.indexOf('\n') + 1), code = /```ts\n([\s\S]*?)\n```\s*$/.exec(rest);
    const doc = rest.slice(0, code ? code.index : rest.length).trim();
    symbols.push({symbol, kind, doc, code: code ? code[1] : ''});
    if (!doc) undocumented++;
  }
  entries.push({specifier, path, symbols});
  const ctx = linker('packages/box3d-kit/api/API.md', path);
  const body = [`<h1 id="top">${esc(specifier)}</h1>`, `<p><code>import {…} from '${esc(specifier)}';</code> ${symbols.length} exports.</p>`,
    `<ul class="symbols">${symbols.map(s => `<li><a href="#${esc(s.symbol)}"><code>${esc(s.symbol)}</code></a> <span class="kind">${s.kind}</span></li>`).join('')}</ul>`,
    ...symbols.map(s => `<section class="symbol" id="${esc(s.symbol)}"><h2><code>${esc(s.symbol)}</code> <span class="kind">${s.kind}</span></h2>${s.doc ? markdown(s.doc.replace(/^#/gm, '\\#'), ctx).html : '<p class="undocumented">No description yet.</p>'}<pre data-lang="ts"><code>${esc(s.code)}</code></pre></section>`)].join('\n');
  pages.set(path, {title: specifier, section: 'API', body, headings: [], source: 'packages/box3d-kit/api/API.md', raw: true});
  for (const s of symbols) search.push({t: s.symbol, k: `${s.kind} · ${specifier}`, u: `${path}#${s.symbol}`, d: s.doc.split(/(?<=\.)\s/)[0].replace(/\s+/g, ' ').slice(0, 140)});
}
const totalSymbols = entries.reduce((n, entry) => n + entry.symbols.length, 0);
pages.set('api/index.html', {title: 'API reference', section: 'API', raw: true, headings: [], source: 'packages/box3d-kit/api/API.md', body: [
  '<h1 id="top">API reference</h1>',
  `<p>Every export of <code>box3d-webgpu-kit</code>, written from the published type declarations: ${totalSymbols} symbols in ${entries.length} entry points. Press <kbd>/</kbd> to search by name.</p>`,
  `<div class="scroll" role="region" tabindex="0" aria-label="Entry points"><table><thead><tr><th scope="col">Import from</th><th scope="col">Exports</th><th scope="col">Classes and functions</th></tr></thead><tbody>${entries.map(entry => `<tr><td><a href="${posix.basename(entry.path)}"><code>${esc(entry.specifier)}</code></a></td><td>${entry.symbols.length}</td><td>${entry.symbols.filter(s => s.kind === 'class' || s.kind === 'function').slice(0, 8).map(s => `<a href="${posix.basename(entry.path)}#${esc(s.symbol)}"><code>${esc(s.symbol)}</code></a>`).join(', ')}${entry.symbols.filter(s => s.kind === 'class' || s.kind === 'function').length > 8 ? ', …' : ''}</td></tr>`).join('')}</tbody></table></div>`,
  `<p>${totalSymbols - undocumented} of the ${totalSymbols} symbols carry a description; the others show their declaration only. Stability rules are in <a href="../reference/api-stability.html">versions and API stability</a>, error codes in <a href="../reference/errors.html">errors and diagnostics</a>.</p>`].join('\n')});

// ---- examples gallery ----
const validation = JSON.parse(read('public/validation/validation.json'));
const SECTION_DOMAINS = {water: ['water-coupling', 'closed-water'], cables: ['cable', 'structure-coupling'], frames: ['frame', 'structure-coupling'], cloths: ['cloth'], grains: ['granular'], solids: ['solid', 'solid-contact'], heat: ['heat'], fluids: ['fluid'], shallowWater: ['shallow-water']};
const cards = [];
for (const [name, make] of Object.entries({...EXAMPLE_SCENES, ...COUPLED_EXAMPLE_SCENES})) {
  const scene = make(), normal = normalizeScene(scene), text = canonicalize(scene, {pretty: true});
  const domains = new Set(['rigid']);
  for (const [section, list] of Object.entries(SECTION_DOMAINS)) if ((normal[section]?.length ?? 0) > 0) for (const domain of list) domains.add(domain);
  if ((normal.solids ?? []).some(solid => solid.fracture)) domains.add('fracture');
  if (name in COUPLED_EXAMPLE_SCENES) domains.add('simulation');
  const rows = [...domains].map(id => ({id, title: validation.domains.find(d => d.id === id)?.title ?? id, cases: validation.cases.filter(c => c.domain === id)})).filter(d => d.cases.length > 0);
  const sections = Object.keys(SECTION_DOMAINS).filter(section => (normal[section]?.length ?? 0) > 0);
  assets.set(`examples/${name}.json`, `${text}\n`);
  cards.push(`<article class="card" id="${esc(name)}"><h2>${esc(scene.meta?.title ?? name)}</h2>
<p>${esc(scene.meta?.description ?? '')}</p>
<p class="facts">${normal.bodies.length} bodies, ${(normal.joints ?? []).length} joints${sections.length ? `, and ${sections.map(s => `<code>${s}</code>`).join(', ')}` : ''}. Step ${+(normal.world?.step ?? 1 / 60).toFixed(6)} s. Scene hash <code>${sceneHash(scene).slice(0, 12)}</code>.</p>
<p class="actions"><a class="button" href="../../lab.html?example=${encodeURIComponent(name)}">Open in the Lab</a> <a href="${esc(name)}.json">Scene JSON</a> (${(text.length / 1024).toFixed(1)} KiB)</p>
<p class="rows">Validation: ${rows.map(d => `<a href="../../validation/index.html">${esc(d.title)}</a> (${d.cases.length} cases, ${d.cases.filter(c => c.pass).length} pass)`).join('; ')}.</p>
<details><summary>The ${rows.reduce((n, d) => n + d.cases.length, 0)} validation rows behind it</summary><ul>${rows.flatMap(d => d.cases).map(c => `<li><code>${esc(c.id)}</code> ${esc(c.title)}: ${c.pass ? 'pass' : 'FAIL'}</li>`).join('')}</ul></details>
${text.length < 6000 ? `<details><summary>Show the scene</summary><pre data-lang="json"><code>${esc(text)}</code></pre></details>` : ''}</article>`);
  search.push({t: scene.meta?.title ?? name, k: 'Example', u: `examples/index.html#${name}`, d: (scene.meta?.description ?? '').slice(0, 140)});
}
pages.set('examples/index.html', {title: 'Examples', section: 'Examples', raw: true, headings: [], source: 'src/engine/scene-examples.ts', body:
  `<h1 id="top">Examples</h1>\n<p>The ${cards.length} example scenes of the Physics Lab. Each opens in the Lab from its link, with nothing to install, and each is a scene file you can read, change and load with <code>loadScene</code>. The validation line names the measured cases of the solvers a scene uses.</p>\n<div class="cards">${cards.join('\n')}</div>`});

// ---- landing page ----
pages.set('index.html', {title: 'Documentation', section: 'Home', raw: true, headings: [], source: 'scripts/build-docs.mjs', body: `<h1 id="top">Box3D WebGPU documentation</h1>
<p class="lede">Rigid bodies by Box3D in WebAssembly, with validated solvers for water, cables and frames, cloth, grains, deformable solids and fracture, heat, and fluids, in SI units, under one stepping loop, with exact checkpoints.</p>
<div class="cards">
<article class="card"><h2><a href="guide/getting-started.html">Getting started</a></h2><p>Five minutes in the browser with the Physics Lab, or five minutes in code with the kit.</p></article>
<article class="card"><h2>Concepts</h2><ul>${GUIDES.slice(1).map(([name, title]) => `<li><a href="guide/${name}.html">${esc(title)}</a></li>`).join('')}</ul></article>
<article class="card"><h2>Solvers</h2><ul>${SOLVERS.map(([name, , title]) => `<li><a href="solvers/${name}.html">${esc(title)}</a></li>`).join('')}</ul></article>
<article class="card"><h2><a href="api/index.html">API reference</a></h2><p>${totalSymbols} exports in ${entries.length} entry points, searchable: press <kbd>/</kbd>.</p></article>
<article class="card"><h2><a href="examples/index.html">Examples</a></h2><p>${cards.length} scenes that open in the Lab, each with its scene file and the validation cases behind it.</p></article>
<article class="card"><h2>Evidence and reference</h2><ul><li><a href="../validation/index.html">Validation</a>: ${validation.cases.length} measured cases against closed forms</li>${REFERENCE.map(([name, , title]) => `<li><a href="reference/${name}.html">${esc(title)}</a></li>`).join('')}</ul></article>
</div>`});

// ---- render ----
const NAV = [['index.html', 'Home'], ['guide/getting-started.html', 'Guide'], ['solvers/simulation.html', 'Solvers'], ['api/index.html', 'API'], ['examples/index.html', 'Examples'], ['reference/errors.html', 'Reference']];
const SIDEBAR = {Guide: GUIDES.map(([name, title]) => [`guide/${name}.html`, title]), Solvers: SOLVERS.map(([name, , title]) => [`solvers/${name}.html`, title]), Reference: REFERENCE.map(([name, , title]) => [`reference/${name}.html`, title]),
  API: [['api/index.html', 'All entry points'], ...entries.map(entry => [entry.path, entry.specifier.replace('box3d-webgpu-kit', 'kit')])]};
function render(path, p) {
  const up = posix.relative(posix.dirname(path), '.') || '.', rel = target => posix.relative(posix.dirname(path), target) || posix.basename(target);
  const side = SIDEBAR[p.section], toc = p.headings.filter(h => h.level === 2);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${esc(p.title)}: Box3D WebGPU documentation.">
<title>${esc(p.title)} · Box3D WebGPU docs</title>
<link rel="stylesheet" href="${up}/docs.css">
<script type="module" src="${up}/docs.js"></script>
</head>
<body data-root="${up}">
<a class="skip" href="#main">Skip to the content</a>
<header class="top">
<a class="brand" href="${rel('index.html')}">Box3D WebGPU docs</a>
<nav aria-label="Sections"><ul>${NAV.map(([target, label]) => `<li><a href="${rel(target)}"${label === p.section || (label === 'Home' && p.section === 'Home') ? ' aria-current="true"' : ''}>${label}</a></li>`).join('')}<li><a href="${up}/../validation/index.html">Validation</a></li><li><a href="${up}/../lab.html">Lab</a></li></ul></nav>
<div class="search" role="search"><label for="search-input" class="visually-hidden">Search the documentation</label><input id="search-input" type="search" placeholder="Search (press /)" autocomplete="off" spellcheck="false" aria-controls="search-results" aria-expanded="false"><ul id="search-results" class="results" role="listbox" aria-label="Search results" hidden></ul></div>
</header>
<div class="layout">
${side ? `<nav class="side" aria-label="${esc(p.section)}"><details open><summary>${esc(p.section)}</summary><ul>${side.map(([target, title]) => `<li><a href="${rel(target)}"${target === path ? ' aria-current="page"' : ''}>${esc(title)}</a></li>`).join('')}</ul></details></nav>` : ''}
<main id="main" tabindex="-1">
${p.body}
${p.source && !p.raw ? `<p class="source">Source: <a href="${REPO}${esc(p.source)}" rel="noopener"><code>${esc(p.source)}</code></a></p>` : ''}
</main>
${toc.length > 2 ? `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${toc.map(h => `<li><a href="#${h.id}">${inline(h.text, {link: url => url})}</a></li>`).join('')}</ul></nav>` : ''}
</div>
<footer><p>Built from the repository by <code>scripts/build-docs.mjs</code>. Box3D is MIT licensed; this is a community project, not an official Box3D release.</p></footer>
</body>
</html>
`;
}
const files = new Map(assets);
for (const [path, p] of pages) files.set(path, render(path, p));
files.set('search-index.json', `${JSON.stringify(search)}\n`);
files.set('docs.css', read('scripts/docs-site/docs.css'));
files.set('docs.js', read('scripts/docs-site/docs.js'));

// ---- checks ----
function check() {
  const problems = [], ids = new Map();
  for (const [path, text] of files) if (path.endsWith('.html')) ids.set(path, new Set([...text.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])));
  for (const [path, text] of files) {
    if (!path.endsWith('.html')) continue;
    if ((text.match(/<h1[\s>]/g) ?? []).length !== 1) problems.push(`${path}: needs exactly one h1`);
    if (/<script(?![^>]*\bsrc=)|<style|\son\w+=/i.test(text)) problems.push(`${path}: inline script, style or handler (the page's own policy forbids them)`);
    for (const [, url] of text.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const href = url.replace(/&amp;/g, '&');
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [file, hash] = href.split('#'), [bare] = file.split('?');
      const target = bare === '' ? path : posix.normalize(posix.join(posix.dirname(path), bare));
      if (target.startsWith('../')) { if (!existsSync(join(root, 'public', target.slice(3))) && !existsSync(join(root, target.slice(3)))) problems.push(`${path}: link to ${href}, which is not in public/ or the site root`); continue; }
      if (!files.has(target)) { problems.push(`${path}: link to ${href}, which is not a page of the site`); continue; }
      if (hash && target.endsWith('.html') && !ids.get(target).has(decodeURIComponent(hash))) problems.push(`${path}: link to ${href}, but ${target} has no element with that id`);
    }
  }
  // The API reference must cover the generated listing, and descriptions may only be added.
  const exported = (api.match(/^### /gm) ?? []).length;
  if (exported !== totalSymbols) problems.push(`the API pages hold ${totalSymbols} symbols, API.md lists ${exported}`);
  if (undocumented > UNDOCUMENTED_MAX) problems.push(`${undocumented} public symbols have no doc comment; the ceiling is ${UNDOCUMENTED_MAX}. Add TSDoc to what you export (then lower UNDOCUMENTED_MAX in scripts/build-docs.mjs when the count falls).`);
  return problems;
}
/** Public symbols without a doc comment. A ratchet: lower it as descriptions are added; the check fails when the count rises above it. */
const UNDOCUMENTED_MAX = 280;

const problems = check(), bytes = [...files.values()].reduce((n, text) => n + Buffer.byteLength(text), 0);
if (problems.length > 0) { console.error(`docs: ${problems.length} problems\n${problems.slice(0, 40).join('\n')}`); process.exit(1); }
if (!process.argv.includes('--check')) {
  rmSync(out, {recursive: true, force: true});
  for (const [path, text] of files) { mkdirSync(dirname(join(out, path)), {recursive: true}); writeFileSync(join(out, path), text); }
}
console.log(`docs: ${[...files.keys()].filter(f => f.endsWith('.html')).length} pages, ${totalSymbols} API symbols (${undocumented} without a description), ${cards.length} examples, ${search.length} search entries, ${(bytes / 1024).toFixed(0)} KiB${process.argv.includes('--check') ? '; links and anchors resolve (nothing written)' : `; written to public/docs/`}`);
void readdirSync;
