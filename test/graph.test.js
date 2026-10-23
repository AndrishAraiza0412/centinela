import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initState, reduce, nodeId, summarize, markDisconnected, describePermission, reveal } from '../src/shared/graph.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const hook = (body, ts = 1) => ({ ts, kind: 'hook', body: { session_id: 's1', cwd: '/tmp/demo', ...body } });

test('subagent session builds parent→child edge', () => {
  const s = initState();
  for (const rec of fixture('subagent-session.jsonl')) reduce(s, rec);
  const ids = Object.keys(s.nodes);
  assert.equal(ids.length, 2);
  assert.equal(s.edges.length, 1);
  const [edge] = s.edges;
  assert.notEqual(edge.label, '');
  const child = s.nodes[edge.to];
  assert.equal(child.role, 'Explore');
  assert.equal(child.status, 'done');
  assert.equal(s.nodes[edge.from].agentId, null);
});

test('main node is created without SessionStart', () => {
  const s = reduce(initState(), hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hola' }));
  const main = s.nodes[nodeId('s1')];
  assert.equal(main.role, 'principal');
  assert.equal(main.cwd, '/tmp/demo');
  assert.equal(main.status, 'working');
});

test('tool actions pair by tool_use_id', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b.ts' }, tool_use_id: 't1' }));
  reduce(s, hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b.ts' }, tool_use_id: 't1' }));
  const { actions } = s.nodes.s1;
  assert.equal(actions.length, 1);
  assert.equal(actions[0].ok, true);
  assert.equal(actions[0].summary, 'Read b.ts');
});

test('PostToolUseFailure marks the action failed', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: 't1' }));
  reduce(s, hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 't1' }));
  assert.equal(s.nodes.s1.actions[0].ok, false);
});

test('orphan subagent hangs from main with empty label', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }));
  assert.deepEqual(s.edges, [{ from: 's1', to: 's1:a1', label: '' }]);
  assert.equal(s.nodes['s1:a1'].role, 'Explore');
});

test('delegation matches the first queued entry of the same type', () => {
  const s = initState();
  const agent = (prompt, type, id) =>
    hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: type, prompt }, tool_use_id: id });
  reduce(s, agent('primero', 'Explore', 't1'));
  reduce(s, agent('auditar', 'auditor', 't2'));
  reduce(s, agent('segundo', 'Explore', 't3'));
  reduce(s, hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }));
  reduce(s, hook({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'Explore' }));
  assert.deepEqual(s.edges.map((e) => e.label), ['primero', 'segundo']);
});

test('permission pending then decided', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/x.js' }, tool_use_id: 't1' }));
  reduce(s, { ts: 2, kind: 'permission', body: { state: 'pending', permId: 'p1', session_id: 's1', tool: 'Edit', input: {} } });
  assert.equal(s.nodes.s1.status, 'waiting');
  assert.equal(s.pending.p1.nodeId, 's1');
  reduce(s, { ts: 3, kind: 'permission', body: { state: 'decided', permId: 'p1', decision: 'allow' } });
  assert.equal(s.nodes.s1.status, 'working');
  assert.deepEqual(s.pending, {});
  assert.equal(s.nodes.s1.actions[0].ok, null);
});

test('denied permission marks the pending action failed', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/a/hola.txt' }, tool_use_id: 't1' }));
  reduce(s, { ts: 2, kind: 'permission', body: { state: 'pending', permId: 'p1', session_id: 's1', tool: 'Write', input: {} } });
  reduce(s, { ts: 3, kind: 'permission', body: { state: 'decided', permId: 'p1', decision: 'deny' } });
  assert.equal(s.nodes.s1.actions[0].ok, false);
});

test('launched agents become disconnected after reload', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'UserPromptSubmit' }));
  reduce(s, { ts: 2, kind: 'launch', agentKey: 'k1', body: { event: 'started', sessionId: 's1' } });
  reduce(s, hook({ hook_event_name: 'UserPromptSubmit', session_id: 's2' }));
  reduce(s, { ts: 3, kind: 'launch', agentKey: 'k2', body: { event: 'started', sessionId: 's2' } });
  reduce(s, { ts: 4, kind: 'launch', agentKey: 'k2', body: { event: 'exited', code: 0 } });
  markDisconnected(s);
  assert.equal(s.nodes.s1.launched, 'k1');
  assert.equal(s.nodes.s1.status, 'disconnected');
  assert.equal(s.nodes.s2.status, 'done');
});

