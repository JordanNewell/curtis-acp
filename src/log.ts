// Stdio discipline: ACP speaks ndjson on stdout, so NOTHING may log there.
// The vendored plugin code console.debug's discovery failures and similar —
// route every non-error console channel to stderr before any module that
// might log gets a chance to run (import this first).

import { format } from "node:util";

for (const method of ["log", "debug", "info", "warn", "trace"] as const) {
	console[method] = (...args: unknown[]) => {
		process.stderr.write(`${format(...args)}\n`);
	};
}
