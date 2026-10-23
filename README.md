# Centinela

Panel local para ver en vivo tus sesiones y subagentes de Claude Code, lanzar agentes por rol, enviarles prompts y aprobar sus permisos.

Node ≥ 22, sin dependencias ni CDN: funciona sin internet. Solo escucha en `127.0.0.1:4317`.

## Arrancar

```sh
node bin/centinela.js
```

Imprime `http://127.0.0.1:4317/#pair=…` y lo abre en el navegador. Ese código sirve **una sola vez**: la página lo canjea por el token de sesión, que vive solo en esa pestaña (sobrevive a recargas). Si abres otra pestaña o reinicias Centinela, vuelve a ejecutar `node bin/centinela.js` desde tu terminal.

Arráncalo desde tu propia terminal, no desde una sesión de Claude Code: la salida de un comando lanzado por Claude queda en archivos que otros comandos pueden leer.

## Observar tus sesiones (hooks)

```sh
node bin/centinela-hooks.js install     # muestra el diff y pide confirmación
node bin/centinela-hooks.js uninstall   # quita solo lo que añadió Centinela
```

- Escribe en `$CLAUDE_CONFIG_DIR/settings.json` (o `~/.claude/settings.json`) y deja una copia `settings.json.centinela-backup-<ts>` antes de cada cambio.
- Añade un hook `http` por evento hacia `/hooks/event`. Tus hooks no se tocan; los de Centinela se reconocen por su URL.
- Si tienes el sandbox activo, añade `127.0.0.1:4317` (solo el puerto de Centinela) a `sandbox.network.allowedDomains`; sin eso los hooks reciben 403. Los comandos sandboxeados pueden alcanzar ese puerto, pero sin el token de la página no pueden hacer nada más que enviar eventos validados. `uninstall` lo quita solo si lo añadió Centinela.
- Con Centinela apagado, los hooks de observación fallan en silencio: tus sesiones siguen igual.

## El panel

- **Arranca vacío:** el lienzo solo muestra lo que ocurre desde que abriste Centinela (el historial sigue guardado en `~/.centinela/`).
- **Proyectos:** en la barra lateral, una vista por cada carpeta con agentes, con el número de agentes activos; «Todos» los muestra juntos.
- **Lienzo de agentes:** cada sesión y subagente es una tarjeta (estado, qué hace ahora, últimas acciones, última respuesta y, si te espera, su permiso ahí mismo). Las líneas punteadas muestran la tarea delegada. Arrastra el fondo o desliza con dos dedos para moverte; pellizca o ⌘+rueda para el zoom; «Encuadrar» vuelve a mostrar todo.
- **Te esperan:** el contador de arriba lleva al agente que espera un permiso. Un agente que espera se ve siempre, aunque los filtros lo oculten.
- **Barra de comandos:** «Mensaje a todos» o a un agente lanzado (⌘↩), «Nuevo agente» y «Detener todos» (pide confirmar).
- **Línea de tiempo:** un carril por agente.

## Agentes lanzados desde el panel

"+ Nuevo agente" lanza `claude -p --agent <rol>` en la carpeta que elijas, con el modelo que elijas (por defecto, Opus, Sonnet o Haiku). Los roles salen de:

- `roles/*.md` de Centinela (incluidos): desarrollador, arquitecto, legal, diseñador, qa, seguridad, devops, documentador, producto y datos. Se pasan con `--agents` al lanzar; no tocan tu configuración. Si tú o el proyecto tienen un rol con el mismo nombre, se usa ese.
- Tu carpeta de agentes de Claude Code (`agents/*.md`) y `.claude/agents/*.md` del proyecto.

- Corren en modo de permisos `default` (si `claude` informa otro modo al arrancar, Centinela lo detiene): cada permiso aparece como tarjeta con la entrada completa, y los caracteres invisibles o el relleno de espacios se muestran marcados. Permitir / Permitir esta misma acción durante la sesión (misma herramienta, mismo agente y exactamente la misma entrada) / Rechazar.
- Todo Bash pasa por el panel, también el que correría dentro del sandbox (en tus sesiones de terminal, Claude Code lo aprueba solo; en los agentes lanzados se desactiva con `autoAllowBashIfSandboxed: false`).
- `claude -p` se salta el diálogo de confianza de carpetas: si la carpeta trae `.claude/settings*.json` o `.mcp.json`, el panel te pide confirmarlo antes de lanzar.
- Un rol del proyecto con el mismo nombre que uno tuyo no se puede lanzar ahí (no sabrías cuál se ejecuta).
- Sin respuesta en 5 minutos → se rechaza. Con Centinela apagado → se rechaza (`onFailure: block`).
- "Continuar aquí", en una sesión de terminal, la retoma con `--resume` en una rama nueva; la de la terminal no cambia.

## Datos y tokens

Todo vive en `~/.centinela/` (`0700`; archivos `0600`):

| Archivo | Para qué |
|---|---|
| `hook-token` | Solo permite enviar eventos a `/hooks/event` (se validan). Va escrito en tu `settings.json`. |
| `events-YYYY-MM-DD.jsonl` | Historial de eventos. Puede contener lo que tus agentes leyeron o escribieron. No se vuelve a cargar al arrancar. |

El token de la página no se guarda en disco: se genera en cada arranque y solo se entrega por el código de un solo uso. Cada agente lanzado recibe además un token propio, en memoria, que solo sirve para pedir permisos y muere con él.

## Desarrollo

```sh
npm test
```

Variables para pruebas: `CENTINELA_HOME`, `CENTINELA_PORT`, `CENTINELA_CLAUDE_BIN`, `CENTINELA_NO_OPEN`, `CENTINELA_PERMISSION_TIMEOUT_MS`.

Documentación: `docs/diseno-v1.md` (diseño y modelo de amenazas), `docs/plan-v1.md`, `docs/spike-notes.md`, `docs/decisiones-v1.md`, `docs/pendientes-v1.md`; sistema visual en `DESIGN.md` y producto en `PRODUCT.md`.
