# Centinela v1 Implementation Plan


**Goal:** Panel local que muestra en vivo las sesiones y subagentes de Claude Code, y permite lanzar agentes por rol, enviarles prompts y aprobar sus permisos.

**Architecture:** Hooks `http` de Claude Code → servidor Node sin dependencias en 127.0.0.1:4317 → `.jsonl` diario + Server-Sent Events → una página con Cytoscape.js. Los agentes lanzados son procesos `claude -p` con `stream-json` cuya aprobación de permisos pasa por el hook `PermissionRequest` hacia el panel.

**Tech Stack:** Node ≥ 22 (ESM, `node:http`, `node:test`, `node:child_process`), Cytoscape.js 3.30.2 por CDN con SRI, HTML/CSS/JS sin framework.

**Spec:** `docs/diseno-v1.md`

## Global Constraints

- Cero dependencias npm en runtime. Solo `node:*`. Tests con `node --test`.
- El servidor escucha solo en `127.0.0.1`, puerto `4317` (sobreescribible con `CENTINELA_PORT`, solo para tests).
- Datos en `~/.centinela/` (sobreescribible con `CENTINELA_HOME`): dir `0700`, archivos `0600`.
- Nunca `shell: true`, nunca `innerHTML` con datos de eventos, nunca `bypassPermissions`.
- Binario de Claude: `claude` (sobreescribible con `CENTINELA_CLAUDE_BIN`, para tests con un falso).
- Config de Claude Code: `$CLAUDE_CONFIG_DIR/settings.json`, si no `~/.claude/settings.json`.
- **Sin git hasta que haya algo funcional:** `git init` + primer commit al terminar la Task 6 (observación en vivo funcionando). Después, un commit por task.
- UI en español.

**Desviación del spec (mejora de seguridad, decidida en el plan):** dos clases de token en vez de uno.
- `ui-token` (`~/.centinela/token`): autoriza todo `/api/*` y `/events`. Solo lo tiene la página.
- `hook-token` (`~/.centinela/hook-token`): solo autoriza `POST /hooks/event`. Va literal en `settings.json` (que no es secreto fuerte); si se filtra, solo permite inyectar eventos falsos, no lanzar nada.
- `launch-token` por agente lanzado (en memoria): solo autoriza `POST /hooks/permission` para ese agente; viaja en `--settings`.

## Review Focus

1. **`tool_input` enorme** (Write de un archivo de 2 MB): el `.jsonl` lo guarda completo, pero la UI y el SSE deben recortarlo a 2 000 caracteres por campo → test en Task 3.
2. **Eventos de subagente sin delegación previa** (orden inesperado, o hooks instalados a mitad de sesión): el nodo debe colgar de la sesión principal con arista sin etiqueta, no perderse → test en Task 2.
3. **`settings.json` con hooks del usuario ya existentes o JSON inválido**: el instalador fusiona sin borrar nada; con JSON inválido aborta sin escribir → tests en Task 5.
4. **Puerto 4317 ocupado**: mensaje claro "Centinela ya está corriendo o el puerto 4317 está ocupado" y salida 1, no stack trace → test en Task 3.
5. **Servidor reiniciado con agentes lanzados vivos**: al recargar, los agentes lanzados del historial aparecen como `disconnected` (no `working`) y sin campo de prompt → test en Task 2.

---

### Task 1: Spike — confirmar hechos pendientes y grabar fixtures

Throwaway salvo los fixtures. Resuelve los 3 "por confirmar" del spec §2.

**Files:**
- Create: `spike/capture.mjs` (borrar al final de la task)
- Create: `test/fixtures/subagent-session.jsonl`, `test/fixtures/permission-request.jsonl`, `test/fixtures/stream-json.jsonl`
- Create: `docs/spike-notes.md`

