// Printable paper labels at real size (CSS mm). Fits the card slots on bins.
const $ = (id) => document.getElementById(id);
const codes = new URLSearchParams(location.search).get('codes')?.split(',').filter(Boolean) ?? null;

const [categories, items] = await Promise.all([
  fetch('/api/categories').then((r) => r.json()),
  fetch('/api/catalog').then((r) => r.json()),
]);
const color = (code) => categories.find((c) => c.code === code)?.color ?? '#888';
const chosen = items.filter((i) => !codes || codes.includes(i.code)).sort((a, b) => a.code.localeCompare(b.code));

/** Shrink text until it fits the label width. */
function fit(node, maxPx) {
  let size = parseFloat(node.style.fontSize);
  while (node.scrollWidth > maxPx && size > 4) {
    size -= 0.25;
    node.style.fontSize = `${size}mm`;
  }
}

function render() {
  const sheet = $('sheet');
  sheet.replaceChildren();
  if (!chosen.length) {
    sheet.textContent = 'No catalog items. Add items in the Shop tab first.';
    return;
  }
  const defW = Number($('w').value) || 72;
  const defH = Number($('h').value) || 14;
  for (const item of chosen) {
    const w = $('useCard').checked && item.labelCard ? item.labelCard.width : defW;
    const h = $('useCard').checked && item.labelCard ? item.labelCard.height : defH;
    const label = document.createElement('div');
    label.className = 'label';
    label.style.width = `${w}mm`;
    label.style.height = `${h}mm`;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.background = color(item.category);
    const l1 = document.createElement('div');
    l1.className = 'l1';
    l1.textContent = item.name;
    l1.style.fontSize = `${h * 0.42}mm`;
    const l2 = document.createElement('div');
    l2.className = 'l2';
    l2.textContent = item.location ? `${item.code} / ${item.location}` : item.code;
    l2.style.fontSize = `${h * 0.24}mm`;
    label.append(bar, l1, l2);
    $('sheet').append(label);
    const inner = label.clientWidth - 6 * (96 / 25.4);
    fit(l1, inner);
    fit(l2, inner);
  }
}

for (const id of ['w', 'h', 'useCard']) $(id).addEventListener('input', render);
$('print').onclick = () => window.print();
render();
