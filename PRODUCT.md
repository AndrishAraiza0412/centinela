# Product

## Platform

web

## Users

Una sola persona: el desarrollador dueño de la Mac, con varias sesiones de Claude Code abiertas a la vez (en terminales y lanzadas desde el propio panel). Tiene Centinela abierto en una pestaña o en un segundo monitor mientras trabaja, y entra a él para ver qué pasa, aprobar permisos y dar órdenes a los agentes.

## Product Purpose

Centinela muestra en vivo qué hace cada sesión y subagente de Claude Code y quién delegó qué a quién, y deja lanzar agentes por rol, conversar con ellos, detenerlos y aprobar sus permisos sin cambiar de terminal. Éxito: de un vistazo se sabe **quién hace qué y quién está esperando** (un permiso o una respuesta), y se actúa en segundos.

## Positioning

Observa las sesiones reales de Claude Code del usuario (vía hooks) y controla agentes lanzados con su propia suscripción por la CLI `claude`, sin API keys ni servicios externos; todo es local y cada permiso de un agente lanzado pasa por el panel con su entrada completa a la vista.

## Operating Context

- Servidor Node local en `127.0.0.1:4317`; la página se abre con un código de emparejamiento de un solo uso que imprime `node bin/centinela.js`.
- Eventos: hooks `http` de Claude Code (sesiones de terminal) y `stream-json` de los procesos `claude -p` lanzados.
- Uso en paralelo con el trabajo: el panel se consulta a ratos y reclama atención solo cuando un agente espera un permiso (tarjeta y aviso del navegador).

## Capabilities and Constraints

- Ver sesiones, subagentes y delegaciones (arista con el inicio del prompt delegado), acciones por agente con su resultado, conversación de los agentes lanzados, salida y stderr al terminar.
- Lanzar agentes por rol (`agents/*.md` del usuario o `.claude/agents/*.md` del proyecto), enviarles prompts, detenerlos, "Continuar aquí" sobre una sesión de terminal (`--resume`).
- Aprobar permisos: Permitir / Permitir esta misma acción durante la sesión / Rechazar; sin respuesta en 5 minutos o con el servidor apagado, se rechaza. Todo Bash de un agente lanzado pasa por el panel.
- Datos disponibles por agente lanzado: costo estimado y tokens que reporta `claude -p` (con suscripción es una estimación, no un cobro).
- Restricciones: solo local; Node ≥ 22 sin dependencias npm; sin `innerHTML`; textos de eventos con `textContent`; CSP estricta; interfaz en español.
- No existe (no inventar): cuotas de API, TPM/latencias de un "cluster", ramas/commits por agente, tableros de objetivos, vista previa de navegador, voz, pausa de agentes (solo detener).

## Evidence on Hand

- Diseño de referencia del usuario ("Agent Swarm Board", 2026-10-22); sus datos son de muestra, no del producto.
- Fixtures reales de eventos en `test/fixtures/`.

## Product Principles

1. Quién espera, primero: un permiso pendiente nunca puede pasar desapercibido.
2. Lo que se ve es lo que se ejecuta: nada recortado ni engañoso en lo que se aprueba.
3. Solo datos reales: si Centinela no lo mide, no aparece.
4. Seguro por defecto: los controles de seguridad y permisos no se relajan por diseño.
