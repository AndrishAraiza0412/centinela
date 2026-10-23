// Panel: snapshot por SSE + reduce local de cada evento; lienzo de tarjetas, cajón de detalle,
// barra de comandos y línea de tiempo. Todo texto de eventos entra con textContent (spec §5).
import { reduce, nodeId } from '/shared/graph.js';
import { el, time, load, save } from '/dom.js';
import { icon } from '/icons.js';
import { createCanvas } from '/canvas.js';
import { createCard, STATUS_LABEL } from '/cards.js';
import { api, initControls, buildControls, permissionsByNode, notifyPermission } from '/control.js';

const ACTIVE = new Set(['idle', 'working', 'waiting']);
const LIVE = new Set(['idle', 'working', 'waiting']);
const RAW_PER_NODE = 200;
const RESTARTED = 'Centinela se reinició o este enlace ya se usó. Abre la URL nueva que imprime «node bin/centinela.js» en tu terminal.';

const $ = (sel) => document.querySelector(sel);
let token = null;
let state = null;
let selected = null;
let selectWhenLaunched = null; // agentKey recién lanzado: se selecciona cuando aparezca su nodo
let project = load('centinela-project') ?? '';
let view = load('centinela-view') === 'timeline' ? 'timeline' : 'canvas';
const raw = new Map(); // nodeId -> registros vistos desde que se abrió la página
const cards = new Map(); // nodeId -> { el, update }
const basename = (p) => (p ? p.split('/').filter(Boolean).pop() : '') || p || '';

// ---------- emparejamiento ----------

// La URL trae un código de un solo uso (#pair=…) que se canjea por el ui-token; el token
// vive solo en esta pestaña. Nada reutilizable queda en el historial del navegador.
async function obtainToken() {
  const m = /pair=([0-9a-f]+)/.exec(location.hash);
  if (!m) {
    try { return sessionStorage.getItem('centinela-token'); } catch { return null; }
  }
  history.replaceState(null, '', location.pathname);
  const res = await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: m[1] }) });
  if (!res.ok) return null;
  const { token } = await res.json();
  try { sessionStorage.setItem('centinela-token', token); } catch {}
  return token;
}

// ---------- marco: iconos, vistas, zoom ----------

$('#logo').append(icon('logo', { size: 20 }));
document.querySelector('[data-view="canvas"]').append(icon('canvas'), 'Lienzo de agentes');
document.querySelector('[data-view="timeline"]').append(icon('timeline'), 'Línea de tiempo');
$('#new-agent').append(icon('plus'), 'Nuevo agente');
$('#zoom-out').append(icon('minus'));
$('#zoom-in').append(icon('plus'));
$('#say-send').append(icon('send'));
$('#drawer-close').append(icon('close'));
$('#notify').append(icon('bell'), 'Activar avisos');

const canvas = createCanvas($('#canvas'), {
  onZoom: (z) => ($('#zoom-level').value = `${Math.round(z * 100)}%`),
  onBackground: () => select(null),
  insetBottom: () => $('#commandbar').offsetHeight + 30,
});
$('#zoom-in').addEventListener('click', () => canvas.zoomBy(1.2));
$('#zoom-out').addEventListener('click', () => canvas.zoomBy(1 / 1.2));
$('#zoom-fit').addEventListener('click', () => canvas.reset());

function setView(v) {
  view = v;
  save('centinela-view', v);
  for (const b of document.querySelectorAll('.nav-item')) {
    if (b.dataset.view === v) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  $('#canvas').hidden = v !== 'canvas';
  $('#timeline').hidden = v !== 'timeline';
  $('.zoom').hidden = v !== 'canvas';
  scheduleRender();
}
for (const b of document.querySelectorAll('.nav-item')) b.addEventListener('click', () => setView(b.dataset.view));
$('#filter-active').addEventListener('change', scheduleRender);
$('#drawer-close').addEventListener('click', () => select(null));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected && !document.querySelector('dialog[open]')) select(null);
});

function setConn(text, cls) {
  const c = $('#conn');
  c.replaceChildren(el('span', { class: 'conn-dot', 'aria-hidden': 'true' }), text);
  c.className = `conn ${cls}`;
}