test('launch exit with non-zero code is an error', () => {
  const s = initState();
  reduce(s, { ts: 1, kind: 'launch', agentKey: 'k1', body: { event: 'started', sessionId: 's1' } });
  reduce(s, { ts: 2, kind: 'launch', agentKey: 'k1', body: { event: 'exited', code: 1 } });
  assert.equal(s.nodes.s1.status, 'error');
});

test('unknown hook event becomes a generic action', () => {
  const s = reduce(initState(), hook({ hook_event_name: 'Notification', message: 'x' }));
  assert.equal(s.nodes.s1.actions[0].tool, 'Notification');
  assert.equal(s.nodes.s1.actions[0].ok, null);
});

test('summarize', () => {
  assert.equal(summarize('Bash', { command: 'npm test' }), 'Bash: npm test');
  assert.equal(summarize('Read', { file_path: '/a/b/auth.ts' }), 'Read auth.ts');
  assert.equal(summarize('Grep', { pattern: 'token' }), 'Grep "token"');
  assert.ok(summarize('Bash', { command: 'x'.repeat(500) }).length <= 80);
});

test('reduce continues on a JSON round-tripped state (browser loads /api/state)', () => {
  const server = initState();
  reduce(server, hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'busca' }, tool_use_id: 't1' }));
  const browser = JSON.parse(JSON.stringify(server));
  reduce(browser, hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }));
  assert.deepEqual(browser.edges, [{ from: 's1', to: 's1:a1', label: 'busca' }]);
});

test('launched node takes the launch role and a user stop is not an error', () => {
  const s = initState();
  reduce(s, { ts: 1, kind: 'launch', agentKey: 'k1', body: { event: 'started', sessionId: 's1', cwd: '/p', role: 'tester' } });
  assert.equal(s.nodes.s1.role, 'tester');
  reduce(s, { ts: 2, kind: 'launch', agentKey: 'k1', body: { event: 'exited', code: null, signal: 'SIGTERM', stopped: true } });
  assert.equal(s.nodes.s1.status, 'done');
});

test('launched node keeps the conversation: prompts and assistant text', () => {
  const s = initState();
  reduce(s, { ts: 1, kind: 'launch', agentKey: 'k1', body: { event: 'started', sessionId: 's1', cwd: '/p', role: 'tester' } });
  reduce(s, { ts: 2, kind: 'launch', agentKey: 'k1', body: { event: 'prompt', text: 'hola' } });
  reduce(s, { ts: 3, kind: 'stream', agentKey: 'k1', body: { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'qué tal' }] } } });
  reduce(s, { ts: 4, kind: 'stream', agentKey: 'k1', body: { type: 'assistant', parent_tool_use_id: 'toolu_x', message: { content: [{ type: 'text', text: 'de un subagente' }] } } });
  reduce(s, { ts: 5, kind: 'stream', agentKey: 'k1', body: { type: 'result', result: 'qué tal' } });
  assert.deepEqual(s.nodes.s1.messages, [
    { ts: 2, from: 'user', text: 'hola' },
    { ts: 3, from: 'assistant', text: 'qué tal' },
  ]);
});


test('pending permission remembers which launched agent asked', () => {
  const s = initState();
  reduce(s, { ts: 1, kind: 'launch', agentKey: 'k1', body: { event: 'started', sessionId: 's1', cwd: '/p', role: 'tester' } });
  reduce(s, { ts: 2, kind: 'permission', agentKey: 'k1', body: { state: 'pending', permId: 'p1', session_id: 's1', tool: 'Bash', input: { command: 'ls' } } });
  assert.equal(s.pending.p1.agentKey, 'k1');
});

// ---------- revisión final ----------
const launchRec = (ts, agentKey, body) => ({ ts, kind: 'launch', agentKey, body });
const permRec = (ts, agentKey, body) => ({ ts, kind: 'permission', agentKey, body });

test('R1: pending permissions from before a restart are dropped', () => {
  const s = initState();
  reduce(s, permRec(1, 'k1', { state: 'pending', permId: 'p1', session_id: 's1', tool: 'Bash', input: {} }));
  markDisconnected(s);
  assert.deepEqual(s.pending, {});
});

