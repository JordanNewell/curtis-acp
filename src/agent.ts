// Curtis as an ACP agent — the glue between Zed's Agent Panel and the
// polyglot providers/arena. Protocol surface: initialize / session:new /
// session:load / session:prompt / session:cancel, with live streaming via
// agent_message_chunk, arena progress via agent_thought_chunk, per-session
// conversation history, and native panel controls via session modes
// (Arena / Single) and the session model picker.

import type { Agent, AgentSideConnection } from "@zed-industries/agent-client-protocol";
import type {
	AuthenticateRequest,
	CancelNotification,
	InitializeRequest,
	InitializeResponse,
	LoadSessionRequest,
	LoadSessionResponse,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	SetSessionModelRequest,
	SetSessionModeRequest,
} from "@zed-industries/agent-client-protocol";
import { runTurn, rankArena } from "./arena.js";
import type { ColumnResult, TurnMode } from "./arena.js";
import { availableModels } from "./config.js";
import type { ChatMessage } from "./chat.js";
import { loadSession as loadPersistedSession, persistedSessionIds, saveSession } from "./persist.js";

// Follow-up context window: last N messages (kept in user/assistant pairs so
// the transcript never dangles).
const MAX_HISTORY_MESSAGES = 16;
const MAX_STORED_USER_CHARS = 4_000;
const MAX_STORED_ASSISTANT_CHARS = 6_000;

interface Session {
	/** Fresh controller per turn — cancel() spends the old one. */
	abort: AbortController;
	mode: TurnMode;
	/** Panel-selected model ("provider:model") — drives single mode. */
	modelId?: string;
	/** Conversation transcript (user + assistant pairs), oldest first. */
	history: ChatMessage[];
	/** Ranked columns from the last completed arena — feeds /promote. */
	lastArena: ColumnResult[];
}

export class CurtisAgent implements Agent {
	private conn: AgentSideConnection;
	private sessions = new Map<string, Session>();
	private nextId = 0;

	constructor(conn: AgentSideConnection) {
		this.conn = conn;
	}

	async initialize(params: InitializeRequest): Promise<InitializeResponse> {
		return {
			protocolVersion: params.protocolVersion,
			agentCapabilities: { loadSession: true },
			// Keys arrive via env vars — declared so clients (and the ACP
			// Registry's auth check) have something valid to show; nothing to
			// interactively authenticate, so authenticate() stays a no-op.
			authMethods: [
				{
					id: "env-keys",
					name: "Environment API keys",
					description:
						"Set <PROVIDER>_API_KEY (e.g. OPENROUTER_API_KEY) in the agent's env; Ollama and LM Studio need no key.",
				},
			],
		};
	}

	// Nothing to do — keys come from the environment (see authMethods above).
	async authenticate(_params: AuthenticateRequest): Promise<void> {}

	async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
		// Skip ids a previous process already persisted — the client remembers
		// those threads, so a collision would hand two ids one history.
		const taken = persistedSessionIds();
		let n = ++this.nextId;
		while (taken.has(`curtis-${n}`)) n = ++this.nextId;
		const sessionId = `curtis-${n}`;
		const session: Session = {
			abort: new AbortController(),
			mode: "arena",
			history: [],
			lastArena: [],
		};
		this.sessions.set(sessionId, session);

		const models = availableModels();
		const first = models[0];
		if (first) session.modelId = `${first.providerId}:${first.modelId}`;

		await this.advertiseCommands(sessionId);

		return { sessionId, ...this.sessionState(session) };
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		let session = this.sessions.get(params.sessionId);
		if (!session) {
			// Not from this process lifetime — hydrate from disk so threads
			// survive agent restarts.
			const saved = loadPersistedSession(params.sessionId);
			if (!saved) throw new Error(`unknown session: ${params.sessionId}`);
			session = {
				abort: new AbortController(),
				mode: saved.mode,
				modelId: saved.modelId,
				history: saved.history,
				lastArena: saved.lastArena as ColumnResult[],
			};
			this.sessions.set(params.sessionId, session);
		}