function select(id) {
  selected = id;
  scheduleRender();
}

// ---------- qué se ve ----------

// Un agente que espera un permiso se ve siempre, aunque el filtro lo esconda: nadie debe esperarte a oscuras.
function visibleNodes() {
  const onlyActive = $('#filter-active').checked;
  const waiting = new Set(Object.values(state.pending).map((p) => p.nodeId));
  return Object.values(state.nodes).filter((n) => waiting.has(n.id)
    || ((!project || n.cwd === project) && (!onlyActive || ACTIVE.has(n.status))));
}

const liveLaunched = () => Object.values(state.nodes).filter((n) => n.launched && LIVE.has(n.status));

// ---------- barra superior: contadores y pestañas ----------

function renderCounters() {
  const nodes = Object.values(state.nodes);
  const count = (s) => nodes.filter((n) => n.status === s).length;
  const pending = Object.values(state.pending);
  const waitingBtn = el('button', {
    type: 'button', class: 'counter-btn', disabled: !pending.length,
    title: pending.length ? 'Ir al agente que te espera' : undefined,
    onclick: () => {
      const target = pending.toSorted((a, b) => a.ts - b.ts)[0];
      if (!target) return;
      setView('canvas');
      // En pantallas estrechas el cajón tapa el lienzo, y la aprobación vive en la tarjeta: solo enfocar.
      if (!matchMedia('(max-width: 760px)').matches) select(target.nodeId);
      requestAnimationFrame(() => canvas.focus(target.nodeId));
    },
  }, String(pending.length));
  $('#counters').replaceChildren(
    el('div', { class: 'counter' }, el('dt', { text: 'Agentes' }), el('dd', { text: `${nodes.filter((n) => ACTIVE.has(n.status)).length}/${nodes.length}` })),
    el('div', { class: 'counter c-working' }, el('dt', { text: 'Trabajando' }), el('dd', { text: String(count('working')) })),
    el('div', { class: `counter c-waiting${pending.length ? ' hot' : ''}` }, el('dt', { text: 'Te esperan' }), el('dd', {}, waitingBtn)),
    el('div', { class: 'counter' }, el('dt', { text: 'Inactivos' }), el('dd', { text: String(count('idle')) })),
  );
}

function renderTabs() {
  const projects = new Map();
  for (const n of Object.values(state.nodes)) {
    if (!n.cwd) continue;
    const p = projects.get(n.cwd) ?? { working: 0, waiting: 0 };
    if (n.status === 'working') p.working++;
    if (n.status === 'waiting') p.waiting++;
    projects.set(n.cwd, p);
  }
  if (project && !projects.has(project)) project = '';
  const tab = (value, label, info) => el('button', {
    type: 'button', role: 'tab', class: 'tab', title: value || 'Todos los proyectos',
    'aria-selected': String(project === value),
    onclick: () => {
      project = value;
      save('centinela-project', value);
      scheduleRender();
    },
  }, info ? el('span', { class: `tab-dot ${info.waiting ? 'waiting' : info.working ? 'working' : ''}`, 'aria-hidden': 'true' }) : null, label);
  $('#tabs').replaceChildren(tab('', 'Todos'), ...[...projects].map(([cwd, info]) => tab(cwd, basename(cwd), info)));
}

// ---------- lienzo ----------

function renderCanvas(nodes) {
  const byNode = permissionsByNode(state);
  const ids = new Set(nodes.map((n) => n.id));
  for (const id of cards.keys()) if (!ids.has(id)) cards.delete(id);
  const status = new Map();
  const els = new Map();
  for (const n of nodes) {
    let card = cards.get(n.id);
    if (!card) {
      card = createCard(n, { onSelect: select });
      cards.set(n.id, card);
    }
    card.update(n, { selected: n.id === selected, permissions: byNode.get(n.id) ?? [] });
    status.set(n.id, n.status);
    els.set(n.id, card.el);
  }
  const waiting = Object.values(state.pending).toSorted((a, b) => a.ts - b.ts)[0];
  canvas.render(nodes, state.edges, els, status, waiting?.nodeId ?? null);
}

// ---------- cajón de detalle ----------