- [ ] **Step 1:** `spike/capture.mjs`: servidor `node:http` en 127.0.0.1:4318 que, para todo POST, escribe `{"ts":Date.now(),"kind":"hook","body":<json>}` como línea en el archivo dado por argv y responde `200` vacío; para `/hooks/permission` responde el JSON allow del spec §2.
- [ ] **Step 2:** Lanzar una sesión con hooks solo por `--settings` (todos los eventos del spec §2 apuntando a `http://127.0.0.1:4318/hooks/event`, `PermissionRequest` a `/hooks/permission`, `onFailure: "block"`), en un directorio temporal:
  `claude -p --output-format stream-json --verbose "Usa el subagente Explore para listar los archivos de este directorio y luego crea hola.txt con 'hola'" > test/fixtures/stream-json.jsonl`
  Expected: `subagent-session.jsonl` con `SubagentStart`, eventos con `agent_id`, y `hola.txt` creado tras un `PermissionRequest`.
- [ ] **Step 3:** Anotar en `spike-notes.md`, con citas del fixture: (a) nombre exacto de la herramienta de delegación en `PreToolUse.tool_name` y claves de `tool_input` (tipo y prompt); (b) campos de `SubagentStart`/`SubagentStop`; (c) si `PermissionRequest` se disparó en `-p` y si la respuesta allow fue respetada; (d) forma de las líneas `stream-json` (texto del asistente, resultado final, `session_id`); (e) forma de un mensaje de usuario por stdin en `--input-format stream-json`.
- [ ] **Step 4:** Si (c) falla: probar `--permission-prompt-tool`/`--permission-prompts host` y anotar cuál funciona; actualizar el spec §2 y la Task 8 antes de seguir.
- [ ] **Step 5:** Separar `permission-request.jsonl` (solo esa sesión de permiso), quitar rutas personales de los fixtures, borrar `spike/`.

---

### Task 2: `graph.js` — eventos → estado del grafo (puro)

**Files:**
- Create: `src/shared/graph.js` (ESM, sin imports de `node:*`: lo usa también el navegador)
- Test: `test/graph.test.js`

**Interfaces:**
- Consumes: registros `{ts:number, kind:'hook'|'stream'|'launch'|'permission', agentKey?:string, body:object}` (forma de los fixtures de Task 1).
- Produces:
  - `initState() -> State`
  - `reduce(state: State, rec: Record) -> State` (muta y devuelve el mismo objeto)
  - `nodeId(sessionId: string, agentId?: string) -> string` = `sessionId` o `` `${sessionId}:${agentId}` ``
  - `State = { nodes: {[id]: Node}, edges: Edge[], pending: {[permId]: Pending} }`
  - `Node = { id, sessionId, agentId: string|null, role: string, cwd: string, status: 'idle'|'working'|'waiting'|'done'|'error'|'disconnected', current: string|null, launched: string|null /* agentKey */, actions: Action[], startedAt: number, endedAt: number|null }`
  - `Action = { ts, tool: string, summary: string, ok: boolean|null, toolUseId: string }`
  - `Edge = { from: string, to: string, label: string }`
  - `Pending = { permId, nodeId, tool, input: object, ts }`
  - `summarize(toolName: string, toolInput: object) -> string` (≤ 80 chars: `Read auth.ts`, `Bash: npm test`, `Grep "token"`)

