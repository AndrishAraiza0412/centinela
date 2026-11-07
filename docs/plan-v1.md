# Centinela v1 Implementation Plan

> **Note:** this is the original v1 plan, kept as a record. Several details changed during implementation (see `decisiones-v1.md`), and the interface was later redesigned without Cytoscape or a CDN. The [README](../README.md) describes the current state.

**Goal:** A local dashboard that shows Claude Code sessions and subagents live, and lets you launch agents by role, send them prompts and approve their permissions.

**Architecture:** Claude Code `http` hooks → dependency-free Node server on 127.0.0.1:4317 → daily `.jsonl` + Server-Sent Events → a page with Cytoscape.js. Launched agents are `claude -p` processes with `stream-json` whose permission approval goes through the `PermissionRequest` hook to the dashboard.

**Tech Stack:** Node ≥ 22 (ESM, `node:http`, `node:test`, `node:child_process`), Cytoscape.js 3.30.2 by CDN with SRI, HTML/CSS/JS without a framework.

**Spec:** `docs/diseno-v1.md`

## Global Constraints

- Zero npm runtime dependencies. Only `node:*`. Tests with `node --test`.
- The server listens only on `127.0.0.1`, port `4317` (overridable with `CENTINELA_PORT`, for tests only).
- Data in `~/.centinela/` (overridable with `CENTINELA_HOME`): dir `0700`, files `0600`.
- Never `shell: true`, never `innerHTML` with event data, never `bypassPermissions`.
- Claude binary: `claude` (overridable with `CENTINELA_CLAUDE_BIN`, for tests with a fake).
- Claude Code config: `$CLAUDE_CONFIG_DIR/settings.json`, otherwise `~/.claude/settings.json`.
- **No git until something works:** `git init` + first commit when Task 6 finishes (live observation working). After that, one commit per task.
- UI in Spanish.

**Deviation from the spec (a security improvement, decided in the plan):** two classes of token instead of one.
- `ui-token` (`~/.centinela/token`): authorizes all `/api/*` and `/events`. Only the page has it.
- `hook-token` (`~/.centinela/hook-token`): authorizes only `POST /hooks/event`. It goes literally in `settings.json` (not a strong secret); if leaked, it only allows injecting fake events, not launching anything.
- `launch-token` per launched agent (in memory): authorizes only `POST /hooks/permission` for that agent; it travels in `--settings`.

## Review Focus

1. **Huge `tool_input`** (Write of a 2 MB file): the `.jsonl` stores it in full, but the UI and SSE must truncate it to 2,000 characters per field → test in Task 3.
2. **Subagent events without a prior delegation** (unexpected order, or hooks installed mid-session): the node must hang from the main session with an unlabeled edge, not get lost → test in Task 2.
3. **`settings.json` with existing user hooks or invalid JSON**: the installer merges without deleting anything; with invalid JSON it aborts without writing → tests in Task 5.
4. **Port 4317 in use**: clear message "Centinela ya está corriendo o el puerto 4317 está ocupado" and exit 1, no stack trace → test in Task 3.
5. **Server restarted with launched agents alive**: on reload, launched agents from history appear as `disconnected` (not `working`) and without a prompt field → test in Task 2.

---

### Task 1: Spike — confirm pending facts and record fixtures

Throwaway except for the fixtures. Resolves the 3 "to confirm" items in spec §2.

**Files:**
- Create: `spike/capture.mjs` (delete at the end of the task)
- Create: `test/fixtures/subagent-session.jsonl`, `test/fixtures/permission-request.jsonl`, `test/fixtures/stream-json.jsonl`
- Create: `docs/spike-notes.md`

- [ ] **Step 1:** `spike/capture.mjs`: a `node:http` server on 127.0.0.1:4318 that, for every POST, writes `{"ts":Date.now(),"kind":"hook","body":<json>}` as a line in the file given by argv and responds with an empty `200`; for `/hooks/permission` it responds with the allow JSON from spec §2.
- [ ] **Step 2:** Launch a session with hooks only through `--settings` (all events in spec §2 pointing to `http://127.0.0.1:4318/hooks/event`, `PermissionRequest` to `/hooks/permission`, `onFailure: "block"`), in a temporary directory:
  `claude -p --output-format stream-json --verbose "Usa el subagente Explore para listar los archivos de este directorio y luego crea hola.txt con 'hola'" > test/fixtures/stream-json.jsonl`
  Expected: `subagent-session.jsonl` with `SubagentStart`, events with `agent_id`, and `hola.txt` created after a `PermissionRequest`.
