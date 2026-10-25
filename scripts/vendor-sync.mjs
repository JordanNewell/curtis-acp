// One-shot vendor sync: copy the provider layer from curtis into this
// repo, rewriting the two 'obsidian' import specifiers to the Node shim.
// Usage: node scripts/vendor-sync.mjs
import fs from "node:fs";
import path from "node:path";

const SRC = process.env.CURTIS_SRC ?? "E:/dev/projects/curtis/src";
const REV = (process.env.CURTIS_REV ?? "ee14456").slice(0, 12);
const DST = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src");

const files = [
	"providers/base.ts", "providers/anthropic.ts", "providers/ollama.ts", "providers/registry.ts",
	"providers/transport.ts", "providers/stream-shim.ts", "providers/colors.ts", "providers/chatgpt.ts",
	"providers/types/openai-responses.ts", "providers/types/anthropic-responses.ts",
	"core/tool-schema.ts", "core/types/json-helpers.ts",
];

const BANNER = `// Vendored from curtis@2.0.0 (commit ${REV}). Keep byte-identical to
// upstream except the two sanctioned edits below, so future syncs are a re-copy:
//   - import specifier 'obsidian' -> '../obsidian-shim.js' (Node shim)
//   - relative imports get explicit .js extensions (NodeNext ESM; upstream
//     builds through esbuild's bundler resolution)
// Re-sync: node scripts/vendor-sync.mjs
`;

// src/providers/x.ts: './base' → './base.js', '../types' → '../types.js',
// '../../core/tool-schema' stays — always relative to the importing file.
function addExtensions(rel, text) {
	const dir = path.posix.dirname(rel);
	return text.replace(/(from ')(\.[^']+)(?=')/g, (m, pre, spec) => {
		if (spec.endsWith(".js")) return m;
		const resolved = path.posix.normalize(path.posix.join(dir, spec)) + ".js";
		let back = path.posix.relative(dir, resolved);
		if (!back.startsWith(".")) back = `./${back}`;
		return `${pre}${back}`;
	});
}

let total = 0;
for (const rel of files) {
	const text = fs.readFileSync(path.join(SRC, rel), "utf8");
	const edits = (text.match(/from 'obsidian'/g) ?? []).length;
	const out =
		BANNER +
		addExtensions(rel, text.replace(/from 'obsidian'/g, "from '../obsidian-shim.js'"));
	fs.mkdirSync(path.join(DST, path.dirname(rel)), { recursive: true });
	fs.writeFileSync(path.join(DST, rel), out);
	total += edits;
	console.log(rel.padEnd(40), edits ? `(rewrote ${edits} obsidian import(s))` : "(pure)");
}
console.log(`\n${files.length} files vendored, ${total} specifier rewrites.`);