test('R2: a late cancellation does not revive a stopped agent', () => {
  const s = initState();
  reduce(s, launchRec(1, 'k1', { event: 'started', sessionId: 's1', cwd: '/p', role: 'tester' }));
  reduce(s, permRec(2, 'k1', { state: 'pending', permId: 'p1', session_id: 's1', tool: 'Bash', input: {} }));
  reduce(s, launchRec(3, 'k1', { event: 'exited', code: null, signal: 'SIGTERM', stopped: true }));
  reduce(s, permRec(4, 'k1', { state: 'decided', permId: 'p1', decision: 'deny', reason: 'cancelled' }));
  assert.equal(s.nodes.s1.status, 'done');
});

test('R2: deciding one of two pending requests keeps the node waiting', () => {
  const s = initState();
  reduce(s, permRec(1, 'k1', { state: 'pending', permId: 'p1', session_id: 's1', tool: 'Bash', input: {} }));
  reduce(s, permRec(2, 'k1', { state: 'pending', permId: 'p2', session_id: 's1', tool: 'Edit', input: {} }));
  reduce(s, permRec(3, 'k1', { state: 'decided', permId: 'p1', decision: 'allow' }));
  assert.equal(s.nodes.s1.status, 'waiting');
  reduce(s, permRec(4, 'k1', { state: 'decided', permId: 'p2', decision: 'allow' }));
  assert.equal(s.nodes.s1.status, 'working');
});

test('R3: a launch that dies before init still shows up with its exit info', () => {
  const s = initState();
  reduce(s, launchRec(1, 'k1', { event: 'exited', code: 1, signal: null, stopped: false, stderrTail: 'not logged in', role: 'tester', cwd: '/p' }));
  const node = s.nodes['launch:k1'];
  assert.equal(node.status, 'error');
  assert.equal(node.role, 'tester');
  assert.equal(node.launched, 'k1');
  assert.deepEqual(node.exit, { code: 1, signal: null, stderrTail: 'not logged in' });
});

test('R3: a normal exit keeps code and stderr on the node', () => {
  const s = initState();
  reduce(s, launchRec(1, 'k1', { event: 'started', sessionId: 's1', cwd: '/p', role: 'tester' }));
  reduce(s, launchRec(2, 'k1', { event: 'exited', code: 2, signal: null, stopped: false, stderrTail: 'boom' }));
  assert.deepEqual(s.nodes.s1.exit, { code: 2, signal: null, stderrTail: 'boom' });
});

test('R4: message sequence keeps growing past the cap', () => {
  const s = initState();
  reduce(s, launchRec(1, 'k1', { event: 'started', sessionId: 's1', cwd: '/p', role: 'tester' }));
  for (let i = 0; i < 205; i++) reduce(s, launchRec(2 + i, 'k1', { event: 'prompt', text: `m${i}` }));
  assert.equal(s.nodes.s1.messages.length, 200);
  assert.equal(s.nodes.s1.msgSeq, 205);
});

test('R5: a failed delegation does not label a later one', () => {
  const s = initState();
  const agent = (prompt, id) => hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt }, tool_use_id: id });
  reduce(s, agent('DENEGADO', 't1'));
  reduce(s, hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Agent', tool_use_id: 't1' }));
  reduce(s, agent('real', 't2'));
  reduce(s, hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }));
  assert.deepEqual(s.edges.map((e) => e.label), ['real']);
});

test('R5: a denied delegation is dropped from the queue', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'no' }, tool_use_id: 't1' }));
  reduce(s, permRec(2, 'k1', { state: 'pending', permId: 'p1', session_id: 's1', tool: 'Agent', input: {} }));
  reduce(s, permRec(3, 'k1', { state: 'decided', permId: 'p1', decision: 'deny' }));
  assert.deepEqual(s.delegations, []);
});

test('R5: SessionEnd drops the session queue', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'x' }, tool_use_id: 't1' }));
  reduce(s, hook({ hook_event_name: 'SessionEnd' }));
  assert.deepEqual(s.delegations, []);
});

test('R6: stopping a launched agent ends its running subagents too', () => {
  const s = initState();
  reduce(s, launchRec(1, 'k1', { event: 'started', sessionId: 's1', cwd: '/p', role: 'tester' }));
  reduce(s, hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }));
  reduce(s, launchRec(3, 'k1', { event: 'exited', code: null, signal: 'SIGTERM', stopped: true }));
  assert.equal(s.nodes['s1:a1'].status, 'done');
});