**Reglas (lo que el test fija):**
- `SessionStart` → nodo principal, `role = body.agent_type ?? 'principal'`, status `idle`. **Spike: `SessionStart` no llega por http** → cualquier evento de una sesión sin nodo principal lo crea igual (con `cwd` del evento).
- `UserPromptSubmit`/`PreToolUse` → status `working`; `PreToolUse` añade Action con `ok:null` y pone `current`.
- `PostToolUse` → Action con mismo `tool_use_id` a `ok:true`; `PostToolUseFailure` → `ok:false`.
- Evento con `agent_id` → va al nodo `nodeId(session_id, agent_id)`, creándolo si no existe.
- Delegación: `PreToolUse` cuya `tool_name` es `'Agent'` (Task 1, nota a; tipo en `tool_input.subagent_type`, texto en `tool_input.prompt`) se encola como `{sessionId, parentNodeId, subagentType, label: prompt.slice(0,60)}`. `SubagentStart` toma la **primera** entrada encolada de la misma sesión con el mismo `subagentType` y crea la arista; sin coincidencia → arista desde el nodo principal con `label: ''`.
- `SubagentStop` → nodo `done`. `Stop` → principal `idle`. `SessionEnd` → `done`. `StopFailure` → `error`.
- `kind:'permission'` con `body.state==='pending'` → `pending[permId]`, nodo `waiting`; `state==='decided'` → borra pending, nodo `working`; si `body.decision==='deny'`, la última Action `ok:null` de esa herramienta en el nodo pasa a `ok:false` (spike: tras un deny no llega `PostToolUse*`).
- `kind:'launch'` con `body.event==='started'` → marca `launched = agentKey` en el nodo de `body.sessionId`; `event==='exited'` → `error` si `code !== 0`, si no `done`.
- Evento de hook desconocido → Action en su nodo con `tool: body.hook_event_name`, `ok: null` (spec §6: se muestra como evento genérico).
- `markDisconnected(state)`: todo nodo con `launched` y status ∉ {done,error} → `disconnected` (se llama tras cargar historial).

- [ ] **Step 1: Tests que fallan** en `test/graph.test.js`:
  - `subagent session builds parent→child edge`: reducir `subagent-session.jsonl` → 2 nodos, 1 arista con `label` no vacío, nodo hijo `role` = tipo del subagente, hijo `done`.
  - `tool actions pair by tool_use_id`: Pre+Post → 1 Action `ok:true`.
  - `orphan subagent hangs from main with empty label` (Review Focus 2): `SubagentStart` sin `PreToolUse` previo → arista `{from: sessionId, label: ''}`.
  - `permission pending then decided`: nodo pasa `waiting` → `working`, `pending` vacío al final.
  - `launched agents become disconnected after reload` (Review Focus 5).
  - `summarize`: `summarize('Bash',{command:'npm test'}) === 'Bash: npm test'`, `summarize('Read',{file_path:'/a/b/auth.ts'}) === 'Read auth.ts'`, resultado ≤ 80.
- [ ] **Step 2:** `node --test test/graph.test.js` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementar `src/shared/graph.js`.
- [ ] **Step 4:** `node --test test/graph.test.js` → PASS.

---

### Task 3: Servidor base — store, auth, ingestión, SSE

**Files:**
- Create: `src/server/paths.js`, `src/server/store.js`, `src/server/auth.js`, `src/server/server.js`, `bin/centinela.js`
- Test: `test/store.test.js`, `test/server.test.js`

**Interfaces:**
- Consumes: `initState`, `reduce`, `markDisconnected` (Task 2).
- Produces:
  - `paths.js`: `home() -> string` (`CENTINELA_HOME` o `~/.centinela`), `ensureHome() -> void` (crea `0700`), `readOrCreateToken(name: 'token'|'hook-token') -> string` (32 bytes hex, archivo `0600`).
  - `store.js`: `append(rec) -> void` (a `events-YYYY-MM-DD.jsonl`, `0600`), `loadAll() -> Record[]` (todos los días en orden; línea corrupta → `console.warn` y se salta).
  - `auth.js`: `checkHostOrigin(req, port) -> number|null` (403 si `Host` ∉ {`127.0.0.1:<port>`, `localhost:<port>`} o si hay `Origin` y no es `http://127.0.0.1:<port>`/`http://localhost:<port>`); `bearer(req) -> string|null`; `safeEqual(a, b) -> boolean` (`crypto.timingSafeEqual`, false si longitudes difieren).
  - `server.js`: `createServer({port, uiToken, hookToken, claudeBin}) -> {server: http.Server, state, broadcast(rec)}`; `broadcast` hace `append` + `reduce` + envía `data: <json>\n\n` a cada cliente SSE con campos de texto recortados a 2 000 chars (`truncateRec(rec, 2000)`).
  - Rutas en esta task: `GET /` y `GET /app.js` etc. (estáticos de `public/` y `src/shared/`), `POST /hooks/event` (hook-token), `GET /api/state` (ui-token → `state` completo), `GET /events` (ui-token por `?token=` **solo en esta ruta**, porque `EventSource` no admite cabeceras; se acepta y se documenta).
  - Reglas comunes: `checkHostOrigin` en toda ruta; `POST` exige `Content-Type: application/json` (415 si no); body máx 5 MB (413).
  - `bin/centinela.js`: arranca, `loadAll()` → `reduce` → `markDisconnected`, imprime `http://127.0.0.1:4317/#token=<uiToken>` y lo abre con `open`. `EADDRINUSE` → `"Centinela ya está corriendo o el puerto 4317 está ocupado"`, exit 1.

