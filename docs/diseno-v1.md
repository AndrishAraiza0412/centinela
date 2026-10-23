# Centinela — diseño v1

Fecha: 2026-10-21 · Estado: borrador para revisión

## 1. Objetivo

Panel local en la Mac para ver, en tiempo real, qué hacen los agentes de Claude Code
(sesión principal y subagentes por rol: desarrollador, auditor, investigador, legal…), cómo se
delegan trabajo entre sí, y para lanzar agentes, enviarles prompts y aprobar sus permisos.

Usa la suscripción de Claude del usuario a través del CLI `claude` (no API key). Centinela no
llama a la API de Anthropic: observa y controla procesos de Claude Code.

**Éxito v1:**
1. Una sesión de Claude Code abierta en la terminal aparece en el panel en < 1 s con sus
   subagentes y acciones.
2. Desde el panel se lanza un agente con un rol, se le envía un segundo prompt y se aprueba o
   rechaza un permiso, sin tocar la terminal.
3. Ninguna página web ni proceso ajeno puede usar el servidor para lanzar comandos.

**Fuera de v1:** app de Mac (Tauri, fase 2), costos/tokens, escribir en sesiones abiertas en la
terminal, borrar historial desde el panel, definir roles desde el panel.

## 2. Hechos verificados (Claude Code 2.1.295)

| Necesidad | Mecanismo |
|---|---|
| Recibir eventos | Hooks tipo `http`: POST JSON a una URL. `headers` con `$VAR` solo para variables en `allowedEnvVars`. Non-2xx = error no bloqueante. `onFailure: "block"` disponible. |
| Eventos usados | `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `Notification`, `PermissionRequest` |
| Quién hizo qué | Campos comunes `session_id`, `cwd`, `hook_event_name`, `transcript_path`. Eventos dentro de un subagente traen `agent_id` y `agent_type`. Eventos de herramienta traen `tool_name`, `tool_input`, `tool_use_id`. |
| Delegación (flecha) | `PreToolUse` con `tool_name: "Agent"` en el padre (`tool_input.subagent_type`, `tool_input.prompt`, `tool_input.description`) + `SubagentStart` del hijo (`agent_id`, `agent_type`; sin `tool_use_id`). En `stream-json`, `system/task_started.task_id` = `agent_id`. |
| Inicio de sesión | `SessionStart` **no llega** por hook `http` (spike): el nodo principal nace con el primer evento de la sesión. |
| Sandbox del usuario | Con `sandbox.enabled`, los hooks http a 127.0.0.1 reciben 403 salvo que `sandbox.network.allowedDomains` incluya `127.0.0.1` (spike). |
| Lanzar con rol | `claude -p --agent <rol> --input-format stream-json --output-format stream-json` |
| Seguir enviando prompts | stdin del proceso en `stream-json` |
| Continuar sesión de terminal | `claude -p --resume <session_id> …` (nueva rama, la de la terminal no cambia) |
| Aprobar permisos | Hook `PermissionRequest` → respuesta `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"\|"deny"}}}`. Timeout por defecto 600 s. |
| Hooks solo para sesiones lanzadas | `--settings <json>` al lanzar |

**Confirmado en el spike (2026-10-22, `spike-notes.md`):** `PermissionRequest` se dispara en
`-p` y su respuesta se respeta, siempre que el agente corra con `--permission-mode default`
(el modo `auto` del usuario lo aprueba antes sin preguntar). `PermissionRequest` no trae
`tool_use_id`; tras un deny no llega `PostToolUse*` (sí `system/permission_denied` en `stream-json`).

## 3. Arquitectura

```
Claude Code (terminal o lanzado por Centinela)
  │ hooks http  (Authorization: Bearer $CENTINELA_TOKEN)
  ▼
centinela-server  — Node ≥ 22, sin dependencias, 127.0.0.1:4317
  ├─ POST /hooks/event        guarda y difunde
  ├─ POST /hooks/permission   (solo sesiones lanzadas) espera la decisión del usuario
  ├─ GET  /events             Server-Sent Events hacia la página
  ├─ GET  /api/state          historial al cargar
  ├─ GET  /api/roles          lista de .claude/agents/*.md (global + proyecto)
  ├─ POST /api/agents         lanzar agente
  ├─ POST /api/agents/:id/prompt
  ├─ POST /api/agents/:id/stop
  ├─ POST /api/permissions/:id   allow | allow-session | deny
  └─ archivos: ~/.centinela/events-YYYY-MM-DD.jsonl, ~/.centinela/token
  ▼
Página (un solo HTML + JS, Cytoscape.js por CDN con versión fija)
```

**Unidades:**
- `server.js` — HTTP, rutas, autenticación, SSE.
- `store.js` — anexa eventos al `.jsonl`, carga el historial.
- `graph.js` (compartido, puro) — eventos → `{nodos, aristas, estado}`. Es lo que se prueba.
- `launcher.js` — crea/gestiona procesos `claude`, parsea `stream-json`.
- `permissions.js` — cola de solicitudes pendientes, timeout → deny.
- `public/index.html`, `public/app.js` — grafo, panel, línea de tiempo.
- `install-hooks.js` — añade/quita los hooks de observación en el `settings.json` del usuario
  (respeta `CLAUDE_CONFIG_DIR`), con copia de respaldo y mostrando el
  diff antes de escribir.

