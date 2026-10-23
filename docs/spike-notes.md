# Spike (Task 1) — notas

Claude Code 2.1.295, Node 24.21.0, 2026-10-22. Sesión: `claude -p --permission-mode default --settings spike/settings.json --output-format stream-json --verbose "Usa el subagente Explore para listar los archivos de este directorio y luego crea hola.txt con 'hola'"`.
El servidor de captura respondía **deny** a `PermissionRequest` (variante segura del spike: prueba que la respuesta se respeta sin aprobar nada a ciegas).
Fixtures: `test/fixtures/subagent-session.jsonl` (17 hooks), `permission-request.jsonl` (PreToolUse Write + PermissionRequest), `stream-json.jsonl` (salida de esa misma sesión, sin líneas `system/hook_*` ni cuerpos de skills). Rutas personales reemplazadas por `/tmp/demo` y `/Users/me`.

## (a) Herramienta de delegación

`tool_name: "Agent"`. `tool_input`:
```json
{"description":"List files in directory","prompt":"List all files …","subagent_type":"Explore","run_in_background":false}
```
`PostToolUse` del `Agent` llega con el mismo `tool_use_id` después de `SubagentStop`.

## (b) SubagentStart / SubagentStop

- `SubagentStart`: `session_id, transcript_path, cwd, prompt_id, agent_id, agent_type, hook_event_name`. **No trae `tool_use_id` ni el prompt** → emparejar por `subagent_type` (cola del plan, Task 2) sigue siendo necesario.
- `SubagentStop`: lo anterior + `permission_mode, effort, stop_hook_active, agent_transcript_path, last_assistant_message, background_tasks, session_crons`.
- Herramientas dentro del subagente: `PreToolUse`/`PostToolUse` con `agent_id: "aea2d15422a3d1748"`, `agent_type: "Explore"`, mismo `session_id` que el padre.

## (c) PermissionRequest en `-p`

- **Sí se dispara en `-p`** y la respuesta del hook se respeta: deny → `hola.txt` no se creó; el modelo recibió el `message` del deny.
- Cuerpo: comunes + `tool_name, tool_input, permission_suggestions` (p. ej. `{"type":"setMode","mode":"acceptEdits","destination":"session"}`). **No trae `tool_use_id`** → el panel no puede emparejarlo por id con el `PreToolUse`; usar el último `PreToolUse` de la sesión con mismo `tool_name` (+ `tool_input` igual).
- Tras un deny no llega `PostToolUse` ni `PostToolUseFailure` para esa herramienta. En `stream-json` aparece `{"type":"system","subtype":"permission_denied","tool_name","tool_use_id","decision_reason_type":"hook","message"}`, y `result.permission_denials[]`.
- **Requiere `--permission-mode default`.** Primera corrida sin él: el `settings.json` del usuario tiene `permissions.defaultMode: "auto"` → el clasificador aprobó el Write y `PermissionRequest` nunca se disparó. No hace falta `--permission-prompt-tool` (Step 4 no aplica).

## Hallazgos no previstos

1. **Sandbox del usuario bloquea los hooks http a 127.0.0.1.** Con `sandbox.enabled: true`, la primera corrida recibió `HTTP 403` en todos los hooks (stderr: `SessionEnd hook [http://127.0.0.1:4318/hooks/event] failed: HTTP 403`); el servidor no recibió nada (un `curl` directo sí daba 200). Añadir en `--settings` `"sandbox":{"enabled":true,"network":{"allowedDomains":["127.0.0.1","localhost"]}}` lo resolvió (la segunda corrida cambió también el modo de permisos; el 403 es de red, así que se atribuye a esto). Consecuencias: el hook de permisos con `onFailure:"block"` bloquearía **todo** sin esta entrada; el instalador (Task 5) también debe añadirla.
2. **`SessionStart` no llega por hook `http`** (0 de 2 corridas, mientras los demás eventos sí). El nodo principal debe crearse con el primer evento de la sesión (`UserPromptSubmit`/`PreToolUse`/…). En agentes lanzados, `stream-json` `system/init` trae `session_id` y `cwd`.
3. Los agentes lanzados heredan los hooks y plugins del usuario (en el fixture corrieron otros hooks `SessionStart` del usuario). Es esperado (mismo Claude Code), pero añade eventos y coste.
4. `SessionEnd` trae `reason: "other"` en `-p`, sin `permission_mode`.
5. `UserPromptSubmit` trae `prompt` y `prompt_id`; todos los eventos de la sesión comparten `prompt_id`.

## (d) Líneas `stream-json` (salida)

- `{"type":"system","subtype":"init","cwd","session_id","tools":[…],…}` — primera línea útil.
- `{"type":"assistant","message":{"content":[{"type":"text","text":…}|{"type":"tool_use",…}|{"type":"thinking",…}]},"parent_tool_use_id":null|"toolu_…","session_id"}`.
- `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id",…}]}}`.
- Subagentes: `system/task_started` (`task_id` = **`agent_id` del hook**, `tool_use_id` del `Agent`, `subagent_type`, `prompt`, `description`), `system/task_progress`, `system/task_updated`, `system/task_notification`. Para agentes lanzados esto da la arista exacta sin cola.
- `system/permission_denied` (ver c), `rate_limit_event`.
- Final: `{"type":"result","subtype":"success","is_error":false,"result":"<texto>","session_id","num_turns","total_cost_usd","permission_denials":[…],…}`.

## (e) Mensaje de usuario por stdin (`--input-format stream-json`)

Una línea por mensaje; probado y respondido:
```json
{"type":"user","message":{"role":"user","content":"Responde solo: uno"}}
```
→ `assistant` con `[{"type":"text","text":"uno"}]` y `result` `"uno"`; el proceso sale 0 al cerrar stdin.
