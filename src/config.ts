// Runtime config for curtis-acp: maps environment configuration onto Curtis's
// vendored 53-provider registry.
//
//   CURTIS_ARENA   comma list of "provider:model" pairs to duel, e.g.
//                  "anthropic:claude-haiku-5-5,google:gemini-3.8-flash".
//                  Unset → every keyed provider's first (flagship) model
//                  arenas automatically: set two API keys, get an arena.
//   CURTIS_SINGLE  optional "provider:model" for single mode (default: first
//                  arena entry; the panel's model picker overrides per-session).
//   CURTIS_TEMPERATURE / _MAX_TOKENS / _REASONING   global sampling knobs.
//   CURTIS_<PROVIDER>_*   per-provider overrides (TEMPERATURE, MAX_TOKENS,
//                  TOP_P, REASONING, OMIT_TEMPERATURE, EXTRA_BODY) — win over
//                  the global knobs; see samplingFor().
//   <PROVIDER>_API_KEY  keyed providers; Ollama/LM Studio need none.
//
// Provider ids are the plugin's upstream ids (anthropic, openai, google,
// openrouter, …) — 53 built-ins. Model ids not in a provider's seed list are
// fine: CURTIS_ARENA names the model on the wire directly.

import { PROVIDER_DEFINITIONS, ProviderRegistry } from "./providers/registry.js";
import type { ProviderConfig, ProviderDefinition, ReasoningEffort, TokenUsage } from "./types.js";

export interface ModelRef {
	providerId: string;
	providerLabel: string;
	modelId: string;
}

// Providers that can't work in a headless ACP process, regardless of keys:
// OAuth lives in the plugin's Electron shell; Azure needs a deployment URL.
const HEADLESS_SKIP = new Set(["chatgpt", "azure-openai"]);

/** Explicit env-var names where the generic `<ID>_API_KEY` rule doesn't fit. */
const ENV_KEYS: Record<string, string[]> = {
	anthropic: ["ANTHROPIC_API_KEY"],
	openai: ["OPENAI_API_KEY"],
	google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
	openrouter: ["OPENROUTER_API_KEY"],
	deepseek: ["DEEPSEEK_API_KEY"],
	groq: ["GROQ_API_KEY"],
	xai: ["XAI_API_KEY"],
	moonshot: ["MOONSHOT_API_KEY"],
	"kimi-coding": ["KIMI_API_KEY"],
	zai: ["ZAI_API_KEY"],
	"zai-glm": ["ZAI_API_KEY"],
	minimax: ["MINIMAX_API_KEY"],
	qwen: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
	"qwen-coding": ["QWEN_CODING_API_KEY"],
	mistral: ["MISTRAL_API_KEY"],
	together: ["TOGETHER_API_KEY"],
	fireworks: ["FIREWORKS_API_KEY"],
	cohere: ["COHERE_API_KEY"],
	perplexity: ["PERPLEXITY_API_KEY"],
	nvidia: ["NVIDIA_API_KEY", "NIM_API_KEY"],
	cerebras: ["CEREBRAS_API_KEY"],
	sambanova: ["SAMBANOVA_API_KEY"],
	"vercel-ai-gateway": ["VERCEL_AI_GATEWAY_API_KEY", "VERCEL_API_KEY"],
	huggingface: ["HUGGINGFACE_API_KEY", "HF_API_KEY"],
	fal: ["FAL_KEY"],
	meta: ["META_API_KEY"],
	upstage: ["UPSTAGE_API_KEY"],
	ai21: ["AI21_API_KEY"],
};

function envKeyFor(def: ProviderDefinition): string | undefined {
	const names = ENV_KEYS[def.id] ?? [`${def.id.toUpperCase().replace(/-/g, "_")}_API_KEY`];
	for (const name of names) {
		const value = process.env[name];
		if (value) return value;
	}
	return undefined;
}

/** Providers runnable in this process: keyless locals + every keyed provider
 *  that actually has a key. (Mock mode: whatever CURTIS_ARENA names.) */