		await this.advertiseCommands(params.sessionId);
		// Replay the transcript so the client rebuilds the thread it remembers.
		for (const message of session.history) {
			await this.conn.sessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: message.role === "user" ? "user_message_chunk" : "agent_message_chunk",
					content: { type: "text", text: message.content },
				},
			});
		}
		await this.conn.sessionUpdate({
			sessionId: params.sessionId,
			update: { sessionUpdate: "current_mode_update", currentModeId: session.mode },
		});
		return this.sessionState(session);
	}

	private sessionState(session: Session) {
		const models = availableModels();
		return {
			modes: {
				currentModeId: session.mode,
				availableModes: [
					{ id: "arena", name: "Arena", description: "Every configured model answers the same prompt" },
					{ id: "single", name: "Single", description: "One live-streamed answer from the selected model" },
				],
			},
			models: models.length
				? {
						currentModelId: session.modelId ?? `${models[0].providerId}:${models[0].modelId}`,
						availableModels: models.map((m) => ({
							modelId: `${m.providerId}:${m.modelId}`,
							name: `${m.providerLabel} · ${m.modelId}`,
						})),
					}
				: undefined,
		};
	}

	private async advertiseCommands(sessionId: string): Promise<void> {
		try {
			await this.conn.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "available_commands_update",
					availableCommands: [
						{ name: "arena", description: "Fan the prompt out to every configured model and compare" },
						{ name: "single", description: "Stream one answer from the selected model (no comparison)" },
						{ name: "promote", description: "Promote an arena column to the single-mode model: /promote <n>" },
						{ name: "models", description: "List configured providers and models" },
						{ name: "clear", description: "Clear this session's conversation history" },
					],
				},
			});
		} catch {
			// command advertisement is cosmetic — never fail session setup on it
		}
	}

	/** State changed — best-effort write-through so a restarted process can
	 *  resume the thread (disk errors only warn; the agent keeps serving). */
	private persist(sessionId: string, session: Session): void {
		saveSession(sessionId, {
			mode: session.mode,
			modelId: session.modelId,
			history: session.history,
			lastArena: session.lastArena,
		});
	}

	async setSessionMode(params: SetSessionModeRequest): Promise<void> {
		const session = this.sessions.get(params.sessionId);
		if (session && (params.modeId === "arena" || params.modeId === "single")) {
			session.mode = params.modeId;
			this.persist(params.sessionId, session);
		}
	}

	async setSessionModel(params: SetSessionModelRequest): Promise<void> {
		const session = this.sessions.get(params.sessionId);
		if (session) {
			session.modelId = params.modelId;
			this.persist(params.sessionId, session);
		}
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const sessionId = params.sessionId;
		const session = this.sessions.get(sessionId);
		if (!session) return { stopReason: "refusal" };

		// A cancelled turn spends the controller; revive it so the session
		// keeps working after a cancel.
		if (session.abort.signal.aborted) session.abort = new AbortController();
		const signal = session.abort.signal;

		const text = params.prompt
			.map((block) => (block.type === "text" ? block.text : ""))
			.join("\n")
			.trim();
		if (!text) return { stopReason: "end_turn" };

		const lower = text.toLowerCase();
		if (lower === "/clear") {
			session.history = [];
			this.persist(sessionId, session);
			await this.finish(sessionId, "Conversation history cleared — the next prompt starts fresh.");
			return { stopReason: "end_turn" };
		}
		if (lower === "/promote" || lower.startsWith("/promote ")) {
			await this.finish(sessionId, promoteMessage(text, session));
			this.persist(sessionId, session);
			if (session.mode === "single" && session.modelId) {
				// keep the client's mode switcher in sync with the promotion
				await this.conn.sessionUpdate({
					sessionId,
					update: { sessionUpdate: "current_mode_update", currentModeId: "single" },
				});
			}
			return { stopReason: "end_turn" };
		}

		let streamed = false;
		// Track the trailing write so the composed final message is guaranteed
		// flushed before the prompt response lands (matters when cancelling an
		// arena: the partial results table must beat the turn-end).
		let lastWrite: Promise<unknown> = Promise.resolve();
		try {
			const result = await runTurn(
				text,
				{ mode: session.mode, modelOverride: session.modelId, history: [...session.history] },
				(event) => {
					if (event.kind === "chunk") streamed = true;
					const body = event.kind === "done" ? (streamed ? "" : event.markdown) : event.text;
					if (!body) return;
					const content = { type: "text" as const, text: body };
					const update =
						event.kind === "thought"
							? { sessionUpdate: "agent_thought_chunk" as const, content }
							: { sessionUpdate: "agent_message_chunk" as const, content };
					lastWrite = this.conn
						.sessionUpdate({ sessionId, update })
						.catch(() => {});
				},
				signal,
			);
			await lastWrite;

			if (result.store) {
				session.history.push(
					{ role: "user", content: cap(result.store.user, MAX_STORED_USER_CHARS) },
					{ role: "assistant", content: cap(result.store.assistant, MAX_STORED_ASSISTANT_CHARS) },
				);
				while (session.history.length > MAX_HISTORY_MESSAGES) session.history.splice(0, 2);
			}
			if (result.arenaRanked) session.lastArena = result.arenaRanked;
			this.persist(sessionId, session);
		} catch (e) {
			await lastWrite;
			const detail = e instanceof Error ? e.message : String(e);
			if (!signal.aborted) {
				await this.finish(sessionId, `Curtis hit an error: ${detail}`);
			}
		}
		return { stopReason: signal.aborted ? "cancelled" : "end_turn" };
	}

	private async finish(sessionId: string, markdown: string): Promise<void> {
		await this.conn.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: markdown },
			},
		});
	}

	async cancel(params: CancelNotification): Promise<void> {
		this.sessions.get(params.sessionId)?.abort.abort();
	}
}

function cap(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function promoteMessage(text: string, session: Session): string {
	const ranked = rankArena(session.lastArena);
	if (ranked.length === 0) {
		return "No arena results yet — run `/arena <prompt>` first, then `/promote <n>` to make the winning column your single-mode model.";
	}
	if (text.trim().toLowerCase() === "/promote") {
		const lines = ranked.map((r, i) => {
			const stat = r.ok ? `${fmtMs(r.firstTokenMs)} to first token` : (r.error ?? "failed");
			return `${i + 1}. **${r.ref.providerLabel}** \`${r.ref.modelId}\` — ${stat}`;
		});
		return `**Last arena ranking** — \`/promote <n>\` makes that column the single-mode model:\n\n${lines.join("\n")}`;
	}
	const n = Number.parseInt(text.slice("/promote ".length).trim(), 10);
	if (!Number.isInteger(n) || n < 1 || n > ranked.length) {
		return `\`/promote <n>\` needs a number between 1 and ${ranked.length} — \`/promote\` alone lists the ranking.`;
	}
	const pick = ranked[n - 1];
	if (!pick.ok) {
		return `Column ${n} (${pick.ref.providerLabel} \`${pick.ref.modelId}\`) failed (${pick.error}) — promote one of the successful columns.`;
	}
	session.modelId = `${pick.ref.providerId}:${pick.ref.modelId}`;
	session.mode = "single";
	return `Promoted **${pick.ref.providerLabel}** \`${pick.ref.modelId}\` — follow-ups stream from it in Single mode.`;
}

function fmtMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
