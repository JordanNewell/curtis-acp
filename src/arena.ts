// Turn logic: single-model live streaming, or the arena — one prompt fanned
// out to every configured model concurrently, composed into a comparison.
//
// ACP streams one linear message, so the arena emits progress through
// thought-chunks while columns generate, then delivers the composed markdown
// (results table + full responses, fastest first) as the message body.

import { availableModels, defaultSingle, mockMode, parseModelRef } from "./config.js";
import type { ModelRef } from "./config.js";
import { streamChat } from "./chat.js";
import type { ChatMessage, StreamResult } from "./chat.js";
import type { TokenUsage } from "./types.js";

export type TurnEvent =
	| { kind: "thought"; text: string }
	| { kind: "chunk"; text: string }
	| { kind: "done"; markdown: string };

export type TurnMode = "arena" | "single";

export interface TurnOptions {
	mode: TurnMode;
	/** Panel-selected model ("provider:model"), used by single mode. */
	modelOverride?: string;
	/** Prior conversation turns (user + assistant), oldest first. */
	history?: ChatMessage[];
}

/** What a finished turn contributes back to session state. */
export interface TurnResult {
	/** Completed transcript pair to append to session history. */
	store?: { user: string; assistant: string };
	/** Arena columns ranked (ok first, then fastest first token) — enables /promote. */
	arenaRanked?: ColumnResult[];
}

export interface ColumnResult {
	ref: ModelRef;
	ok: boolean;
	text: string;
	firstTokenMs: number;
	totalMs: number;
	error?: string;
	/** Provider-reported token usage + seed-price estimate, when available. */
	usage?: TokenUsage;
	costUsd?: number | null;
}

const SYSTEM: ChatMessage = {
	role: "system",
	content:
		"You are Curtis, a concise polyglot AI assistant inside a code editor. Answer directly, use markdown, no preamble.",
};

// A hung provider must never stall the whole turn: every request gets its own
// wall-clock budget (arena columns show up as "failed: timeout", single mode
// as a truncation note).
const TURN_TIMEOUT_MS = Number(process.env.CURTIS_TIMEOUT_MS) || 180_000;

// Follow-ups stay grounded in past arena results without ballooning context.
const DIGEST_PER_COLUMN_CHARS = 600;
const DIGEST_MAX_CHARS = 4000;

export function listModels(): string {
	const all = availableModels();
	if (all.length === 0) {
		const hint = mockMode
			? ""
			: "\n\nSet `CURTIS_ARENA=\"openrouter:google/gemini-3.1-flash-lite,deepseek:deepseek-flash\"` and the matching `*_API_KEY` env vars to enable the arena.";
		return "No models configured." + hint;
	}
	const lines = all.map((m, i) => `${i + 1}. **${m.providerLabel}** \`${m.modelId}\``);
	return `Configured models:\n\n${lines.join("\n")}`;
}

/** Arena display order — also the numbering `/promote <n>` uses. */
export function rankArena(results: ColumnResult[]): ColumnResult[] {
	return [...results].sort((a, b) =>
		a.ok && b.ok ? a.firstTokenMs - b.firstTokenMs : a.ok ? -1 : 1,
	);
}

