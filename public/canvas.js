// Lienzo de agentes: cámara (desplazar/zoom), distribución en árbol por sesión y aristas.
// Las tarjetas son DOM normal dentro de un "mundo" transformado; las aristas, un SVG en el mismo mundo.
import { el } from '/dom.js';

const NS = 'http://www.w3.org/2000/svg';
const GAP_X = 168; // deja sitio a la etiqueta de la arista entre tarjeta y tarjeta
const GAP_Y = 28;
const SESSION_GAP = 56;
const FIT_MIN = 0.85; // encuadrar nunca deja las tarjetas ilegibles: mejor desplazar
const ANCHOR_Y = 30; // altura de la cabecera de la tarjeta donde nacen y llegan las aristas
const Z_MIN = 0.3;
const Z_MAX = 1.5;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// insetBottom: alto de lo que flota sobre el lienzo (la barra de comandos); la cámara nunca deja nada debajo.
export function createCanvas(root, { onZoom = () => {}, onBackground = () => {}, insetBottom = () => 0 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'edges');
  svg.setAttribute('aria-hidden', 'true');
  const world = el('div', { class: 'world' }, svg);
  root.append(world);

  const cam = { x: 48, y: 48, z: 1 };
  let userMoved = false;
  let layoutSig = '';
  let positions = new Map();
  const labels = new Map(); // id de arista -> etiqueta HTML

  function apply() {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    root.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    root.style.backgroundSize = `${18 * cam.z}px ${18 * cam.z}px`;
    onZoom(cam.z);
  }

  function zoomAt(cx, cy, factor) {
    const r = root.getBoundingClientRect();
    const mx = cx - r.left;
    const my = cy - r.top;
    const z = clamp(cam.z * factor, Z_MIN, Z_MAX);
    cam.x = mx - (mx - cam.x) * (z / cam.z);
    cam.y = my - (my - cam.y) * (z / cam.z);
    cam.z = z;
    userMoved = true;
    apply();
  }

  // Trackpad: dos dedos desplaza, pellizco (ctrl) hace zoom. Rueda con ⌘ también hace zoom.
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else {
      cam.x -= e.deltaX;
      cam.y -= e.deltaY;
      userMoved = true;
      apply();
    }
  }, { passive: false });

  // Arrastrar el fondo desplaza; un clic sin arrastre sobre el fondo deselecciona.
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.card, .edge-label')) return;
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
    root.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    cam.x = drag.cx + dx;
    cam.y = drag.cy + dy;
    if (drag.moved) userMoved = true;
    apply();
  });
  const endDrag = () => {
    if (drag && !drag.moved) onBackground();
    drag = null;
    root.classList.remove('dragging');
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  // Árbol por sesión, de izquierda a derecha; sesiones apiladas en el orden en que empezaron.
  function layout(nodes, edges, sizeOf) {
    const ids = new Set(nodes.map((n) => n.id));
    const kids = new Map();
    const hasParent = new Set();
    for (const e of edges) {
      if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
      (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)).push(e.to);
      hasParent.add(e.to);
    }
    const start = new Map(nodes.map((n) => [n.id, n.startedAt]));
    const byStart = (a, b) => start.get(a) - start.get(b);
    const pos = new Map();
    const seen = new Set();
    const place = (id, x, y) => {
      seen.add(id);
      const { w, h } = sizeOf(id);
      pos.set(id, { x, y, w, h });
      let cy = y;
      for (const k of (kids.get(id) ?? []).sort(byStart)) {
        if (seen.has(k)) continue;
        cy += place(k, x + w + GAP_X, cy) + GAP_Y;
      }
      return Math.max(h, cy - y - GAP_Y);
    };
    // Cada sesión se distribuye sola en (0,0); luego los árboles se acomodan en filas
    // del ancho del lienzo, como un tablero, en lugar de una columna interminable.
    const trees = [];
    const tree = (rootId) => {
      const before = new Set(pos.keys());
      place(rootId, 0, 0);
      const ids = [...pos.keys()].filter((id) => !before.has(id));
      const w = Math.max(...ids.map((id) => pos.get(id).x + pos.get(id).w));
      const h = Math.max(...ids.map((id) => pos.get(id).y + pos.get(id).h));
      trees.push({ ids, w, h });
    };
    for (const id of nodes.map((n) => n.id).filter((id) => !hasParent.has(id)).sort(byStart)) tree(id);
    for (const n of nodes) if (!seen.has(n.id)) tree(n.id); // ciclos: nunca perder un nodo
    const maxW = Math.max(...trees.map((t) => t.w), (root.clientWidth - 112) / 0.85);
    let x = 0, y = 0, rowH = 0;
    for (const t of trees) {
      if (x > 0 && x + t.w > maxW) { x = 0; y += rowH + SESSION_GAP; rowH = 0; }
      for (const id of t.ids) { const p = pos.get(id); p.x += x; p.y += y; }
      x += t.w + SESSION_GAP;
      rowH = Math.max(rowH, t.h);
    }
    return pos;
  }

  function fit() {
    if (!positions.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of positions.values()) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
    }
    const r = root.getBoundingClientRect();
    const pad = 56;
    const z = clamp(Math.min((r.width - pad * 2) / (x1 - x0), (r.height - insetBottom() - pad * 2) / (y1 - y0)), FIT_MIN, 1);
    cam.z = z;
    cam.x = Math.max(pad, (r.width - (x1 - x0) * z) / 2) - x0 * z;
    cam.y = pad - y0 * z;
    apply();
  }

  function edgePath(a, b) {
    const x1 = a.x + a.w;
    const y1 = a.y + ANCHOR_Y;
    const x2 = b.x;
    const y2 = b.y + ANCHOR_Y;
    const dx = Math.max(40, (x2 - x1) / 2);
    return { d: `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  }

  // cards: Map id -> elemento ya actualizado. edges: aristas del estado. status: id -> status.
  // waitingId: el agente que espera un permiso; mientras el usuario no mueva la cámara, queda a la vista.
  let lastWaiting = null;
  function render(nodes, edges, cards, status, waitingId = null) {
    for (const [id, card] of cards) {
      if (card.parentNode !== world) world.append(card);
      card.dataset.id = id;
    }
    for (const child of [...world.children]) {
      if (child.classList.contains('card') && !cards.has(child.dataset.id)) child.remove();
    }
    const sizeOf = (id) => ({ w: cards.get(id).offsetWidth, h: cards.get(id).offsetHeight });
    positions = layout(nodes, edges, sizeOf);
    for (const [id, p] of positions) {
      const card = cards.get(id);
      card.style.transform = `translate(${p.x}px, ${p.y}px)`;
      // Solo después de la primera colocación se anima el movimiento (nada vuela desde 0,0).
      if (!card.classList.contains('placed')) requestAnimationFrame(() => card.classList.add('placed'));
    }

    svg.replaceChildren();
    const live = new Set();
    for (const e of edges) {
      const a = positions.get(e.from);
      const b = positions.get(e.to);
      if (!a || !b) continue;
      const { d, mx, my } = edgePath(a, b);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `edge edge-${status.get(e.to) ?? 'idle'}`);
      svg.append(path);
      if (!e.label) continue;
      const key = `${e.from}>${e.to}`;
      live.add(key);
      let label = labels.get(key);
      if (!label) {
        label = el('div', { class: 'edge-label' });
        labels.set(key, label);
        world.append(label);
      }
      label.textContent = e.label;
      label.title = e.label;
      label.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
    }
    for (const [key, label] of labels) if (!live.has(key)) { label.remove(); labels.delete(key); }

    // Mientras el usuario no mueva la cámara, cada agente nuevo vuelve a encuadrarse.
    const sig = [...positions.keys()].sort().join('|');
    if (!userMoved && (sig !== layoutSig || waitingId !== lastWaiting)) {
      fit();
      if (waitingId) show(waitingId);
    }
    layoutSig = sig;
    lastWaiting = waitingId;
  }

  // Lleva la tarjeta entera a la zona visible (sobre la barra de comandos); si no cabe, su parte de arriba.
  function focus(id) {
    if (show(id)) userMoved = true;
  }
  function show(id) {
    const p = positions.get(id);
    if (!p) return false;
    const r = root.getBoundingClientRect();
    const pad = 24;
    const visibleH = r.height - insetBottom();
    cam.z = Math.max(cam.z, 0.9);
    cam.x = r.width / 2 - (p.x + p.w / 2) * cam.z;
    const h = p.h * cam.z;
    cam.y = (h <= visibleH - pad * 2 ? (visibleH - h) / 2 : pad) - p.y * cam.z;
    apply();
    return true;
  }

  const zoomBy = (factor) => {
    const r = root.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };
  const reset = () => {
    userMoved = false;
    fit();
  };

  apply();
  return { render, focus, zoomBy, reset };
}
