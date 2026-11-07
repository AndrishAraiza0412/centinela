# Spike (Task 1) — notes

Claude Code 2.1.295, Node 24.21.0, 2026-10-22. Session: `claude -p --permission-mode default --settings spike/settings.json --output-format stream-json --verbose "Usa el subagente Explore para listar los archivos de este directorio y luego crea hola.txt con 'hola'"`.
The capture server answered **deny** to `PermissionRequest` (the spike's safe variant: it proves the response is respected without approving anything blindly).
Fixtures: `test/fixtures/subagent-session.jsonl` (17 hooks), `permission-request.jsonl` (PreToolUse Write + PermissionRequest), `stream-json.jsonl` (output of that same session, without `system/hook_*` lines or skill bodies). Personal paths replaced with `/tmp/demo` and `/Users/me`.

## (a) Delegation tool

`tool_name: "Agent"`. `tool_input`:
```json
{"description":"List files in directory","prompt":"List all files …","subagent_type":"Explore","run_in_background":false}
```
The `Agent`'s `PostToolUse` arrives with the same `tool_use_id` after `SubagentStop`.

## (b) SubagentStart / SubagentStop

- `SubagentStart`: `session_id, transcript_path, cwd, prompt_id, agent_id, agent_type, hook_event_name`. **It carries neither `tool_use_id` nor the prompt** → matching by `subagent_type` (the plan's queue, Task 2) is still necessary.
- `SubagentStop`: the above + `permission_mode, effort, stop_hook_active, agent_transcript_path, last_assistant_message, background_tasks, session_crons`.
- Tools inside the subagent: `PreToolUse`/`PostToolUse` with `agent_id: "aea2d15422a3d1748"`, `agent_type: "Explore"`, same `session_id` as the parent.

## (c) PermissionRequest in `-p`

- **It does fire in `-p`** and the hook's response is respected: deny → `hola.txt` was not created; the model received the deny `message`.
- Body: common fields + `tool_name, tool_input, permission_suggestions` (e.g. `{"type":"setMode","mode":"acceptEdits","destination":"session"}`). **It has no `tool_use_id`** → the dashboard cannot match it by id with the `PreToolUse`; use the session's last `PreToolUse` with the same `tool_name` (+ equal `tool_input`).
- After a deny, neither `PostToolUse` nor `PostToolUseFailure` arrives for that tool. In `stream-json` there is `{"type":"system","subtype":"permission_denied","tool_name","tool_use_id","decision_reason_type":"hook","message"}`, and `result.permission_denials[]`.
- **It requires `--permission-mode default`.** First run without it: the user's `settings.json` has `permissions.defaultMode: "auto"` → the classifier approved the Write and `PermissionRequest` never fired. `--permission-prompt-tool` is not needed (Step 4 does not apply).

## Unexpected findings

1. **The user's sandbox blocks http hooks to 127.0.0.1.** With `sandbox.enabled: true`, the first run got `HTTP 403` on all hooks (stderr: `SessionEnd hook [http://127.0.0.1:4318/hooks/event] failed: HTTP 403`); the server received nothing (a direct `curl` did give 200). Adding `"sandbox":{"enabled":true,"network":{"allowedDomains":["127.0.0.1","localhost"]}}` in `--settings` resolved it (the second run also changed the permission mode; the 403 is a network error, so it is attributed to this). Consequences: the permission hook with `onFailure:"block"` would block **everything** without this entry; the installer (Task 5) must add it too.
2. **`SessionStart` does not arrive through an `http` hook** (0 of 2 runs, while the other events do). The main node must be created with the session's first event (`UserPromptSubmit`/`PreToolUse`/…). In launched agents, `stream-json` `system/init` carries `session_id` and `cwd`.
3. Launched agents inherit the user's hooks and plugins (other user `SessionStart` hooks ran in the fixture). This is expected (same Claude Code), but it adds events and cost.
4. `SessionEnd` carries `reason: "other"` in `-p`, without `permission_mode`.
5. `UserPromptSubmit` carries `prompt` and `prompt_id`; all events in the session share `prompt_id`.

## (d) `stream-json` lines (output)

- `{"type":"system","subtype":"init","cwd","session_id","tools":[…],…}` — first useful line.
- `{"type":"assistant","message":{"content":[{"type":"text","text":…}|{"type":"tool_use",…}|{"type":"thinking",…}]},"parent_tool_use_id":null|"toolu_…","session_id"}`.
- `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id",…}]}}`.
- Subagents: `system/task_started` (`task_id` = **the hook's `agent_id`**, the `Agent`'s `tool_use_id`, `subagent_type`, `prompt`, `description`), `system/task_progress`, `system/task_updated`, `system/task_notification`. For launched agents this gives the exact edge without a queue.
- `system/permission_denied` (see c), `rate_limit_event`.
- Final: `{"type":"result","subtype":"success","is_error":false,"result":"<texto>","session_id","num_turns","total_cost_usd","permission_denials":[…],…}`.

## (e) User message through stdin (`--input-format stream-json`)

One line per message; tested and answered:
```json
{"type":"user","message":{"role":"user","content":"Responde solo: uno"}}
```
→ `assistant` with `[{"type":"text","text":"uno"}]` and `result` `"uno"`; the process exits 0 when stdin closes.
