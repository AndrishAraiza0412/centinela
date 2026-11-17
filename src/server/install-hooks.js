// Adds/removes Centinela's observation hooks in Claude Code's settings.json.
// Our own entries are recognized by their URL: unknown keys are not added to the file.
import { join } from 'node:path';
import { claudeConfigDir } from './paths.js';

export const OBSERVED_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'Notification',
];
// Only Centinela's port: a bare 127.0.0.1 would open all local services to the sandbox.
// (Verified: with '127.0.0.1:<port>' the hooks arrive; without the entry they get 403.)
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
  // With the sandbox active, http hooks to 127.0.0.1 get 403 if the domain is not allowed (spike).
  if (s.sandbox?.enabled === true) {
    const domains = ((s.sandbox.network ??= {}).allowedDomains ??= []);
    if (!domains.includes(`127.0.0.1:${port}`)) domains.push(`127.0.0.1:${port}`);
  }
  return s;
}

// removeDomain: only if Centinela was the one that added 127.0.0.1 (the CLI knows, not the file).
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
