---
name: Centinela
description: Local board of live terminals to watch and direct Claude Code sessions.
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

**Creative North Star: "The room of live terminals"**

Centinela is a dark board where each agent is a complete terminal placed on a dotted canvas, not a graph node with a separate panel. It reads at a glance from a second monitor next to a dark editor: what is running pulses green, what is waiting on you burns terracotta, what failed is marked red. Everything else is green-tinted near-black and stays quiet.

The density is that of an operator's tool: 13px base text, compact controls, three type voices with fixed jobs (serif small caps to name, monospace for what the machine says and counts, system sans for the interface). Depth is built with tonal layers and 1px borders; shadow is reserved for what floats or demands attention. It works with no network or dependencies: system fonts, hand-drawn single-stroke SVG icons, CSP `default-src 'self'`.

It is dark only by decision: it lives next to a dark editor and must not dazzle when glanced at.

**Key Characteristics:**
- Near-black canvas with a dot grid (18px) and 340px terminal cards.
- A single warm accent with two related meanings: "act here" and "this is waiting on you".
- State encoded by color and by shape (dot, pill, animated edge), never by color alone.
- Three type voices with strict roles, all from the system.
- Flat by default; shadow only on the floating command bar and the waiting card.

## Colors

Near-black neutrals with a very low blue-green tint (chroma ≤ 0.02), a terracotta accent and two status colors.

