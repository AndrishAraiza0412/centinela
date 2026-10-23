// Solicitudes de permiso de los agentes lanzados: esperan la decisión del panel; sin ella → deny.
import { randomUUID } from 'node:crypto';

export const DECISIONS = new Set(['allow', 'allow-session', 'deny']);

const canonical = (v) => JSON.stringify(v, (_, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);

export function createPermissions({ broadcast, timeoutMs }) {
  const waiting = new Map(); // permId -> { resolve, agentKey, ruleKey, timer }
  const rules = new Set(); // allow-session, en memoria: se pierden al reiniciar

  // Mismo agente + misma herramienta + EXACTAMENTE la misma entrada (claves ordenadas):
  // aprobar un Write no aprueba otro archivo, ni un Bash el mismo comando fuera del sandbox.
  const ruleKey = (agentKey, b) => `${agentKey}|${b.agent_id ?? ''}|${b.tool_name}|${canonical(b.tool_input ?? {})}`;

  function settle(permId, decision, reason) {
    const w = waiting.get(permId);
    if (!w) return false;
    waiting.delete(permId);
    clearTimeout(w.timer);
    if (decision === 'allow-session') rules.add(w.ruleKey);
    broadcast({ ts: Date.now(), kind: 'permission', agentKey: w.agentKey, body: { state: 'decided', permId, decision, ...(reason && { reason }) } });
    w.resolve(decision === 'deny' ? 'deny' : 'allow');
    return true;
  }

  function request(agentKey, b, { signal } = {}) {
    const key = ruleKey(agentKey, b);
    if (rules.has(key)) {
      broadcast({ ts: Date.now(), kind: 'permission', agentKey, body: { state: 'auto', session_id: b.session_id, agent_id: b.agent_id, tool: b.tool_name, input: b.tool_input ?? {} } });
      return Promise.resolve('allow');
    }
    const permId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(permId, 'deny', 'timeout'), timeoutMs);
      timer.unref();
      waiting.set(permId, { resolve, agentKey, ruleKey: key, timer });
      broadcast({
        ts: Date.now(), kind: 'permission', agentKey,
        body: { state: 'pending', permId, session_id: b.session_id, agent_id: b.agent_id, tool: b.tool_name, input: b.tool_input ?? {} },
      });
      // Claude cortó la petición (proceso detenido): la tarjeta no debe quedarse colgada.
      signal?.addEventListener('abort', () => settle(permId, 'deny', 'cancelled'), { once: true });
    });
  }

  const decide = (permId, decision) => DECISIONS.has(decision) && settle(permId, decision);

  return { request, decide };
}
