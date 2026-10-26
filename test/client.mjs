// Protocol self-test: spawns the agent over stdio and speaks raw ACP
// (JSON-RPC 2.0 / ndjson) to it. Covers: initialize (incl. authMethods),
// session/new (modes + model picker + commands advertised), arena with a
// failing column, /models, /promote (arena winner → single mode),
// multi-turn history, /clear, native mode/model switch with live streaming,
// mid-turn cancel, session revival after cancel, session/load replay, and
// cancel-during-arena composing partial results.
// Runs in mock mode — no API keys needed.
//
// Usage: npm run build && npm run test:mock

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Sessions persist to disk now — point the suite at a throwaway dir so tests
// never read or write the user's real ~/.curtis-acp state.
const SESSION_DIR = mkdtempSync(join(tmpdir(), "curtis-test-sessions-"));

const child = spawn(process.execPath, ["dist/index.js"], {
	env: {
		...process.env,
		CURTIS_MOCK: "1",
		CURTIS_MOCK_DELAY: "60",
		CURTIS_TIMEOUT_MS: "10000",
		CURTIS_SESSION_DIR: SESSION_DIR,
		// keyless local providers double as mock duelists; "fail" triggers the
		// deterministic mock failure so the arena error path gets exercised
		CURTIS_ARENA: "ollama:mock-a,lmstudio:mock-b-fail",
	},
	stdio: ["pipe", "pipe", "inherit"],
});

let nextId = 1;
const pending = new Map();
const updates = [];

function send(method, params) {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
	});
}

