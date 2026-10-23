---
name: Centinela
description: Tablero local de terminales vivas para ver y dirigir sesiones de Claude Code.
colors:
  bg: "#0b0d0d"
  canvas: "#0d1010"
  side: "#0f1212"
  surface: "#131717"
  surface-2: "#192020"
  well: "#0f1312"
  border: "#232a28"
  border-strong: "#33403c"
  dot: "#222b28"
  text: "#e6ebe8"
  muted: "#919c97"
  faint: "#87928d"
  accent: "#e2774f"
  accent-hover: "#ec8660"
  accent-ink: "#1c0e07"
  accent-soft: "rgb(226 119 79 / 0.14)"
  live: "#45d08f"
  live-soft: "rgb(69 208 143 / 0.12)"
  danger: "#f0506e"
  danger-soft: "rgb(240 80 110 / 0.12)"
typography:
  headline:
    fontFamily: "ui-serif, \"New York\", \"Iowan Old Style\", Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    letterSpacing: "0.06em"
    fontFeature: "all-small-caps"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  card-title:
    fontFamily: "ui-serif, \"New York\", \"Iowan Old Style\", Georgia, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "0.06em"
    fontFeature: "all-small-caps"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "ui-serif, \"New York\", \"Iowan Old Style\", Georgia, serif"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "0.08em"
    fontFeature: "all-small-caps"
  mono:
    fontFamily: "ui-monospace, \"SF Mono\", \"Menlo\", monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  mono-small:
    fontFamily: "ui-monospace, \"SF Mono\", \"Menlo\", monospace"
    fontSize: "11px"
    fontWeight: 400
rounded:
  track: "3px"
  xs: "6px"
  control: "8px"
  card: "10px"
  floating: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "28px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    width: "340px"
  card-terminal:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    typography: "{typography.mono}"
    padding: "9px 12px"
  pill-working:
    backgroundColor: "{colors.live-soft}"
    textColor: "{colors.live}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 9px 5px"
  pill-waiting:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 9px 5px"
  pill-error:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 9px 5px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
  nav-item-active:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.accent}"
  commandbar:
    backgroundColor: "rgb(17 21 21 / 0.97)"
    rounded: "{rounded.floating}"
    padding: "10px 12px"
    width: "min(780px, calc(100% - 32px))"
  drawer:
    backgroundColor: "{colors.side}"
    padding: "20px 20px 28px"
    width: "400px"
---

# Design System: Centinela

## Overview

**Creative North Star: "La sala de terminales vivas"**

Centinela es un tablero oscuro donde cada agente es una terminal completa colocada sobre un lienzo de puntos, no un nodo de grafo con un panel aparte. Se lee de un vistazo desde un segundo monitor junto a un editor oscuro: lo que corre late en verde, lo que te espera arde en terracota, lo que falló se marca en rojo. Todo lo demás es casi-negro con tinte verde y queda en silencio.

La densidad es de herramienta de operador: texto base de 13px, controles compactos, tres voces tipográficas con funciones fijas (versalitas serif para nombrar, monoespaciada para lo que la máquina dice y cuenta, sans del sistema para la interfaz). La profundidad se construye con capas tonales y bordes de 1px; la sombra está reservada para lo que flota o reclama atención. Funciona sin red ni dependencias: fuentes del sistema, iconos SVG de trazo único dibujados a mano, CSP `default-src 'self'`.

Es solo oscuro por decisión: vive al lado de un editor oscuro y no debe deslumbrar al mirarlo de reojo.

**Key Characteristics:**
- Lienzo casi-negro con retícula de puntos (18px) y tarjetas-terminal de 340px.
- Un solo acento cálido con dos significados emparentados: "actúa aquí" y "esto te espera".
- Estado codificado por color y por forma (punto, pastilla, arista animada), nunca solo por color.
- Tres voces tipográficas con roles estrictos, todas del sistema.
- Plano por defecto; sombra solo en la barra de comandos flotante y en la tarjeta que espera.

## Colors

Neutros casi-negros con un tinte verde azulado muy bajo (croma ≤ 0.02), un acento terracota y dos colores de estado.

### Primary
- **Terracota de Turno** (accent): la acción primaria (Nuevo agente, Lanzar, Permitir, Enviar), el foco de teclado, el cursor de texto, la vista activa de la navegación y, sobre todo, cualquier agente que espera al usuario (borde y halo de su tarjeta, pastilla "Espera permiso", contador "Te esperan", arista punteada). Su hover es **Terracota Encendida** (accent-hover). Sobre el acento sólido, el texto es **Tinta de Barro** (accent-ink).
- **Velo Terracota** (accent-soft): fondo de la pastilla de espera, del contador activo y de la selección de texto.

### Secondary
- **Verde Pulso** (live): lo que está trabajando ahora: punto de conexión "En vivo", pastilla "Trabajando", arista animada, resultado correcto en la terminal, cifra de agentes trabajando. Con **Velo Verde** (live-soft) como fondo de pastillas y chips.

### Tertiary
- **Rojo Falla** (danger): error, desconexión, resultado fallido, acciones destructivas (Detener, Rechazar). Con **Velo Rojo** (danger-soft) en hover y pastillas.

