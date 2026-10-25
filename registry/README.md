# ACP Registry submission scaffold

`agent.json` here follows the [registry format](https://github.com/agentclientprotocol/registry)
(FORMAT.md): one directory per agent, `npx` distribution, validated against
`agent.schema.json`. Copy `curtis/agent.json` into a PR against
`agentclientprotocol/registry` once the checklist below is green.

## Before the PR

- [ ] Publish to npm as `curtis-acp` (`npm publish`) — the registry installs via `npx`, so the package must exist and match `version`.
- [ ] Create the GitHub repo `JordanNewell/curtis-acp` (owner resolved in `agent.json`; registry validates that `repository` and `license_url` resolve — `license_url` points at this repo's LICENSE).
- [ ] Confirm `website` (or drop the field if there is no Curtis page yet).
- [x] Optional: add `icon` — SVG, exactly 16×16, square (`icon.svg`, arena-columns mark in the brand greens). Verify the registry's expected icon field format (inline URL vs repo-relative path) against their CONTRIBUTING.md when assembling the PR.
- [ ] Sanity-check the auth requirement: the registry only lists agents that return valid `authMethods` in the handshake. curtis-acp declares the `env-keys` method (verified in `test/client.mjs`); re-check the registry's CONTRIBUTING.md for their exact CI expectations before submitting.

## After merge

- One entry reaches Zed **and** JetBrains users through the registry feeds
  (`registry.json` / `registry-for-jetbrains.json`).
- Bump `version` in `agent.json` with every npm release — registry updates are
  picked up without re-review.
