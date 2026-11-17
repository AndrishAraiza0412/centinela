// Events → graph state. Pure and import-free: used by both the server and the browser.

const DELEGATION_TOOL = 'Agent';
const MAX_SUMMARY = 80;
const MAX_MESSAGES = 200;
const MAX_ACTIONS = 500;
export const ACTIVE = new Set(['idle', 'working', 'waiting']);
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
// An id that comes from an event can never be a name inherited from Object.prototype.
const safeId = (id) => typeof id === 'string' && id !== '' && !RESERVED.has(id);

// `delegations`: PreToolUse of Agent that has no SubagentStart yet. It goes in the State because the
// browser keeps reducing over the /api/state snapshot.
export function initState() {
  return { nodes: {}, edges: [], pending: {}, delegations: [] };
}

export function nodeId(sessionId, agentId) {
  return agentId ? `${sessionId}:${agentId}` : sessionId;
}

const basename = (p) => String(p ?? '').split('/').pop();
const clip = (s) => (s.length > MAX_SUMMARY ? s.slice(0, MAX_SUMMARY - 1) + '…' : s);

// What the permission card shows: without trimming or abbreviating paths (what is approved must be seen in full).
export function describePermission(toolName, input = {}) {
  const i = input ?? {};
  if (toolName === 'Bash') return `Bash: ${i.command ?? ''}`;
  if (toolName === DELEGATION_TOOL) {
    return `Lanzar un subagente «${i.subagent_type ?? '?'}»${i.description ? ` para: ${i.description}` : ''}\n\nEncargo:\n${i.prompt ?? ''}`;
  }
  const path = i.file_path ?? i.notebook_path ?? i.path ?? i.url;
  return path ? `${toolName} ${path}` : `${toolName} ${JSON.stringify(i)}`;
}

