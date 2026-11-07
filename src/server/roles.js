import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeConfigDir } from './paths.js';

// Un nombre de rol termina como argumento de `--agent`: nunca puede parecer una bandera.
export const SAFE_ROLE = /^[A-Za-z0-9][\w.-]*$/;

// Roles que trae Centinela (roles/*.md). Se pasan con `--agents` solo al lanzarlos: no tocan tu config.
const BUILTIN_DIR = fileURLToPath(new URL('../../roles/', import.meta.url));

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const out = { prompt: m ? m[2].trim() : '' };
  for (const line of m ? m[1].split(/\r?\n/) : []) {
    const kv = /^(name|description):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function readRoles(dir, source) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
  return files
    .map((f) => frontmatter(readFileSync(join(dir, f), 'utf8')))
    .filter((fm) => fm.name && SAFE_ROLE.test(fm.name))
    .map((fm) => ({ name: fm.name, description: fm.description ?? '', source, prompt: fm.prompt }));
}

// Definiciones para `claude --agents` de los roles incluidos con esos nombres.
export function builtinAgents(names) {
  return Object.fromEntries(readRoles(BUILTIN_DIR, 'centinela')
    .filter((r) => names.includes(r.name))
    .map((r) => [r.name, { description: r.description, prompt: r.prompt }]));
}

// cwd ya validado (absoluto, real) por quien llama.
// Un rol del proyecto con el mismo nombre que uno tuyo no se lista: `--agent nombre` podría
// ejecutar la definición del repo mientras el panel muestra la tuya. El tuyo queda marcado
// como conflicto y no se puede lanzar ahí. Un rol incluido cede ante uno tuyo o del proyecto
// con su nombre (sin `--agents`, `--agent nombre` ejecuta el de ellos).
export function listRoles(cwd) {
  const user = readRoles(join(claudeConfigDir(), 'agents'), 'user');
  const project = cwd ? readRoles(join(cwd, '.claude', 'agents'), 'project') : [];
  const projectNames = new Set(project.map((r) => r.name));
  const userNames = new Set(user.map((r) => r.name));
  const builtin = readRoles(BUILTIN_DIR, 'centinela').filter((r) => !userNames.has(r.name) && !projectNames.has(r.name));
  return [
    ...builtin.map((r) => ({ ...r, conflict: false })),
    ...user.map((r) => ({ ...r, conflict: projectNames.has(r.name) })),
    ...project.filter((r) => !userNames.has(r.name)).map((r) => ({ ...r, conflict: false })),
  ].map(({ prompt, ...r }) => r);
}
