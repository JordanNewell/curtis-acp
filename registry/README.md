# ACP Registry submission scaffold

`agent.json` here follows the [registry format](https://github.com/agentclientprotocol/registry)
(FORMAT.md): one directory per agent, `npx` distribution, validated against
`agent.schema.json`. Copy `curtis/agent.json` into a PR against
`agentclientprotocol/registry` once the checklist below is green.

## Before the PR

- [x] Publish to npm as `curtis-acp` — done: **0.4.0 live** (web-auth OTP flow; tarball shasum `2bcaaca…` verified, handshake re-tested against the published artifact). **0.4.1** re-licenses the package MIT → BUSL-1.1 (matching curtis) — publish pending the 2FA flow.
- [x] Create the GitHub repo `JordanNewell/curtis-acp` (both `repository` and `license_url` resolve — verified 200).
- [x] Confirm `website` — `https://jordannewell.com/curtis` resolves (308 → 200 on the trailing slash; registry validators follow redirects).
- [x] Optional: add `icon` — done per CONTRIBUTING: 16×16 SVG, monochrome `currentColor` only (hardcoded hex fills fail validation), sitting as `icon.svg` next to `agent.json`; the registry build generates the `icon` URL itself. `agent.json` validated **VALID** against their `agent.schema.json` (draft-07).
- [x] Sanity-check the auth requirement: `initialize` returns one valid `authMethods` entry (`env-keys` — verified in `test/client.mjs` and against the published package).

**PR state:** opened — agentclientprotocol/registry PR **#721** (head: JordanNewell/add-curtis) (`add-curtis` from the fork). Watch their CI; on merge the entry reaches Zed and JetBrains feeds. Bump `version` in `curtis/agent.json` with every npm release — registry updates pick up without re-review.

Note: npm flags `@zed-industries/agent-client-protocol@0.4.5` as deprecated (renamed to `@agentclientprotocol/sdk`) — migrate on the next version bump.

## After merge

- One entry reaches Zed **and** JetBrains users through the registry feeds
  (`registry.json` / `registry-for-jetbrains.json`).
- Bump `version` in `agent.json` with every npm release — registry updates are
  picked up without re-review.
