// Controles: lanzar agentes, conversar con ellos, continuar sesiones de terminal y aprobar permisos.
import { describePermission, reveal } from '/shared/graph.js';
import { el, load, save } from '/dom.js';
import { icon } from '/icons.js';

const LIVE = new Set(['idle', 'working', 'waiting']);
let token = null;
let onLaunched = () => {};

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}
const errorText = (r) => r.data?.error ?? `Error ${r.status}`;

// Devuelve si hay al menos un rol lanzable; si no, el selector lo dice en vez de quedarse vacío.
async function fillRoles(select, cwd, err) {
  select.replaceChildren();
  select.disabled = false;
  const none = (text) => {
    select.append(el('option', { value: '', text }));
    select.disabled = true;
    return false;
  };
  if (!cwd) return none('Primero indica la carpeta');
  const r = await api('GET', `/api/roles?cwd=${encodeURIComponent(cwd)}`);
  if (!r.ok) {
    err.textContent = errorText(r);
    return none('Sin roles disponibles');
  }
  err.textContent = r.data.length ? '' : 'No hay roles: crea uno en tu carpeta de agentes de Claude Code o en .claude/agents del proyecto.';
  if (!r.data.some((x) => !x.conflict)) return none('Sin roles disponibles');
  const source = { centinela: 'incluido', user: 'tuyo', project: 'del proyecto' };
  select.append(...r.data.map((x) => el('option', {
    value: x.name,
    disabled: x.conflict,
    text: `${x.name} (${source[x.source]})${x.conflict ? ' — también existe en el proyecto: renombra uno' : x.description ? ` — ${x.description}` : ''}`,
  })));
  return true;
}

// ---------- nuevo agente ----------

function setupDialog(getSelected) {
  const dialog = document.querySelector('#launch-dialog');
  const form = dialog.querySelector('form');
  const { cwd, role, model, prompt, trust } = form.elements;
  model.value = load('centinela-model') ?? '';
  const err = dialog.querySelector('.error');
  const trustRow = dialog.querySelector('.trust');
  const submit = form.querySelector('button[value="launch"]');

  document.querySelector('#new-agent').addEventListener('click', () => {
    cwd.value = getSelected()?.cwd || load('centinela-cwd') || '';
    err.textContent = '';
    trust.checked = false;
    trustRow.hidden = true;
    dialog.showModal();
    fillRoles(role, cwd.value, err);
  });
  cwd.addEventListener('change', () => {
    trust.checked = false;
    trustRow.hidden = true;
    fillRoles(role, cwd.value.trim(), err);
  });
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value === 'cancel') return; // method=dialog: cierra
    e.preventDefault();
    submit.disabled = true;
    const r = await api('POST', '/api/agents', { role: role.value, model: model.value, cwd: cwd.value.trim(), prompt: prompt.value, trustProject: trust.checked });
    submit.disabled = false;
    if (!r.ok) {
      if (r.data?.code === 'untrusted') trustRow.hidden = false;
      return void (err.textContent = errorText(r));
    }
    save('centinela-cwd', cwd.value.trim());
    save('centinela-model', model.value);
    prompt.value = '';
    dialog.close();
    onLaunched(r.data.agentKey);
  });
}

// ---------- panel: controles del nodo seleccionado ----------

function launchedControls(n, err) {
  const text = el('textarea', { rows: '3', 'aria-label': 'Prompt para el agente', placeholder: 'Escribe un prompt… (⌘↩ envía)' });
  const send = el('button', { type: 'submit', class: 'primary', text: 'Enviar' });
  const stop = el('button', {
    type: 'button', class: 'danger', text: 'Detener',
    onclick: async () => {
      stop.disabled = true;
      const r = await api('POST', `/api/agents/${n.launched}/stop`);
      if (!r.ok) { err.textContent = errorText(r); stop.disabled = false; }
    },
  });
  const form = el('form', {
    class: 'composer',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!text.value.trim()) return;
      send.disabled = true;
      const r = await api('POST', `/api/agents/${n.launched}/prompt`, { text: text.value });
      send.disabled = false;
      if (!r.ok) return void (err.textContent = errorText(r));
      text.value = '';
      err.textContent = '';
    },
  }, text, el('div', { class: 'row' }, send, stop));
  text.addEventListener('keydown', (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && form.requestSubmit());
  const note = el('p', { class: 'note' });
  return {
    els: [form, note],
    update(n) {
      const live = LIVE.has(n.status);
      form.hidden = !live;
      note.hidden = live;
      note.textContent = 'El agente terminó.';
    },
  };
}

function resumeControls(n, err) {
  const role = el('select', { 'aria-label': 'Rol del agente que continúa' });
  const text = el('textarea', { rows: '3', 'aria-label': 'Prompt para continuar', placeholder: 'Qué debe hacer al continuar…' });
  const go = el('button', { type: 'submit', class: 'primary', text: 'Continuar aquí' });
  const trust = el('input', { type: 'checkbox' });
  const trustRow = el('label', { class: 'trust', hidden: true }, trust, ' Confío en esta carpeta y en su configuración');
  const form = el('form', {
    class: 'composer',
    onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      const r = await api('POST', '/api/agents', { role: role.value, cwd: n.cwd, prompt: text.value, resume: n.sessionId, trustProject: trust.checked });
      go.disabled = false;
      if (!r.ok) {
        if (r.data?.code === 'untrusted') trustRow.hidden = false;
        return void (err.textContent = errorText(r));
      }
      text.value = '';
      onLaunched(r.data.agentKey);
    },
  }, el('h3', { text: 'Continuar esta sesión desde el panel' }), role, text, trustRow, go);
  if (n.role === 'principal') fillRoles(role, n.cwd, err).then((ok) => (go.disabled = !ok));
  else role.append(el('option', { value: n.role, text: n.role }));
  return { els: [form], update() {} };
}

