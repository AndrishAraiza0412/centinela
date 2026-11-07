import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeConfigDir } from './paths.js';

// Un nombre de rol termina como argumento de `--agent`: nunca puede parecer una bandera.
export const SAFE_ROLE = /^[A-Za-z0-9][\w.-]*$/;

// Roles que trae Centinela (roles/*.md). Se pasan con `--agents` solo al lanzarlos: no tocan tu config.
const BUILTIN_DIR = fileURLToPath(new URL('../../roles/', import.meta.url));

const TOOL_LISTS = new Set(['tools', 'disallowedTools']);
const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
const toolList = (s) => s.replace(/\s+#.*$/, '').trim().replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const out = { prompt: m ? m[2].trim() : '' };
  const lines = m ? m[1].split(/\r?\n/) : [];
  lines.forEach((line, i) => {
    const kv = /^(name|description|tools|disallowedTools|model):\s*(.*)$/.exec(line);
    if (!kv) return;
    const key = kv[1];
    const value = kv[2].trim();
    const next = lines.slice(i + 1);
    const indented = next.slice(0, (next.findIndex((l) => !/^\s/.test(l)) + 1 || next.length + 1) - 1).map((l) => l.trim());
    if (TOOL_LISTS.has(key)) out[key] = value ? toolList(value) : indented.filter((l) => l.startsWith('-')).flatMap((l) => toolList(l.slice(1)));
    else if (key === 'model') out[key] = unquote(value.replace(/\s+#.*$/, ''));
    else if (/^[>|][-+]?$/.test(value)) out[key] = indented.join(' ').trim(); // bloque YAML
    else out[key] = unquote(value);
  });
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
    .map((fm) => ({ ...fm, description: fm.description ?? '', source }));
}

// Definiciones para `claude --agents`: los agentes lanzados no cargan los ajustes de usuario, así
// que ni los roles incluidos ni los del usuario existen para `--agent` si no se pasan aquí.
// Con el mismo nombre gana el del usuario, igual que en listRoles.
export function inlineAgents(names) {
  const roles = [...readRoles(BUILTIN_DIR, 'centinela'), ...readRoles(join(claudeConfigDir(), 'agents'), 'user')];
  return Object.fromEntries(roles
    .filter((r) => names.includes(r.name))
    .map((r) => [r.name, {
      description: r.description,
      prompt: r.prompt,
      ...(r.tools?.length && { tools: r.tools }),
      ...(r.disallowedTools?.length && { disallowedTools: r.disallowedTools }),
      ...(r.model && { model: r.model }),
    }]));
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
  ].map(({ name, description, source, conflict }) => ({ name, description, source, conflict }));
}
