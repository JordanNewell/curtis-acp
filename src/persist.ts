// Session persistence — makes session/load work across agent restarts.
// Zed remembers thread ids; without disk state, a restarted agent process
// rejects every old id ("unknown session"). Each session lands as a JSON
// file (history transcript, mode, model, last arena ranking); loadSession
// hydrates from it. Writes are best-effort: a full disk must degrade to
// in-memory-only behavior, never crash the agent.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatMessage } from "./chat.js";

export const sessionDir =
	process.env.CURTIS_SESSION_DIR ?? path.join(os.homedir(), ".curtis-acp", "sessions");

/** The slice of Session state that survives a restart. */
export interface PersistedSession {
	mode: "arena" | "single";
	modelId?: string;
	history: ChatMessage[];
	lastArena: unknown[];
}

function fileFor(id: string): string {
	return path.join(sessionDir, `${encodeURIComponent(id)}.json`);
}

/** Every session id with persisted state — newSession skips these ids so a
 *  restarted process can't collide with a Zed-remembered thread. */
export function persistedSessionIds(): Set<string> {
	try {
		return new Set(
			fs
				.readdirSync(sessionDir)
				.filter((f) => f.endsWith(".json"))
				.map((f) => decodeURIComponent(f.slice(0, -".json".length))),
		);
	} catch {
		return new Set();
	}
}

export function saveSession(id: string, state: PersistedSession): void {
	try {
		fs.mkdirSync(sessionDir, { recursive: true });
		fs.writeFileSync(fileFor(id), JSON.stringify(state, null, "\t"));
	} catch (e) {
		console.warn(`curtis-acp: could not persist session ${id}:`, e);
	}
}

/** Null when the id has no persisted state (or the file is corrupt) — the
 *  caller keeps its "unknown session" behavior for genuinely unknown ids. */
export function loadSession(id: string): PersistedSession | null {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(fileFor(id), "utf8"));
		if (
			parsed &&
			typeof parsed === "object" &&
			(parsed as PersistedSession).mode != null &&
			Array.isArray((parsed as PersistedSession).history)
		) {
			return parsed as PersistedSession;
		}
	} catch {
		// fall through
	}
	return null;
}
