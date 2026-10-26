# Security

## Keys (BYOK)

curtis-acp is bring-your-own-key: provider API keys arrive exclusively through
environment variables (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, … — see
`ENV_KEYS` in `src/config.ts` for the exact map).

- Keys live only in **process memory** for the lifetime of the agent process.
- The agent **never writes keys — or any secret material — to disk**.
- Keys are **never logged**: stdout is reserved for the ACP protocol (ndjson
  over stdio), and all logging is routed to stderr; key material appears in
  neither.
- There is **zero telemetry** and no network egress beyond requests to the
  configured LLM provider endpoints themselves.

## Session data

Conversation transcripts are stored **locally only** — one JSON file per
session under `~/.curtis-acp/sessions` (override with `CURTIS_SESSION_DIR`) —
so threads survive agent restarts. They never leave the machine except as
prompt context sent to the LLM providers you have configured, and the directory
contains no key material.

## Reporting a vulnerability

Please report vulnerabilities privately to **jordan@jordannewell.com** rather
than opening a public issue. Include reproduction steps and, if useful, the
client's ACP log (`dev: open acp logs` in Zed).

## License

curtis-acp is licensed under [BUSL-1.1](LICENSE) (matching the parent project
[curtis](https://github.com/JordanNewell/curtis)); it converts to Apache 2.0
four years after each version's first public distribution.
