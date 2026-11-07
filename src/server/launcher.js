// Procesos `claude -p` lanzados desde el panel: roles, prompts por stdin, stream-json → broadcast.
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { realpathSync, statSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { listRoles, builtinAgents } from './roles.js';
import { safeEqual } from './auth.js';
import { MODELS } from '../shared/models.js';

const STDERR_TAIL = 2000;
const KILL_AFTER_MS = 5000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `claude -p` se salta el diálogo de confianza: estos archivos del repo se cargarían sin preguntar.
const PROJECT_CONFIG = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'];
// Modos en que cada permiso pasa por PermissionRequest (y por lo tanto por el panel).
const GATED_MODES = new Set(['default', 'manual']);

// Modo equipo: el agente coordina subagentes (herramienta Agent) de los otros roles. Los
// subagentes no pueden delegar a su vez, así que el coordinador reparte y hace la revisión cruzada.
const teamPrompt = (roles) => `Trabajas como coordinador de un equipo. Con la herramienta Agent puedes delegar en estos roles: ${roles.join(', ')}.
- Si la tarea tiene partes independientes, divídela y lanza varios Agent en el mismo mensaje para que trabajen en paralelo. Si es pequeña, hazla tú.
- El usuario aprueba cada subagente que lances: en la descripción di para qué lo necesitas.
- Cada encargo debe ser autocontenido (objetivo, archivos, cuándo está terminado): el subagente no ve esta conversación.
- Evita que dos subagentes editen el mismo archivo. Si pasa, Centinela hace que cada uno revise el cambio del otro antes de aplicar el suyo; si te reportan un conflicto, decide tú cómo integrarlo.
- Revisión cruzada: el trabajo de un rol lo revisa otro distinto (lo del desarrollador, qa o seguridad, por ejemplo). Si la revisión encuentra fallos, encarga la corrección y vuelve a revisar, hasta que pase o hasta 3 rondas.
- Al terminar, resume qué hizo cada rol, qué se revisó y qué quedó pendiente. Si después se te pide algo más, sigue coordinando el equipo.`;

export class LaunchError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validateCwd(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new LaunchError('La carpeta del proyecto debe ser una ruta absoluta.');
  let real;
  try {
    real = realpathSync(cwd);
  } catch {
    throw new LaunchError('La carpeta del proyecto no existe.');
  }
  if (!statSync(real).isDirectory()) throw new LaunchError('La ruta del proyecto no es una carpeta.');
  return real;
}

const userMessage = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';

export function createLauncher({ claudeBin, port, broadcast }) {
  const agents = new Map(); // agentKey -> { child, launchToken, alive, stopped, killTimer }

  // Solo los agentes lanzados piden permisos al panel. Sin allowedDomains el sandbox del
  // usuario responde 403 y, con onFailure:block, todo lo que pide permiso queda bloqueado (spike).
  // Solo el puerto de Centinela, no todo 127.0.0.1.
  const permSettings = (launchToken) => ({
    // Lanzar un subagente no pide permiso en modo default: así cada uno pasa por el panel.
    permissions: { ask: ['Agent'] },
    hooks: {
      PermissionRequest: [{
        matcher: '*',
        hooks: [{ type: 'http', url: `http://127.0.0.1:${port()}/hooks/permission`, timeout: 310, onFailure: 'block', headers: { Authorization: `Bearer ${launchToken}` } }],
      }],
    },
    // Con el sandbox activo, Claude Code aprueba solo cualquier Bash que quepa en él (también
    // escrituras dentro del proyecto). En un agente lanzado, todo Bash pasa por el panel.
    sandbox: { autoAllowBashIfSandboxed: false, network: { allowedDomains: [`127.0.0.1:${port()}`] } },
  });

  function launch({ role, cwd, prompt, resume, trustProject, model = '', team = false } = {}) {
    const dir = validateCwd(cwd);
    const roles = listRoles(dir);
    const found = roles.find((r) => r.name === role);
    if (!found) throw new LaunchError(`El rol «${String(role)}» no existe en este proyecto ni en tus agentes.`);
    if (found.conflict) {
      throw new LaunchError(`El rol «${role}» existe en tus agentes y también en el proyecto; renombra uno para saber cuál se ejecuta.`);
    }
    const config = PROJECT_CONFIG.filter((f) => existsSync(join(dir, f)));
    if (config.length && trustProject !== true) {
      throw new LaunchError(`Esta carpeta trae ${config.join(', ')}: se cargarían sin preguntar (hooks, permisos o servidores MCP del repo). Confírmalo solo si confías en ella.`, 400, 'untrusted');
    }
    if (typeof prompt !== 'string' || !prompt.trim()) throw new LaunchError('El prompt inicial no puede estar vacío.');
    if (resume !== undefined && (typeof resume !== 'string' || !SESSION_ID.test(resume))) {
      throw new LaunchError('La sesión a continuar no es un id de sesión válido.');
    }
    if (!MODELS.includes(model)) throw new LaunchError(`El modelo «${String(model)}» no está en la lista.`);
    if (typeof team !== 'boolean') throw new LaunchError('El modo equipo debe ser verdadero o falso.');

    // Roles incluidos que van inline: el lanzado y, en equipo, todos los que puede delegar.
    const inline = team ? roles.filter((r) => r.source === 'centinela').map((r) => r.name) : found.source === 'centinela' ? [role] : [];
    const mates = roles.filter((r) => !r.conflict && r.name !== role).map((r) => r.name);
    const agentKey = randomUUID();
    const launchToken = randomBytes(32).toString('hex');
    const args = [
      '-p', '--agent', role, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'default', '--settings', JSON.stringify(permSettings(launchToken)),
      ...(resume ? ['--resume', resume] : []),
      ...(model ? ['--model', model] : []),
      ...(inline.length ? ['--agents', JSON.stringify(builtinAgents(inline))] : []),
      ...(team && mates.length ? ['--append-system-prompt', teamPrompt(mates)] : []),
    ];
    const child = spawn(claudeBin, args, { cwd: dir, env: { ...process.env, CENTINELA_AGENT_KEY: agentKey } });
    const agent = { child, launchToken, alive: true, stopped: false, killTimer: null };
    agents.set(agentKey, agent);

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-STDERR_TAIL)));
    child.stdin.on('error', () => {}); // EPIPE si el proceso muere antes de leer
    child.on('error', (err) => (stderr = (stderr + `\n${err.message}`).slice(-STDERR_TAIL)));

    createInterface({ input: child.stdout }).on('line', (line) => {
      let body;
      try {
        body = JSON.parse(line);
      } catch {
        body = { type: 'raw', text: line };
      }
      broadcast({ ts: Date.now(), kind: 'stream', agentKey, body });
      if (body.type === 'system' && body.subtype === 'init' && !GATED_MODES.has(body.permissionMode)) {
        // Un modo distinto (agente con permissionMode propio, o un alias que dejó de existir)
        // aprobaría acciones sin pasar por el panel.
        agent.error = `El agente arrancó en modo de permisos «${body.permissionMode}» en vez de «default»; se detuvo.`;
        child.kill('SIGKILL');
        return;
      }
      if (body.type === 'system' && body.subtype === 'init') {
        broadcast({ ts: Date.now(), kind: 'launch', agentKey, body: { event: 'started', sessionId: body.session_id, cwd: dir, role, model: body.model } });
        // El prompt inicial se anuncia aquí: antes de init el nodo aún no existe en el grafo.
        broadcast({ ts: Date.now(), kind: 'launch', agentKey, body: { event: 'prompt', text: prompt } });
      }
    });

    // 'close' llega tras vaciar stdout/stderr: ninguna línea se pierde después de 'exited'.
    child.on('close', (code, signal) => {
      agent.alive = false;
      clearTimeout(agent.killTimer);
      broadcast({
        ts: Date.now(), kind: 'launch', agentKey,
        body: { event: 'exited', code, signal, stopped: agent.stopped, stderrTail: stderr, role, cwd: dir, ...(agent.error && { error: agent.error }) },
      });
    });

    child.stdin.write(userMessage(prompt));
    return { agentKey, launchToken };
  }

  // 'unknown' | 'alive' | 'exited'
  const status = (agentKey) => (!agents.has(agentKey) ? 'unknown' : agents.get(agentKey).alive ? 'alive' : 'exited');

  function sendPrompt(agentKey, text) {
    const agent = agents.get(agentKey);
    if (!agent?.alive || typeof text !== 'string' || !text.trim()) return false;
    agent.child.stdin.write(userMessage(text));
    broadcast({ ts: Date.now(), kind: 'launch', agentKey, body: { event: 'prompt', text } });
    return true;
  }

  function stop(agentKey) {
    const agent = agents.get(agentKey);
    if (!agent?.alive || agent.stopped) return false;
    agent.stopped = true;
    agent.child.kill('SIGTERM');
    agent.killTimer = setTimeout(() => agent.child.kill('SIGKILL'), KILL_AFTER_MS);
    agent.killTimer.unref();
    return true;
  }

  // El launch-token solo vale mientras su agente vive.
  function tokenFor(launchToken) {
    for (const [agentKey, agent] of agents) {
      if (agent.alive && safeEqual(agent.launchToken, launchToken)) return agentKey;
    }
    return null;
  }

  return { launch, sendPrompt, stop, tokenFor, status };
}
