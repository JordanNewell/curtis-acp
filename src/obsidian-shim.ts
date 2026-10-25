// Node shim for the Obsidian APIs the vendored provider layer touches.
//
// curtis-ai-chat's provider files import exactly two things from 'obsidian':
// Platform (transport policy) and requestUrl (CORS-immune HTTP + model
// discovery). On Node we satisfy them with globals + fetch, and polyfill the
// `window` surface transport.ts expects so its node-https streaming tier —
// the battle-tested desktop path — runs unmodified against Node's real
// http/https modules.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Only the flags the vendored code reads. Desktop = Node integration present. */
export const Platform = {
	isDesktopApp: true,
	isMobile: false,
};

/** Minimal shape of Obsidian's RequestUrlResponse that the vendored code reads:
 *  `status` (discovery), `text` (buffered chat fallback), `json` (pre-parsed). */
export interface RequestUrlResponse {
	status: number;
	text: string;
	json?: unknown;
	arrayBuffer?: ArrayBuffer;
	headers?: Record<string, string>;
}

export interface RequestUrlOptions {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** Obsidian semantics: throw on non-2xx instead of returning the status. */
	throw?: boolean;
	contentType?: string;
}

/** fetch-backed stand-in for Obsidian's requestUrl. */
export async function requestUrl(options: RequestUrlOptions): Promise<RequestUrlResponse> {
	const res = await fetch(options.url, {
		method: options.method ?? "GET",
		headers: options.headers,
		body: options.body,
	});
	const text = await res.text();
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined; // Obsidian also leaves .json undefined for non-JSON bodies
	}
	const resp: RequestUrlResponse = { status: res.status, text, json };
	if (options.throw && res.status >= 400) {
		const err = new Error(`request failed, failed code: ${res.status}, reason: ${text.slice(0, 200)}`);
		(err as Error & { status?: number }).status = res.status;
		throw err;
	}
	return resp;
}

// ---------------------------------------------------------------------------
// window polyfill — transport.ts reaches through `window.require` (Electron's
// Node bridge) for http/https and `window.fetch` for the streaming fallback.
// Point require at Node's real module loader and the desktop node-https tier
// works as-is, including true abort via socket destroy.
// ---------------------------------------------------------------------------

const nodeRequire = createRequire(path.join(here, "vendor-shim-require.cjs"));

const w = globalThis as typeof globalThis & {
	window?: {
		require?: (moduleName: string) => unknown;
		fetch?: typeof fetch;
	};
};

if (!w.window) {
	w.window = globalThis as unknown as typeof w.window;
}
if (!w.window.require) {
	w.window.require = nodeRequire;
}
if (!w.window.fetch) {
	w.window.fetch = fetch;
}