- [ ] **Step 1: Tests que fallan** (`createServer` en puerto 0, `CENTINELA_HOME` en dir temporal):
  - `store skips corrupt lines`: archivo con una línea basura entre dos válidas → `loadAll()` devuelve 2.
  - `files are 0600 and dir 0700`.
  - `POST /hooks/event without token -> 401`; `with ui-token -> 401` (solo hook-token vale); `with hook-token -> 200` y aparece en `/api/state`.
  - `foreign Host -> 403`; `foreign Origin -> 403`; `text/plain POST -> 415`.
  - `GET /api/state with hook-token -> 401`.
  - `SSE truncates long fields` (Review Focus 1): evento con `tool_input.content` de 10 000 chars → el mensaje SSE lo trae ≤ 2 000; `loadAll()` lo trae completo.
  - `port in use prints friendly message` (Review Focus 4): spawn de `bin/centinela.js` dos veces con el mismo `CENTINELA_PORT` → el segundo sale 1 con el mensaje exacto.
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implementar los cinco archivos.
- [ ] **Step 4:** `node --test` → PASS.

---

### Task 4: Página — grafo, panel, línea de tiempo (solo lectura)

**Files:**
- Create: `public/index.html`, `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: `GET /api/state`, `GET /events?token=`, `reduce`/`initState` de `/shared/graph.js` (el servidor sirve `src/shared/` en `/shared/`).
- Produces: nada para otras tasks salvo los contenedores `#graph`, `#panel`, `#timeline`, `#toolbar` que extiende la Task 8.

- [ ] **Step 1:** `index.html`: CSP del spec §5 en `<meta http-equiv>`; Cytoscape `https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.min.js` con `integrity` calculado con `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A` y `crossorigin="anonymous"`.
- [ ] **Step 2:** `app.js`: lee el token de `location.hash`, lo guarda en `sessionStorage` y limpia el hash con `history.replaceState`; carga `/api/state`; abre `EventSource`; en cada mensaje `reduce` local y re-render incremental. Nodos: color por `role` (hash del nombre → paleta fija de 8), clase por `status` (pulso CSS en `working`, ámbar en `waiting`, gris en `disconnected`). Layout `breadthfirst` agrupado por `sessionId`. Filtros: proyecto (`cwd`), solo activas.
- [ ] **Step 3:** Panel derecho al clic: rol, status, tarea (label de la arista entrante), acciones con hora, botón "ver JSON crudo". **Todo con `textContent`.**
- [ ] **Step 4:** Línea de tiempo: un carril por nodo visible, bloques por Action (`ts` hasta la siguiente Action), SVG o divs.
- [ ] **Step 5: Verificar:** `CENTINELA_HOME=$(mktemp -d) node bin/centinela.js`, luego reenviar `test/fixtures/subagent-session.jsonl` línea a línea con `curl -H "Authorization: Bearer $(cat $CENTINELA_HOME/hook-token)" -H 'Content-Type: application/json' -d @-` a `/hooks/event` cada 300 ms. Expected: aparecen 2 nodos y la arista, el hijo late y pasa a ✓; recargar la página conserva todo.
- [ ] **Step 6:** `grep -n innerHTML public/` → sin resultados.

