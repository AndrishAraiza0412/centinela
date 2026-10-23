import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { home } from './paths.js';

const FILE = /^events-\d{4}-\d{2}-\d{2}\.jsonl$/;

export function append(rec) {
  const day = new Date(rec.ts).toLocaleDateString('sv-SE'); // YYYY-MM-DD, hora local
  appendFileSync(join(home(), `events-${day}.jsonl`), JSON.stringify(rec) + '\n', { mode: 0o600 });
}

// Solo hoy y ayer: el historial completo crece sin límite (los PostToolUse traen archivos enteros).
export function loadAll() {
  const day = (ms) => `events-${new Date(ms).toLocaleDateString('sv-SE')}.jsonl`;
  const recent = new Set([day(Date.now()), day(Date.now() - 86_400_000)]);
  let files;
  try {
    files = readdirSync(home()).filter((f) => FILE.test(f) && recent.has(f)).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const recs = [];
  for (const f of files) {
    for (const [i, line] of readFileSync(join(home(), f), 'utf8').split('\n').entries()) {
      if (!line) continue;
      try {
        recs.push(JSON.parse(line));
      } catch {
        console.warn(`Centinela: línea corrupta ignorada en ${f}:${i + 1}`);
      }
    }
  }
  return recs;
}
