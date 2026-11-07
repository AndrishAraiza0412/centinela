# Product

## Platform

web

## Users

A single person: the developer who owns the Mac, with several Claude Code sessions open at once (in terminals and launched from the dashboard itself). They keep Centinela open in a tab or on a second monitor while working, and go to it to see what is happening, approve permissions and give orders to agents.

## Product Purpose

Centinela shows live what each Claude Code session and subagent is doing and who delegated what to whom, and lets you launch agents by role, talk to them, stop them and approve their permissions without switching terminals. Success: at a glance you know **who is doing what and who is waiting** (for a permission or a response), and you act within seconds.

## Positioning

It observes the user's real Claude Code sessions (through hooks) and controls agents launched with their own subscription through the `claude` CLI, without API keys or external services; everything is local and every permission of a launched agent goes through the dashboard with its full input in view.

## Operating Context

- Local Node server on `127.0.0.1:4317`; the page opens with a single-use pairing code printed by `node bin/centinela.js`.
- Events: Claude Code `http` hooks (terminal sessions) and `stream-json` from launched `claude -p` processes.
- Used alongside work: the dashboard is checked now and then and demands attention only when an agent is waiting for a permission (card and browser notification).

## Capabilities and Constraints

- See sessions, subagents and delegations (an edge with the start of the delegated prompt), actions per agent with their result, conversation of launched agents, output and stderr on exit.
- Launch agents by role (the user's `agents/*.md` or the project's `.claude/agents/*.md`), send them prompts, stop them, "Continuar aquí" (Continue here) on a terminal session (`--resume`).
- Approve permissions: Allow / Allow this same action for the session / Reject; with no answer in 5 minutes or with the server off, it is rejected. All Bash from a launched agent goes through the dashboard.
- Data available per launched agent: estimated cost and tokens reported by `claude -p` (on a subscription this is an estimate, not a charge).
- Constraints: local only; Node ≥ 22 with no npm dependencies; no `innerHTML`; event text through `textContent`; strict CSP; interface in Spanish.
- Does not exist (do not invent): API quotas, TPM/latencies of a "cluster", branches/commits per agent, goal boards, browser preview, voice, pausing agents (only stopping).

## Evidence on Hand

- The user's reference design ("Agent Swarm Board", 2026-10-22); its data is sample data, not from the product.
- Real event fixtures in `test/fixtures/`.

## Product Principles

1. Who is waiting comes first: a pending permission can never go unnoticed.
2. What you see is what runs: nothing truncated or misleading in what gets approved.
3. Real data only: if Centinela does not measure it, it does not appear.
4. Secure by default: security and permission controls are not relaxed by design.
