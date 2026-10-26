# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Session persistence** — transcript, mode, model, and last arena ranking persist to disk (`~/.curtis-acp/sessions`, override with `CURTIS_SESSION_DIR`), so `session/load` resumes threads after an agent restart; new session ids skip persisted ids to avoid collisions. `test/persist.mjs` covers replay, a grounded follow-up, and id collision across a real process restart.
- **Cloud model discovery** — keyed providers exposing `/models` (Anthropic, OpenAI, Google, OpenRouter, …) now populate the panel's model picker with their real catalogs at startup instead of their curated seed fallbacks (previously Anthropic offered a single model); discovery also enriches per-model pricing for the arena's cost cells.
- Repo CI (GitHub Actions): build + both test suites on Node 18/20/24.
- `CHANGELOG.md`, `SECURITY.md`.

## [0.4.1] — 2026-10-26

### Changed

- Re-licensed from MIT to **BUSL-1.1**, matching the parent project [curtis](https://github.com/JordanNewell/curtis) — the provider layer is vendored from it, so the license travels with the code. Personal and internal business use remains unrestricted; converts to Apache 2.0 four years after each version's first public distribution.
- `registry/curtis/agent.json`: version bumped to 0.4.1 and the npx distribution target pinned to `curtis-acp@0.4.1`, so registry installs stay in step with npm releases.

## [0.4.0] — 2026-10-26

### Added

- Initial release: Curtis AI as an ACP agent — the full **53-provider layer vendored from curtis@2.0.0** (`scripts/vendor-sync.mjs`), bringing the plugin's researched per-provider parameter matrix (which sampling knobs each API accepts) and price-verified model seeds.
- **Multi-model arena in the ACP message stream**: one prompt fanned out to every configured model concurrently, with per-column timeout and cancel; cancelling mid-arena composes whatever finished instead of discarding it (in-flight columns marked cancelled).
- **Promote-to-single** (`/promote <n>`; bare `/promote` lists the ranking) — makes an arena column the single-mode model, keeping the panel's mode switcher in sync.
- **Conversation history** with compact per-column arena digests — follow-ups stay grounded without replaying every full column into context.
- **`session/load` replay** — the transcript is re-streamed to the client on reconnect.
- **Native panel controls** via ACP session modes and the model picker: an Arena/Single switcher and a model dropdown driving Single mode.
- **Env sampling + reasoning-effort knobs** (`CURTIS_TEMPERATURE`, `CURTIS_MAX_TOKENS`, `CURTIS_REASONING`) translated into each provider's own reasoning dialect via the vendored `getReasoningWire`, with the sampling fields that dialect rejects stripped.
- **Per-provider sampling overrides** (`CURTIS_<PROVIDER>_TEMPERATURE` / `_MAX_TOKENS` / `_TOP_P` / `_REASONING` / `_OMIT_TEMPERATURE` / `_EXTRA_BODY`), layered over the global knobs.
- **Real token counts + seed-price cost estimates** in the arena results table (word-count fallback for providers that never report usage).
- **Mock mode** (`CURTIS_MOCK=1`) for keyless protocol testing — canned streaming, deterministic failure columns, `CURTIS_MOCK_DELAY` for cancel/timeout paths. Protocol self-test in `test/client.mjs` (13 checks over stdio).
- **Live validation harness** (`test/live.mjs`) — real turns against live providers; a comma-separated model list runs a real arena.

[0.4.1]: https://github.com/JordanNewell/curtis-acp/compare/0.4.0...0.4.1
[0.4.0]: https://github.com/JordanNewell/curtis-acp/releases/tag/v0.4.0
