# Centinela v1 — pendientes

Hallazgos menores de la revisión final y de la auditoría de seguridad (2026-10-22) que no se arreglaron en v1. Ninguno es crítico ni importante.

## Seguridad

- El launch-token de cada agente viaja dentro de `--settings` y se ve en `ps`. Quien lo lea puede forjar tarjetas de permiso de ese agente (no decidirlas). Arreglo: pasar `--settings` como archivo `0600`.
- La tarjeta toma el nodo del `session_id` del cuerpo del hook; debería salir del agente dueño del launch-token.
- `install-hooks` no escribe de forma atómica ni detecta cambios concurrentes de `settings.json`; un archivo nuevo queda con la máscara por defecto.
- `isOurs` quita el grupo de hooks completo si uno de sus hooks es de Centinela (borraría un hook tuyo añadido a mano en ese grupo).
- `roles.js` sigue enlaces simbólicos y FIFOs sin tope de tamaño (un repo hostil podría colgar el panel).
- La CSP va como `<meta>`, así que no puede llevar `frame-ancestors`; mejor como cabecera HTTP. (Desde el rediseño ya no hay CDN: `script-src 'self'` y `base-uri 'none'`.)

## Robustez

- SSE sin control de backpressure; varios cuerpos de 5 MB a la vez se guardan en memoria.
- Un `Write` de ≥ ~2,5 MB supera el límite de `/hooks/event` (413) y su acción queda en "…"; `/api/state` no recorta y SSE sí.
- Si el socket del hook se cierra mientras se lee el cuerpo, la petición espera los 300 s.
- `append()` que falla (disco lleno) tumba el servidor.
- Procesos nietos que heredan los pipes retrasan el `close`; `SIGTERM` no llega a los procesos que lanzó `claude`; `sendPrompt` entre la muerte y el `close` devuelve `true`.
- `settings.json` válido pero que no es un objeto (o vacío) da un stack trace en el instalador.

## Interfaz

- Eventos genéricos (`Notification`) quedan en "…" para siempre; `StopFailure` oculta el campo de prompt de un agente que sigue vivo.
- `breadthfirst` con `fit` reinicia el pan y el zoom al llegar cada nodo nuevo; los carriles de la línea de tiempo pierden el foco del teclado cada 2 s; el `aria-live` del panel anuncia todo el panel en cada evento.

## Sin verificar

- Si `--resume <id>` en `-p` conserva el mismo `session_id` (fusionaría el nodo de terminal con el lanzado).
- Si `claude -p` emite `system/init` más de una vez con entrada en streaming (duplicaría el primer prompt en la conversación).
- Si `--setting-sources user` sigue cargando los roles de `.claude/agents` del proyecto.
