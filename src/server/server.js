import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initState, reduce } from '../shared/graph.js';
import { append } from './store.js';
import { ensureHome } from './paths.js';
import { checkHostOrigin, bearer, safeEqual } from './auth.js';
import { createLauncher, validateCwd, LaunchError } from './launcher.js';
import { listRoles } from './roles.js';
import { createPermissions, DECISIONS } from './permissions.js';

const MAX_BODY = 5 * 1024 * 1024;
const SSE_FIELD_MAX = 2000;
const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

// Lista cerrada: nunca se sirve una ruta construida a partir de la URL.
const STATIC = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/control.js': ['public/control.js', 'text/javascript; charset=utf-8'],
  '/dom.js': ['public/dom.js', 'text/javascript; charset=utf-8'],
  '/canvas.js': ['public/canvas.js', 'text/javascript; charset=utf-8'],
  '/cards.js': ['public/cards.js', 'text/javascript; charset=utf-8'],
  '/icons.js': ['public/icons.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/shared/graph.js': ['src/shared/graph.js', 'text/javascript; charset=utf-8'],
};

export function truncateRec(value, max) {
  if (typeof value === 'string') return value.length > max ? value.slice(0, max) : value;
  if (Array.isArray(value)) return value.map((v) => truncateRec(v, max));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateRec(v, max)]));
  }
  return value;
}

function send(res, status, body = '', type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json');

// Lee el body completo; si pasa del límite sigue drenando y devuelve null.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, res) {
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) {
    req.resume();
    send(res, 415);
    return undefined;
  }
  const raw = await readBody(req);
  if (raw === null) {
    send(res, 413);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    send(res, 400);
    return undefined;
  }
}

const ID = /^[A-Za-z0-9][\w-]{0,127}$/;
const RESERVED_IDS = new Set(['constructor', 'prototype']);
const optionalString = (v) => v === undefined || (typeof v === 'string' && v.length <= 4096);

// Lo mínimo para que un evento (que cualquiera con el hook-token puede forjar) no rompa el estado.
function validHookBody(b) {
  const id = (v) => typeof v === 'string' && ID.test(v) && !RESERVED_IDS.has(v);
  return Boolean(b) && typeof b === 'object' && !Array.isArray(b)
    && id(b.session_id) && (b.agent_id === undefined || id(b.agent_id))
    && ['agent_type', 'cwd', 'tool_name', 'hook_event_name', 'tool_use_id'].every((k) => optionalString(b[k]));
}