---

### Task 5: `install-hooks.js` — instalar observación en Claude Code

**Files:**
- Create: `src/server/install-hooks.js`, `bin/centinela-hooks.js`
- Test: `test/install-hooks.test.js`

**Interfaces:**
- Consumes: `readOrCreateToken('hook-token')` (Task 3).
- Produces:
  - `settingsPath() -> string` (`$CLAUDE_CONFIG_DIR/settings.json` o `~/.claude/settings.json`)
  - `merge(settings: object, hookToken: string, port: number) -> object` — por cada evento de observación del spec §2 (todos menos `PermissionRequest`), añade una entrada `{"matcher":"", "hooks":[{"type":"http","url":"http://127.0.0.1:<port>/hooks/event","timeout":2,"headers":{"Authorization":"Bearer <hookToken>"}}]}` marcada con `"_centinela": true`; idempotente (no duplica); no toca entradas ajenas. **Spike:** si `sandbox.enabled` es true, añade `127.0.0.1` a `sandbox.network.allowedDomains` (sin él los hooks reciben 403) y lo recuerda en `"_centinelaAddedDomain": true` para que `unmerge` solo lo quite si lo añadió.
  - `unmerge(settings) -> object` — quita solo las entradas `_centinela`.
  - CLI: `centinela-hooks install|uninstall [--yes]`: muestra diff (JSON antes/después de la clave `hooks`), pide confirmación salvo `--yes`, escribe copia `settings.json.centinela-backup-<ts>` antes de escribir.

- [ ] **Step 1: Tests que fallan:**
  - `merge keeps user hooks` (Review Focus 3): settings con un hook `PreToolUse` propio → tras `merge` sigue ahí y hay uno `_centinela` más.
  - `merge is idempotent`: `merge(merge(s))` deep-equal `merge(s)`.
  - `unmerge restores original`: `unmerge(merge(s))` deep-equal `s`.
  - `invalid JSON aborts without writing` (Review Focus 3): CLI sobre archivo con `{` → exit 1, archivo intacto, sin backup.
  - Verificar contra Task 1 que la forma `matcher`/`hooks` es la que aceptó Claude Code; si el spike mostró que los eventos sin herramienta no llevan `matcher`, omitirlo para esos.
- [ ] **Step 2:** `node --test test/install-hooks.test.js` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `node --test` → PASS.

---

### Task 6: Prueba en vivo de observación + primer commit

- [ ] **Step 1:** `node bin/centinela-hooks.js install` sobre el `settings.json` de Claude Code (revisar el diff antes de aceptar).
- [ ] **Step 2:** `node bin/centinela.js`, y en otra terminal abrir `claude` en cualquier proyecto y pedir algo que use un subagente. Expected: la sesión aparece en < 1 s, el subagente cuelga con su tarea, las acciones llegan en vivo.
- [ ] **Step 3:** Apagar Centinela y seguir usando `claude` en la terminal. Expected: ningún error visible ni retraso perceptible.
- [ ] **Step 4:** `git init`, `.gitignore` (`node_modules/`, `.DS_Store`), commit: `feat: observación en vivo de sesiones de Claude Code`.

---

### Task 7: Lanzador — roles, procesos `claude`, prompts

**Files:**
- Create: `src/server/roles.js`, `src/server/launcher.js`
- Modify: `src/server/server.js` (rutas nuevas)
- Create: `test/fake-claude.mjs` (imita `claude -p --input-format stream-json --output-format stream-json`: emite una línea `system/init` con `session_id`, y por cada línea de stdin una respuesta de asistente con el texto recibido; sale 0 al cerrar stdin)
- Test: `test/launcher.test.js`

