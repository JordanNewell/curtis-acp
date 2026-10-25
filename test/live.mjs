// Live smoke test — exercises the REAL provider path (no mocks) with a
// minimal single-model turn, or a real 2+ column arena when given a
// comma-separated model list. Needs providers reachable (keys in env, or
// Ollama/LM Studio on localhost). Prints counts and latency only, never key
// material.
//
// Usage: node test/live.mjs "provider:model[,provider:model…]"
//   single:  node test/live.mjs ollama:llama3.2:3b
//   arena:   node test/live.mjs "ollama:qwen2.5:7b-instruct,ollama:llama3.2:3b"

import { spawn } from "node:child_process";

const ref = process.argv[2] ?? "ollama:llama3.2:3b";
const arena = ref.includes(",");

const child = spawn(process.execPath, ["dist/index.js"], {
	env: { ...process.env, CURTIS_ARENA: ref },
	stdio: ["pipe", "pipe", "inherit"],
});

let nextId = 1;
const pending = new Map();
const updates = [];
let buffer = "";

child.stdout.on("data", (d) => {
	buffer += d.toString();
	let idx;
	while ((idx = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, idx);
		buffer = buffer.slice(idx + 1);
		if (!line.trim()) continue;
		const msg = JSON.parse(line);
		if (msg.id !== undefined && pending.has(msg.id)) {
			const p = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
		} else if (msg.method === "session/update") {
			updates.push(msg.params);
		}
	}
});

const fail = (msg) => {
	console.error(`LIVE FAIL: ${msg}`);
	child.kill();
	process.exit(1);
};
// Local models can take tens of seconds to load + infer on CPU — override
// with LIVE_TIMEOUT_MS if your hardware needs more.
const timeout = setTimeout(() => fail("timed out"), Number(process.env.LIVE_TIMEOUT_MS) || 180_000);

try {
	await send("initialize", { protocolVersion: 1, clientCapabilities: {} });
	const session = await send("session/new", { cwd: process.cwd(), mcpServers: [] });
	if (!arena) await send("session/set_mode", { sessionId: session.sessionId, modeId: "single" });

	const started = Date.now();
	const r = await send("session/prompt", {
		sessionId: session.sessionId,
		prompt: [{ type: "text", text: "Reply with exactly: live smoke ok" }],
	});
	if (r.stopReason !== "end_turn") fail(`stopReason ${r.stopReason}`);

	const chunks = updates.filter((u) => u.update?.sessionUpdate === "agent_message_chunk");
	const text = chunks.map((u) => u.update.content.text).join("");
	if (arena) {
		if (!/\|\s*Model\s*\|/.test(text)) fail(`arena table missing. Body: ${text.slice(0, 300)}`);
		const rows = (text.match(/^\| /gm) ?? []).length - 1; // minus header row
		console.log(`LIVE PASS — arena ${ref}: ${rows} columns composed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
	} else {
		if (chunks.length < 2) fail(`not streamed as chunks (${chunks.length} chunk(s)). Body: ${text.slice(0, 300)}`);
		console.log(`LIVE PASS — ${ref}: ${chunks.length} chunks, ${Date.now() - started}ms total, reply: "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`);
	}

	clearTimeout(timeout);
	child.kill();
	process.exit(0);
} catch (e) {
	fail(e.message);
}

function send(method, params) {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
	});
}