export async function runTurn(
	prompt: string,
	opts: TurnOptions,
	emit: (e: TurnEvent) => void,
	signal: AbortSignal,
): Promise<TurnResult> {
	const trimmed = prompt.trim();
	const lower = trimmed.toLowerCase();

	if (lower === "/models" || lower === "/models?") {
		emit({ kind: "done", markdown: listModels() });
		return {};
	}

	let single = opts.mode === "single";
	let body = trimmed;
	if (lower.startsWith("/arena ")) {
		body = trimmed.slice(7).trim();
		single = false;
	} else if (lower === "/arena") {
		emit({ kind: "done", markdown: listModels() });
		return {};
	} else if (lower.startsWith("/single ") || lower.startsWith("/ask ")) {
		single = true;
		body = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
	}
	if (!body) {
		emit({ kind: "done", markdown: "Nothing to send — add a prompt after the command." });
		return {};
	}

	const models = availableModels();
	if (models.length === 0) {
		emit({ kind: "done", markdown: listModels() });
		return {};
	}

	const messages: ChatMessage[] = [...(opts.history ?? []), { role: "user", content: body }];

	if (single || models.length < 2) {
		const ref =
			(opts.modelOverride && parseModelRef(opts.modelOverride)) || defaultSingle() || models[0];
		emit({ kind: "thought", text: `${ref.providerLabel} · ${ref.modelId}\n` });
		const budget = await withBudget(signal, (budgetSignal) =>
			streamChat(ref, [SYSTEM, ...messages], budgetSignal, (d) =>
				emit({ kind: "chunk", text: d }),
			),
		);
		// A budget timeout gets a visible truncation note; a user cancel and a
		// provider error propagate (the agent stays quiet on cancel, surfaces
		// the error otherwise). Nothing partial is stored.
		if (budget.timedOut && !signal.aborted) {
			emit({
				kind: "chunk",
				text: `\n\n> ⏱ ${ref.providerLabel} timed out after ${fmtMs(TURN_TIMEOUT_MS)} — response truncated.`,
			});
			return {};
		}
		if (budget.cancelled) return {};
		const result = budget.value!;
		emit({ kind: "done", markdown: result.text });
		return signal.aborted ? {} : { store: { user: body, assistant: result.text } };
	}

	return runArena(models, messages, emit, signal);
}

/** Outcome of a budgeted run: the value, or which boundary killed it.
 *  Provider errors propagate as rejections — only cancel/timeout are captured. */
interface Budgeted<T> {
	value?: T;
	timedOut: boolean;
	cancelled: boolean;
}

/**
 * Run the request under the wall-clock budget. The budget signal dies with
 * the turn signal OR its own timeout; a user cancel surfaces as `cancelled`,
 * a timeout as `timedOut`, anything else as a rethrown provider error.
 */
async function withBudget<T>(
	signal: AbortSignal,
	run: (budgetSignal: AbortSignal) => Promise<T>,
): Promise<Budgeted<T>> {
	const budget = new AbortController();
	const onTurnAbort = () => budget.abort();
	if (signal.aborted) budget.abort();
	signal.addEventListener("abort", onTurnAbort, { once: true });
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		budget.abort();
	}, TURN_TIMEOUT_MS);
	try {
		return { value: await run(budget.signal), timedOut: false, cancelled: false };
	} catch (e) {
		if (signal.aborted) return { timedOut, cancelled: true };
		if (timedOut) return { timedOut: true, cancelled: false };
		throw e;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", onTurnAbort);
	}
}

async function runArena(
	models: ModelRef[],
	messages: ChatMessage[],
	emit: (e: TurnEvent) => void,
	signal: AbortSignal,
): Promise<TurnResult> {
	const promptText = messages[messages.length - 1].content;
	emit({
		kind: "thought",
		text: `Arena: fanning out to ${models.length} models — ${models
			.map((m) => `${m.providerLabel}/${m.modelId}`)
			.join(", ")}\n`,
	});

	const results: ColumnResult[] = [];
	const throttle = throttleEmitters(emit);

	await Promise.allSettled(
		models.map(async (ref) => {
			// Per-column abort: dies with the turn (global signal) or its own
			// wall-clock budget, so one hung provider can't stall the arena.
			const columnAbort = new AbortController();
			const onGlobalAbort = () => columnAbort.abort();
			if (signal.aborted) columnAbort.abort();
			signal.addEventListener("abort", onGlobalAbort, { once: true });
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				columnAbort.abort();
			}, TURN_TIMEOUT_MS);

			const label = `${ref.providerLabel} · ${ref.modelId}`;
			let chars = 0;
			const entry: ColumnResult = { ref, ok: false, text: "", firstTokenMs: 0, totalMs: 0 };
			try {
				const res: StreamResult = await streamChat(
					ref,
					[SYSTEM, ...messages],
					columnAbort.signal,
					(d) => {
						chars += d.length;
						throttle.progress(label, chars);
					},
				);
				Object.assign(entry, res, { ok: res.text.trim().length > 0 });
				if (!entry.ok) entry.error = "empty response";
				// The adapter resolves (partial text) on abort instead of throwing,
				// so cancelled/timeout columns are classified here, post-hoc.
				if (columnAbort.signal.aborted) {
					entry.ok = false;
					entry.error = timedOut
						? `timeout after ${fmtMs(TURN_TIMEOUT_MS)}`
						: "cancelled";
				}
				throttle.progress(label, chars, true);
			} catch (e) {
				// Thrown aborts (the mock streamer) classify the same as resolved ones.
				entry.error = columnAbort.signal.aborted
					? timedOut
						? `timeout after ${fmtMs(TURN_TIMEOUT_MS)}`
						: "cancelled"
					: e instanceof Error
						? e.message
						: String(e);
			} finally {
				clearTimeout(timer);
				signal.removeEventListener("abort", onGlobalAbort);
			}
			results.push(entry);
		}),
	);

	const ranked = rankArena(results);

	// Cancel no longer throws the comparison away: whatever finished is
	// composed and delivered; still-running columns show as cancelled.
	emit({ kind: "done", markdown: composeArena(ranked) });

	const user = promptText;
	if (signal.aborted) return {};

	const digest = arenaDigest(user, ranked);
	return { store: { user, assistant: digest }, arenaRanked: ranked };
}

