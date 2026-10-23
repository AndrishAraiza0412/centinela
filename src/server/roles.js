import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeConfigDir } from './paths.js';

// Un nombre de rol termina como argumento de `--agent`: nunca puede parecer una bandera.
export const SAFE_ROLE = /^[A-Za-z0-9][\w.-]*$/;

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
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
    .map((fm) => ({ name: fm.name, description: fm.description ?? '', source }));
}

// cwd ya validado (absoluto, real) por quien llama.
// Un rol del proyecto con el mismo nombre que uno tuyo no se lista: `--agent nombre` podría
// ejecutar la definición del repo mientras el panel muestra la tuya. El tuyo queda marcado
// como conflicto y no se puede lanzar ahí.
export function listRoles(cwd) {
  const user = readRoles(join(claudeConfigDir(), 'agents'), 'user');
  const project = cwd ? readRoles(join(cwd, '.claude', 'agents'), 'project') : [];
  const projectNames = new Set(project.map((r) => r.name));
  const userNames = new Set(user.map((r) => r.name));
  return [
    ...user.map((r) => ({ ...r, conflict: projectNames.has(r.name) })),
    ...project.filter((r) => !userNames.has(r.name)).map((r) => ({ ...r, conflict: false })),
  ];
}
