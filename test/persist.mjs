// Persistence test: a session's history must survive an agent restart.
// Process 1 creates a session, runs a turn (history stored), exits.
// Process 2 (same CURTIS_SESSION_DIR) must session/load that id — replaying
// the transcript — and continue the conversation with history attached.
// Runs in mock mode — no API keys needed.
//
// Usage: npm run build && npm run test:persist

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SESSION_DIR = mkdtempSync(join(tmpdir(), "curtis-persist-test-"));
const fail = (msg) => {
	console.error(`PERSIST FAIL: ${msg}`);
	rmSync(SESSION_DIR, { recursive: true, force: true });
	process.exit(1);
};

/** One agent process; returns { send, updates, waitExit } over stdio ACP. */
function agent() {
	const child = spawn(process.execPath, ["dist/index.js"], {
		env: {
			...process.env,
			CURTIS_MOCK: "1",
			CURTIS_SESSION_DIR: SESSION_DIR,
			CURTIS_ARENA: "ollama:mock-a",
		},
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
	return {
		updates,
		send(method, params) {
			return new Promise((resolve, reject) => {
				const id = nextId++;
				pending.set(id, { resolve, reject });
				child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
			});
		},
		stop() {
			child.stdin.end();
			return new Promise((r) => child.on("exit", r));
		},
	};
}

try {
	// --- process 1: create + converse ---
	const a = agent();
	await a.send("initialize", { protocolVersion: 1, clientCapabilities: {} });
	const s1 = await a.send("session/new", { cwd: process.cwd(), mcpServers: [] });
	const r1 = await a.send("session/prompt", {
		sessionId: s1.sessionId,
		prompt: [{ type: "text", text: "first turn" }],
	});
	if (r1.stopReason !== "end_turn") fail(`process 1 turn: ${r1.stopReason}`);
	await a.stop(); // hard exit — the only durable state is what hit disk

	// --- process 2: resume by id ---
	const b = agent();
	await b.send("initialize", { protocolVersion: 1, clientCapabilities: {} });
	await b.send("session/load", { sessionId: s1.sessionId, cwd: process.cwd(), mcpServers: [] });
	const replayed = b.updates
		.filter((u) => u.sessionId === s1.sessionId)
		.map((u) => u.update?.sessionUpdate);
	const userChunks = replayed.filter((k) => k === "user_message_chunk").length;
	const agentChunks = replayed.filter((k) => k === "agent_message_chunk").length;
	if (userChunks < 1 || agentChunks < 1) {
		fail(`replay incomplete — user:${userChunks} agent:${agentChunks}`);
	}
	console.log("session/load ok — transcript replayed after restart");

	// Follow-up must ride the restored transcript (mock echoes prior-msg count).
	await b.send("session/prompt", {
		sessionId: s1.sessionId,
		prompt: [{ type: "text", text: "follow-up" }],
	});
	const body = b.updates
		.filter((u) => u.sessionId === s1.sessionId && u.update?.sessionUpdate === "agent_message_chunk")
		.map((u) => u.update.content.text)
		.join("");
	if (!body.includes("(prior msgs: 2)")) {
		fail(`history not restored — mock saw: ${body.slice(-40)}`);
	}
	console.log("follow-up ok — restored transcript grounded the turn (prior msgs: 2)");

	// --- and a brand-new session must not collide with the persisted id ---
	const s2 = await b.send("session/new", { cwd: process.cwd(), mcpServers: [] });
	if (s2.sessionId === s1.sessionId) fail("new session collided with persisted id");
	console.log(`id collision ok — new session ${s2.sessionId} skipped persisted ${s1.sessionId}`);

	rmSync(SESSION_DIR, { recursive: true, force: true });
	console.log("\nPASS — curtis-acp: sessions survive restart (replay, grounded follow-up, no id collision).");
	process.exit(0);
} catch (e) {
	fail(e.message);
}