- [ ] **Step 3:** Record in `spike-notes.md`, quoting the fixture: (a) the exact name of the delegation tool in `PreToolUse.tool_name` and the `tool_input` keys (type and prompt); (b) the fields of `SubagentStart`/`SubagentStop`; (c) whether `PermissionRequest` fired in `-p` and whether the allow response was respected; (d) the shape of `stream-json` lines (assistant text, final result, `session_id`); (e) the shape of a user message through stdin in `--input-format stream-json`.
- [ ] **Step 4:** If (c) fails: try `--permission-prompt-tool`/`--permission-prompts host` and record which works; update spec §2 and Task 8 before continuing.
- [ ] **Step 5:** Split out `permission-request.jsonl` (only that permission session), remove personal paths from the fixtures, delete `spike/`.

---

### Task 2: `graph.js` — events → graph state (pure)

**Files:**
- Create: `src/shared/graph.js` (ESM, no `node:*` imports: the browser uses it too)
- Test: `test/graph.test.js`

**Interfaces:**
- Consumes: records `{ts:number, kind:'hook'|'stream'|'launch'|'permission', agentKey?:string, body:object}` (shape of the Task 1 fixtures).
- Produces:
  - `initState() -> State`
  - `reduce(state: State, rec: Record) -> State` (mutates and returns the same object)
  - `nodeId(sessionId: string, agentId?: string) -> string` = `sessionId` or `` `${sessionId}:${agentId}` ``
  - `State = { nodes: {[id]: Node}, edges: Edge[], pending: {[permId]: Pending} }`
  - `Node = { id, sessionId, agentId: string|null, role: string, cwd: string, status: 'idle'|'working'|'waiting'|'done'|'error'|'disconnected', current: string|null, launched: string|null /* agentKey */, actions: Action[], startedAt: number, endedAt: number|null }`
  - `Action = { ts, tool: string, summary: string, ok: boolean|null, toolUseId: string }`
  - `Edge = { from: string, to: string, label: string }`
  - `Pending = { permId, nodeId, tool, input: object, ts }`
  - `summarize(toolName: string, toolInput: object) -> string` (≤ 80 chars: `Read auth.ts`, `Bash: npm test`, `Grep "token"`)