## 4. Interfaz

- **Grafo (arriba):** nodo = agente (sesión principal o subagente), color/ícono por `agent_type`;
  bajo el nombre, la acción actual. Arista = delegación, etiqueta = inicio del prompt delegado.
  Estados: trabajando (pulso), terminado ✓, error ✕, esperando permiso (ámbar). Sesiones
  agrupadas por proyecto (`cwd`). Filtros: sesión, proyecto, solo activas.
- **Panel derecho (clic en nodo):** tarea, lista de acciones con hora, JSON crudo. En agentes
  lanzados: respuestas del modelo (de `stream-json`) y campo para enviar prompt.
  En sesiones de terminal: botón "Continuar aquí".
- **Línea de tiempo (abajo):** un carril por agente, bloques por acción.
- **Nuevo agente:** rol (de `/api/roles`), carpeta del proyecto, prompt inicial.
- **Permiso pendiente:** tarjeta "<agente> quiere <herramienta>: <resumen del input>" con
  Permitir / Permitir siempre en esta sesión / Rechazar.

## 5. Seguridad

Modelo de amenaza: el servidor puede ejecutar `claude` con permisos aprobados, es decir,
ejecución de código en la Mac. Atacantes considerados: cualquier página web abierta en el
navegador, otros procesos locales sin el token, y contenido malicioso dentro de los repos que
los agentes leen (prompt injection).

| Riesgo | Control |
|---|---|
| Acceso desde la red | Escucha solo en `127.0.0.1`. |
| CSRF / página web que hace POST a localhost | Token obligatorio en `Authorization: Bearer` en toda ruta excepto `GET /` (la página). Sin cookies. Peticiones `POST` exigen `Content-Type: application/json` (fuerza preflight CORS); no se envían cabeceras CORS permisivas. |
| DNS rebinding | Rechazar si `Host` ≠ `127.0.0.1:4317` / `localhost:4317`; rechazar si hay `Origin` y no es el propio. |
| Robo del token | `~/.centinela/token` generado con `crypto.randomBytes(32)`, permisos `0600`, directorio `0700`. La página lo recibe por fragmento de URL (`#token=`) que abre el servidor al arrancar; nunca va en query string ni en logs. Comparación en tiempo constante. |
| Inyección de comandos al lanzar | `child_process.spawn` con arreglo de argumentos, nunca `shell: true`. `rol` validado contra la lista de `/api/roles`; `cwd` debe existir, ser directorio y ser absoluto (realpath). El prompt va por stdin, no por argumentos. |
| Aprobaciones falsas | Solo `/api/permissions/:id` con token decide; ids aleatorios; una decisión por id. |
| Timeout / servidor caído en permisos | Sin respuesta en 300 s → `deny`. El hook de permisos usa `onFailure: "block"`, así que servidor caído = no se ejecuta. |
| "Permitir siempre" demasiado amplio | Se limita a la misma herramienta + mismo `agent_id` dentro de la misma sesión, en memoria; se pierde al reiniciar. Nunca para Bash con comandos distintos: allow-session en Bash solo cubre el comando exacto. |
| Prompt injection desde repos | Por diseño las sesiones lanzadas corren en modo de permisos normal (`manual`/default), nunca `bypassPermissions`; toda acción que requiera permiso pasa por el panel mostrando el input completo. |
| XSS con contenido de agentes | Todo texto de eventos se inserta con `textContent`; nunca `innerHTML`. CSP en la página: `default-src 'self'; script-src 'self' cdn.jsdelivr.net; connect-src 'self'`. Cytoscape con versión fija + SRI. |
| Secretos en el historial | `.jsonl` con permisos `0600`. Nada sale de la Mac. |
| Hooks de observación rompen sesiones | Hooks de observación son no bloqueantes (non-2xx/caído = se ignora), timeout corto (2 s). |

Al terminar la implementación: revisión con el agente `security-auditor` contra esta tabla.

## 6. Errores

| Caso | Comportamiento |
|---|---|
| Servidor apagado | Observación: se ignora. Permisos de sesiones lanzadas: bloqueado (deny). |
| Proceso `claude` lanzado muere | Nodo ✕, panel muestra stderr final y código de salida. |
| Navegador cerrado | El servidor sigue; al reabrir, `/api/state` reconstruye. |
| Línea corrupta en `.jsonl` | Se salta con aviso en consola; no detiene la carga. |
| Evento desconocido | Se guarda y aparece en el panel como evento genérico. |

## 7. Pruebas

- `node --test`: `graph.js` con eventos grabados (sesión con 2 subagentes, error, permiso
  pendiente) → nodos/aristas/estados esperados.
- `node --test`: seguridad del servidor — sin token 401, Host ajeno 403, Origin ajeno 403,
  rol desconocido 400, cwd relativo 400, timeout de permiso → deny.
- Manual de punta a punta: lanzar agente, verlo en el grafo, aprobar un permiso, enviar segundo
  prompt, "Continuar aquí" sobre una sesión de terminal.

## 8. Fase 2 (no ahora)

Envolver `public/` y el servidor en Tauri como app de Mac; el servidor sigue igual.