### Neutral
- **Fondo Abisal** (bg): fondo de la página.
- **Lienzo** (canvas): superficie del lienzo y de la línea de tiempo; los puntos de la retícula usan **Punto de Retícula** (dot).
- **Costado** (side): barra lateral y cajón de detalle.
- **Superficie** (surface): tarjetas, botones, contadores, diálogo.
- **Superficie Alzada** (surface-2): hover, pestaña seleccionada, mensaje del usuario, ícono de tarjeta.
- **Pozo** (well): campos de texto y el bloque de terminal dentro de la tarjeta; es más oscuro que la superficie, se lee como hundido.
- **Borde** (border) y **Borde Firme** (border-strong): divisores de 1px y bordes en reposo / en hover, seleccionados y flotantes.
- **Tinta** (text), **Tinta Apagada** (muted) y **Tinta Tenue** (faint): texto principal, etiquetas y texto secundario, marcas de tiempo y placeholders.

### Named Rules
**The Quién-Te-Espera Rule.** La terracota significa "tu turno": acción primaria o agente esperando. No se usa como decoración, ni para marcar novedad, ni para estados que no requieren al usuario.

**The Tres Estados Rule.** Verde = trabajando, terracota = esperando, rojo = falló. Ningún otro color porta estado, y cada estado se repite en punto, pastilla, borde e ícono para no depender solo del matiz.

## Typography

**Display/Label Font:** serif del sistema en versalitas (`ui-serif`, New York, Iowan Old Style, Georgia)
**Body Font:** sans del sistema (`-apple-system`, SF Pro Text, system-ui)
**Label/Mono Font:** monoespaciada del sistema (`ui-monospace`, SF Mono, Menlo)

**Character:** versalitas serif con tracking abierto para nombrar cosas (agentes, contadores, secciones) como en una placa de instrumento; monoespaciada para todo lo que sale de la máquina; sans neutra para la interfaz. Sin fuentes descargadas: funciona sin red bajo la CSP.

### Hierarchy
- **Headline** (400, 22px, versalitas, +0.06em): nombre del agente en el cajón y título del diálogo.
- **Title** (600, 17px, sans): el nombre "Centinela" en la barra superior.
- **Card title** (400, 16px/1.15, versalitas, +0.06em): nombre del agente en la tarjeta; en la línea de tiempo, 15px.
- **Body** (400, 13px/1.45, sans): interfaz general, botones, campos, mensajes.
- **Label** (400, 13–15px, versalitas, +0.06–0.1em, color muted): etiquetas de contadores, hechos del cajón, pastillas de estado, encabezados de sección, marca.
- **Mono** (12px/1.5): salida de la terminal, "ahora" de la tarjeta, resumen del permiso; **Mono small** (11–11.5px): pies de tarjeta, marcas de tiempo, chip "Local", aristas, versión. Cifras siempre con `tabular-nums`.

### Named Rules
**The Tres Voces Rule.** Versalitas serif nombra, mono reporta, sans opera. Una cifra o un comando nunca va en serif; un nombre de agente nunca va en mono.

## Layout

Rejilla de app a pantalla completa, de escritorio: barra lateral fija de 228px + área principal. El área principal apila barra superior (marca, chip local, contadores a la derecha), barra de herramientas (pestañas por proyecto, filtro, zoom, Nuevo agente) y el escenario. El escenario superpone lienzo / línea de tiempo y la barra de comandos flotante (centrada abajo, hasta 780px, 18px sobre el borde), con el cajón de detalle de 400px a la derecha cuando hay selección.

El lienzo es infinito, con pan y zoom; las tarjetas tienen ancho fijo y se colocan por relayout animado. Ritmo de espaciado: 4 / 8 / 12 / 20 / 28px, con pasos intermedios de 6, 10 y 14px dentro de controles. Por debajo de 1100px la barra lateral colapsa a 60px de solo íconos y el cajón baja a 360px. El uso móvil está fuera de alcance por ahora; la regla de 760px existe en el CSS pero no es una plataforma soportada.

## Elevation & Depth

Sistema plano con capas tonales: el fondo más oscuro está detrás, las superficies suben medio escalón de luminosidad, los pozos (campos, terminal) bajan. Todo borde es de 1px. La sombra es neutra (negro con alfa), nunca de color, y solo aparece en dos lugares: lo que flota sobre el lienzo y lo que reclama al usuario.

### Shadow Vocabulary
- **Flotante** (`box-shadow: 0 18px 40px rgb(0 0 0 / 0.45)`): barra de comandos.
- **Te espera** (`box-shadow: 0 0 0 1px var(--accent), 0 12px 28px rgb(0 0 0 / 0.5)`): tarjeta en estado de espera; doble borde terracota más elevación.

### Named Rules
**The Plano-Salvo-Turno Rule.** Las superficies son planas en reposo. Una tarjeta solo se eleva cuando espera al usuario; ningún hover ni selección añade sombra (la selección usa un contorno terracota de 2px separado 3px).

## Shapes

