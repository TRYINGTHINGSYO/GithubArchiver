# Foundry roadmap

**v0.6 rule:** every change must eliminate friction encountered while building a
real project. Speculative capabilities stay in **Ideas** until justified by
actual workflow pain.

Foundry is the **tool**, not the perpetual project. Prefer using it to build
Inventory (and the next apps) over expanding Foundry itself.

---

## Completed

- [x] **v0.1–v0.4** — Local GPT ↔ Cursor relay → orchestrator (task graphs, policy, recovery)
- [x] **Rename to Foundry** — Cursor is an adapter, not the product identity
- [x] **UX / trust pass** — Run screen clarity, trust levels, approval surfaces
- [x] **Standalone extraction** — Product root (`src/`, `public/`, `plugins/`, `adapters/`); GithubArchiver is only a managed project
- [x] **v0.5 packaging** — `dist/` build, CI, self-project boundary, create/open/resume
- [x] **Project birth (local acceptance)** — scaffold → install → verify → git commit → approval gate → `~/.foundry` registry → restart reopen
- [ ] **Publish `TRYINGTHINGSYO/Foundry`** — human (`PUBLISH.md`); blocked for cloud agent tokens
- [ ] **Project birth with remote** — `FOUNDRY_ACCEPTANCE_GITHUB=1 npm run acceptance:github`

Original problem solved in architecture:

> Stop copying ChatGPT ↔ Cursor by hand; run a standalone orchestrator that
> creates, verifies, and manages projects (with explicit remote approval).

---

## Validated improvements

*Changes discovered through real use. Empty until Inventory (or another real
project) is built with Foundry.*

| Friction | Source project | Fix | Version |
|----------|----------------|-----|---------|
| *(none yet)* | | | |

When something forces a manual step or annoyance, log it in [FRICTION.md](./FRICTION.md)
(Task / Expectation / Reality / Fix / Validated), add a row here, then implement.
Do not invent work if the log stays empty.

**After publish + `acceptance:github`:** tag `v0.5.0-beta.1` and do not touch
core while building Inventory unless an entry appears in FRICTION.md.

---

## Ideas

*Speculative. Do not schedule until a Validated improvements row justifies them.*

- Better progress visualization
- Easier recovery after failed dependency installs
- Faster startup
- Better logs and diagnostics
- More reliable / quieter approval UX
- Improved documentation and onboarding
- Additional coding-agent adapters (Claude Code, Codex, …)
- Marketplace / plugin expansion
- LLM-designed custom scaffolds beyond templates + brief
- OS keychain credential backends
- npm publish / global `npx foundry` install

---

## Cadence

1. **v0.5** — Freeze core (this release).
2. Build **Inventory** entirely with Foundry.
3. Keep a running friction log (table above).
4. Ship **v0.6** containing only fixes from that log.
5. Repeat for the next real project.
