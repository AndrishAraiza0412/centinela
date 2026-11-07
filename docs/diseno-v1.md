# Centinela — v1 design

Date: 2026-10-21 · Status: draft for review

> **Note:** this is the original v1 design, kept as a record. The implementation has changed since: for example, it uses agent cards instead of a Cytoscape graph, has no CDN, and no longer stores the page token on disk. The [README](../README.md) describes the current state.

## 1. Goal

A local dashboard on the Mac to see, in real time, what Claude Code agents are doing
(main session and subagents by role: developer, auditor, researcher, legal…), how they
delegate work to each other, and to launch agents, send them prompts and approve their permissions.

It uses the user's Claude subscription through the `claude` CLI (no API key). Centinela does not
call the Anthropic API: it observes and controls Claude Code processes.

**v1 success:**
1. A Claude Code session open in the terminal appears in the dashboard in < 1 s with its
   subagents and actions.
2. From the dashboard you launch an agent with a role, send it a second prompt and approve or
   reject a permission, without touching the terminal.
3. No web page or foreign process can use the server to launch commands.

**Out of v1:** Mac app (Tauri, phase 2), costs/tokens, writing to sessions open in the
terminal, deleting history from the dashboard, defining roles from the dashboard.

## 2. Verified facts (Claude Code 2.1.295)

| Need | Mechanism |
|---|---|
| Receive events | `http` type hooks: POST JSON to a URL. `headers` with `$VAR` only for variables in `allowedEnvVars`. Non-2xx = non-blocking error. `onFailure: "block"` available. |
| Events used | `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `Notification`, `PermissionRequest` |
| Who did what | Common fields `session_id`, `cwd`, `hook_event_name`, `transcript_path`. Events inside a subagent carry `agent_id` and `agent_type`. Tool events carry `tool_name`, `tool_input`, `tool_use_id`. |
| Delegation (arrow) | `PreToolUse` with `tool_name: "Agent"` in the parent (`tool_input.subagent_type`, `tool_input.prompt`, `tool_input.description`) + the child's `SubagentStart` (`agent_id`, `agent_type`; no `tool_use_id`). In `stream-json`, `system/task_started.task_id` = `agent_id`. |
| Session start | `SessionStart` **does not arrive** through an `http` hook (spike): the main node is born with the session's first event. |
| User's sandbox | With `sandbox.enabled`, http hooks to 127.0.0.1 get a 403 unless `sandbox.network.allowedDomains` includes `127.0.0.1` (spike). |
| Launch with a role | `claude -p --agent <rol> --input-format stream-json --output-format stream-json` |
| Keep sending prompts | The process's stdin in `stream-json` |
| Continue a terminal session | `claude -p --resume <session_id> …` (new branch, the terminal's does not change) |
| Approve permissions | `PermissionRequest` hook → response `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"\|"deny"}}}`. Default timeout 600 s. |
| Hooks only for launched sessions | `--settings <json>` at launch |

