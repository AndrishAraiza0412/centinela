// Helpers de DOM compartidos. Todo texto entra con textContent (spec §5).

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

export const time = (ts) => new Date(ts).toLocaleTimeString('es', { hour12: false });

export function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
