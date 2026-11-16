// Client-side search of the documentation site and small conveniences. No dependencies; the index is one JSON file
// written by scripts/build-docs.mjs, fetched when the search box is first used.
const root = document.body.dataset.root || '.';
const input = document.getElementById('search-input'), list = document.getElementById('search-results');
let index = null, loading = null, selected = -1;

const load = () => loading ??= fetch(`${root}/search-index.json`).then(response => response.ok ? response.json() : []).then(entries => { index = entries; }).catch(() => { index = []; });
function rank(entry, words) {
  const title = entry.t.toLowerCase();
  let score = 0;
  for (const word of words) {
    const at = title.indexOf(word);
    if (at === 0) score += title.length === word.length ? 100 : 60;
    else if (at > 0) score += 30;
    else if (entry.k.toLowerCase().includes(word) || entry.d.toLowerCase().includes(word)) score += 8;
    else return 0;
  }
  return score - Math.min(20, title.length / 4);
}
function show() {
  const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  list.textContent = ''; selected = -1;
  if (words.length === 0 || index === null) { close(); return; }
  const found = index.map(entry => [rank(entry, words), entry]).filter(([score]) => score > 0).sort((a, b) => b[0] - a[0] || a[1].t.localeCompare(b[1].t)).slice(0, 30);
  if (found.length === 0) {
    const none = document.createElement('li'); none.className = 'none'; none.textContent = 'Nothing found.'; list.append(none);
  }
  for (const [, entry] of found) {
    const item = document.createElement('li'), link = document.createElement('a'), where = document.createElement('span');
    item.setAttribute('role', 'option'); item.setAttribute('aria-selected', 'false');
    link.href = `${root}/${entry.u}`; link.textContent = entry.t; link.tabIndex = -1;
    where.className = 'where'; where.textContent = entry.d ? `${entry.k}: ${entry.d}` : entry.k;
    link.append(where); item.append(link); list.append(item);
  }
  list.hidden = false; input.setAttribute('aria-expanded', 'true');
}
function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); selected = -1; }
function move(step) {
  const items = [...list.querySelectorAll('li[role="option"]')];
  if (items.length === 0) return;
  if (selected >= 0) items[selected].setAttribute('aria-selected', 'false');
  selected = (selected + step + items.length) % items.length;
  items[selected].setAttribute('aria-selected', 'true');
  items[selected].scrollIntoView({block: 'nearest'});
}
if (input && list) {
  input.addEventListener('focus', () => { load().then(show); });
  input.addEventListener('input', () => { load().then(show); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter') { const link = list.querySelector(`li[aria-selected="true"] a`) ?? list.querySelector('li[role="option"] a'); if (link) location.href = link.href; }
    else if (event.key === 'Escape') { close(); input.blur(); }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.search')) close(); });
  document.addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); input.focus(); input.select(); }
  });
}
// On a phone the section list starts closed, so the page content is first.
const side = document.querySelector('.side details');
if (side && matchMedia('(max-width: 48rem)').matches) side.open = false;
