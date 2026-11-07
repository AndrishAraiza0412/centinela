import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPermissions } from '../src/server/permissions.js';
import { describePermission, initState, reduce } from '../src/shared/graph.js';

function harness({ active = () => true } = {}) {
  const recs = [];
  const perms = createPermissions({ broadcast: (r) => recs.push(r), timeoutMs: 60_000, isActive: active, roleOf: (b) => b.agent_type ?? 'coordinador' });
  const ask = (agentId, input, tool = 'Edit') => perms.request('k1', { session_id: 's1', agent_id: agentId, agent_type: agentId, cwd: '/proj', tool_name: tool, tool_input: input });
  const pending = () => recs.filter((r) => r.body.state === 'pending');
  return { recs, perms, ask, pending };
}
const edit = (file, n) => ({ file_path: file, old_string: 'a', new_string: n });

test('a parallel edit to the same file goes back to the agent with the other change, then to the panel', async () => {
  const { recs, ask, pending } = harness();
  ask('legal', edit('/proj/page.html', 'aviso legal'));
  const first = await ask('desarrollador', edit('page.html', 'nuevo menú')); // relativa al cwd: mismo archivo
  assert.equal(first.decision, 'deny');
  assert.match(first.message, /legal/);
  assert.match(first.message, /aviso legal/, 'the agent sees what the other one wants to do');
  assert.match(first.message, /vuelve a leer/);
  assert.ok(recs.some((r) => r.body.state === 'review' && r.body.path === '/proj/page.html'));

  ask('desarrollador', edit('page.html', 'nuevo menú + aviso'));
  await new Promise((r) => setImmediate(r));
  const [, second] = pending();
  assert.equal(second.body.review.path, '/proj/page.html');
  assert.equal(second.body.review.with[0].role, 'legal');
});

test('an approved edit by an agent still working counts; one by a finished agent does not', async () => {
  let legalActive = true;
  const { ask, perms, pending } = harness({ active: (s, agentId) => agentId !== 'legal' || legalActive });
  ask('legal', edit('/proj/a.js', 'x'));
  await new Promise((r) => setImmediate(r));
  perms.decide(pending()[0].body.permId, 'allow');
  assert.equal((await ask('qa', edit('/proj/a.js', 'y'))).decision, 'deny');
  legalActive = false;
  ask('seguridad', edit('/proj/a.js', 'z'));
  await new Promise((r) => setImmediate(r));
  assert.equal(pending().at(-1).body.review, undefined);
});

test('different files, the same agent twice, or a non-edit tool never trigger a review', async () => {
  const { recs, ask } = harness();
  ask('legal', edit('/proj/a.js', 'x'));
  ask('qa', edit('/proj/b.js', 'y'));
  ask('legal', edit('/proj/a.js', 'x2'));
  ask('qa', { command: 'cat /proj/a.js' }, 'Bash');
  await new Promise((r) => setImmediate(r));
  assert.equal(recs.filter((r) => r.body.state === 'review').length, 0);
  assert.equal(recs.filter((r) => r.body.state === 'pending').length, 4);
});

test('the review shows on the agent card; the panel card for Agent says which role and what for', () => {
  const state = initState();
  reduce(state, { ts: 1, kind: 'permission', agentKey: 'k1', body: { state: 'review', session_id: 's1', agent_id: 'qa', agent_type: 'qa', path: '/proj/a.js', with: ['legal'] } });
  assert.match(state.nodes['s1:qa'].actions[0].summary, /legal.*a\.js/);
  const text = describePermission('Agent', { subagent_type: 'legal', description: 'Redactar el aviso legal', prompt: 'Escribe el aviso de privacidad para la página' });
  assert.match(text, /«legal» para: Redactar el aviso legal/);
  assert.match(text, /Escribe el aviso de privacidad/);
});