### Primary
- **Your-Turn Terracotta** (accent): the primary action (Nuevo agente, Lanzar, Permitir, Enviar), keyboard focus, the text cursor, the active navigation view and, above all, any agent waiting on the user (its card's border and halo, "Espera permiso" pill, "Te esperan" counter, dotted edge). Its hover is **Lit Terracotta** (accent-hover). On the solid accent, text is **Clay Ink** (accent-ink).
- **Terracotta Veil** (accent-soft): background of the waiting pill, the active counter and text selection.

### Secondary
- **Pulse Green** (live): what is working right now: "En vivo" connection dot, "Trabajando" pill, animated edge, successful result in the terminal, working-agents figure. With **Green Veil** (live-soft) as the background of pills and chips.

### Tertiary
- **Failure Red** (danger): error, disconnection, failed result, destructive actions (Detener, Rechazar). With **Red Veil** (danger-soft) on hover and pills.

### Neutral
- **Abyssal Background** (bg): the page background.
- **Canvas** (canvas): surface of the canvas and the timeline; grid dots use **Grid Dot** (dot).
- **Side** (side): sidebar and detail drawer.
- **Surface** (surface): cards, buttons, counters, dialog.
- **Raised Surface** (surface-2): hover, selected tab, user message, card icon.
- **Well** (well): text fields and the terminal block inside the card; darker than the surface, it reads as sunken.
- **Border** (border) and **Firm Border** (border-strong): 1px dividers and borders at rest / on hover, selected and floating.
- **Ink** (text), **Muted Ink** (muted) and **Faint Ink** (faint): main text, labels and secondary text, timestamps and placeholders.

### Named Rules
**The Who's-Waiting Rule.** Terracotta means "your turn": primary action or waiting agent. It is not used as decoration, to mark something new, or for states that do not require the user.

**The Three States Rule.** Green = working, terracotta = waiting, red = failed. No other color carries state, and each state is repeated in dot, pill, border and icon so it does not depend on hue alone.

## Typography

**Display/Label Font:** system serif in small caps (`ui-serif`, New York, Iowan Old Style, Georgia)
**Body Font:** system sans (`-apple-system`, SF Pro Text, system-ui)
**Label/Mono Font:** system monospace (`ui-monospace`, SF Mono, Menlo)

**Character:** serif small caps with open tracking to name things (agents, counters, sections) like an instrument plate; monospace for everything coming from the machine; neutral sans for the interface. No downloaded fonts: it works offline under the CSP.

### Hierarchy
- **Headline** (400, 22px, small caps, +0.06em): agent name in the drawer and dialog title.
- **Title** (600, 17px, sans): the name "Centinela" in the top bar.
- **Card title** (400, 16px/1.15, small caps, +0.06em): agent name on the card; 15px on the timeline.
- **Body** (400, 13px/1.45, sans): general interface, buttons, fields, messages.
- **Label** (400, 13–15px, small caps, +0.06–0.1em, muted color): counter labels, drawer facts, status pills, section headers, brand.
- **Mono** (12px/1.5): terminal output, the card's "now" line, permission summary; **Mono small** (11–11.5px): card footers, timestamps, "Local" chip, edges, version. Figures always with `tabular-nums`.

### Named Rules
**The Three Voices Rule.** Serif small caps names, mono reports, sans operates. A figure or a command never goes in serif; an agent name never goes in mono.

## Layout

Full-screen desktop app grid: fixed 228px sidebar + main area. The main area stacks the top bar (brand, local chip, counters on the right), the toolbar (project tabs, filter, zoom, Nuevo agente) and the stage. The stage overlays the canvas / timeline and the floating command bar (centered at the bottom, up to 780px, 18px above the edge), with the 400px detail drawer on the right when there is a selection.

The canvas is infinite, with pan and zoom; cards have a fixed width and are placed by animated relayout. Spacing rhythm: 4 / 8 / 12 / 20 / 28px, with intermediate steps of 6, 10 and 14px inside controls. Below 1100px the sidebar collapses to 60px icons only and the drawer drops to 360px. Mobile use is out of scope for now; the 760px rule exists in the CSS but is not a supported platform.

## Elevation & Depth

Flat system with tonal layers: the darkest background is behind, surfaces rise half a lightness step, wells (fields, terminal) go down. Every border is 1px. Shadow is neutral (black with alpha), never colored, and appears in only two places: what floats over the canvas and what demands the user.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 18px 40px rgb(0 0 0 / 0.45)`): command bar.
- **Waiting on you** (`box-shadow: 0 0 0 1px var(--accent), 0 12px 28px rgb(0 0 0 / 0.5)`): card in waiting state; double terracotta border plus elevation.

### Named Rules
**The Flat-Except-Your-Turn Rule.** Surfaces are flat at rest. A card rises only when it is waiting on the user; no hover or selection adds shadow (selection uses a 2px terracotta outline offset by 3px).

## Shapes

Soft, consistent corners: 8px for controls (buttons, fields, card icons, connection), 10px for containers (cards, counters, facts), 14px for floating elements (command bar, dialog), 999px for pills, chips and edge labels; 3–6px only on small pieces (timeline track, `kbd`, `pre` blocks). Status dots are 6–8px circles. Edges between agents are dotted curves (stroke 1.5, dash 4/5). Icons: 24×24 SVG with a single 1.75 stroke, `currentColor`, shown at 16px.

## Components

### Buttons
Compact and calm; color appears only when the action matters.
- **Shape:** soft corners (8px), 1px border.
- **Default:** surface with border; hover rises to raised surface and firm border. 0.15s transition on background, border and color.
- **Primary:** solid terracotta with clay ink, weight 600; hover to lit terracotta.
- **Ghost:** transparent, muted text; hover takes surface and border.
- **Danger:** red text and translucent red border on transparent; hover with red veil. **danger-text** variant (Detener todos): muted until hover or "armed" (two-step confirmation).
- **Icon button:** 6px padding.
- **Focus:** 2px terracotta outline, 2px offset. Disabled: 0.45 opacity.

### Chips (status pills)
- **Style:** 13px serif small caps, 999px pill, 1px border; working (green, with a leading dot), waiting (terracotta), error (red), disconnected (dotted border, faint ink).
- **"Local" chip:** 11.5px mono on green veil.

### Cards / Containers
The terminal card is the signature piece (see below). Secondary containers (counters, drawer facts, messages) use surface, 1px border and 8–10px radius, without shadow.

### Inputs / Fields
- **Style:** well with 1px border, 8px radius, 7px 10px padding.
- **Focus:** the border turns firm and, with the keyboard, a 2px terracotta outline.
- **Error:** failure-red text below the form.

### Navigation
Sidebar with small-caps brand ("Centinela // panel" with a terracotta dot), small-caps section header and 13.5px items with an icon. Active: terracotta text on raised surface with firm border. Footer with connection status in mono inside a well (green "En vivo" dot, red if it drops). Project tabs in 14px serif with a status dot; the selected one rises to raised surface.

### Agent card (signature)
A complete 340px terminal: header (icon in a 30px box colored by state, name in small caps, type in 12px sans, status pill), "now" line in mono, sunken terminal block with ✓ / ✗ / spinner marks per action and tabular time, agent's last message (3 lines), permission slot and mono footer with actions, cost and time. While waiting, the border, halo and permission slot (6% terracotta background) make it the only warm thing on screen; the Permitir / Permitir en la sesión / Rechazar buttons live inside the card. Finished or disconnected, the background drops to near-black and the "now" line disappears.

### Command bar (signature)
Floating, centered at the bottom, 14px radius, firm border and floating shadow. One row: recipient, field that grows with its content, `⌘↩` shortcut in `kbd`, Enviar (icon-only primary) and Detener todos (danger-text).

### Motion
Card relayout (transform 0.24s, `cubic-bezier(0.2, 0.8, 0.2, 1)`), dashes flowing on the edges of working agents (1.1s linear), spinner on actions in progress (1s). Everything turns off with `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** reserve terracotta for the primary action and the waiting agent (The Who's-Waiting Rule).
- **Do** repeat each state in dot, pill, border and icon, with green / terracotta / red and nothing else.
- **Do** use serif small caps for names and labels, mono with `tabular-nums` for output and figures, system sans for the interface.
- **Do** build depth with tonal layers and 1px borders; shadow only on the command bar and the waiting card.
- **Do** draw new icons as single-stroke SVG (24×24, stroke 1.75, `currentColor`) in `icons.js`.
- **Do** turn off all animation under `prefers-reduced-motion`.

### Don't:
- **Don't** add web fonts, CDNs or external resources: they break the `default-src 'self'` CSP and offline use.
- **Don't** add a light theme: the product lives next to a dark editor.
- **Don't** use colored shadows or raise cards on hover or selection.
- **Don't** turn agents into graph nodes with a separate details panel; each agent reads completely on its card.
- **Don't** show metrics Centinela does not measure (quotas, latencies, branches per agent).