function notify(method, params) {
	child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

child.stdout.on("data", (d) => {
	let buffer = (child._buf ?? "") + d.toString();
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
	child._buf = buffer;
});

const fail = (msg) => {
	console.error(`FAIL: ${msg}`);
	child.kill();
	process.exit(1);
};
const textOf = (filter) =>
	updates.filter(filter).map((u) => u.update.content?.text ?? "").join("");
const messageText = () => textOf((u) => u.update?.sessionUpdate === "agent_message_chunk");
const clearUpdates = () => { updates.length = 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const timeout = setTimeout(() => fail("timed out after 60s"), 60000);

try {
	// --- initialize + session setup ------------------------------------------
	const init = await send("initialize", {
		protocolVersion: 1,
		clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
	});
	if (!init.protocolVersion) fail("initialize returned no protocolVersion");
	if (!init.authMethods?.length) fail("initialize advertised no authMethods (registry prerequisite)");
	console.log(`initialize ok (protocol ${init.protocolVersion}, ${init.authMethods.length} auth method(s))`);

	const session = await send("session/new", { cwd: process.cwd(), mcpServers: [] });
	const sid = session.sessionId;
	if (!sid) fail("session/new returned no sessionId");
	if (session.modes?.availableModes?.length !== 2) fail(`expected 2 modes, got ${JSON.stringify(session.modes)}`);
	if (session.models?.availableModels?.length !== 2) fail("expected 2 models in the session model picker");
	const commands = updates.find((u) => u.update?.sessionUpdate === "available_commands_update");
	if (!commands?.update.availableCommands.some((c) => c.name === "promote")) fail("/promote not advertised");
	console.log(`session ok — modes: ${session.modes.availableModes.map((m) => m.id).join("/")} · models: ${session.models.availableModels.map((m) => m.modelId).join(", ")}`);

	// --- arena turn with a failing column ------------------------------------
	clearUpdates();
	const r1 = await send("session/prompt", {
		sessionId: sid,
		prompt: [{ type: "text", text: "Compare side-by-side testing vs leaderboards" }],
	});
	if (r1.stopReason !== "end_turn") fail(`arena stopReason was ${r1.stopReason}`);
	const arenaText = messageText();
	const chunks = updates.filter((u) => u.update?.sessionUpdate === "agent_message_chunk").length;
	const thought = updates.filter((u) => u.update?.sessionUpdate === "agent_thought_chunk").length;
	if (arenaText.length < 100) fail(`only ${arenaText.length} chars composed`);
	if (!/\|\s*Model\s*\|/.test(arenaText)) fail("arena results table missing");
	if (!arenaText.includes("failed")) fail("failure column not surfaced in the arena");
	if (!arenaText.includes("simulated provider failure")) fail("failure detail missing");
	if (!arenaText.includes(" tok")) fail("tokens column missing — usage not rendered in the Size cell");
	if (thought === 0) fail("no arena progress thought-chunks");
	console.log(`arena ok — ${chunks} message chunks, ${thought} progress lines, failure column surfaced`);

	// --- /models ---------------------------------------------------------------
	clearUpdates();
	const r2 = await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "/models" }] });
	if (r2.stopReason !== "end_turn" || !messageText().includes("Configured models")) fail("/models turn misbehaved");
	console.log("/models ok");

	// --- /promote: ranking, promotion to single mode, history follow-up -------
	clearUpdates();
	await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "/promote" }] });
	if (!messageText().includes("Last arena ranking")) fail("/promote without args did not list the ranking");
	if (!messageText().includes("mock-a")) fail("ranking missing the successful column");

	await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "/promote 1" }] });
	if (!messageText().includes("Promoted")) fail("/promote 1 did not confirm the promotion");
	const modeUpdate = updates.find(
		(u) => u.update?.sessionUpdate === "current_mode_update" && u.update.currentModeId === "single",
	);
	if (!modeUpdate) fail("promotion did not push current_mode_update=single");

	clearUpdates();
	const r3 = await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "hello" }] });
	const afterPromote = messageText();
	if (r3.stopReason !== "end_turn") fail(`post-promote stopReason was ${r3.stopReason}`);
	if (!afterPromote.startsWith("[Ollama (Local) · mock-a]")) fail("post-promote turn did not use the promoted column");
	if (!afterPromote.includes("(prior msgs: 2)")) fail("arena result not carried into follow-up history");
	console.log("promote ok — winner promoted to single mode, follow-up saw the arena transcript");

	await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "/promote 99" }] });
	if (!messageText().includes("needs a number between")) fail("/promote 99 was not rejected gracefully");
	console.log("promote bounds ok");

	// --- /clear resets history --------------------------------------------------
	clearUpdates();
	await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "/clear" }] });
	if (!messageText().includes("cleared")) fail("/clear did not confirm");
	clearUpdates();
	await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "hello again" }] });
	if (messageText().includes("prior msgs")) fail("history survived /clear");
	console.log("/clear ok");

	// --- native mode + model switch, then single streaming --------------------
	await send("session/set_mode", { sessionId: sid, modeId: "single" });
	await send("session/set_model", { sessionId: sid, modelId: "ollama:mock-a" });
	clearUpdates();
	const r4 = await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "hello there" }] });
	const singleChunks = updates.filter((u) => u.update?.sessionUpdate === "agent_message_chunk").length;
	if (r4.stopReason !== "end_turn") fail(`single stopReason was ${r4.stopReason}`);
	if (singleChunks < 5) fail(`single mode streamed only ${singleChunks} chunks — expected live word-by-word`);
	console.log(`mode/model switch ok — single streamed ${singleChunks} live chunks`);

	// --- mid-turn cancel (single) ----------------------------------------------
	clearUpdates();
	const cancelPromise = send("session/prompt", {
		sessionId: sid,
		prompt: [{ type: "text", text: "/single write something long" }],
	});
	await sleep(250);
	notify("session/cancel", { sessionId: sid });
	const r5 = await cancelPromise;
	if (r5.stopReason !== "cancelled") fail(`cancel stopReason was ${r5.stopReason}, expected cancelled`);
	console.log("cancel ok — mid-turn session/cancel returned stopReason=cancelled");

	// --- session/load: replay transcript; unknown id errors ---------------------
	clearUpdates();
	const beforeLoad = updates.length;
	const loaded = await send("session/load", { sessionId: sid, cwd: process.cwd(), mcpServers: [] });
	if (!loaded.modes?.availableModes?.length) fail("session/load returned no mode state");
	const replayUser = updates
		.slice(beforeLoad)
		.filter((u) => u.update?.sessionUpdate === "user_message_chunk").length;
	const replayAgent = updates
		.slice(beforeLoad)
		.filter((u) => u.update?.sessionUpdate === "agent_message_chunk").length;
	if (replayUser < 1 || replayAgent < 1) fail(`session/load replayed ${replayUser} user / ${replayAgent} agent chunks`);
	let loadErrored = false;
	try {
		await send("session/load", { sessionId: "curtis-404", cwd: process.cwd(), mcpServers: [] });
	} catch {
		loadErrored = true;
	}
	if (!loadErrored) fail("session/load with unknown sessionId should error");
	console.log(`session/load ok — transcript replayed (${replayUser} user + ${replayAgent} agent), unknown id rejected`);

	// --- cancel during arena composes the partial results table ----------------
	clearUpdates();
	const arenaCancelPromise = send("session/prompt", {
		sessionId: sid,
		prompt: [{ type: "text", text: "/arena write something long" }],
	});
	await sleep(300);
	notify("session/cancel", { sessionId: sid });
	const r6 = await arenaCancelPromise;
	if (r6.stopReason !== "cancelled") fail(`arena cancel stopReason was ${r6.stopReason}`);
	const partial = messageText();
	if (!/\|\s*Model\s*\|/.test(partial)) fail("cancelled arena dropped the partial results table");
	if (!partial.includes("cancelled")) fail("cancelled columns not marked in the partial table");
	console.log("arena cancel ok — partial table composed, cancelled columns marked");

	// --- session revival after cancel -------------------------------------------
	clearUpdates();
	const r7 = await send("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "/models" }] });
	if (r7.stopReason !== "end_turn" || !messageText().includes("Configured models")) {
		fail("session unusable after cancel — abort controller not revived");
	}
	console.log("revival ok — session accepts prompts again after cancel");

	clearTimeout(timeout);
	child.kill();

	// --- single-mode wall-clock budget (separate agent, tiny timeout) ----------
	await timeoutBudgetTest();

	console.log("\nPASS — curtis-acp: handshake + auth, arena compose + failure columns, promote, history, clear, mode/model switch, streaming, cancel + partial arena, session/load, revival, single-mode timeout.");
	process.exit(0);
} catch (e) {
	fail(e.message);
}