**Interfaces:**
- Consumes: `broadcast(rec)` (Task 3), forma de `stream-json` (Task 1 nota d/e).
- Produces:
  - `listRoles(cwd?: string) -> {name, description, source:'user'|'project'}[]` — lee frontmatter `name`/`description` de `<config>/agents/*.md` y `<cwd>/.claude/agents/*.md`.
  - `launch({role, cwd, prompt, resume?}) -> {agentKey: string, launchToken: string}` — valida (rol ∈ `listRoles(cwd)`, `cwd` absoluto, existe, es directorio, `fs.realpathSync`), hace `spawn(claudeBin, ['-p','--agent',role,'--input-format','stream-json','--output-format','stream-json','--verbose','--permission-mode','default','--settings', JSON.stringify(permSettings), ...(resume?['--resume',resume]:[])], {cwd, env:{...process.env, CENTINELA_AGENT_KEY: agentKey}})` sin shell; escribe `prompt` por stdin en formato stream-json; cada línea de stdout → `broadcast({kind:'stream', agentKey, body})`; `system/init` → `broadcast({kind:'launch', agentKey, body:{event:'started', sessionId}})`; `exit` → `broadcast({kind:'launch', agentKey, body:{event:'exited', code, stderrTail}})` (últimos 2 000 chars de stderr).
  - `permSettings` = `{"hooks":{"PermissionRequest":[{"matcher":"","hooks":[{"type":"http","url":"http://127.0.0.1:<port>/hooks/permission","timeout":310,"onFailure":"block","headers":{"Authorization":"Bearer <launchToken>"}}]}]},"sandbox":{"network":{"allowedDomains":["127.0.0.1"]}}}` — **Spike:** sin `allowedDomains` el sandbox del usuario devuelve 403 y, con `onFailure:"block"`, el agente no puede hacer nada que pida permiso. Verificar en Task 10 que `--settings` fusiona `allowedDomains` con la lista del usuario y no la reemplaza.
  - `sendPrompt(agentKey, text) -> boolean`, `stop(agentKey) -> boolean` (SIGTERM, SIGKILL a los 5 s).
  - `tokenFor(launchToken) -> agentKey|null`.
  - Rutas (ui-token): `GET /api/roles?cwd=`, `POST /api/agents {role,cwd,prompt,resume?}` → `{agentKey}`; `POST /api/agents/:key/prompt {text}`; `POST /api/agents/:key/stop`. 400 con mensaje en español para cada validación; 404 para agentKey desconocido.

- [ ] **Step 1: Tests que fallan** (`CENTINELA_CLAUDE_BIN=test/fake-claude.mjs`, rol de prueba en `<tmp>/.claude/agents/tester.md`):
  - `unknown role -> 400`; `relative cwd -> 400`; `nonexistent cwd -> 400`.
  - `prompt with shell metacharacters is passed literally`: prompt `"; rm -rf ~ $(whoami)"` → el fake lo devuelve idéntico en la respuesta.
  - `launch emits started, stream and exited records` con el `session_id` del fake.
  - `sendPrompt reaches the process`: segunda respuesta contiene el texto enviado.
  - `stop terminates`: `exited` llega en < 6 s.
  - `spawn args never use shell`: el fake vuelca `process.argv` en su init; contiene `--agent tester` y `--permission-mode default`, nunca `bypassPermissions`.
- [ ] **Step 2:** `node --test test/launcher.test.js` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `node --test` → PASS. Commit: `feat: lanzar agentes por rol y enviarles prompts`.

---

### Task 8: Permisos desde el panel

**Files:**
- Create: `src/server/permissions.js`
- Modify: `src/server/server.js`
- Test: `test/permissions.test.js`