// El esqueleto (incluidos los campos de texto) se construye una vez por nodo;
// cada evento solo actualiza su contenido, así no se pierde lo que el usuario escribe.
let panel = null;

function buildPanel(n) {
  const id = n.id;
  const parts = {
    key: `${n.id}|${n.launched ?? ''}`,
    title: el('h2'), kind: el('p', { class: 'drawer-kind' }), status: el('span'),
    task: el('dd'), cwd: el('dd'), now: el('dd'), start: el('dd'),
    convHead: el('h3', { class: 'caps', text: 'Conversación' }), conv: el('ol', { class: 'conversation' }),
    actHead: el('h3', { class: 'caps' }), actions: el('div'),
    exit: el('section', { class: 'exit', hidden: true }),
    controls: buildControls(n),
    sig: {},
  };
  const rawPre = el('pre', { class: 'raw', hidden: true });
  const toggle = el('button', {
    type: 'button', class: 'raw-toggle', 'aria-expanded': 'false', text: 'Ver JSON crudo',
    onclick: () => {
      const open = rawPre.hidden;
      rawPre.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Ocultar JSON crudo' : 'Ver JSON crudo';
      if (open) rawPre.textContent = JSON.stringify({ nodo: state.nodes[id], eventos: raw.get(id) ?? [] }, null, 2);
    },
  });
  parts.root = el('div', { class: 'drawer-body' },
    el('header', { class: 'drawer-head' }, parts.title, parts.status),
    parts.kind,
    el('dl', { class: 'facts' },
      el('dt', { text: 'Tarea' }), parts.task,
      el('dt', { text: 'Proyecto' }), parts.cwd,
      el('dt', { text: 'Ahora' }), parts.now,
      el('dt', { text: 'Inicio' }), parts.start),
    parts.exit,
    parts.controls.el,
    parts.convHead, parts.conv,
    parts.actHead, parts.actions,
    toggle, rawPre);
  return parts;
}

function refill(parts, name, sig, build) {
  if (parts.sig[name] === sig) return;
  parts.sig[name] = sig;
  parts[name].replaceChildren(...build());
}

function renderDrawer() {
  const n = selected && state.nodes[selected];
  $('#drawer').hidden = !n;
  if (!n) {
    panel = null;
    return;
  }
  if (panel?.key !== `${n.id}|${n.launched ?? ''}`) {
    panel = buildPanel(n);
    $('#panel').replaceChildren(panel.root);
  }
  panel.title.textContent = n.role;
  panel.kind.textContent = n.launched ? 'Lanzado desde el panel' : n.agentId ? 'Subagente' : 'Sesión de terminal';
  panel.status.className = `pill pill-${n.status}`;
  panel.status.textContent = STATUS_LABEL[n.status] ?? n.status;
  panel.task.textContent = state.edges.find((e) => e.to === n.id)?.label || '—';
  panel.cwd.textContent = n.cwd || '—';
  panel.now.textContent = n.current || '—';
  panel.start.textContent = time(n.startedAt);
  panel.controls.update(n);
  panel.exit.hidden = !n.exit;
  if (n.exit) {
    const how = n.exit.signal ? `señal ${n.exit.signal}` : `código ${n.exit.code}`;
    refill(panel, 'exit', JSON.stringify(n.exit), () => [
      el('h3', { class: 'caps', text: `Salida del proceso · ${how}` }),
      n.exit.error ? el('p', { class: 'error', text: n.exit.error }) : null,
      n.exit.stderrTail ? el('pre', { class: 'raw', text: n.exit.stderrTail }) : el('p', { class: 'note', text: 'Sin salida de error.' }),
    ]);
  }

  const messages = n.messages ?? [];
  panel.convHead.hidden = panel.conv.hidden = !n.launched;
  refill(panel, 'conv', `${n.msgSeq ?? messages.length}`, () => messages.map((m) =>
    el('li', { class: `msg ${m.from}` },
      el('span', { class: 'who', text: `${m.from === 'user' ? 'Tú' : n.role} · ${time(m.ts)}` }),
      el('p', { text: m.text }))));

  panel.actHead.textContent = `Acciones · ${n.actions.length}`;
  const recent = n.actions.slice(-100).reverse();
  refill(panel, 'actions', `${n.actions.length}|${recent.map((a) => a.ok).join()}`, () => recent.length
    ? [el('ol', { class: 'term' }, ...recent.map((a) =>
      el('li', { class: `line r-${a.ok}` },
        el('span', { class: 'mark' }, icon(a.ok === true ? 'check' : a.ok === false ? 'x' : 'loader', { size: 13, label: a.ok === true ? 'bien' : a.ok === false ? 'falló' : 'en curso' })),
        el('span', { class: 'what', text: a.summary }),
        el('time', { text: time(a.ts) }))))]
    : [el('p', { class: 'note', text: 'Sin acciones todavía.' })]);
}

