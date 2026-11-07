# Centinela v1 — pending items

Minor findings from the final review and the security audit (2026-10-22) that were not fixed in v1. None is critical or important.

## Security

- Each agent's launch-token and the hook-token travel inside `--settings` and are visible in `ps`. Anyone who reads them can forge that agent's permission cards or send events (not decide permissions). Fix: pass `--settings` as a `0600` file.
- A trusted project can still skip the panel with `permissions.allow`, with plugins from its `enabledPlugins` that bring hooks, or with hooks in the frontmatter of a role in `.claude/agents`. Only `hooks.PermissionRequest` and `hooks.PreToolUse` in its settings are refused. Hooks in a project skill's frontmatter were not tested, and the refusal is only checked at launch.
- `env` from the user's settings has no allowlist (only `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is removed); `apiKeyHelper` and `awsAuthRefresh` are not inherited, so a user who authenticates through them cannot launch agents.
- The card takes the node from the `session_id` in the hook body; it should come from the agent owning the launch-token.
- `install-hooks` does not write atomically or detect concurrent changes to `settings.json`; a new file gets the default mask.
- `isOurs` removes the whole hook group if one of its hooks is Centinela's (it would delete a hook of yours added by hand in that group).
- `roles.js` follows symlinks and FIFOs with no size cap (a hostile repo could hang the dashboard).
- The CSP is delivered as a `<meta>`, so it cannot carry `frame-ancestors`; better as an HTTP header. (Since the redesign there is no CDN: `script-src 'self'` and `base-uri 'none'`.)

## Robustness

- SSE has no backpressure control; several 5 MB bodies at once are held in memory.
- A `Write` of ≥ ~2.5 MB exceeds the `/hooks/event` limit (413) and its action stays at "…"; `/api/state` does not truncate and SSE does.
- If the hook socket closes while the body is being read, the request waits the full 300 s.
- An `append()` that fails (disk full) brings the server down.
- Grandchild processes that inherit the pipes delay `close`; `SIGTERM` does not reach processes launched by `claude`; `sendPrompt` between death and `close` returns `true`.
- A `settings.json` that is valid but not an object (or empty) gives a stack trace in the installer.

## Interface

- Generic events (`Notification`) stay at "…" forever; `StopFailure` hides the prompt field of an agent that is still alive.
- `breadthfirst` with `fit` resets pan and zoom when each new node arrives; timeline lanes lose keyboard focus every 2 s; the panel's `aria-live` announces the whole panel on each event.

## Verified with the real CLI (2026-11-07)

- `--resume <id>` in `-p` keeps the same `session_id`: the terminal node and the launched one merge.
- `claude -p` emits `system/init` on every turn with streaming input: the first prompt is now announced only once.
- `--setting-sources project,local` still loads the project's `.claude/agents` roles but not the user's, which now travel in `--agents`.