export function runnableDefinitions(): ProviderDefinition[] {
	if (mockMode) return [];
	return PROVIDER_DEFINITIONS.filter(
		(def) =>
			!HEADLESS_SKIP.has(def.id) && (def.authType === "none" || Boolean(envKeyFor(def))),
	);
}

function parseRef(raw: string): ModelRef | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const sep = trimmed.indexOf(":");
	const providerId = sep === -1 ? trimmed : trimmed.slice(0, sep);
	const modelId = sep === -1 ? "" : trimmed.slice(sep + 1);
	const def = PROVIDER_DEFINITIONS.find((d) => d.id === providerId);
	if (mockMode) {
		// Lenient: the canned streamer answers anything, and arena models like
		// "mock-a" are deliberately not real.
		const label = def?.name ?? providerId.charAt(0).toUpperCase() + providerId.slice(1);
		return modelId ? { providerId, providerLabel: label, modelId } : null;
	}
	if (!def || !modelId) return null;
	if (HEADLESS_SKIP.has(def.id)) return null;
	const key = envKeyFor(def);
	if (def.authType !== "none" && !key) return null;
	return { providerId, providerLabel: def.name, modelId };
}

/** All configured models: the CURTIS_ARENA list, or every runnable provider's
 *  flagship when no list is set. */
export function availableModels(): ModelRef[] {
	if (!mockMode && !process.env.CURTIS_ARENA) {
		return runnableDefinitions()
			.map((def) => {
				// Prefer the live instance catalog (discovery-populated; locals
				// have empty seeds); the static seed list is the fallback.
				const models = getProvider(def.id)?.models ?? def.models;
				return { providerId: def.id, providerLabel: def.name, modelId: models[0]?.id ?? "" };
			})
			.filter((ref) => ref.modelId !== "");
	}
	return (process.env.CURTIS_ARENA ?? "")
		.split(",")
		.map((entry) => parseRef(entry))
		.filter((ref): ref is ModelRef => ref !== null);
}

export function defaultSingle(): ModelRef | null {
	const single = process.env.CURTIS_SINGLE ? parseRef(process.env.CURTIS_SINGLE) : null;
	if (single) return single;
	return availableModels()[0] ?? null;
}

/** Parse a "provider:model" string from the panel's model picker. */
export function parseModelRef(raw: string): ModelRef | null {
	return parseRef(raw);
}

export const mockMode = process.env.CURTIS_MOCK === "1";

// ---------------------------------------------------------------------------
// Sampling — global env knobs (CURTIS_*) with per-provider overrides layered
// on top (CURTIS_<PROVIDER>_*), ported from the plugin's three-layer
// resolution: first defined value wins, provider level beats global. Reasoning
// effort is translated per provider by the vendored getReasoningWire (chat.ts).
// Per-model overrides stay plugin-side: model ids carry ':' and '/' and don't
// fit env-var names.
// ---------------------------------------------------------------------------

const REASONING_LEVELS = new Set(["minimal", "low", "medium", "high", "max", "off"]);

