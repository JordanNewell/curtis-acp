// Chat adapter: arena.ts's streaming surface, backed by Curtis's vendored
// provider layer (chatStream → node-https/fetch transports). CURTIS_MOCK=1
// swaps in a canned streamer so the agent can be protocol-tested without keys.

import { chatStream } from "./providers/transport.js";
import { getReasoningWire } from "./providers/registry.js";
import { estimateCost, getProvider, mockMode, samplingFor } from "./config.js";
import type { ModelRef } from "./config.js";
import type { AIMessage, AIRequestOptions, TokenUsage } from "./types.js";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface StreamResult {
	text: string;
	firstTokenMs: number;
	totalMs: number;
	/** Token counts when the provider reports them; cost estimated from the
	 *  vendored pricing seeds (null = unpriced). */
	usage?: TokenUsage;
	costUsd?: number | null;
}

/** Build request options the way the plugin does: layered env sampling knobs
 *  (global < per-provider), then the provider's reasoning dialect
 *  (getReasoningWire), then strip whatever sampling fields that dialect
 *  rejects so strict providers never see them. The per-provider extra-body
 *  passthrough rides along and is merged last by formatRequest. */
function buildOptions(ref: ModelRef): AIRequestOptions {
	const s = samplingFor(ref.providerId);
	const options: AIRequestOptions = {
		model: ref.modelId,
		maxTokens: s.maxTokens,
		stream: true,
	};
	if (!s.omitTemperature && s.temperature !== undefined) options.temperature = s.temperature;
	if (s.topP !== undefined) options.topP = s.topP;
	if (s.extra) options.extra = s.extra;

	if (s.reasoningEffort) {
		options.reasoningEffort = s.reasoningEffort;
		const wire = getReasoningWire(ref.providerId, s.reasoningEffort, options.maxTokens);
		if (wire.body) options.reasoningBody = wire.body;
		for (const key of wire.dropSampling) {
			if (key === "temperature") options.temperature = undefined;
			else if (key === "topP") options.topP = undefined;
			else if (key === "stop") options.stop = undefined;
			else if (key === "penalties") {
				options.frequencyPenalty = undefined;
				options.presencePenalty = undefined;
			}
		}
	}
	return options;
}

export async function streamChat(
	ref: ModelRef,
	messages: ChatMessage[],
	signal: AbortSignal,
	onDelta: (text: string) => void,
): Promise<StreamResult> {
	if (mockMode) return streamMock(ref, messages, signal, onDelta);

	const provider = getProvider(ref.providerId);
	if (!provider) throw new Error(`${ref.providerLabel} is not configured (missing API key?)`);

	// The vendored formatRequest applies the per-provider param caps (which
	// sampling knobs are safe to send), auth headers, and wire dialects.
	const requestInit = provider.formatRequest(messages as AIMessage[], buildOptions(ref));

	const started = Date.now();
	let firstTokenMs = 0;
	let text = "";
	let usage: TokenUsage | undefined;
	const { done } = await chatStream(provider, requestInit, { stream: true }, {
		signal,
		onChunk: (chunk) => {
			if (!firstTokenMs) firstTokenMs = Date.now() - started;
			text += chunk;
			onDelta(chunk);
		},
		onUsage: (u) => {
			usage = u;
		},
	});
	// chatStream resolves `done` on abort (delivering the partial text) —
	// callers distinguish cancel via the signal itself.
	await done;
	const result: StreamResult = {
		text,
		firstTokenMs: firstTokenMs || Date.now() - started,
		totalMs: Date.now() - started,
	};
	if (usage) {
		result.usage = usage;
		result.costUsd = estimateCost(ref.providerId, ref.modelId, usage);
	}
	return result;
}

const MOCK_TEXT =
	"Side-by-side testing beats leaderboards for your actual workload: leaderboards rank models on public benchmarks that may not match your data, while a quick duel on your own prompt shows tone, latency, and correctness where it matters. Two practical wins: you compare candidates on identical inputs, and you catch formatting quirks (markdown, verbosity) benchmarks never score. Bottom line: use leaderboards to shortlist, use an arena to decide.";

// ms per 8-word burst — CURTIS_MOCK_DELAY slows the canned stream so cancel
// and timeout paths can be tested deterministically.
const MOCK_DELAY = Number(process.env.CURTIS_MOCK_DELAY ?? 15);

async function streamMock(
	ref: ModelRef,
	messages: ChatMessage[],
	signal: AbortSignal,
	onDelta: (text: string) => void,
): Promise<StreamResult> {
	const started = Date.now();
	if (ref.modelId.includes("fail")) {
		// deterministic failure column so the arena's error path is testable
		await new Promise((r) => setTimeout(r, 30));
		throw new Error("simulated provider failure (mock)");
	}
	// Test hook: report how many prior transcript messages rode along, so the
	// protocol test can assert multi-turn history end to end. (system + the
	// current user message are the two non-history entries.)
	const prior = Math.max(0, messages.length - 2);
	const text =
		`[${ref.providerLabel} · ${ref.modelId}] ${MOCK_TEXT}` +
		(prior > 0 ? ` (prior msgs: ${prior})` : "");
	// stream in word chunks with tiny delays so chunk delivery is exercised;
	// honour aborts between bursts the way a real fetch would
	const words = text.split(" ");
	for (let i = 0; i < words.length; i++) {
		onDelta((i ? " " : "") + words[i]);
		if (i % 8 === 7) {
			await new Promise((r) => setTimeout(r, MOCK_DELAY));
			if (signal.aborted) throw new Error("This operation was aborted");
		}
	}
	// Synthetic usage so the arena's tokens/cost rendering is exercised the
	// same way a provider-reported usage chunk exercises it live.
	const usage: TokenUsage = {
		promptTokens: 12 + messages.join(" ").length % 50,
		completionTokens: words.length,
		totalTokens: 12 + (messages.join(" ").length % 50) + words.length,
	};
	return {
		text,
		firstTokenMs: 40,
		totalMs: Date.now() - started,
		usage,
		costUsd: estimateCost(ref.providerId, ref.modelId, usage),
	};
}