// ---------- barra de comandos ----------

let stopArmed = null;

function renderCommandBar() {
  const live = liveLaunched();
  const target = $('#say-target');
  const keep = target.value;
  const sel = selected && state.nodes[selected];
  const preferred = sel?.launched && LIVE.has(sel.status) ? sel.launched : null;
  const sig = `${live.map((n) => n.launched).join()}|${preferred}`;
  if (target.dataset.sig !== sig) {
    target.dataset.sig = sig;
    target.replaceChildren(
      el('option', { value: '*', text: `Todos los lanzados (${live.length})` }),
      ...live.map((n) => el('option', { value: n.launched, text: `${n.role} · ${basename(n.cwd)}` })));
    const values = new Set(['*', ...live.map((n) => n.launched)]);
    target.value = preferred ?? (values.has(keep) ? keep : '*');
  }
  const none = live.length === 0;
  $('#say-text').disabled = none;
  $('#say-send').disabled = none;
  target.disabled = none;
  $('#say-text').placeholder = none
    ? 'No hay agentes lanzados vivos: lanza uno con «Nuevo agente».'
    : target.value === '*' ? `Habla con los ${live.length} agentes lanzados…` : 'Habla con este agente…';

  const stop = $('#op-stop-all');
  stop.disabled = none;
  if (!stopArmed) stop.replaceChildren(icon('stop'), el('span', { class: 'long', text: 'Detener todos' }), ` (${live.length})`);
}

$('#op-stop-all').addEventListener('click', async () => {
  const stop = $('#op-stop-all');
  const live = liveLaunched();
  // Dos pasos: detener a todos no se deshace.
  if (!stopArmed) {
    stopArmed = setTimeout(() => { stopArmed = null; renderCommandBar(); }, 4000);
    stop.classList.add('armed');
    stop.replaceChildren(icon('alert'), `Confirmar: detener ${live.length}`);
    return;
  }
  clearTimeout(stopArmed);
  stopArmed = null;
  stop.classList.remove('armed');
  const results = await Promise.all(live.map((n) => api('POST', `/api/agents/${n.launched}/stop`)));
  $('.say-status').textContent = `Detenidos: ${results.filter((r) => r.ok).length} de ${live.length}.`;
  renderCommandBar();
});

$('#commandbar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#say-text').value;
  if (!text.trim()) return;
  const target = $('#say-target').value;
  const keys = target === '*' ? liveLaunched().map((n) => n.launched) : [target];
  $('#say-send').disabled = true;
  const results = await Promise.all(keys.map((k) => api('POST', `/api/agents/${k}/prompt`, { text })));
  $('#say-send').disabled = false;
  const ok = results.filter((r) => r.ok).length;
  $('.say-status').textContent = ok === keys.length
    ? `Enviado a ${ok} ${ok === 1 ? 'agente' : 'agentes'}.`
    : `Enviado a ${ok} de ${keys.length}: ${results.find((r) => !r.ok)?.data?.error ?? 'error'}`;
  if (ok) $('#say-text').value = '';
});
$('#say-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#commandbar').requestSubmit();
});
$('#say-target').addEventListener('change', renderCommandBar);

// ---------- línea de tiempo ----------