function composeArena(results: ColumnResult[]): string {
	const rows = results
		.map((r) => {
			const name = `**${r.ref.providerLabel}** \`${r.ref.modelId}\``;
			if (!r.ok) {
				const why = r.error === "cancelled" ? "cancelled" : `failed: ${r.error?.slice(0, 60)}`;
				return `| ${name} | — | — | ${why} |`;
			}
			return `| ${name} | ${fmtMs(r.firstTokenMs)} | ${fmtMs(r.totalMs)} | ${sizeCell(r)} |`;
		})
		.join("\n");
	const sections = results
		.map((r, i) => {
			const name = `### ${i + 1}. ${r.ref.providerLabel} — \`${r.ref.modelId}\``;
			if (!r.ok) {
				const why = r.error === "cancelled" ? "cancelled" : `failed: ${r.error}`;
				return `${name}\n\n> ${why}`;
			}
			return `${name}\n\n${r.text.trim()}`;
		})
		.join("\n\n---\n\n");
	return `## Arena\n\n| Model | First token | Total | Size |\n|---|---|---|---|\n${rows}\n\n---\n\n${sections}`;
}

/** Tokens (provider-reported when available) plus seed-price cost; falls back
 *  to a word count for providers that never report usage. */
function sizeCell(r: ColumnResult): string {
	if (!r.usage) return `~${r.text.trim().split(/\s+/).length} words`;
	const cost = r.costUsd != null ? ` · ${fmtCost(r.costUsd)}` : "";
	return `~${fmtTokens(r.usage.totalTokens)} tok${cost}`;
}

function fmtTokens(tokens: number): string {
	return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

function fmtCost(usd: number): string {
	return usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** Compact per-column summary stored as the arena's assistant turn, so
 *  follow-ups ("expand on the Gemini answer") stay grounded without replaying
 *  every full column into context. */
function arenaDigest(user: string, ranked: ColumnResult[]): string {
	const lines = ranked.map((r, i) => {
		const head = `${i + 1}. **${r.ref.providerLabel}** \`${r.ref.modelId}\``;
		if (!r.ok) return `${head} — ${r.error === "cancelled" ? "cancelled" : `failed: ${r.error}`}`;
		const cost = r.costUsd != null ? `, ~${fmtCost(r.costUsd)}` : "";
		const body = r.text.trim().slice(0, DIGEST_PER_COLUMN_CHARS);
		return `${head} (${fmtMs(r.firstTokenMs)} to first token${cost}):\n> ${body}`;
	});
	const header = `[Arena comparison of "${user.slice(0, 200)}" — ranked fastest first. The user may ask about or promote any column.]`;
	const digest = `${header}\n${lines.join("\n")}`;
	return digest.length > DIGEST_MAX_CHARS ? `${digest.slice(0, DIGEST_MAX_CHARS)}…` : digest;
}

function fmtMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Progress lines for the thought stream — one update per model per ~2s so a
 *  5-column race doesn't flood the client. */
function throttleEmitters(emit: (e: TurnEvent) => void) {
	const last = new Map<string, number>();
	return {
		progress(label: string, chars: number, force = false) {
			const now = Date.now();
			const prev = last.get(label) ?? 0;
			if (!force && now - prev < 2000) return;
			last.set(label, now);
			// trailing newline keeps each model's progress on its own line
			emit({ kind: "thought", text: `· ${label}: ${chars} chars\n` });
		},
	};
}
