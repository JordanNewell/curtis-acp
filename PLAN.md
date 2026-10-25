# Curtis AI Chat — Go-Forward Plan

**Date:** 2026-10-08 · **Decision:** Shelve the Zed port. Sequence: Obsidian growth → monetization → standalone app → ACP agent (backlog).

**Why:** Zed's extension ceiling is ~89K downloads for the #1 extension ever; third-party agents without OpenCode-scale gravity get ~nothing (Auggie: 285 stars). Curtis has 284 downloads vs Copilot for Obsidian's 2.4M in a market that demonstrably installs AI chat plugins at scale — and nothing in Obsidian combines arena + agent mode + 30+ providers + voice. The bottleneck is distribution, not platform or features.

**North-star metric:** weekly plugin downloads. **Secondary:** Pro conversions, forum/discussion engagement.

---

## Phase 0 — Baseline & tracking (Week 1)

- [ ] Add a weekly GitHub Action to `curtis-ai-chat` that logs download counts from `obsidianmd/obsidian-releases` community-plugin stats JSON to a CSV/commit. Baseline today: **284 downloads**.
- [ ] Define the KPI dashboard (even a simple README table updated by the Action): downloads, GitHub stars, discussions, release cadence.
- [ ] Listing audit (most assets already exist — v2.0.0 has hero, arena GIF, website, demo vault): verify plugin-search keywords/tags cover "arena", "compare models", "voice", "agent", "local LLM", "LM Studio", "OpenRouter" — the search terms people actually type.
- [ ] Confirm manifest `description` leads with the differentiator ("compare models side by side"), not the category (crowded: "AI chat for Obsidian").

**Output:** measurable baseline + search-optimized listing. No code changes beyond the tracking Action.

## Phase 1 — Growth engine (Weeks 2–6)

Positioning: **"Any model. Side by side. In your vault."** (local-first, BYOK, no subscription).

