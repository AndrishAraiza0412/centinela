import { mkdirSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function home() {
  return process.env.CENTINELA_HOME || join(homedir(), '.centinela');
}

// Carpeta de configuración de Claude Code (settings.json, agents/).
export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function ensureHome() {
  mkdirSync(home(), { recursive: true, mode: 0o700 });
  chmodSync(home(), 0o700);
}

export function readOrCreateToken(name) {
  const file = join(home(), name);
  try {
    return readFileSync(file, 'utf8').trim();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
  return token;
}
