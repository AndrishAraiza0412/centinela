// Añade/quita los hooks de observación de Centinela en el settings.json de Claude Code.
// Las entradas propias se reconocen por su URL: no se añaden claves desconocidas al archivo.
import { join } from 'node:path';
import { claudeConfigDir } from './paths.js';

export const OBSERVED_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'Notification',
];
// Solo el puerto de Centinela: un 127.0.0.1 a secas abriría al sandbox todos los servicios locales.
// (Verificado: con '127.0.0.1:<puerto>' los hooks llegan; sin entrada reciben 403.)
const OUR_DOMAIN = /^127\.0\.0\.1:\d+$/;
const OUR_URL = /^http:\/\/127\.0\.0\.1:\d+\/hooks\/event$/;

export function settingsPath() {
  return join(claudeConfigDir(), 'settings.json');
}

const isOurs = (group) => Array.isArray(group?.hooks) && group.hooks.some((h) => h?.type === 'http' && OUR_URL.test(h.url ?? ''));

function removeOurHooks(s) {
  if (!s.hooks) return;
  for (const event of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[event])) continue;
    s.hooks[event] = s.hooks[event].filter((g) => !isOurs(g));
    if (s.hooks[event].length === 0) delete s.hooks[event];
  }
  if (Object.keys(s.hooks).length === 0) delete s.hooks;
}

export function merge(settings, hookToken, port) {
  const s = structuredClone(settings);
  removeOurHooks(s);
  s.hooks ??= {};
  for (const event of OBSERVED_EVENTS) {
    (s.hooks[event] ??= []).push({
      matcher: '*',
      hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hooks/event`, timeout: 2, headers: { Authorization: `Bearer ${hookToken}` } }],
    });
  }
  // Con el sandbox activo, los hooks http a 127.0.0.1 reciben 403 si el dominio no está permitido (spike).
  if (s.sandbox?.enabled === true) {
    const domains = ((s.sandbox.network ??= {}).allowedDomains ??= []);
    if (!domains.includes(`127.0.0.1:${port}`)) domains.push(`127.0.0.1:${port}`);
  }
  return s;
}

// removeDomain: solo si fue Centinela quien añadió 127.0.0.1 (lo sabe el CLI, no el archivo).
export function unmerge(settings, { removeDomain = false } = {}) {
  const s = structuredClone(settings);
  removeOurHooks(s);
  const network = s.sandbox?.network;
  if (removeDomain && Array.isArray(network?.allowedDomains)) {
    network.allowedDomains = network.allowedDomains.filter((d) => !OUR_DOMAIN.test(d));
    if (network.allowedDomains.length === 0) delete network.allowedDomains;
    if (Object.keys(network).length === 0) delete s.sandbox.network;
  }
  return s;
}

export const hasLocalDomain = (s) => Boolean(s.sandbox?.network?.allowedDomains?.some((d) => OUR_DOMAIN.test(d)));