export function createServer({ port, uiToken, hookToken, claudeBin, pairCode }) {
  let pairing = pairCode; // un solo uso: quien lo lea después (historial, ps) ya no obtiene nada
  ensureHome();
  const state = initState();
  const clients = new Set();

  function broadcast(rec) {
    append(rec);
    reduce(state, rec);
    // Un permiso viaja completo: el usuario debe ver entero lo que aprueba.
    const msg = `data: ${JSON.stringify(rec.kind === 'permission' ? rec : truncateRec(rec, SSE_FIELD_MAX))}\n\n`;
    for (const res of clients) res.write(msg);
  }

  // Rutas /api/* ya autenticadas con el ui-token.
  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, state);

    if (req.method === 'GET' && url.pathname === '/api/roles') {
      const cwd = url.searchParams.get('cwd');
      return sendJson(res, 200, listRoles(cwd ? validateCwd(cwd) : undefined));
    }

    if (req.method === 'POST' && url.pathname === '/api/agents') {
      const body = await readJson(req, res);
      if (body === undefined) return;
      const { agentKey } = launcher.launch(body ?? {});
      return sendJson(res, 200, { agentKey });
    }

    const perm = /^\/api\/permissions\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'POST' && perm) {
      const body = await readJson(req, res);
      if (body === undefined) return;
      if (!DECISIONS.has(body?.decision)) return sendJson(res, 400, { error: 'Decisión no válida: usa allow, allow-session o deny.' });
      if (!permissions.decide(perm[1], body.decision)) return sendJson(res, 404, { error: 'Solicitud desconocida o ya decidida.' });
      return sendJson(res, 200, { ok: true });
    }

    const m = /^\/api\/agents\/([\w-]+)\/(prompt|stop)$/.exec(url.pathname);
    if (req.method === 'POST' && m) {
      const [, agentKey, action] = m;
      const body = action === 'prompt' ? await readJson(req, res) : (req.resume(), null);
      if (body === undefined) return;
      const status = launcher.status(agentKey);
      if (status === 'unknown') return sendJson(res, 404, { error: 'Agente desconocido.' });
      if (status === 'exited') return sendJson(res, 409, { error: 'El agente ya terminó.' });
      if (action === 'stop') return sendJson(res, 200, { ok: launcher.stop(agentKey) });
      if (!launcher.sendPrompt(agentKey, body?.text)) return sendJson(res, 400, { error: 'El prompt no puede estar vacío.' });
      return sendJson(res, 200, { ok: true });
    }

    req.resume();
    send(res, 404);
  }

  async function handle(req, res) {
    const denied = checkHostOrigin(req, server.address().port);
    if (denied) return send(res, denied);
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      try {
        return send(res, 200, await readFile(root(file)), type);
      } catch {
        return send(res, 404);
      }
    }

    if (req.method === 'POST' && url.pathname === '/hooks/event') {
      if (!safeEqual(bearer(req), hookToken)) {
        req.resume();
        return send(res, 401);
      }
      const body = await readJson(req, res);
      if (body === undefined) return;
      if (!validHookBody(body)) return send(res, 400);
      broadcast({ ts: Date.now(), kind: 'hook', body });
      return send(res, 200);
    }

    // Solo agentes lanzados: su launch-token identifica al agente. Responde cuando decide el panel.
    if (req.method === 'POST' && url.pathname === '/hooks/permission') {
      const agentKey = launcher.tokenFor(bearer(req));
      if (!agentKey) {
        req.resume();
        return send(res, 401);
      }
      const body = await readJson(req, res);
      if (body === undefined) return;
      const ac = new AbortController();
      res.on('close', () => !res.writableFinished && ac.abort());
      const decision = await permissions.request(agentKey, body, { signal: ac.signal });
      if (res.destroyed) return;
      return sendJson(res, 200, {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Rechazado desde Centinela.' },
        },
      });
    }

    // Emparejamiento: la página cambia el código de un solo uso de la URL por el ui-token.
    if (req.method === 'POST' && url.pathname === '/api/pair') {
      const body = await readJson(req, res);
      if (body === undefined) return;
      if (!pairing || !safeEqual(body?.code, pairing)) return sendJson(res, 401, { error: 'Este enlace ya se usó o Centinela se reinició.' });
      pairing = null;
      return sendJson(res, 200, { token: uiToken });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!safeEqual(bearer(req), uiToken)) {
        req.resume();
        return send(res, 401);
      }
      try {
        return await handleApi(req, res, url);
      } catch (err) {
        if (err instanceof LaunchError) return sendJson(res, err.status, { error: err.message, ...(err.code && { code: err.code }) });
        throw err;
      }
    }

    // EventSource no admite cabeceras: el ui-token va en ?token= solo en esta ruta.
    if (req.method === 'GET' && url.pathname === '/events') {
      if (!safeEqual(url.searchParams.get('token'), uiToken)) return send(res, 401);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      // El estado viaja como primer frame: entre snapshot y suscripción no se pierde ni duplica nada.
      res.write(`event: snapshot\ndata: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    req.resume();
    send(res, 404);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500);
    });
  });
  const launcher = createLauncher({ claudeBin, port: () => server.address().port, broadcast });
  const permissions = createPermissions({ broadcast, timeoutMs: Number(process.env.CENTINELA_PERMISSION_TIMEOUT_MS || 300_000) });
  server.listen(port, '127.0.0.1');
  return { server, state, broadcast, launcher };
}
