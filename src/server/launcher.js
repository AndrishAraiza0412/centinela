// `claude -p` processes launched from the dashboard: roles, prompts over stdin, stream-json → broadcast.
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { realpathSync, statSync, existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { listRoles, inlineAgents } from './roles.js';
import { safeEqual } from './auth.js';
import { merge, settingsPath } from './install-hooks.js';
import { MODELS } from '../shared/models.js';

const STDERR_TAIL = 2000;
const KILL_AFTER_MS = 5000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `claude -p` skips the trust dialog: these repo files would be loaded without asking.
const PROJECT_CONFIG = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'];
// Modes in which every permission goes through PermissionRequest (and therefore through the dashboard).
const GATED_MODES = new Set(['default', 'manual']);
// Verified with the real claude: if another hook answers allow, the action runs even while the dashboard is still waiting.
const DECIDING_HOOKS = ['PermissionRequest', 'PreToolUse'];

// Team mode: the agent coordinates subagents (Agent tool) of the other roles. The
// subagents cannot delegate in turn, so the coordinator distributes the work and does the cross-review.
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

// Trust in the folder does not cover this: the dashboard would show a decision that is no longer the user's.
function refuseDecidingHooks(dir) {
  for (const f of ['.claude/settings.json', '.claude/settings.local.json']) {
    const file = join(dir, f);
    if (!existsSync(file)) continue;
    let settings;
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new LaunchError(`No se pudo leer ${f}: sin saber qué hooks trae, no se lanza el agente.`);
    }
    const hook = DECIDING_HOOKS.find((e) => settings?.hooks?.[e]);
    if (hook) throw new LaunchError(`${f} define un hook ${hook}: podría aprobar acciones sin pasar por el panel. Quítalo para lanzar agentes aquí.`);
  }
}

// From the user's settings only what cannot approve anything through the dashboard is inherited.
// If they cannot be read, it does not launch: the agent would silently lose the deny rules and the sandbox.
function userSettings() {
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new LaunchError(`No se pudo leer ${settingsPath()}: sin tus reglas deny ni tu sandbox, no se lanza el agente.`);
  }
  if (!isObject(settings)) throw new LaunchError(`${settingsPath()} no es un objeto JSON: sin tus reglas deny ni tu sandbox, no se lanza el agente.`);
  return settings;
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const userEnv = (env) => (isObject(env) ? Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string' && !v.includes('\0'))) : {});

const userMessage = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';

export function createLauncher({ claudeBin, port, hookToken, broadcast }) {
  const agents = new Map(); // agentKey -> { child, launchToken, alive, stopped, killTimer }

  // Only launched agents ask the dashboard for permissions. Without allowedDomains the user's sandbox
  // answers 403 and, with onFailure:block, everything that asks for permission ends up blocked (spike).
  // Only Centinela's port, not all of 127.0.0.1.
  const permSettings = (launchToken, user) => merge({
    ...(typeof user.model === 'string' && { model: user.model }),
    // Launching a subagent does not ask for permission in default mode: this way each one goes through the dashboard.
    permissions: { ask: ['Agent', ...strings(user.permissions?.ask)], ...(strings(user.permissions?.deny).length && { deny: strings(user.permissions.deny) }) },
    hooks: {
      PermissionRequest: [{
        matcher: '*',
        hooks: [{ type: 'http', url: `http://127.0.0.1:${port()}/hooks/permission`, timeout: 310, onFailure: 'block', headers: { Authorization: `Bearer ${launchToken}` } }],
      }],
    },
    // With the sandbox active, Claude Code auto-approves any Bash that fits in it (also
    // writes inside the project). In a launched agent, every Bash goes through the dashboard.
    sandbox: {
      ...(isObject(user.sandbox) && user.sandbox),
      autoAllowBashIfSandboxed: false,
      network: { ...(isObject(user.sandbox?.network) && user.sandbox.network), allowedDomains: [...strings(user.sandbox?.network?.allowedDomains), `127.0.0.1:${port()}`] },
    },
  }, hookToken, port());

  function launch({ role, cwd, prompt, resume, trustProject, model = '', team = false } = {}) {
    const dir = validateCwd(cwd);
    const roles = listRoles(dir);
    const found = roles.find((r) => r.name === role);
    if (!found) throw new LaunchError(`El rol «${String(role)}» no existe en este proyecto ni en tus agentes.`);
    if (found.conflict) {
      throw new LaunchError(`El rol «${role}» existe en tus agentes y también en el proyecto; renombra uno para saber cuál se ejecuta.`);
    }
    refuseDecidingHooks(dir);
    const user = userSettings();
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

    // Roles that go inline: the launched one and, in team mode, all the ones it can delegate to. The project's are loaded by claude.
    const inline = team ? roles.filter((r) => r.source !== 'project' && !r.conflict).map((r) => r.name) : found.source !== 'project' ? [role] : [];
    const mates = roles.filter((r) => !r.conflict && r.name !== role).map((r) => r.name);
    const agentKey = randomUUID();
    const launchToken = randomBytes(32).toString('hex');
    // No user settings: neither their hooks nor their plugins can answer a permission instead of the dashboard.
    const args = [
      '-p', '--agent', role, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--setting-sources', 'project,local',
      '--permission-mode', 'default', '--settings', JSON.stringify(permSettings(launchToken, user)),
      ...(resume ? ['--resume', resume] : []),
      ...(model ? ['--model', model] : []),
      ...(inline.length ? ['--agents', JSON.stringify(inlineAgents(inline))] : []),
      ...(team && mates.length ? ['--append-system-prompt', teamPrompt(mates)] : []),
    ];
    // Agent-team teammates are other processes: it is not established that they inherit --settings and the dashboard. Team mode uses subagents.
    const env = { ...process.env, ...userEnv(user.env), CENTINELA_AGENT_KEY: agentKey, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: undefined };
    const child = spawn(claudeBin, args, { cwd: dir, env });
    const agent = { child, launchToken, alive: true, stopped: false, killTimer: null };
    agents.set(agentKey, agent);

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-STDERR_TAIL)));
    child.stdin.on('error', () => {}); // EPIPE if the process dies before reading
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
        // A different mode (an agent with its own permissionMode, or an alias that no longer exists)
        // would approve actions without going through the dashboard.
        agent.error = `El agente arrancó en modo de permisos «${body.permissionMode}» en vez de «default»; se detuvo.`;
        child.kill('SIGKILL');
        return;
      }
      // system/init repeats on every turn: start up and announce the first prompt only once.
      if (body.type === 'system' && body.subtype === 'init' && !agent.started) {
        agent.started = true;
        broadcast({ ts: Date.now(), kind: 'launch', agentKey, body: { event: 'started', sessionId: body.session_id, cwd: dir, role, model: body.model } });
        // The initial prompt is announced here: before init the node does not exist in the graph yet.
        broadcast({ ts: Date.now(), kind: 'launch', agentKey, body: { event: 'prompt', text: prompt } });
      }
    });

    // 'close' arrives after stdout/stderr are drained: no line is lost after 'exited'.
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

  // The launch-token is only valid while its agent is alive.
  function tokenFor(launchToken) {
    for (const [agentKey, agent] of agents) {
      if (agent.alive && safeEqual(agent.launchToken, launchToken)) return agentKey;
    }
    return null;
  }

  return { launch, sendPrompt, stop, tokenFor, status };
}