**Interfaces:**
- Consumes: `tokenFor` (Task 7), `broadcast` (Task 3).
- Produces:
  - `request(agentKey, hookBody) -> Promise<'allow'|'deny'>` — si hay regla allow-session aplicable, resuelve `allow` sin preguntar; si no, crea `permId` (`crypto.randomUUID()`), `broadcast({kind:'permission', agentKey, body:{state:'pending', permId, session_id, agent_id, tool:hookBody.tool_name, input:hookBody.tool_input}})` y espera; a los `CENTINELA_PERMISSION_TIMEOUT_MS` (por defecto 300 000) → `deny`.
  - `decide(permId, 'allow'|'allow-session'|'deny') -> boolean` (false si ya decidido o inexistente); emite `state:'decided'`.
  - Regla allow-session = clave `` `${agentKey}|${agent_id ?? ''}|${tool}|${tool==='Bash' ? input.command : ''}` `` (Bash solo cubre el comando exacto); en memoria.
  - Rutas: `POST /hooks/permission` (launch-token → agentKey; otro token → 401) responde `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}`; `POST /api/permissions/:permId {decision}` (ui-token).

- [ ] **Step 1: Tests que fallan:**
  - `hook with ui-token -> 401`; `with launch-token of another agent` → se atribuye solo a ese agente.
  - `timeout denies` con `CENTINELA_PERMISSION_TIMEOUT_MS=200`.
  - `allow-session covers same tool only`: tras allow-session en `Edit`, segundo `Edit` del mismo agente → allow sin pending; `Write` → pending.
  - `allow-session on Bash covers exact command only`: `npm test` permitido; `npm test && curl x` → pending.
  - `decide twice returns false`.
- [ ] **Step 2:** `node --test test/permissions.test.js` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `node --test` → PASS. Commit: `feat: aprobar permisos de agentes desde el panel`.

---

### Task 9: UI de control — nuevo agente, prompts, permisos, continuar aquí

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: rutas de Tasks 7 y 8; `Node.launched`, `state.pending`, registros `kind:'stream'`.

- [ ] **Step 1:** Botón "+ Nuevo agente" → `<dialog>` nativo con `<select>` de roles (de `/api/roles?cwd=`), `<input>` carpeta (ruta absoluta), `<textarea>` prompt; errores 400 mostrados en el diálogo.
- [ ] **Step 2:** Panel de nodo lanzado: respuestas del asistente (de `kind:'stream'`, texto con `textContent`), `<textarea>` + "Enviar", botón "Detener". Nodo `disconnected`: sin campo, con aviso "Centinela se reinició; este agente ya no está conectado".
- [ ] **Step 3:** Panel de nodo de terminal: botón "Continuar aquí" → `POST /api/agents {role: node.role==='principal' ? <rol elegido en un select> : node.role, cwd: node.cwd, prompt, resume: node.sessionId}`.
- [ ] **Step 4:** Tarjetas de permiso (una por `state.pending`) fijas arriba a la derecha: "<rol> quiere <tool>: <summarize>", input completo desplegable, botones Permitir / Permitir siempre en esta sesión / Rechazar. Notificación del navegador (`Notification`, si el usuario la acepta) cuando llega una con la pestaña oculta.
- [ ] **Step 5:** `grep -n innerHTML public/` → sin resultados. Commit: `feat: controles de agentes en el panel`.

---

### Task 10: Prueba de punta a punta y revisión de seguridad

- [ ] **Step 1:** E2E manual (spec §7): lanzar un agente `code-reviewer` sobre este repo con "revisa src/server/auth.js"; verlo en el grafo; enviar un segundo prompt; pedirle que cree un archivo y aprobar el permiso desde el panel; rechazar otro y ver que no se ejecuta; "Continuar aquí" sobre una sesión de terminal.
- [ ] **Step 2:** Apagar el servidor con un agente esperando permiso → el agente recibe deny (onFailure block) y su nodo queda `disconnected` al volver.
- [ ] **Step 3:** Desde otra pestaña en `https://example.com`, consola: `fetch('http://127.0.0.1:4317/api/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})` → bloqueado (CORS/403), nada lanzado.
- [ ] **Step 4:** Revisión con el agente `security-auditor` contra la tabla del spec §5 y la desviación de tokens de este plan; corregir lo que encuentre con test.
- [ ] **Step 5:** `README.md` breve (arrancar, instalar/desinstalar hooks, tokens). Commit: `chore: centinela v1`.