function numEnv(name: string): number | undefined {
	const raw = process.env[name];
	if (!raw) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

const globalSampling = {
	temperature: numEnv("CURTIS_TEMPERATURE"),
	maxTokens: numEnv("CURTIS_MAX_TOKENS") ?? 4096,
	reasoningEffort: REASONING_LEVELS.has(process.env.CURTIS_REASONING ?? "")
		? (process.env.CURTIS_REASONING as ReasoningEffort)
		: undefined,
};

/** What one request's sampling resolves to after the per-provider layer. */
export interface ResolvedSampling {
	temperature?: number;
	maxTokens: number;
	reasoningEffort?: ReasoningEffort;
	topP?: number;
	/** Never send temperature, even when a global value exists — OpenAI
	 *  reasoning models and friends 400 on receiving the field at all. */
	omitTemperature: boolean;
	/** Raw JSON deep-merged into the request body last (vendored
	 *  mergeExtraBody): provider-specific fields the knobs don't name. */
	extra?: Record<string, unknown>;
}

/** Per-provider knob suffixes, e.g. CURTIS_ANTHROPIC_TEMPERATURE. */
const PROVIDER_KNOBS = ["TEMPERATURE", "MAX_TOKENS", "TOP_P", "REASONING", "OMIT_TEMPERATURE", "EXTRA_BODY"] as const;

function providerEnvPrefix(providerId: string): string {
	return `CURTIS_${providerId.toUpperCase().replace(/-/g, "_")}_`;
}

/** Resolve sampling for one provider: global knobs < CURTIS_<PROVIDER>_*.
 *  Unparseable EXTRA_BODY JSON is warned to stderr and ignored — a typoed
 *  passthrough must not take the whole panel down. */
export function samplingFor(providerId: string): ResolvedSampling {
	const resolved: ResolvedSampling = {
		temperature: globalSampling.temperature,
		maxTokens: globalSampling.maxTokens,
		reasoningEffort: globalSampling.reasoningEffort,
		omitTemperature: false,
	};
	const prefix = providerEnvPrefix(providerId);
	for (const knob of PROVIDER_KNOBS) {
		const raw = process.env[prefix + knob];
		if (raw === undefined || raw === "") continue;
		switch (knob) {
			case "TEMPERATURE":
			case "MAX_TOKENS":
			case "TOP_P": {
				const n = numEnv(prefix + knob);
				if (n === undefined) continue;
				if (knob === "TEMPERATURE") resolved.temperature = n;
				else if (knob === "MAX_TOKENS") resolved.maxTokens = n;
				else resolved.topP = n;
				break;
			}
			case "REASONING":
				if (REASONING_LEVELS.has(raw)) resolved.reasoningEffort = raw as ReasoningEffort;
				break;
			case "OMIT_TEMPERATURE":
				resolved.omitTemperature = raw === "1" || raw.toLowerCase() === "true";
				break;
			case "EXTRA_BODY":
				try {
					const parsed: unknown = JSON.parse(raw);
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						resolved.extra = parsed as Record<string, unknown>;
					} else {
						console.warn(`curtis-acp: ${prefix}EXTRA_BODY must be a JSON object — ignored`);
					}
				} catch {
					console.warn(`curtis-acp: ${prefix}EXTRA_BODY is not valid JSON — ignored`);
				}
				break;
		}
	}
	return resolved;
}

/** Estimated USD cost for a response, from the vendored pricing seeds.
 *  Null when the provider/model has no price data (shown as "—"). */
export function estimateCost(
	providerId: string,
	modelId: string,
	usage: Pick<TokenUsage, "promptTokens" | "completionTokens">,
): number | null {
	const pricing = getProvider(providerId)?.getModelPricing(modelId);
	if (!pricing) return null;
	return (usage.promptTokens / 1_000_000) * pricing.inputPrice +
		(usage.completionTokens / 1_000_000) * pricing.outputPrice;
}

// ---------------------------------------------------------------------------
// Registry bootstrap — one ProviderRegistry over env-derived configs. Discovery
// fills real model catalogs everywhere the provider exposes /models: keyless
// locals need it (their seed lists are empty) and keyed clouds benefit (seed
// lists are curated fallbacks, e.g. Anthropic's is a single entry) — discovery
// also enriches per-model pricing for the arena's cost cells. Bounded by the
// bootstrap cap in index.ts; a failed key or hung endpoint degrades to seeds.
// ---------------------------------------------------------------------------

let registry: ProviderRegistry | undefined;

/** Resolved before the agent serves requests (index.ts awaits it). */
export const ready: Promise<void> = (async () => {
	if (mockMode) return;
	const configs: Record<string, ProviderConfig> = {};
	for (const def of runnableDefinitions()) {
		configs[def.id] = { enabled: true, apiKey: envKeyFor(def) ?? "" };
	}
	registry = new ProviderRegistry(configs);
	for (const def of runnableDefinitions()) {
		registry.updateConfig(def.id, configs[def.id]);
	}
	const discoveries = runnableDefinitions()
		.filter((def) => def.autoDiscoverModels)
		.map((def) => registry!.discoverModels(def));
	await Promise.allSettled(discoveries);
})();

export function getProvider(providerId: string) {
	return registry?.getProvider(providerId);
}