// Makes visible the characters that fool the eye (bidi, zero-width, control) and the
// long runs of spaces that push the rest of the command out of the box.
export function reveal(text) {
  let suspicious = false;
  const out = String(text)
    .replace(/[\p{Cf}\p{Cc}]/gu, (c) => {
      if (c === '\n' || c === '\t') return c;
      suspicious = true;
      return `\\u${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
    })
    .replace(/ {9,}/g, (run) => {
      suspicious = true;
      return ` ⟨${run.length} espacios⟩ `;
    });
  return { text: out, suspicious };
}

export function summarize(toolName, toolInput = {}) {
  const i = toolInput ?? {};
  switch (toolName) {
    case 'Bash': return clip(`Bash: ${i.command ?? ''}`);
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit':
      return clip(`${toolName} ${basename(i.file_path ?? i.notebook_path)}`);
    case 'Grep': return clip(`Grep "${i.pattern ?? ''}"`);
    case 'Glob': return clip(`Glob ${i.pattern ?? ''}`);
    case DELEGATION_TOOL: return clip(`Agent → ${i.subagent_type ?? '?'}`);
    default: return clip(String(toolName));
  }
}

function makeNode(id, sessionId, agentId, role, cwd, ts) {
  return { id, sessionId, agentId, role, cwd, status: 'idle', current: null, launched: null, actions: [], messages: [], startedAt: ts, endedAt: null };
}

function ensureMain(state, sessionId, cwd, ts) {
  const id = nodeId(sessionId);
  if (!Object.hasOwn(state.nodes, id)) state.nodes[id] = makeNode(id, sessionId, null, 'principal', cwd ?? '', ts);
  return state.nodes[id];
}

// Node a hook event belongs to; creates the main and the child if missing. A child is born
// hanging from the main (edge without a label); SubagentStart corrects it if it knows who delegated.
function nodeFor(state, b, ts) {
  const main = ensureMain(state, b.session_id, b.cwd, ts);
  if (!b.agent_id) return main;
  const id = nodeId(b.session_id, b.agent_id);
  if (!Object.hasOwn(state.nodes, id)) {
    state.nodes[id] = makeNode(id, b.session_id, b.agent_id, b.agent_type ?? 'subagente', b.cwd ?? main.cwd, ts);
    state.edges.push({ from: main.id, to: id, label: '' });
  }
  return state.nodes[id];
}

function end(node, status, ts) {
  node.status = status;
  node.current = null;
  node.endedAt = ts;
}

// End of a session: none of its nodes can keep "working" (subagents included).
function endSession(state, sessionId, status, ts) {
  for (const n of Object.values(state.nodes)) {
    if (n.sessionId === sessionId && ACTIVE.has(n.status)) end(n, status, ts);
  }
  state.delegations = state.delegations.filter((q) => q.sessionId !== sessionId);
}

function pushAction(node, action) {
  node.actions.push(action);
  if (node.actions.length > MAX_ACTIONS) node.actions.shift();
}

const dropDelegation = (state, pred) => {
  const i = state.delegations.findLastIndex(pred);
  if (i >= 0) state.delegations.splice(i, 1);
};

function reduceHook(state, b, ts) {
  if (!safeId(b.session_id) || (b.agent_id !== undefined && !safeId(b.agent_id))) return;
  const node = nodeFor(state, b, ts);
  switch (b.hook_event_name) {
    case 'SessionStart':
      node.role = b.agent_type ?? node.role;
      node.status = 'idle';
      break;
    case 'UserPromptSubmit':
      node.status = 'working';
      break;
    case 'PreToolUse': {
      const summary = summarize(b.tool_name, b.tool_input);
      node.status = 'working';
      node.current = summary;
      pushAction(node, { ts, tool: b.tool_name, summary, ok: null, toolUseId: b.tool_use_id });
      if (b.tool_name === DELEGATION_TOOL) {
        state.delegations.push({
          sessionId: b.session_id,
          parentNodeId: node.id,
          toolUseId: b.tool_use_id,
          subagentType: b.tool_input?.subagent_type,
          label: String(b.tool_input?.prompt ?? '').slice(0, 60),
        });
      }
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const action = node.actions.find((a) => a.toolUseId === b.tool_use_id);
      if (action) Object.assign(action, { ok: b.hook_event_name === 'PostToolUse', endedAt: ts });
      // A delegation that ended (or failed) can no longer be paired with a future SubagentStart.
      if (b.tool_name === DELEGATION_TOOL) dropDelegation(state, (q) => q.toolUseId === b.tool_use_id);
      break;
    }
    case 'SubagentStart': {
      const queue = state.delegations;
      const i = queue.findIndex((q) => q.sessionId === b.session_id && q.subagentType === b.agent_type);
      const [match] = i >= 0 ? queue.splice(i, 1) : [];
      const edge = state.edges.find((e) => e.to === node.id);
      if (match) Object.assign(edge, { from: match.parentNodeId, label: match.label });
      node.status = 'working';
      break;
    }
    case 'SubagentStop': end(node, 'done', ts); break;
    case 'Stop': node.status = 'idle'; node.current = null; break;
    case 'SessionEnd': endSession(state, b.session_id, 'done', ts); break;
    case 'StopFailure': end(node, 'error', ts); break;
    default:
      pushAction(node, { ts, tool: b.hook_event_name, summary: summarize(b.hook_event_name), ok: null, toolUseId: '' });
  }
}

function reducePermission(state, agentKey, b, ts) {
  if (b.state === 'review') {
    // Centinela handed the change back to the agent so it reviews another agent's change to the same file.
    const others = Array.isArray(b.with) ? b.with.join(', ') : 'otro agente';
    pushAction(nodeFor(state, b, ts), { ts, tool: 'Revisión', summary: clip(`Revisa el cambio de ${others} en ${basename(b.path)}`), ok: null, toolUseId: '' });
    return;
  }
  if (b.state === 'pending') {
    const node = nodeFor(state, b, ts);
    state.pending[b.permId] = { permId: b.permId, nodeId: node.id, agentKey: agentKey ?? null, tool: b.tool, input: b.input ?? {}, ts, ...(b.review && { review: b.review }) };
    node.status = 'waiting';
    node.current = `Espera permiso · ${b.tool}`;
    return;
  }
  const p = state.pending[b.permId];
  if (!p) return;
  delete state.pending[b.permId];
  const node = state.nodes[p.nodeId];
  if (!node) return;
  // Only "waiting" changes: a finished agent does not come back to life because of a late cancellation.
  if (node.status === 'waiting') {
    const next = Object.values(state.pending).find((q) => q.nodeId === node.id);
    node.status = next ? 'waiting' : 'working';
    node.current = next ? `Espera permiso · ${next.tool}` : null;
  }
  if (b.decision === 'deny') {
    const action = node.actions.findLast((a) => a.tool === p.tool && a.ok === null);
    if (action) action.ok = false;
    if (p.tool === DELEGATION_TOOL) dropDelegation(state, (q) => q.parentNodeId === node.id);
  }
}

const launchedNode = (state, agentKey) => Object.values(state.nodes).find((n) => n.launched === agentKey);

function addMessage(node, msg) {
  node.msgSeq = (node.msgSeq ?? 0) + 1; // the UI uses it as a signature: the length stalls at the cap
  (node.messages ??= []).push(msg);
  if (node.messages.length > MAX_MESSAGES) node.messages.shift();
}

// Conversation of a launched agent: only the main thread's text (not its subagents').
function reduceStream(state, agentKey, b, ts) {
  if (b.type === 'result' && typeof b.total_cost_usd === 'number') {
    // Estimate reported by claude -p (with a subscription it is not a charge).
    const node = launchedNode(state, agentKey);
    if (node) node.usage = { ...node.usage, costUsd: b.total_cost_usd };
    return;
  }
  if (b.type !== 'assistant' || b.parent_tool_use_id) return;
  const node = launchedNode(state, agentKey);
  const u = b.message?.usage;
  if (node && u) {
    // Context size at the last call of the main thread.
    const contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    node.usage = { ...node.usage, contextTokens };
  }
  const text = (b.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (node && text) addMessage(node, { ts, from: 'assistant', text });
}

function reduceLaunch(state, agentKey, b, ts) {
  if (b.event === 'prompt') {
    const node = launchedNode(state, agentKey);
    if (node) addMessage(node, { ts, from: 'user', text: b.text });
    return;
  }
  if (b.event === 'started') {
    if (!safeId(b.sessionId)) return;
    const node = ensureMain(state, b.sessionId, b.cwd, ts);
    node.launched = agentKey;
    if (b.role) node.role = b.role;
    if (typeof b.model === 'string') node.model = b.model;
    return;
  }
  if (b.event === 'exited') {
    // Stopped by the user (stopped) is not an error even if it exits by signal.
    const status = b.code === 0 || b.stopped ? 'done' : 'error';
    let nodes = Object.values(state.nodes).filter((n) => n.launched === agentKey);
    if (!nodes.length) {
      // Died before system/init (claude missing, no session, role rejected): make it look the same.
      const id = `launch:${agentKey}`;
      state.nodes[id] = makeNode(id, '', null, b.role ?? 'agente', b.cwd ?? '', ts);
      state.nodes[id].launched = agentKey;
      nodes = [state.nodes[id]];
    }
    for (const node of nodes) {
      node.exit = { code: b.code ?? null, signal: b.signal ?? null, stderrTail: b.stderrTail ?? '', ...(b.stopped && { stopped: true }), ...(b.error && { error: b.error }) };
      if (node.sessionId) endSession(state, node.sessionId, status, ts);
      end(node, status, ts);
    }
  }
}

export function reduce(state, rec) {
  const b = rec.body ?? {};
  if (rec.kind === 'hook' && b.session_id) reduceHook(state, b, rec.ts);
  else if (rec.kind === 'permission') reducePermission(state, rec.agentKey, b, rec.ts);
  else if (rec.kind === 'launch') reduceLaunch(state, rec.agentKey, b, rec.ts);
  else if (rec.kind === 'stream') reduceStream(state, rec.agentKey, b, rec.ts);
  return state;
}
