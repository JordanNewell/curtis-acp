# ACP Registry submission scaffold

`agent.json` here follows the [registry format](https://github.com/agentclientprotocol/registry)
(FORMAT.md): one directory per agent, `npx` distribution, validated against
`agent.schema.json`. Copy `curtis/agent.json` into a PR against
`agentclientprotocol/registry` once the checklist below is green.

## Before the PR

- [ ] Publish to npm as `curtis-acp` (`npm publish --otp=<code>` — the account has 2FA) — the registry installs via `npx`, so the package must exist and match `version`.
- [x] Create the GitHub repo `JordanNewell/curtis-acp` (both `repository` and `license_url` resolve — verified 200).
- [x] Confirm `website` — `https://jordannewell.com/curtis` resolves (308 → 200 on the trailing slash; registry validators follow redirects).
- [x] Optional: add `icon` — done per CONTRIBUTING: 16×16 SVG, monochrome `currentColor` only (hardcoded hex fills fail validation), sitting as `icon.svg` next to `agent.json`; the registry build generates the `icon` URL itself. `agent.json` validated **VALID** against their `agent.schema.json` (draft-07).
- [x] Sanity-check the auth requirement: `initialize` returns one valid `authMethods` entry (`env-keys` — verified in `test/client.mjs`).

**PR state:** branch `add-curtis` pushed to the fork (`JordanNewell/registry`) with `curtis/agent.json` + `curtis/icon.svg` — open the PR against `agentclientprotocol/registry` once the npm package exists (their CI installs the `npx` target).

## After merge

- One entry reaches Zed **and** JetBrains users through the registry feeds
  (`registry.json` / `registry-for-jetbrains.json`).
- Bump `version` in `agent.json` with every npm release — registry updates are
  picked up without re-review.