test('R6: SessionEnd ends every active node of the session', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }));
  reduce(s, hook({ hook_event_name: 'SessionEnd' }));
  assert.equal(s.nodes['s1:a1'].status, 'done');
});

test('R6: after a restart, terminal sessions are idle, not working forever', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' }));
  markDisconnected(s);
  assert.equal(s.nodes.s1.status, 'idle');
});

test('R7: actions per node are capped', () => {
  const s = initState();
  for (let i = 0; i < 520; i++) reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `c${i}` }, tool_use_id: `t${i}` }));
  assert.equal(s.nodes.s1.actions.length, 500);
  assert.equal(s.nodes.s1.actions.at(-1).summary, 'Bash: c519');
});

test('R8: a subagent seen without SubagentStart still hangs from main', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' }));
  assert.deepEqual(s.edges, [{ from: 's1', to: 's1:a1', label: '' }]);
});

test('R8: a later SubagentStart updates that edge instead of adding one', () => {
  const s = initState();
  reduce(s, hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'busca' }, tool_use_id: 't0' }));
  reduce(s, hook({ hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' }));
  reduce(s, hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }));
  assert.deepEqual(s.edges, [{ from: 's1', to: 's1:a1', label: 'busca' }]);
});

test('I4: reserved ids never touch Object.prototype', () => {
  const s = initState();
  for (const sid of ['__proto__', 'constructor', 'prototype']) {
    reduce(s, hook({ session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 't' }));
  }
  assert.equal(({}).status, undefined);
  assert.equal(({}).current, undefined);
  assert.equal(Object.getPrototypeOf(s.nodes), Object.prototype, 'nodes keeps its prototype');
  assert.deepEqual(Object.keys(s.nodes), []);
});

test('I3: describePermission shows full paths and the whole command', () => {
  assert.equal(describePermission('Write', { file_path: '/repo/.git/hooks/pre-commit', content: 'x' }), 'Write /repo/.git/hooks/pre-commit');
  const cmd = 'ls; ' + 'echo hi; '.repeat(40);
  assert.equal(describePermission('Bash', { command: cmd }), `Bash: ${cmd}`);
});

test('I3: reveal exposes invisible and bidi characters and long blank runs', () => {
  const r = reveal('ls \u202Etxt.exe\u200B' + ' '.repeat(30) + '; rm -rf ~');
  assert.equal(r.suspicious, true);
  assert.match(r.text, /\\u202E/);
  assert.match(r.text, /\\u200B/);
  assert.match(r.text, /⟨30 espacios⟩/);
  assert.match(r.text, /rm -rf ~/);
  assert.deepEqual(reveal('npm test\n\tok'), { text: 'npm test\n\tok', suspicious: false });
});

test('launched node keeps estimated cost and current context size', () => {
  const s = initState();
  reduce(s, { ts: 1, kind: 'launch', agentKey: 'k1', body: { event: 'started', sessionId: 's1', cwd: '/p', role: 'tester' } });
  reduce(s, { ts: 2, kind: 'stream', agentKey: 'k1', body: { type: 'assistant', message: { content: [{ type: 'text', text: 'hola' }], usage: { input_tokens: 10, cache_read_input_tokens: 30000, cache_creation_input_tokens: 2000, output_tokens: 50 } } } });
  reduce(s, { ts: 3, kind: 'stream', agentKey: 'k1', body: { type: 'assistant', parent_tool_use_id: 'toolu_sub', message: { content: [], usage: { input_tokens: 999999 } } } });
  reduce(s, { ts: 4, kind: 'stream', agentKey: 'k1', body: { type: 'result', total_cost_usd: 0.1834, usage: { output_tokens: 50 } } });
  assert.deepEqual(s.nodes.s1.usage, { contextTokens: 32010, costUsd: 0.1834 });
});

test('a pending permission shows as what the agent is doing now', () => {
  const s = initState();
  reduce(s, { ts: 1, kind: 'permission', agentKey: 'k1', body: { state: 'pending', permId: 'p1', session_id: 's1', tool: 'Bash', input: {} } });
  assert.equal(s.nodes.s1.current, 'Espera permiso · Bash');
  reduce(s, { ts: 2, kind: 'permission', agentKey: 'k1', body: { state: 'decided', permId: 'p1', decision: 'deny' } });
  assert.equal(s.nodes.s1.current, null);
});