function renderTimeline(nodes) {
  const box = $('#timeline');
  if (!nodes.length) {
    box.replaceChildren(el('p', { class: 'note', text: 'Sin agentes todavía.' }));
    return;
  }
  const now = Date.now();
  const t0 = Math.min(...nodes.map((n) => n.startedAt));
  const span = Math.max(now - t0, 1000);
  const pct = (t) => `${((t - t0) / span) * 100}%`;
  box.replaceChildren(
    el('div', { class: 'lane lane-head' }, el('span', { class: 'caps', text: 'Agente' }), el('span', { class: 'axis' },
      el('span', { text: time(t0) }), el('span', { text: 'ahora' }))),
    ...nodes.map((n) => {
      const track = el('div', { class: 'track' });
      n.actions.forEach((a, i) => {
        const end = n.actions[i + 1]?.ts ?? n.endedAt ?? now;
        const block = el('div', { class: `block ok-${a.ok}`, title: `${time(a.ts)} ${a.summary}` });
        block.style.left = pct(a.ts);
        block.style.width = `${((end - a.ts) / span) * 100}%`;
        track.append(block);
      });
      return el('div', { class: `lane st-${n.status}` },
        el('button', { type: 'button', 'aria-pressed': String(n.id === selected), title: n.cwd, onclick: () => select(n.id) },
          el('span', { class: 'lane-dot', 'aria-hidden': 'true' }), n.role),
        track);
    }));
}
setInterval(() => state && view === 'timeline' && renderTimeline(visibleNodes()), 2000);

// ---------- render ----------

let frame = 0;
function scheduleRender() {
  if (frame || !state) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function render() {
  if (selectWhenLaunched) {
    const launched = Object.values(state.nodes).find((n) => n.launched === selectWhenLaunched);
    if (launched) {
      selected = launched.id;
      selectWhenLaunched = null;
    }
  }
  if (selected && !state.nodes[selected]) selected = null;
  const nodes = visibleNodes();
  const empty = Object.keys(state.nodes).length === 0;
  $('#empty').hidden = !empty;
  if (empty) {
    $('#empty').replaceChildren(
      el('strong', { text: 'Todavía no hay agentes.' }),
      el('span', { text: 'Abre una sesión de Claude Code en tu terminal (los hooks la traen aquí) o lanza uno con «Nuevo agente».' }));
  }
  renderCounters();
  renderTabs();
  if (view === 'canvas') renderCanvas(nodes);
  else renderTimeline(nodes);
  renderDrawer();
  renderCommandBar();
}

function recNodeId(rec) {
  const b = rec.body ?? {};
  if ((rec.kind === 'hook' || rec.kind === 'permission') && b.session_id) return nodeId(b.session_id, b.agent_id);
  return null;
}

function apply(rec) {
  const id = recNodeId(rec);
  if (id) {
    const list = raw.get(id) ?? [];
    list.push(rec);
    if (list.length > RAW_PER_NODE) list.shift();
    raw.set(id, list);
  }
  reduce(state, rec);
  notifyPermission(rec, state);
}

function showFatal(text) {
  setConn('Sin conexión', 'down');
  $('#empty').hidden = false;
  $('#empty').replaceChildren(el('strong', { text: 'Sin conexión con Centinela.' }), el('span', { text }));
}

function connect() {
  const es = new EventSource(`/events?token=${encodeURIComponent(token)}`);
  // El servidor manda el estado completo como primer frame de cada conexión (y de cada reconexión).
  es.addEventListener('snapshot', (msg) => {
    state = JSON.parse(msg.data);
    setConn('En vivo', 'live');
    scheduleRender();
  });
  es.onmessage = (msg) => {
    if (!state) return;
    apply(JSON.parse(msg.data));
    scheduleRender();
  };
  es.onerror = async () => {
    setConn('Reconectando…', 'down');
    // EventSource no expone el 401: si el token dejó de valer (Centinela se reinició), hay que volver a emparejar.
    const probe = await fetch('/api/state', { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (probe?.status === 401) {
      es.close();
      try { sessionStorage.removeItem('centinela-token'); } catch {}
      showFatal(RESTARTED);
    }
  };
}

setView(view);
token = await obtainToken();
if (token) {
  initControls({ token, getSelected: () => state?.nodes[selected], onLaunched: (agentKey) => (selectWhenLaunched = agentKey) });
  connect();
} else showFatal(RESTARTED);