// A hung provider must not stall a single-mode turn forever: with a 40ms
// budget against a 500ms mock, the turn ends end_turn with a truncation note.
async function timeoutBudgetTest() {
	const slow = spawn(process.execPath, ["dist/index.js"], {
		env: {
			...process.env,
			CURTIS_MOCK: "1",
			CURTIS_MOCK_DELAY: "500",
			CURTIS_TIMEOUT_MS: "40",
			CURTIS_SESSION_DIR: SESSION_DIR,
			CURTIS_ARENA: "ollama:mock-a",
		},
		stdio: ["pipe", "pipe", "inherit"],
	});
	try {
		const tid = { n: 1 };
		const pending = new Map();
		const chunks = [];
		slow.stdout.on("data", (d) => {
			let buffer = (slow._buf ?? "") + d.toString();
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
				} else if (msg.method === "session/update" && msg.params.update?.sessionUpdate === "agent_message_chunk") {
					chunks.push(msg.params.update.content?.text ?? "");
				}
			}
			slow._buf = buffer;
		});
		const call = (method, params) =>
			new Promise((resolve, reject) => {
				const id = tid.n++;
				pending.set(id, { resolve, reject });
				slow.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
			});

		await call("initialize", { protocolVersion: 1, clientCapabilities: {} });
		const s = await call("session/new", { cwd: process.cwd(), mcpServers: [] });
		await call("session/set_mode", { sessionId: s.sessionId, modeId: "single" });
		const r = await call("session/prompt", {
			sessionId: s.sessionId,
			prompt: [{ type: "text", text: "write something long" }],
		});
		const text = chunks.join("");
		if (r.stopReason !== "end_turn") fail(`timeout turn stopReason was ${r.stopReason}`);
		if (!text.includes("timed out after")) fail("single-mode timeout produced no truncation note");
		if (!text.includes("mock-a")) fail("timeout turn streamed nothing before the budget hit");
		console.log("timeout ok — single-mode turn truncated by its wall-clock budget with a visible note");
	} finally {
		slow.kill();
	}
}