**Rules (what the test pins down):**
- `SessionStart` → main node, `role = body.agent_type ?? 'principal'`, status `idle`. **Spike: `SessionStart` does not arrive over http** → any event from a session without a main node creates it anyway (with the event's `cwd`).
- `UserPromptSubmit`/`PreToolUse` → status `working`; `PreToolUse` adds an Action with `ok:null` and sets `current`.
- `PostToolUse` → Action with the same `tool_use_id` to `ok:true`; `PostToolUseFailure` → `ok:false`.
- Event with `agent_id` → goes to node `nodeId(session_id, agent_id)`, creating it if it does not exist.
- Delegation: a `PreToolUse` whose `tool_name` is `'Agent'` (Task 1, note a; type in `tool_input.subagent_type`, text in `tool_input.prompt`) is queued as `{sessionId, parentNodeId, subagentType, label: prompt.slice(0,60)}`. `SubagentStart` takes the **first** queued entry from the same session with the same `subagentType` and creates the edge; with no match → edge from the main node with `label: ''`.
- `SubagentStop` → node `done`. `Stop` → main `idle`. `SessionEnd` → `done`. `StopFailure` → `error`.
- `kind:'permission'` with `body.state==='pending'` → `pending[permId]`, node `waiting`; `state==='decided'` → deletes pending, node `working`; if `body.decision==='deny'`, the node's last `ok:null` Action of that tool becomes `ok:false` (spike: after a deny no `PostToolUse*` arrives).
- `kind:'launch'` with `body.event==='started'` → sets `launched = agentKey` on the node of `body.sessionId`; `event==='exited'` → `error` if `code !== 0`, otherwise `done`.
- Unknown hook event → Action on its node with `tool: body.hook_event_name`, `ok: null` (spec §6: shown as a generic event).
- `markDisconnected(state)`: every node with `launched` and status ∉ {done,error} → `disconnected` (called after loading history).

- [ ] **Step 1: Failing tests** in `test/graph.test.js`:
  - `subagent session builds parent→child edge`: reducing `subagent-session.jsonl` → 2 nodes, 1 edge with a non-empty `label`, child node `role` = subagent type, child `done`.
  - `tool actions pair by tool_use_id`: Pre+Post → 1 Action `ok:true`.
  - `orphan subagent hangs from main with empty label` (Review Focus 2): `SubagentStart` without a prior `PreToolUse` → edge `{from: sessionId, label: ''}`.
  - `permission pending then decided`: node goes `waiting` → `working`, `pending` empty at the end.
  - `launched agents become disconnected after reload` (Review Focus 5).
  - `summarize`: `summarize('Bash',{command:'npm test'}) === 'Bash: npm test'`, `summarize('Read',{file_path:'/a/b/auth.ts'}) === 'Read auth.ts'`, result ≤ 80.
- [ ] **Step 2:** `node --test test/graph.test.js` → FAIL (module does not exist).
- [ ] **Step 3:** Implement `src/shared/graph.js`.
- [ ] **Step 4:** `node --test test/graph.test.js` → PASS.

---

### Task 3: Base server — store, auth, ingestion, SSE

**Files:**
- Create: `src/server/paths.js`, `src/server/store.js`, `src/server/auth.js`, `src/server/server.js`, `bin/centinela.js`
- Test: `test/store.test.js`, `test/server.test.js`

**Interfaces:**
- Consumes: `initState`, `reduce`, `markDisconnected` (Task 2).
- Produces:
  - `paths.js`: `home() -> string` (`CENTINELA_HOME` or `~/.centinela`), `ensureHome() -> void` (creates `0700`), `readOrCreateToken(name: 'token'|'hook-token') -> string` (32 hex bytes, `0600` file).
  - `store.js`: `append(rec) -> void` (to `events-YYYY-MM-DD.jsonl`, `0600`), `loadAll() -> Record[]` (all days in order; corrupt line → `console.warn` and skipped).
  - `auth.js`: `checkHostOrigin(req, port) -> number|null` (403 if `Host` ∉ {`127.0.0.1:<port>`, `localhost:<port>`} or if `Origin` is present and is not `http://127.0.0.1:<port>`/`http://localhost:<port>`); `bearer(req) -> string|null`; `safeEqual(a, b) -> boolean` (`crypto.timingSafeEqual`, false if lengths differ).
  - `server.js`: `createServer({port, uiToken, hookToken, claudeBin}) -> {server: http.Server, state, broadcast(rec)}`; `broadcast` does `append` + `reduce` + sends `data: <json>\n\n` to each SSE client with text fields truncated to 2,000 chars (`truncateRec(rec, 2000)`).
  - Routes in this task: `GET /` and `GET /app.js` etc. (static files from `public/` and `src/shared/`), `POST /hooks/event` (hook-token), `GET /api/state` (ui-token → full `state`), `GET /events` (ui-token through `?token=` **on this route only**, because `EventSource` does not support headers; accepted and documented).
  - Common rules: `checkHostOrigin` on every route; `POST` requires `Content-Type: application/json` (415 otherwise); max body 5 MB (413).
  - `bin/centinela.js`: starts, `loadAll()` → `reduce` → `markDisconnected`, prints `http://127.0.0.1:4317/#token=<uiToken>` and opens it with `open`. `EADDRINUSE` → `"Centinela ya está corriendo o el puerto 4317 está ocupado"`, exit 1.

- [ ] **Step 1: Failing tests** (`createServer` on port 0, `CENTINELA_HOME` in a temporary dir):
  - `store skips corrupt lines`: file with a garbage line between two valid ones → `loadAll()` returns 2.
  - `files are 0600 and dir 0700`.
  - `POST /hooks/event without token -> 401`; `with ui-token -> 401` (only hook-token is valid); `with hook-token -> 200` and it appears in `/api/state`.
  - `foreign Host -> 403`; `foreign Origin -> 403`; `text/plain POST -> 415`.
  - `GET /api/state with hook-token -> 401`.
  - `SSE truncates long fields` (Review Focus 1): event with a 10,000-char `tool_input.content` → the SSE message carries ≤ 2,000; `loadAll()` carries it in full.
  - `port in use prints friendly message` (Review Focus 4): spawning `bin/centinela.js` twice with the same `CENTINELA_PORT` → the second exits 1 with the exact message.
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implement the five files.
- [ ] **Step 4:** `node --test` → PASS.

---

### Task 4: Page — graph, panel, timeline (read-only)

**Files:**
- Create: `public/index.html`, `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: `GET /api/state`, `GET /events?token=`, `reduce`/`initState` from `/shared/graph.js` (the server serves `src/shared/` at `/shared/`).
- Produces: nothing for other tasks except the containers `#graph`, `#panel`, `#timeline`, `#toolbar` that Task 8 extends.

- [ ] **Step 1:** `index.html`: the CSP from spec §5 in `<meta http-equiv>`; Cytoscape `https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.min.js` with `integrity` calculated with `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A` and `crossorigin="anonymous"`.
- [ ] **Step 2:** `app.js`: reads the token from `location.hash`, saves it in `sessionStorage` and clears the hash with `history.replaceState`; loads `/api/state`; opens `EventSource`; on each message, local `reduce` and incremental re-render. Nodes: color by `role` (name hash → fixed palette of 8), class by `status` (CSS pulse on `working`, amber on `waiting`, gray on `disconnected`). `breadthfirst` layout grouped by `sessionId`. Filters: project (`cwd`), active only.
- [ ] **Step 3:** Right panel on click: role, status, task (label of the incoming edge), actions with time, "ver JSON crudo" (view raw JSON) button. **All with `textContent`.**
- [ ] **Step 4:** Timeline: one lane per visible node, blocks per Action (`ts` until the next Action), SVG or divs.
- [ ] **Step 5: Verify:** `CENTINELA_HOME=$(mktemp -d) node bin/centinela.js`, then resend `test/fixtures/subagent-session.jsonl` line by line with `curl -H "Authorization: Bearer $(cat $CENTINELA_HOME/hook-token)" -H 'Content-Type: application/json' -d @-` to `/hooks/event` every 300 ms. Expected: 2 nodes and the edge appear, the child pulses and goes to ✓; reloading the page keeps everything.
- [ ] **Step 6:** `grep -n innerHTML public/` → no results.

---

### Task 5: `install-hooks.js` — install observation in Claude Code

**Files:**
- Create: `src/server/install-hooks.js`, `bin/centinela-hooks.js`
- Test: `test/install-hooks.test.js`

**Interfaces:**
- Consumes: `readOrCreateToken('hook-token')` (Task 3).
- Produces:
  - `settingsPath() -> string` (`$CLAUDE_CONFIG_DIR/settings.json` or `~/.claude/settings.json`)
  - `merge(settings: object, hookToken: string, port: number) -> object` — for each observation event in spec §2 (all except `PermissionRequest`), adds an entry `{"matcher":"", "hooks":[{"type":"http","url":"http://127.0.0.1:<port>/hooks/event","timeout":2,"headers":{"Authorization":"Bearer <hookToken>"}}]}` marked with `"_centinela": true`; idempotent (does not duplicate); does not touch foreign entries. **Spike:** if `sandbox.enabled` is true, adds `127.0.0.1` to `sandbox.network.allowedDomains` (without it hooks get a 403) and records it in `"_centinelaAddedDomain": true` so `unmerge` removes it only if it added it.
  - `unmerge(settings) -> object` — removes only the `_centinela` entries.
  - CLI: `centinela-hooks install|uninstall [--yes]`: shows a diff (JSON before/after of the `hooks` key), asks for confirmation unless `--yes`, writes a `settings.json.centinela-backup-<ts>` copy before writing.

- [ ] **Step 1: Failing tests:**
  - `merge keeps user hooks` (Review Focus 3): settings with their own `PreToolUse` hook → after `merge` it is still there and there is one more `_centinela`.
  - `merge is idempotent`: `merge(merge(s))` deep-equal `merge(s)`.
  - `unmerge restores original`: `unmerge(merge(s))` deep-equal `s`.
  - `invalid JSON aborts without writing` (Review Focus 3): CLI on a file with `{` → exit 1, file intact, no backup.
  - Verify against Task 1 that the `matcher`/`hooks` shape is what Claude Code accepted; if the spike showed that events without a tool carry no `matcher`, omit it for those.
- [ ] **Step 2:** `node --test test/install-hooks.test.js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test` → PASS.

---

### Task 6: Live observation test + first commit

- [ ] **Step 1:** `node bin/centinela-hooks.js install` on Claude Code's `settings.json` (review the diff before accepting).
- [ ] **Step 2:** `node bin/centinela.js`, and in another terminal open `claude` in any project and ask for something that uses a subagent. Expected: the session appears in < 1 s, the subagent hangs with its task, actions arrive live.
- [ ] **Step 3:** Turn Centinela off and keep using `claude` in the terminal. Expected: no visible error or perceptible delay.
- [ ] **Step 4:** `git init`, `.gitignore` (`node_modules/`, `.DS_Store`), commit: `feat: observación en vivo de sesiones de Claude Code`.

---

### Task 7: Launcher — roles, `claude` processes, prompts

**Files:**
- Create: `src/server/roles.js`, `src/server/launcher.js`
- Modify: `src/server/server.js` (new routes)
- Create: `test/fake-claude.mjs` (imitates `claude -p --input-format stream-json --output-format stream-json`: emits a `system/init` line with `session_id`, and for each stdin line an assistant response with the received text; exits 0 when stdin closes)
- Test: `test/launcher.test.js`

**Interfaces:**
- Consumes: `broadcast(rec)` (Task 3), `stream-json` shape (Task 1 notes d/e).
- Produces:
  - `listRoles(cwd?: string) -> {name, description, source:'user'|'project'}[]` — reads `name`/`description` frontmatter from `<config>/agents/*.md` and `<cwd>/.claude/agents/*.md`.
  - `launch({role, cwd, prompt, resume?}) -> {agentKey: string, launchToken: string}` — validates (role ∈ `listRoles(cwd)`, `cwd` absolute, exists, is a directory, `fs.realpathSync`), does `spawn(claudeBin, ['-p','--agent',role,'--input-format','stream-json','--output-format','stream-json','--verbose','--permission-mode','default','--settings', JSON.stringify(permSettings), ...(resume?['--resume',resume]:[])], {cwd, env:{...process.env, CENTINELA_AGENT_KEY: agentKey}})` without a shell; writes `prompt` through stdin in stream-json format; each stdout line → `broadcast({kind:'stream', agentKey, body})`; `system/init` → `broadcast({kind:'launch', agentKey, body:{event:'started', sessionId}})`; `exit` → `broadcast({kind:'launch', agentKey, body:{event:'exited', code, stderrTail}})` (last 2,000 chars of stderr).
  - `permSettings` = `{"hooks":{"PermissionRequest":[{"matcher":"","hooks":[{"type":"http","url":"http://127.0.0.1:<port>/hooks/permission","timeout":310,"onFailure":"block","headers":{"Authorization":"Bearer <launchToken>"}}]}]},"sandbox":{"network":{"allowedDomains":["127.0.0.1"]}}}` — **Spike:** without `allowedDomains` the user's sandbox returns 403 and, with `onFailure:"block"`, the agent cannot do anything that asks for permission. Verify in Task 10 that `--settings` merges `allowedDomains` with the user's list and does not replace it.
  - `sendPrompt(agentKey, text) -> boolean`, `stop(agentKey) -> boolean` (SIGTERM, SIGKILL after 5 s).
  - `tokenFor(launchToken) -> agentKey|null`.
  - Routes (ui-token): `GET /api/roles?cwd=`, `POST /api/agents {role,cwd,prompt,resume?}` → `{agentKey}`; `POST /api/agents/:key/prompt {text}`; `POST /api/agents/:key/stop`. 400 with a message in Spanish for each validation; 404 for an unknown agentKey.

- [ ] **Step 1: Failing tests** (`CENTINELA_CLAUDE_BIN=test/fake-claude.mjs`, test role in `<tmp>/.claude/agents/tester.md`):
  - `unknown role -> 400`; `relative cwd -> 400`; `nonexistent cwd -> 400`.
  - `prompt with shell metacharacters is passed literally`: prompt `"; rm -rf ~ $(whoami)"` → the fake returns it identical in the response.
  - `launch emits started, stream and exited records` with the fake's `session_id`.
  - `sendPrompt reaches the process`: the second response contains the sent text.
  - `stop terminates`: `exited` arrives in < 6 s.
  - `spawn args never use shell`: the fake dumps `process.argv` in its init; it contains `--agent tester` and `--permission-mode default`, never `bypassPermissions`.
- [ ] **Step 2:** `node --test test/launcher.test.js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test` → PASS. Commit: `feat: lanzar agentes por rol y enviarles prompts`.

---

### Task 8: Permissions from the dashboard

**Files:**
- Create: `src/server/permissions.js`
- Modify: `src/server/server.js`
- Test: `test/permissions.test.js`

**Interfaces:**
- Consumes: `tokenFor` (Task 7), `broadcast` (Task 3).
- Produces:
  - `request(agentKey, hookBody) -> Promise<'allow'|'deny'>` — if an applicable allow-session rule exists, resolves `allow` without asking; otherwise creates `permId` (`crypto.randomUUID()`), `broadcast({kind:'permission', agentKey, body:{state:'pending', permId, session_id, agent_id, tool:hookBody.tool_name, input:hookBody.tool_input}})` and waits; after `CENTINELA_PERMISSION_TIMEOUT_MS` (default 300,000) → `deny`.
  - `decide(permId, 'allow'|'allow-session'|'deny') -> boolean` (false if already decided or nonexistent); emits `state:'decided'`.
  - allow-session rule = key `` `${agentKey}|${agent_id ?? ''}|${tool}|${tool==='Bash' ? input.command : ''}` `` (Bash covers only the exact command); in memory.
  - Routes: `POST /hooks/permission` (launch-token → agentKey; other token → 401) responds `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}`; `POST /api/permissions/:permId {decision}` (ui-token).

- [ ] **Step 1: Failing tests:**
  - `hook with ui-token -> 401`; `with launch-token of another agent` → attributed only to that agent.
  - `timeout denies` with `CENTINELA_PERMISSION_TIMEOUT_MS=200`.
  - `allow-session covers same tool only`: after allow-session on `Edit`, a second `Edit` by the same agent → allow without pending; `Write` → pending.
  - `allow-session on Bash covers exact command only`: `npm test` allowed; `npm test && curl x` → pending.
  - `decide twice returns false`.
- [ ] **Step 2:** `node --test test/permissions.test.js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test` → PASS. Commit: `feat: aprobar permisos de agentes desde el panel`.

---

### Task 9: Control UI — new agent, prompts, permissions, continue here

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: routes from Tasks 7 and 8; `Node.launched`, `state.pending`, `kind:'stream'` records.

- [ ] **Step 1:** "+ Nuevo agente" button → native `<dialog>` with a roles `<select>` (from `/api/roles?cwd=`), folder `<input>` (absolute path), prompt `<textarea>`; 400 errors shown in the dialog.
- [ ] **Step 2:** Launched node panel: assistant responses (from `kind:'stream'`, text with `textContent`), `<textarea>` + "Enviar", "Detener" button. `disconnected` node: no field, with the notice "Centinela se reinició; este agente ya no está conectado".
- [ ] **Step 3:** Terminal node panel: "Continuar aquí" button → `POST /api/agents {role: node.role==='principal' ? <role chosen in a select> : node.role, cwd: node.cwd, prompt, resume: node.sessionId}`.
- [ ] **Step 4:** Permission cards (one per `state.pending`) fixed at the top right: "<role> wants <tool>: <summarize>", expandable full input, Permitir / Permitir siempre en esta sesión / Rechazar buttons. Browser notification (`Notification`, if the user accepts it) when one arrives with the tab hidden.
- [ ] **Step 5:** `grep -n innerHTML public/` → no results. Commit: `feat: controles de agentes en el panel`.

---

### Task 10: End-to-end test and security review

- [ ] **Step 1:** Manual E2E (spec §7): launch a `code-reviewer` agent on this repo with "revisa src/server/auth.js"; see it in the graph; send a second prompt; ask it to create a file and approve the permission from the dashboard; reject another and see that it does not run; "Continuar aquí" on a terminal session.
- [ ] **Step 2:** Turn the server off with an agent waiting for permission → the agent gets deny (onFailure block) and its node stays `disconnected` on return.
- [ ] **Step 3:** From another tab on `https://example.com`, console: `fetch('http://127.0.0.1:4317/api/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})` → blocked (CORS/403), nothing launched.
- [ ] **Step 4:** Review with the `security-auditor` agent against the table in spec §5 and this plan's token deviation; fix what it finds with a test.
- [ ] **Step 5:** Brief `README.md` (start, install/uninstall hooks, tokens). Commit: `chore: centinela v1`.
