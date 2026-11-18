// Draws ./validation.json (written by scripts/validation-report.mjs) as accessible tables.
// No dependencies, no inline code, no requests other than the JSON next to this file.
const SCHEMA = 'box3d-validation', VERSION = 1;

/** el('td', {class: 'value', 'data-label': 'Measured'}, 'text', node, ...) */
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) if (value !== null && value !== undefined && value !== false) node.setAttribute(name, value === true ? '' : value);
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
}
/** Text with `code spans` as nodes. The JSON is data, so it only ever becomes text nodes. */
function rich(text) {
  return String(text).split('`').map((part, i) => i % 2 ? el('code', {}, part) : part);
}
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fileName = file => file.split('/').pop();

function summaryRow(domain) {
  const failed = domain.cases - domain.passed;
  return el('tr', {}, el('th', {scope: 'row'}, el('a', {href: `#${domain.id}`}, domain.title)), el('td', {class: 'num'}, String(domain.cases)), el('td', {class: 'num'}, String(domain.passed)), el('td', {class: 'num'}, String(failed)));
}

function caseRow(row) {
  const search = [row.id, row.title, row.quantity, row.formula, row.note ?? '', row.source.file, row.source.test].join(' ').toLowerCase();
  return el('tr', {role: 'row', id: `case-${slug(row.id)}`, class: row.pass ? null : 'failed', 'data-search': search, 'data-pass': row.pass ? '1' : '0'},
    el('th', {role: 'rowheader', scope: 'row'}, row.title, el('span', {class: 'quantity'}, row.quantity), row.note ? el('span', {class: 'note'}, row.note) : null, row.failure ? el('span', {class: 'note'}, `Failure: ${row.failure}`) : null),
    el('td', {role: 'cell', 'data-label': 'Reference'}, el('span', {}, el('span', {class: 'reference-value'}, row.text.reference), el('span', {class: 'formula'}, row.formula))),
    el('td', {role: 'cell', class: 'value', 'data-label': 'Measured'}, row.text.measured),
    el('td', {role: 'cell', class: 'value', 'data-label': 'Error'}, row.text.error),
    el('td', {role: 'cell', 'data-label': 'Tolerance'}, row.text.tolerance),
    el('td', {role: 'cell', 'data-label': 'Result'}, el('span', {}, el('span', {class: `badge ${row.pass ? 'pass' : 'fail'}`}, row.pass ? 'Pass' : 'Fail'))),
    el('td', {role: 'cell', class: 'source', 'data-label': 'Test'}, el('a', {href: row.source.url, title: row.source.test, 'aria-label': `Test source ${row.source.file}: ${row.source.test}`}, fileName(row.source.file))));
}

function domainSection(domain, rows, repository) {
  const failed = domain.cases - domain.passed, heading = `${domain.id}-title`;
  const docs = domain.docs.map((doc, i) => [i ? ', ' : '', el('a', {href: `${repository}/blob/main/${doc}`}, doc)]);
  const columns = ['Case', 'Reference', 'Measured', 'Error', 'Tolerance', 'Result', 'Test'];
  return el('section', {id: domain.id, class: 'cases', 'aria-labelledby': heading},
    el('h2', {id: heading}, domain.title),
    el('p', {class: 'meta'}, domain.summary),
    el('p', {class: 'meta'}, 'Solver: ', rich(domain.solver), `. ${domain.cases} cases, ${domain.passed} pass${failed ? `, ${failed} fail` : ''}. Model and limits: `, docs, '.'),
    el('div', {class: 'scroll', role: 'region', 'aria-labelledby': heading, tabindex: '0'},
      el('table', {class: 'cases-table', role: 'table'},
        el('caption', {class: 'visually-hidden'}, `${domain.title}: reference, measured value, error, tolerance and result of each case`),
        el('thead', {role: 'rowgroup'}, el('tr', {role: 'row'}, columns.map((name, i) => el('th', {role: 'columnheader', scope: 'col', class: i === 2 || i === 3 ? 'num' : null}, name)))),
        el('tbody', {role: 'rowgroup'}, rows.map(caseRow)))),
    el('p', {class: 'muted empty', hidden: true}, 'No case of this domain matches the filter.'),
    el('details', {class: 'limits', open: true}, el('summary', {}, `What is not validated: ${domain.title.toLowerCase()}`), el('ul', {}, domain.notValidated.map(line => el('li', {}, rich(line))))));
}

function applyFilter(total) {
  const words = document.getElementById('filter').value.toLowerCase().split(/\s+/).filter(Boolean), failuresOnly = document.getElementById('failures').checked;
  let shown = 0;
  for (const section of document.querySelectorAll('section.cases')) {
    let visible = 0;
    for (const row of section.querySelectorAll('tbody tr')) {
      const match = words.every(word => row.dataset.search.includes(word)) && (!failuresOnly || row.dataset.pass === '0');
      row.hidden = !match;
      if (match) visible++;
    }
    section.querySelector('.scroll').hidden = visible === 0;
    section.querySelector('.empty').hidden = visible !== 0;
    shown += visible;
  }
  document.getElementById('filter-count').textContent = words.length || failuresOnly ? `${shown} of ${total} cases shown.` : '';
}

function draw(report) {
  if (report?.schema !== SCHEMA || report.version !== VERSION) throw new Error(`validation.json is not ${SCHEMA} version ${VERSION}`);
  const {totals} = report, status = document.getElementById('status');
  status.textContent = `${totals.cases} cases in ${totals.domains} domains: ${totals.passed} pass their tolerance${totals.failed ? `, ${totals.failed} fail` : ', none fail'}.`;
  status.classList.add(totals.failed ? 'bad' : 'ok');
  document.getElementById('summary-body').replaceChildren(...report.domains.map(summaryRow));
  document.getElementById('summary-foot').replaceChildren(el('tr', {}, el('th', {scope: 'row'}, 'All'), el('td', {class: 'num'}, String(totals.cases)), el('td', {class: 'num'}, String(totals.passed)), el('td', {class: 'num'}, String(totals.failed))));
  document.getElementById('domains').replaceChildren(...report.domains.map(domain => domainSection(domain, report.cases.filter(row => row.domain === domain.id), report.repository)));
  document.getElementById('schema').textContent = `${report.schema} version ${report.version}, ${report.digits} significant digits`;
  document.getElementById('overview').hidden = false;
  for (const id of ['filter', 'failures']) document.getElementById(id).addEventListener('input', () => applyFilter(totals.cases));
  // The anchor of the address (a domain or a case) exists only now.
  if (location.hash.length > 1) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({behavior: 'instant'});
}

fetch(new URL('./validation.json', import.meta.url), {credentials: 'same-origin'})
  .then(response => { if (!response.ok) throw new Error(`validation.json: HTTP ${response.status}`); return response.json(); })
  .then(draw)
  .catch(error => {
    const status = document.getElementById('status');
    status.classList.add('bad');
    status.replaceChildren(`The results could not be loaded (${error.message}). The same report is in `, el('a', {href: 'https://github.com/nathansenn/box3d-WEBGPU/blob/main/docs/VALIDATION.md'}, 'docs/VALIDATION.md'), '.');
  });
