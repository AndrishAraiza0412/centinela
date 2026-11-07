// Solicitudes de permiso de los agentes lanzados: esperan la decisión del panel; sin ella → deny.
import { randomUUID } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';

export const DECISIONS = new Set(['allow', 'allow-session', 'deny']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const CHANGE_MAX = 2000;
const EDITS_PER_FILE = 5;

const canonical = (v) => JSON.stringify(v, (_, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);

const editPath = (b) => {
  const p = EDIT_TOOLS.has(b.tool_name) && (b.tool_input?.file_path ?? b.tool_input?.notebook_path);
  return typeof p === 'string' && p ? resolvePath(typeof b.cwd === 'string' ? b.cwd : '/', p) : null;
};

function changeText({ tool, input }) {
  const { file_path, notebook_path, ...rest } = input ?? {};
  const text = JSON.stringify(rest, null, 2);
  return `${tool}: ${text.length > CHANGE_MAX ? text.slice(0, CHANGE_MAX) + '…' : text}`;
}

// La respuesta llega al agente como el error de su herramienta: es lo que lee para revisar.
const reviewMessage = (path, others) => `Centinela pausó este cambio: otro agente también está modificando ${path} en paralelo.
${others.map((o) => `— ${o.role}, ${changeText(o)}`).join('\n')}
Antes de seguir, vuelve a leer el archivo, comprueba que tu cambio es compatible con el suyo y rehaz tu edición integrando ambos. Si chocan (los dos cambian lo mismo de forma distinta), no edites: explica el conflicto en tu respuesta para que el coordinador decida.`;

// isActive(sessionId, agentId) y roleOf(body) vienen del estado del grafo.
export function createPermissions({ broadcast, timeoutMs, isActive = () => true, roleOf = () => 'otro agente' }) {
  const waiting = new Map(); // permId -> { resolve, agentKey, ruleKey, timer, edit }
  const rules = new Set(); // allow-session, en memoria: se pierden al reiniciar
  const edits = new Map(); // ruta -> cambios aprobados [{ id, owner, sessionId, agentId, role, tool, input }]
  const reviewed = new Set(); // owner|ruta|ids de los cambios ajenos que ya se le mostraron

  // Mismo agente + misma herramienta + EXACTAMENTE la misma entrada (claves ordenadas):
  // aprobar un Write no aprueba otro archivo, ni un Bash el mismo comando fuera del sandbox.
  const ruleKey = (agentKey, b) => `${agentKey}|${b.agent_id ?? ''}|${b.tool_name}|${canonical(b.tool_input ?? {})}`;

  const editOf = (id, agentKey, b, path) => ({
    id, path, owner: `${agentKey}|${b.agent_id ?? ''}`, sessionId: b.session_id, agentId: b.agent_id,
    role: roleOf(b), tool: b.tool_name, input: b.tool_input ?? {},
  });

  function remember(edit) {
    const list = (edits.get(edit.path) ?? []).filter((e) => e.owner !== edit.owner);
    edits.set(edit.path, [...list, edit].slice(-EDITS_PER_FILE));
  }

  // Cambios de OTROS agentes al mismo archivo: aprobados mientras su autor sigue activo, o pendientes.
  function othersOn(edit) {
    const done = (edits.get(edit.path) ?? []).filter((e) => e.owner !== edit.owner && isActive(e.sessionId, e.agentId));
    const pending = [...waiting.values()].map((w) => w.edit).filter((e) => e?.path === edit.path && e.owner !== edit.owner);
    return [...done, ...pending];
  }

  function settle(permId, decision, reason) {
    const w = waiting.get(permId);
    if (!w) return false;
    waiting.delete(permId);
    clearTimeout(w.timer);
    if (decision === 'allow-session') rules.add(w.ruleKey);
    if (decision !== 'deny' && w.edit) remember(w.edit);
    broadcast({ ts: Date.now(), kind: 'permission', agentKey: w.agentKey, body: { state: 'decided', permId, decision, ...(reason && { reason }) } });
    w.resolve({ decision: decision === 'deny' ? 'deny' : 'allow' });
    return true;
  }

  function request(agentKey, b, { signal } = {}) {
    const permId = randomUUID();
    const path = editPath(b);
    const edit = path && editOf(permId, agentKey, b, path);
    const others = edit ? othersOn(edit) : [];
    const seen = `${edit?.owner}|${path}|${others.map((o) => o.id).sort().join(',')}`;
    const ids = {
      session_id: b.session_id, agent_id: b.agent_id, ...(typeof b.agent_type === 'string' && { agent_type: b.agent_type }),
      tool: b.tool_name, input: b.tool_input ?? {},
    };

    // Primera vez que choca con estos cambios ajenos: que el agente los revise antes de preguntarte.
    if (others.length && !reviewed.has(seen)) {
      reviewed.add(seen);
      broadcast({ ts: Date.now(), kind: 'permission', agentKey, body: { state: 'review', ...ids, path, with: others.map((o) => o.role) } });
      return Promise.resolve({ decision: 'deny', message: reviewMessage(path, others) });
    }
    const review = others.length ? { path, with: others.map((o) => ({ role: o.role, change: changeText(o) })) } : undefined;

    const key = ruleKey(agentKey, b);
    if (rules.has(key)) {
      if (edit) remember(edit);
      broadcast({ ts: Date.now(), kind: 'permission', agentKey, body: { state: 'auto', ...ids } });
      return Promise.resolve({ decision: 'allow' });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(permId, 'deny', 'timeout'), timeoutMs);
      timer.unref();
      waiting.set(permId, { resolve, agentKey, ruleKey: key, timer, edit });
      broadcast({ ts: Date.now(), kind: 'permission', agentKey, body: { state: 'pending', permId, ...ids, ...(review && { review }) } });
      // Claude cortó la petición (proceso detenido): la tarjeta no debe quedarse colgada.
      signal?.addEventListener('abort', () => settle(permId, 'deny', 'cancelled'), { once: true });
    });
  }

  const decide = (permId, decision) => DECISIONS.has(decision) && settle(permId, decision);

  return { request, decide };
}
