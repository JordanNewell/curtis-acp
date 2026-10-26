# curtis-acp

**Curtis AI as an [ACP](https://agentclientprotocol.com) agent** — the full Curtis provider layer (53 providers) with the multi-model **arena**, inside [Zed](https://zed.dev)'s Agent Panel (and JetBrains, or any ACP client).

One prompt, every model, side by side — the thing no editor ships natively. Zed's own Parallel Agents run distinct tasks concurrently; `curtis-acp` fans a *single prompt* out to all your configured models and composes the comparison in-thread. Then `/promote` makes the winner your model.

## Status

The provider layer is **vendored from curtis-ai-chat@2.0.0** (`scripts/vendor-sync.mjs` re-syncs it; the only sanctioned edits are the Node shim specifier and explicit `.js` import extensions). That brings the plugin's researched per-provider parameter matrix — which sampling knobs each API accepts, so strict providers get fields dropped instead of 400s — plus curated, price-verified model seeds and runtime `/models` discovery.

Self-tested (`npm run test:mock` — 13 protocol checks over stdio: handshake, arena with a failing column, promote-to-single, multi-turn history, `/clear`, mode/model switch, streaming, mid-turn cancel with partial arena composed, session/load replay, single-mode timeout) and **live-validated** against real providers (Ollama single turn + 2-column arena through the vendored transport).

## Try it in Zed

Build, then add a custom agent in Zed (`agent_servers` in settings.json — Agent Settings → External Agents → Add Custom Agent). Setting two keys is enough — every keyed provider's flagship arenas automatically:

```json
{
	"agent_servers": {
		"curtis": {
			"type": "custom",
			"command": "node",
			"args": ["E:\\dev\\projects\\curtis-ai-chat-zed\\dist\\index.js"],
			"env": {
				"ANTHROPIC_API_KEY": "sk-ant-…",
				"GEMINI_API_KEY": "AIza…"
			}
		}
	}
}
```

Or pick the duel explicitly with `CURTIS_ARENA`:

```json
"env": {
	"CURTIS_ARENA": "anthropic:claude-opus-4-6,google:gemini-3.8-flash,ollama:qwen2.5:7b-instruct",
	"ANTHROPIC_API_KEY": "sk-ant-…"
}
```

Zed picks the change up without a restart. New thread → pick **curtis** → type a prompt. The panel gets native controls: an **Arena/Single mode switcher** and a **model dropdown** (drives Single mode). Debug with `dev: open acp logs` if anything looks off.

### Configuration (env)

| Var | Meaning |
|---|---|
| `CURTIS_ARENA` | Comma list of `provider:model` duels. Unset → every keyed provider's first model arenas automatically. Provider ids are the plugin's: `anthropic`, `openai`, `google`, `openrouter`, `deepseek`, `groq`, `xai`, `moonshot`, `zai-glm`, `qwen`, `mistral`, `together`, `ollama`, `lmstudio`, … (53 built-ins). Model ids not in the seed list work — they're sent to the wire as-is. |
| `CURTIS_SINGLE` | Optional `provider:model` for single mode (default: first arena entry; the panel's model picker overrides per-session) |
| `CURTIS_TEMPERATURE` | Sampling temperature for every request (omit = provider default; dropped automatically where the provider's reasoning dialect rejects it) |
| `CURTIS_MAX_TOKENS` | Max output tokens (default 4096) |
| `CURTIS_REASONING` | Reasoning effort: `minimal`/`low`/`medium`/`high`/`max`/`off` — translated into each provider's own dialect (`reasoning_effort`, `thinking{}`, `think`, …), with the sampling fields that dialect rejects stripped |
| `CURTIS_<PROVIDER>_*` | Per-provider overrides that win over the global knobs above: `CURTIS_ANTHROPIC_TEMPERATURE=0.2`, `CURTIS_OPENAI_MAX_TOKENS=8192`, `CURTIS_GOOGLE_TOP_P=0.9`, `CURTIS_ANTHROPIC_OMIT_TEMPERATURE=1` (never send temperature — reasoning models 400 on it), `CURTIS_XAI_REASONING=high`, `CURTIS_MISTRAL_EXTRA_BODY={"safe_mode":false}` (raw JSON deep-merged into the request body last). Prefix rule = the API-key rule: provider id uppercased, dashes → underscores (`zai-glm` → `CURTIS_ZAI_GLM_*`). |
| `CURTIS_TIMEOUT_MS` | Per-request wall-clock budget before it's marked failed/truncated (default 180000) |
| `CURTIS_MOCK=1` | Canned streaming for protocol testing without keys (`CURTIS_MOCK_DELAY`, model ids containing `fail` simulate failures) |
| `<PROVIDER>_API_KEY` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `MOONSHOT_API_KEY`, `ZAI_API_KEY`, … — Ollama/LM Studio need none. Rule of thumb: `<PROVIDER>_<API_KEY>`; see `ENV_KEYS` in `src/config.ts` for the exact map. |

Not available headlessly: ChatGPT sign-in (OAuth lives in the plugin's Electron shell) and Azure OpenAI (needs a deployment URL).

### Slash commands (in the agent panel)

- `/arena <prompt>` — force the arena (default when ≥2 models are configured: plain prompts arena automatically)
- `/single <prompt>` — plain live-streamed answer from the selected model
- `/promote <n>` — after an arena, make column *n* the single-mode model (`/promote` alone lists the ranking). The panel's mode switcher follows along.
- `/models` — list configured models
- `/clear` — wipe this session's conversation history

### Conversation memory

Sessions keep a transcript (last 16 messages). Follow-ups in Single mode see your previous turns; after an arena, follow-ups are grounded in a compact per-column digest, so *"expand on the Gemini answer"* works. Arena turns store the digest, not the full columns, to keep context lean.

## How the arena renders

ACP streams one linear message, so the arena works in two beats: progress goes to the thought stream (`· OpenRouter · …: 240 chars`), then the composed message lands — a results table (first-token latency, total time, provider-reported tokens, seed-price cost estimate) followed by every full response under its own heading, fastest first. Cancelling mid-arena keeps the table: finished columns stay, in-flight ones are marked cancelled. Each request — column or single — runs under its own `CURTIS_TIMEOUT_MS` budget, so a hung provider can never stall the panel.

## Roadmap

- npm publish + ACP Registry listing (`registry/` scaffold filled in — LICENSE + 16×16 icon added, `OWNER` resolved to JordanNewell; the URLs resolve once the GitHub repo exists, then `npm publish` and the registry PR)
- OS keychain for keys (env vars today; the plugin's secretStorage seam is the shape to follow)
- Per-column `/stop` from the client mid-arena (needs an ACP extension — today, turn-cancel composes whatever finished)

Done recently: hosted live pass (Z.ai GLM-5.3 single turn + 2-column arena through the vendored transport; five more providers' failure paths exercised live against placeholder keys), per-provider sampling overrides (`CURTIS_<PROVIDER>_*` — the plugin's three-layer resolution ported to env, `EXTRA_BODY` passthrough included), real token counts + cost estimates in the arena table, env sampling + reasoning-effort knobs (per-provider dialects via the vendored `getReasoningWire`), npm publish readiness, full 53-provider layer vendored from the plugin, native mode/model picker, per-column cancel semantics, `session/load` resume, conversation history, promote/clear commands.

## License

[BUSL 1.1](LICENSE) — same as [curtis](https://github.com/JordanNewell/curtis); converts to Apache 2.0 four years after each version's first public distribution. The provider layer is vendored from curtis@2.0.0, so the license travels with it. Personal and internal business use is unrestricted; the only restriction is productizing a Curtis substitute.

## Layout

```
src/index.ts        stdio bootstrap (awaits provider bootstrap → ndJsonStream → AgentSideConnection)
src/log.ts          console→stderr discipline (stdout is protocol)
src/agent.ts        ACP surface: initialize / session:new / session:load / prompt / cancel / modes / model picker / promote / clear
src/arena.ts        turn logic: command parsing, history, fan-out, per-column timeout, composition, digests
src/chat.ts         streamChat adapter: vendored providers ⇆ arena, mock streamer
src/config.ts       env config → ProviderRegistry; provider ids, keys, default arena, layered sampling resolution
src/obsidian-shim.ts  Node stand-ins for the two Obsidian APIs the vendored code touches
src/types.ts        provider type slice (trimmed from the plugin's types.ts)
src/providers/      vendored: base, anthropic, ollama, registry (53 defs + caps matrix), transport, stream-shim, chatgpt
src/core/           vendored: tool-schema, json-helpers
test/client.mjs     raw JSON-RPC stdio self-test (mock mode, no keys)
test/live.mjs       real turns against live providers ("a,b" = arena; needs keys or local runtimes)
scripts/vendor-sync.mjs  re-copy the provider layer from curtis-ai-chat
registry/           ACP Registry submission scaffold + checklist
```
