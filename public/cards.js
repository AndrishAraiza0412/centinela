// Agent card on the canvas: who it is, what it is doing now, what it did, what it said and whether it is waiting for you.
// Built once per node; each event only updates its content (refill by signature).
import { el, time } from '/dom.js';
import { icon } from '/icons.js';

export const STATUS_LABEL = {
  idle: 'Inactivo', working: 'Trabajando', waiting: 'Te espera',
  done: 'Terminado', error: 'Error',
};
const LINES = 5;
const basename = (p) => (p ? p.split('/').filter(Boolean).pop() : '') || p || '';
const tokens = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function kindOf(n) {
  if (n.launched) return { icon: 'bot', text: 'Lanzado desde el panel' };
  if (n.agentId) return { icon: 'branch', text: 'Subagente' };
  return { icon: 'terminal', text: 'Sesión de terminal' };
}

function actionLine(a) {
  const mark = a.ok === true ? icon('check', { size: 13, label: 'bien' })
    : a.ok === false ? icon('x', { size: 13, label: 'falló' })
      : icon('loader', { size: 13, label: 'en curso' });
  return el('li', { class: `line r-${a.ok}` },
    el('span', { class: 'mark' }, mark),
    el('span', { class: 'what', text: a.summary }),
    el('time', { text: time(a.ts) }));
}

export function createCard(n, { onSelect }) {
  const p = {
    icon: el('span', { class: 'card-icon' }),
    title: el('button', { type: 'button', class: 'card-title', onclick: () => onSelect(n.id) }),
    kind: el('span', { class: 'card-kind' }),
    pill: el('span', { class: 'pill' }),
    now: el('p', { class: 'card-now' }),
    term: el('ol', { class: 'term' }),
    say: el('blockquote', { class: 'say' }),
    perms: el('div', { class: 'perm-slot' }),
    foot: el('footer', { class: 'card-foot' }),
    sig: {},
  };
  const card = el('article', { class: 'card' },
    el('header', { class: 'card-head' },
      p.icon,
      el('div', { class: 'card-id' }, p.title, p.kind),
      p.pill),
    p.now, p.term, p.say, p.perms, p.foot);
  // A click anywhere "neutral" on the card selects it; the controls do their own thing.
  card.addEventListener('click', (e) => {
    if (!e.target.closest('button, a, summary, pre, textarea, input, select')) onSelect(n.id);
  });

  const refill = (name, sig, build) => {
    if (p.sig[name] === sig) return;
    p.sig[name] = sig;
    p[name].replaceChildren(...build());
  };

  function update(n, { selected, permissions }) {
    card.dataset.status = n.status;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-label', `${n.role}: ${STATUS_LABEL[n.status] ?? n.status}`);
    p.title.textContent = n.role;
    p.title.setAttribute('aria-pressed', String(selected));
    // A launched agent can be born as a session: its SessionStart arrives before `started`.
    const kind = kindOf(n);
    refill('icon', kind.icon, () => [icon(kind.icon, { size: 16 })]);
    p.kind.textContent = [kind.text, basename(n.cwd)].filter(Boolean).join(' · ');
    p.pill.textContent = STATUS_LABEL[n.status] ?? n.status;
    p.pill.className = `pill pill-${n.status}`;

    p.now.hidden = !n.current;
    p.now.textContent = n.current ? `› ${n.current}` : '';

    const recent = n.actions.slice(-LINES);
    refill('term', `${n.actions.length}|${recent.map((a) => a.ok).join()}`, () => recent.length
      ? recent.map(actionLine)
      : [el('li', { class: 'line empty', text: 'Sin acciones todavía.' })]);

    const last = (n.messages ?? []).findLast((m) => m.from === 'assistant');
    p.say.hidden = !last;
    refill('say', `${n.msgSeq ?? 0}`, () => last
      ? [el('span', { class: 'say-who', text: 'Claude' }), el('p', { text: last.text })]
      : []);

    refill('perms', permissions.map((c) => c.dataset.permId).join('|'), () => permissions);

    const bits = [`${n.actions.length} ${n.actions.length === 1 ? 'acción' : 'acciones'}`];
    if (n.model) bits.unshift(n.model.replace(/^claude-/, ''));
    if (n.usage?.contextTokens) bits.push(`contexto ${tokens(n.usage.contextTokens)}`);
    if (typeof n.usage?.costUsd === 'number') bits.push(`≈ $${n.usage.costUsd.toFixed(2)} (estimado)`);
    const end = n.exit
      ? (n.exit.error ? 'detenido por seguridad' : n.exit.stopped ? 'detenido por ti' : n.exit.signal ? `salió (${n.exit.signal})` : `salió con código ${n.exit.code}`)
      : `desde ${time(n.startedAt)}`;
    refill('foot', `${bits.join()}|${end}`, () => [el('span', { text: bits.join(' · ') }), el('span', { text: end })]);
  }

  return { el: card, update };
}
