// Vendored from curtis-ai-chat@2.0.0 (commit ee14456). Keep byte-identical to
// upstream except the two sanctioned edits below, so future syncs are a re-copy:
//   - import specifier 'obsidian' -> '../obsidian-shim.js' (Node shim)
//   - relative imports get explicit .js extensions (NodeNext ESM; upstream
//     builds through esbuild's bundler resolution)
// Re-sync: node scripts/vendor-sync.mjs
// Type guards for narrowing `unknown` values at JSON boundaries.
// Every external JSON parse site should pass through one of these before
// the value enters typed code.

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function hasStringProp(v: object, k: string): v is Record<string, string> & typeof v {
  return k in v && typeof (v as Record<string, unknown>)[k] === 'string';
}

export function hasArrayProp(v: object, k: string): v is Record<string, unknown[]> & typeof v {
  return k in v && Array.isArray((v as Record<string, unknown>)[k]);
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