Esquinas suaves y consistentes: 8px para controles (botones, campos, íconos de tarjeta, conexión), 10px para contenedores (tarjetas, contadores, hechos), 14px para lo flotante (barra de comandos, diálogo), 999px para pastillas, chips y etiquetas de arista; 3–6px solo en piezas pequeñas (pista de la línea de tiempo, `kbd`, bloques `pre`). Los puntos de estado son círculos de 6–8px. Las aristas entre agentes son curvas punteadas (trazo 1.5, guion 4/5). Iconos: SVG de 24×24 con trazo único de 1.75, `currentColor`, mostrados a 16px.

## Components

### Buttons
Compactos y tranquilos; el color aparece solo cuando la acción importa.
- **Shape:** esquinas suaves (8px), borde de 1px.
- **Default:** superficie con borde; hover sube a superficie alzada y borde firme. Transición de 0.15s en fondo, borde y color.
- **Primary:** terracota sólida con tinta de barro, peso 600; hover a terracota encendida.
- **Ghost:** transparente, texto apagado; hover toma superficie y borde.
- **Danger:** texto y borde rojo translúcido sobre transparente; hover con velo rojo. Variante **danger-text** (Detener todos): apagada hasta hover o "armada" (confirmación en dos pasos).
- **Icon button:** relleno de 6px.
- **Focus:** contorno terracota de 2px, separación 2px. Deshabilitado: opacidad 0.45.

### Chips (pastillas de estado)
- **Style:** versalitas serif 13px, pastilla de 999px, borde de 1px; trabajando (verde, con punto antepuesto), esperando (terracota), error (rojo), desconectado (borde punteado, tinta tenue).
- **Chip "Local":** mono 11.5px sobre velo verde.

### Cards / Containers
La tarjeta-terminal es la pieza firma (ver abajo). Los contenedores secundarios (contadores, hechos del cajón, mensajes) usan superficie, borde de 1px y 8–10px de radio, sin sombra.

### Inputs / Fields
- **Style:** pozo con borde de 1px, 8px de radio, relleno 7px 10px.
- **Focus:** el borde pasa a firme y, con teclado, contorno terracota de 2px.
- **Error:** texto en rojo falla bajo el formulario.

### Navigation
Barra lateral con marca en versalitas ("Centinela // panel" con punto terracota), encabezado de sección en versalitas y elementos de 13.5px con ícono. Activo: texto terracota sobre superficie alzada con borde firme. Pie con estado de conexión en mono dentro de un pozo (punto verde "En vivo", rojo si cae). Pestañas por proyecto en serif 14px con punto de estado; la seleccionada sube a superficie alzada.

### Tarjeta de agente (signature)
Terminal completa de 340px: cabecera (ícono en caja de 30px coloreado por estado, nombre en versalitas, tipo en sans 12px, pastilla de estado), línea "ahora" en mono, bloque de terminal hundido con marcas ✓ / ✗ / spinner por acción y hora tabular, último mensaje del agente (3 líneas), ranura de permiso y pie mono con acciones, costo y hora. En espera, el borde, el halo y la ranura de permiso (fondo terracota al 6%) la hacen la única cosa cálida en pantalla; los botones Permitir / Permitir en la sesión / Rechazar viven dentro de la tarjeta. Terminada o desconectada, el fondo baja a casi-negro y desaparece la línea "ahora".

### Barra de comandos (signature)
Flotante, centrada abajo, 14px de radio, borde firme y sombra flotante. Una fila: destinatario, campo que crece con el contenido, atajo `⌘↩` en `kbd`, Enviar (primario de solo ícono) y Detener todos (danger-text).

### Movimiento
Relayout de tarjetas (transform 0.24s, `cubic-bezier(0.2, 0.8, 0.2, 1)`), guiones que fluyen en las aristas de agentes trabajando (1.1s lineal), spinner en acciones en curso (1s). Todo se apaga con `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** reservar la terracota para la acción primaria y para el agente que espera (The Quién-Te-Espera Rule).
- **Do** repetir cada estado en punto, pastilla, borde e ícono, con verde / terracota / rojo y nada más.
- **Do** usar versalitas serif para nombres y etiquetas, mono con `tabular-nums` para salida y cifras, sans del sistema para la interfaz.
- **Do** construir profundidad con capas tonales y bordes de 1px; sombra solo en la barra de comandos y en la tarjeta que espera.
- **Do** dibujar iconos nuevos como SVG de trazo único (24×24, trazo 1.75, `currentColor`) en `icons.js`.
- **Do** apagar toda animación bajo `prefers-reduced-motion`.

### Don't:
- **Don't** añadir fuentes web, CDNs ni recursos externos: rompen la CSP `default-src 'self'` y el uso sin red.
- **Don't** añadir un tema claro: el producto vive junto a un editor oscuro.
- **Don't** usar sombras de color ni elevar tarjetas en hover o selección.
- **Don't** convertir los agentes en nodos de grafo con un panel de detalles aparte; cada agente se lee completo en su tarjeta.
- **Don't** mostrar métricas que Centinela no mide (cuotas, latencias, ramas por agente).