**Confirmed in the spike (2026-10-22, `spike-notes.md`):** `PermissionRequest` fires in
`-p` and its response is respected, as long as the agent runs with `--permission-mode default`
(the user's `auto` mode approves first without asking). `PermissionRequest` has no
`tool_use_id`; after a deny no `PostToolUse*` arrives (`system/permission_denied` does, in `stream-json`).

## 3. Architecture

```
Claude Code (terminal or launched by Centinela)
  │ http hooks  (Authorization: Bearer $CENTINELA_TOKEN)
  ▼
centinela-server  — Node ≥ 22, no dependencies, 127.0.0.1:4317
  ├─ POST /hooks/event        stores and broadcasts
  ├─ POST /hooks/permission   (launched sessions only) waits for the user's decision
  ├─ GET  /events             Server-Sent Events to the page
  ├─ GET  /api/state          history on load
  ├─ GET  /api/roles          list of .claude/agents/*.md (global + project)
  ├─ POST /api/agents         launch agent
  ├─ POST /api/agents/:id/prompt
  ├─ POST /api/agents/:id/stop
  ├─ POST /api/permissions/:id   allow | allow-session | deny
  └─ files: ~/.centinela/events-YYYY-MM-DD.jsonl, ~/.centinela/token
  ▼
Page (a single HTML + JS, Cytoscape.js by CDN with a pinned version)
```

**Units:**
- `server.js` — HTTP, routes, authentication, SSE.
- `store.js` — appends events to the `.jsonl`, loads history.
- `graph.js` (shared, pure) — events → `{nodos, aristas, estado}`. This is what gets tested.
- `launcher.js` — creates/manages `claude` processes, parses `stream-json`.
- `permissions.js` — queue of pending requests, timeout → deny.
- `public/index.html`, `public/app.js` — graph, panel, timeline.
- `install-hooks.js` — adds/removes observation hooks in the user's `settings.json`
  (respects `CLAUDE_CONFIG_DIR`), with a backup copy and showing the
  diff before writing.

## 4. Interface

- **Graph (top):** node = agent (main session or subagent), color/icon by `agent_type`;
  below the name, the current action. Edge = delegation, label = start of the delegated prompt.
  States: working (pulse), finished ✓, error ✕, waiting for permission (amber). Sessions
  grouped by project (`cwd`). Filters: session, project, active only.
- **Right panel (click on a node):** task, list of actions with time, raw JSON. On launched
  agents: model responses (from `stream-json`) and a field to send a prompt.
  On terminal sessions: "Continuar aquí" (Continue here) button.
- **Timeline (bottom):** one lane per agent, blocks per action.
- **New agent:** role (from `/api/roles`), project folder, initial prompt.
- **Pending permission:** card "<agent> wants <tool>: <input summary>" with
  Allow / Always allow in this session / Reject.

## 5. Security

Threat model: the server can run `claude` with approved permissions, that is,
code execution on the Mac. Attackers considered: any web page open in the
browser, other local processes without the token, and malicious content inside the repos
agents read (prompt injection).

| Risk | Control |
|---|---|
| Network access | Listens only on `127.0.0.1`. |
| CSRF / web page POSTing to localhost | Mandatory token in `Authorization: Bearer` on every route except `GET /` (the page). No cookies. `POST` requests require `Content-Type: application/json` (forces a CORS preflight); no permissive CORS headers are sent. |
| DNS rebinding | Reject if `Host` ≠ `127.0.0.1:4317` / `localhost:4317`; reject if `Origin` is present and is not its own. |
| Token theft | `~/.centinela/token` generated with `crypto.randomBytes(32)`, `0600` permissions, `0700` directory. The page receives it through a URL fragment (`#token=`) opened by the server at startup; it never goes in a query string or logs. Constant-time comparison. |
| Command injection at launch | `child_process.spawn` with an argument array, never `shell: true`. `rol` validated against the `/api/roles` list; `cwd` must exist, be a directory and be absolute (realpath). The prompt goes through stdin, not arguments. |
| Fake approvals | Only `/api/permissions/:id` with a token decides; random ids; one decision per id. |
| Timeout / server down on permissions | No answer in 300 s → `deny`. The permission hook uses `onFailure: "block"`, so server down = does not run. |
| "Always allow" too broad | Limited to the same tool + same `agent_id` within the same session, in memory; lost on restart. Never for Bash with different commands: allow-session on Bash covers only the exact command. |
| Prompt injection from repos | By design, launched sessions run in normal permission mode (`manual`/default), never `bypassPermissions`; every action requiring permission goes through the dashboard showing the full input. |
| XSS with agent content | All event text is inserted with `textContent`; never `innerHTML`. CSP on the page: `default-src 'self'; script-src 'self' cdn.jsdelivr.net; connect-src 'self'`. Cytoscape with a pinned version + SRI. |
| Secrets in history | `.jsonl` with `0600` permissions. Nothing leaves the Mac. |
| Observation hooks break sessions | Observation hooks are non-blocking (non-2xx/down = ignored), short timeout (2 s). |

When implementation is finished: review with the `security-auditor` agent against this table.

## 6. Errors

| Case | Behavior |
|---|---|
| Server off | Observation: ignored. Permissions of launched sessions: blocked (deny). |
| Launched `claude` process dies | Node ✕, panel shows final stderr and exit code. |
| Browser closed | The server keeps going; on reopening, `/api/state` rebuilds. |
| Corrupt line in `.jsonl` | Skipped with a console warning; does not stop loading. |
| Unknown event | Stored and shown in the panel as a generic event. |

## 7. Tests

- `node --test`: `graph.js` with recorded events (session with 2 subagents, error, pending
  permission) → expected nodes/edges/states.
- `node --test`: server security — no token 401, foreign Host 403, foreign Origin 403,
  unknown role 400, relative cwd 400, permission timeout → deny.
- Manual end to end: launch agent, see it in the graph, approve a permission, send a second
  prompt, "Continuar aquí" (Continue here) on a terminal session.

## 8. Phase 2 (not now)

Wrap `public/` and the server in Tauri as a Mac app; the server stays the same.