// Se construye una vez por nodo seleccionado: lo que el usuario escribe sobrevive a cada evento SSE.
export function buildControls(n) {
  const err = el('p', { class: 'error', role: 'alert' });
  const parts = n.launched ? launchedControls(n, err) : !n.agentId ? resumeControls(n, err) : { els: [], update() {} };
  return { el: el('section', { class: 'controls' }, ...parts.els, err), update: parts.update };
}

// ---------- permisos ----------

const cards = new Map(); // permId -> article

function permissionCard(p, role) {
  const err = el('p', { class: 'error', role: 'alert' });
  const buttons = [['allow', 'Permitir', 'primary'], ['allow-session', 'Permitir en la sesión', ''], ['deny', 'Rechazar', 'danger']]
    .map(([decision, label, cls]) => el('button', {
      type: 'button', class: cls, text: label,
      title: decision === 'allow-session' ? 'Aprueba sola esta misma acción, con exactamente la misma entrada, mientras dure este agente' : undefined,
      onclick: async () => {
        buttons.forEach((b) => (b.disabled = true));
        const r = await api('POST', `/api/permissions/${p.permId}`, { decision });
        if (!r.ok) { err.textContent = errorText(r); buttons.forEach((b) => (b.disabled = false)); }
      },
    }));
  // Lo que se ve es lo que se ejecuta: nada recortado, y los caracteres invisibles, a la vista.
  const what = reveal(describePermission(p.tool, p.input));
  const full = reveal(JSON.stringify(p.input, null, 2));
  const review = p.review && reveal(p.review.with.map((o) => `${o.role} — ${o.change}`).join('\n\n'));
  return el('section', { class: 'perm', role: 'group', 'aria-label': `Permiso pendiente: ${role} quiere ${p.tool}` },
    el('h3', {}, icon('shield', { size: 14 }), p.tool === 'Agent' ? ' Quiere lanzar un subagente' : ` Quiere usar ${p.tool}`),
    what.suspicious || full.suspicious || review?.suspicious
      ? el('p', { class: 'warn', role: 'alert', text: '⚠ La entrada tiene caracteres invisibles o espacios de relleno; se muestran marcados. Revísala antes de permitir.' })
      : null,
    el('p', { class: 'perm-summary', text: what.text }),
    review
      ? el('details', { class: 'review' },
        el('summary', { text: `Otro agente también cambia este archivo: ya vio su cambio y rehízo el suyo (${p.review.with.map((o) => o.role).join(', ')})` }),
        el('pre', { class: 'raw', text: review.text }))
      : null,
    el('details', { open: true },
      el('summary', { text: `Entrada completa (${JSON.stringify(p.input).length} caracteres)` }),
      el('pre', { class: 'raw', text: full.text })),
    el('div', { class: 'row' }, ...buttons),
    err);
}

// Las tarjetas de permiso viven dentro de la tarjeta del agente que pide; cada una se crea una
// vez por permId (así un clic a medias o un <details> abierto sobreviven a cada evento).
export function permissionsByNode(state) {
  for (const [permId, card] of cards) {
    if (!state.pending[permId]) { card.remove(); cards.delete(permId); }
  }
  const byNode = new Map();
  for (const p of Object.values(state.pending)) {
    let card = cards.get(p.permId);
    if (!card) {
      // El rol sale del agente dueño del launch-token; el session_id del hook es solo respaldo.
      const owner = Object.values(state.nodes).find((n) => p.agentKey && n.launched === p.agentKey) ?? state.nodes[p.nodeId];
      card = permissionCard(p, owner?.role ?? 'Un agente');
      card.dataset.permId = p.permId;
      cards.set(p.permId, card);
    }
    (byNode.get(p.nodeId) ?? byNode.set(p.nodeId, []).get(p.nodeId)).push(card);
  }
  return byNode;
}

// ---------- avisos del navegador ----------

function setupNotifications() {
  const button = document.querySelector('#notify');
  const refresh = () => (button.hidden = !('Notification' in window) || Notification.permission !== 'default');
  button.addEventListener('click', () => Notification.requestPermission().then(refresh));
  refresh();
}

export function notifyPermission(rec, state) {
  if (rec.kind !== 'permission' || rec.body.state !== 'pending' || !document.hidden) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const p = state.pending[rec.body.permId];
  const role = (p && state.nodes[p.nodeId]?.role) ?? 'Un agente';
  new Notification('Centinela: permiso pendiente', { body: `${role} quiere ${rec.body.tool}` });
}

export function initControls(opts) {
  token = opts.token;
  onLaunched = opts.onLaunched;
  setupDialog(opts.getSelected);
  setupNotifications();
}
