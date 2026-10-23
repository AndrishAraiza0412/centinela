#!/usr/bin/env node
// Imita `claude -p --input-format stream-json --output-format stream-json` para los tests.
import { createInterface } from 'node:readline';

// `node --test` también recoge este archivo: fuera del lanzador no hace nada.
if (!process.env.CENTINELA_AGENT_KEY) process.exit(0);

const sessionId = `fake-${process.pid}`;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

out({ type: 'system', subtype: 'init', session_id: sessionId, cwd: process.cwd(), permissionMode: process.env.FAKE_PERMISSION_MODE ?? 'default', argv: process.argv.slice(2), agentKey: process.env.CENTINELA_AGENT_KEY });
process.stderr.write('fake-claude: listo\n');

for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: msg.message.content }] }, parent_tool_use_id: null, session_id: sessionId });
}
out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: sessionId });
