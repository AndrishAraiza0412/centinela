// Procesos `claude -p` lanzados desde el panel: roles, prompts por stdin, stream-json → broadcast.
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { realpathSync, statSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { listRoles, builtinAgent } from './roles.js';
import { safeEqual } from './auth.js';

const STDERR_TAIL = 2000;
const KILL_AFTER_MS = 5000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `claude -p` se salta el diálogo de confianza: estos archivos del repo se cargarían sin preguntar.
const PROJECT_CONFIG = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'];
// Modos en que cada permiso pasa por PermissionRequest (y por lo tanto por el panel).
const GATED_MODES = new Set(['default', 'manual']);
// Alias que `claude --model` resuelve a la última versión; '' = el modelo por defecto.
export const MODELS = ['', 'opus', 'sonnet', 'haiku'];

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

  function launch({ role, cwd, prompt, resume, trustProject, model = '' } = {}) {
    const dir = validateCwd(cwd);
    const found = listRoles(dir).find((r) => r.name === role);
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

    const agentKey = randomUUID();
    const launchToken = randomBytes(32).toString('hex');
    const args = [
      '-p', '--agent', role, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'default', '--settings', JSON.stringify(permSettings(launchToken)),
      ...(resume ? ['--resume', resume] : []),
      ...(model ? ['--model', model] : []),
      ...(found.source === 'centinela' ? ['--agents', JSON.stringify(builtinAgent(role))] : []),
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
