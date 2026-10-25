// Curtis provider types — trimmed to exactly what the vendored provider layer
// consumes (curtis-ai-chat/src/types.ts carries the whole app's types; the
// provider slice below is identical in shape, minus Obsidian-side concerns).

import type { JsonSchemaObject, ToolParameter } from "./core/tool-schema.js";

// ============================================================================
// TOOL TYPES
// ============================================================================

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/** Tool-definition shape the provider dialects read. The `execute` context is
 *  host-specific; the ACP agent has no tool loop yet, so it stays opaque. */
export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, ToolParameter>;
	execute: (params: Record<string, unknown>, context: unknown) => Promise<string>;
	/** Full JSON Schema override for `parameters` (MCP-style nested schemas). */
	inputSchema?: JsonSchemaObject;
}

export interface ToolResult {
	tool_call_id: string;
	content: string;
	is_error?: boolean;
}

// ============================================================================
// PROVIDER TYPES
// ============================================================================

export interface AIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | MessageContent[];
	/** When role='assistant' and the model returned tool_calls. */
	tool_calls?: ToolCall[];
	/** When role='tool' — id of the originating assistant tool call. */
	tool_call_id?: string;
	/** Optional name of the tool that produced this result (role='tool'). */
	name?: string;
	/** When role='tool' — the tool reported an error (maps to Anthropic is_error). */
	is_error?: boolean;
}

export interface MessageContent {
	type: "text" | "image_url";
	text?: string;
	image_url?: { url: string };
}

export interface AIModel {
	id: string;
	name: string;
	contextLength: number;
	inputPrice?: number; // per million tokens USD
	outputPrice?: number;
	visionSupported?: boolean;
	functionCallingSupported?: boolean;
}

export interface AIRequestOptions {
	model: string;
	/** Undefined = omit the field entirely (reasoning models often reject it).
	 *  Providers must never send `temperature` when this is undefined. */
	temperature?: number;
	maxTokens: number;
	stream?: boolean;
	/** When set, the provider advertises tools to the model (agent mode). */
	tools?: ToolDefinition[];
	// --- Advanced per-provider overrides (all undefined = don't send) ---
	topP?: number;
	topK?: number;
	minP?: number;
	seed?: number;
	/** Stop sequences (OpenAI `stop`, Anthropic `stop_sequences`). */
	stop?: string[];
	frequencyPenalty?: number;
	presencePenalty?: number;
	repetitionPenalty?: number;
	/** Raw passthrough deep-merged into the request body last. Reserved keys
	 *  (model/messages/stream/stream_options) cannot be overridden. */
	extra?: Record<string, unknown>;
	/** Reasoning effort for models that expose the knob. */
	reasoningEffort?: ReasoningEffort;
	/** Provider-dialect body fragments for the reasoning request. */
	reasoningBody?: Record<string, unknown>;
	/** Ollama-native hardware knobs (options{}/keep_alive). */
	ollama?: OllamaRequestParams;
}

/** Reasoning-effort levels Curtis understands. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "max" | "off";

/** Ollama native /api/chat knobs that have no OpenAI-compat equivalent. */
export interface OllamaRequestParams {
	numCtx?: number;
	numGpu?: number;
	numThread?: number;
	keepAlive?: string;
}

/** Per-provider advanced parameter overrides. */
export interface ModelOverrides {
	temperature?: number;
	maxTokens?: number;
	omitTemperature?: boolean;
	topP?: number;
	topK?: number;
	minP?: number;
	seed?: number;
	stopSequences?: string;
	frequencyPenalty?: number;
	presencePenalty?: number;
	repetitionPenalty?: number;
	extraBodyJson?: string;
	numCtx?: number;
	numGpu?: number;
	numThread?: number;
	keepAlive?: string;
	reasoningEffort?: ReasoningEffort;
}

export interface AIResponse {
	content: string;
	usage?: TokenUsage;
	reasoning?: string;
	/** Tool calls the model wants executed. Empty/absent means: final answer. */
	tool_calls?: ToolCall[];
}

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cachedTokens?: number;
}

export type StreamCallback = (chunk: string) => void;
export type UsageCallback = (usage: TokenUsage) => void;
export type ErrorCallback = (error: Error) => void;

/**
 * Relaxed response shape that the transport layer produces.
 * Both native `Response` and the Node-https / requestUrl shims satisfy this.
 */
export interface StreamResponse {
	readonly ok: boolean;
	readonly status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
	body?: ReadableLike;
}

/** Minimal ReadableStream-like interface (Node IncomingMessage shim or fetch body). */
export interface ReadableLike {
	getReader(): ReadableReader;
}

export interface ReadableReader {
	read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>;
	releaseLock(): void;
}

export interface AIProvider {
	readonly id: string;
	readonly name: string;
	readonly endpoint: string;
	models: AIModel[]; // mutable so auto-discovery can update in place
	readonly supportsStreaming: boolean;
	readonly supportsVision: boolean;

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit;
	parseResponse(response: StreamResponse): Promise<AIResponse>;
	parseStream(
		response: StreamResponse,
		onChunk: StreamCallback,
		onUsage?: UsageCallback,
		onError?: ErrorCallback,
	): Promise<void>;
	isAuthenticated(): boolean;
	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null;
	setModels?(models: AIModel[]): void;
	prepare?(): Promise<void>;
	supportsToolCalls?(): boolean;
}

export type AuthType = "bearer" | "anthropic" | "none" | "oauth" | "key";

export interface ProviderDefinition {
	id: string;
	name: string;
	endpoint: string;
	authType: AuthType;
	models: AIModel[];
	autoDiscoverModels?: boolean; // fetch /v1/models at runtime
	icon?: string;
}

export interface ProviderConfig {
	/** Plaintext API key (env vars in the ACP agent; the keychain is a plugin-side concern). */
	apiKey?: string;
	apiKeyRef?: string;
	oauthRef?: string;
	oauthJson?: string;
	enabled: boolean;
	defaultModel?: string;
	customEndpoint?: string;
	/** Model ids the user typed in manually — always offered, never pruned by discovery. */
	extraModels?: string[];
	modelOverrides?: ModelOverrides;
	perModelOverrides?: Record<string, ModelOverrides>;
}