- [ ] **Week 2:** Obsidian Forum post in *Share & showcase* (arena GIF as the hook, not a feature list). Cross-post r/ObsidianMD with a "I built" narrative — polyglot + arena + local models angle.
- [ ] **Week 2–3:** 60-second arena demo video (the GIF's story: one prompt → 2 models → promote the winner). YouTube Shorts + embed in README + forum post.
- [ ] **Week 3:** Obsidian Discord + relevant LLM/local-AI Discords (Ollama, LM Studio communities — Curtis is a first-class frontend for them).
- [ ] **Week 4:** Show HN ("Show HN: Curtis – bring-your-own-everything AI chat inside Obsidian") and X/Twitter thread.
- [ ] **Week 4–6:** SEO article on the plugin site: "Comparing LLMs side by side in Obsidian (2026)" + a honest competitor comparison page (Smart Connections, Copilot plugin) — you win on polyglot + arena + local.
- [ ] **Product-led loop (Week 3–5, code):** "Export chat as note" with a tasteful footer link; `/arena` as a one-command demo; first-run onboarding wizard (pick a provider → first chat in <60s; auto-detect Ollama/LM Studio on localhost).
- [ ] **Cadence:** ship weekly. Every release = changelog post + one asset.

**Targets:** 284 → **2,500+ downloads by end of Week 6**; 1 front-page-adjacent community post per week.
**Kill/adjust:** if <100 new downloads/week after 4 weeks of consistent posting → pull Phase 3 forward and treat Obsidian as a portfolio piece.

## Phase 2 — Monetization (Weeks 4–8, overlaps Phase 1)

**Policy (verified):** Obsidian allows "optional payments" — core must be free/open-source; optional paid unlocks are permitted; external service costs (BYOK APIs) unaffected. Source: obsidian.md "The future of plugins" + Developer Policies.

- **Free forever:** BYOK chat, all 30+ providers, 2-model arena, vault-aware Q&A. (This IS the primary feature set — keeps the store listing compliant and builds trust.)
- **Curtis Pro** (one-time license, **$39**, TypingMind precedent — $1M/20mo on the same model):
  - Agent mode (autonomous multi-step tasks)
  - Voice I/O
  - Arena >2 models + saved comparisons
  - Prompt-library sync across vaults/devices
- **Commerce:** Lemon Squeezy or Polar.sh (merchant-of-record → handles global VAT/sales tax). License key with offline-grace validation inside the plugin (never phone-home-block on launch).
- [ ] Week 4: pick MoR, write the license/entitlement design doc (gate in code: feature flags keyed to license; graceful "Pro" upsell moments in-context, not modals at launch).
- [ ] Week 5–7: implement gates + license activation UI + purchase page on jordannewell.com.
- [ ] Week 8: launch Pro alongside a milestone plugin release (announcement post doubles as a marketing beat).

**Targets:** 2–5% download→paid conversion (typical dev-tool range); **50 sales by month 3** post-launch (~$2K) — proves willingness to pay *before* Phase 3.
**Risk:** reviewers interpret a gated feature as "primary." Mitigation: chat + 2-model arena free; gates only on power features. If challenged, voice/agent can move to the standalone app (Phase 3) where gating is unrestricted.

## Phase 3 — Standalone BYOK desktop app (Months 2–4; commit only on Phase 1–2 signal)

- **Stack:** Tauri v2 shell reusing the Curtis TS core; macOS/Windows/Linux; Tauri auto-updater; direct download first (no store cut).
- **Differentiation vs Cherry Studio (52K★) / Msty / AnythingLLM (67K★):** they do side-by-side or agents — none do agent mode + arena + local models (Ollama/LM Studio first-class) + voice + file/vault awareness together.
- **Pricing:** $49 one-time (or $5/mo later); free tier capped at 2 providers.
- [ ] Month 2: scaffold + provider layer port (the core is already provider-agnostic).
- [ ] Month 3: arena + agent mode + voice in the shell; alpha to the Obsidian-community email list built during Phase 1.
- [ ] Month 4: launch.
- **Effort:** 4–6 weeks MVP. **Kill criteria:** <500 downloads or <1% conversion in first 60 days.

## Phase 4 — `curtis-acp` agent (backlog; 1–2 weeks when pulled)

Thin TypeScript ACP agent (npx-distributed, TS core reused) with the **arena as the lead feature** — confirmed unclaimed in ACP/Zed as of Oct 2026, and the ACP Registry reaches **both Zed and JetBrains's 12.5M users** from one listing.

- **Trigger:** after Phase 2 revenue, or organic community pull from Zed/JetBrains users.
- Ship as binary or npx; PR to `agentclientprotocol/registry` (curated, updates without re-review).
- Constraints accepted: linear message stream (arena = markdown table + promote via slash command), no voice (Zed has no mic API).
- This folder (`curtis-ai-chat-zed`) can be renamed/repurposed for it — keep, don't delete.

## Rejected (from research, do not revisit without new evidence)

- **Full Zed port as Wasm extension** — can't build chat UI; economy too small; deprecated in favor of ACP Registry anyway.
- **VS Code/Cursor marketplace** — Claude Code 22.3M installs, Cline 5M, Kilo acquired; Roo's team exited IDE extensions in 2026.
- **JetBrains native plugin** — Kotlin rewrite; marketplace crackdown after June 2026 API-key-stealing incident. (ACP entry stays open — that's Phase 4.)
- **Neovim** — Lua rewrite, avante.nvim/codecompanion own the niche.

## Key risks

1. **Solo-dev bandwidth** — the plan front-loads marketing (cheap, no code) before any new surface area. Never run Phase 3 and Phase 2 simultaneously.
2. **Obsidian first-party AI** — a native Obsidian AI chat would compress the market. Watch Obsidian's announcements; the arena + polyglot + local-first wedge is the most defensible part if that happens.
3. **Incumbents copy the arena** (Copilot for Obsidian adding compare) — speed matters: the forum/SEO presence in Phase 1 is also the moat ("arena" becomes *your* keyword).
4. **Monetization/policy drift** — re-verify Developer Policies at Phase 2 start; keep Pro entitlements server-light so a model change is cheap.

## Immediate next actions (this week)

1. Add the download-tracking GitHub Action to `curtis-ai-chat` (Phase 0).
2. Draft the Forum "Share & showcase" post around the existing arena GIF.
3. Record the 60-second arena demo video.
4. Pick Lemon Squeezy vs Polar.sh and write the entitlement design doc.
