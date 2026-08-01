# GithubArchive+ Redesign Plan (2026-08)

Based on a live codebase audit. Implement in phases; do not reset data.

## Current state (audit)

| Area | Reality |
|------|---------|
| Shell | Sticky top header + single centered column; mobile bottom tabs. No left/right rails. |
| Homepage | Long vertical discovery landing (repos only): readiness, emerging, clusters, high-signal. |
| Repos | Rich detail page; `DiscoveryRepoCard` / `RepoListItem`; Discover lanes; Birth Feed; Search. |
| Websites | v1 pipeline only: CT/zone → `candidate_domains` → verify → `/websites` live list. |
| Collections | Repo-only: `collections` + `collection_repositories` (Favorites / Watch Later). |
| Ratings | None for websites. |
| Screenshots | None. |
| Admin | Control / Jobs / Health / Storage / Intelligence tabs. |
| Theme | Dark-only tokens in `app.css`. |

**Missing vs product brief:** three-column shell, website detail/random, website favorites/ratings/collections, polymorphic collections, unified search tabs, README TOC rail, explainable similarity UI, light/system themes.

## Preservation rules

1. Keep all existing routes working (`/`, `/discover*`, `/repo/*`, `/websites`, `/favorites`, `/watch-later`, `/admin/*`, APIs, workers).
2. Additive migrations only; no drops of `candidate_domains` or `collection_repositories`.
3. Dual-write repo collection membership into `collection_items` while keeping `collection_repositories`.
4. Website identity remains `registrable_domain` (PK of `candidate_domains`) until a richer `websites` entity is justified.
5. Regression tests for `/websites`, `/favorites`, `/repo/...` accessibility after shell change.

## Phase plan

### Phase 1 — Audit + plan
This document. Done when shell work starts from these facts.

### Phase 2 — Shared design system + app shell
- Theme tokens: dark / light / system; distinctive fonts; CSS variables.
- `AppShell`: left discovery nav (collapsible sections), center content, right contextual rail.
- Persist sidebar open/collapsed in `localStorage`.
- Mobile: left drawer; right modules stack under main.
- Wire Command Palette into layout (already exists unused).

### Phase 3 — Repository discovery UI (incremental)
- Density modes for list views.
- Compact repo card refinement (reuse `DiscoveryRepoCard` / consolidate `RepoCard`).
- README sticky section navigator on detail (additive).
- Keep existing discovery materialization loads.

### Phase 4 — Website discovery UI (first-class)
- Website cards + denser `/websites` grid.
- `/websites/[domain]` detail page (no auto-open external).
- `/websites/random` with session “recently shown” + filters.
- Homepage: interleave Random/New/Highest-Rated websites with repo sections.
- Prominent Random Website in left nav.

### Phase 5 — Favorites, collections, ratings
- `collection_items` (`repository` \| `website`) + backfill from `collection_repositories`.
- Independent website favorites / watch later via system collections.
- `website_ratings` (1–5), aggregates, Bayesian/Wilson ranking helpers.
- Admin moderation hooks (soft-delete ratings).

### Phase 6 — Search + similarity
- Unified search tabs: All / Repositories / Websites / Collections / Topics.
- Similar websites/repos panels with explainable signals (start rule-based: topic/domain/category).

### Phase 7 — Performance + hardening
- Indexes, lazy screenshots (when added), virtualization for huge lists, cursor pagination.
- E2E: discover repo → website → favorite → rate → collection → random next.

## Immediate delivery (this PR slice)

Ship Phase 2 + Phase 4 foundations + Phase 5 schema/API minimum:

1. Three-column shell + theme toggle + structured left nav (repos **and** websites equal).
2. Migration 044: ratings, user state (hidden/shown), `collection_items`, rating aggregates on domains.
3. Website detail + random pages; upgraded `/websites` cards.
4. Homepage dual discovery block for websites without removing repo sections.
5. Tests proving `/websites`, favorites, and new website routes remain accessible.

Screenshots, embedding similarity, and full admin rating moderation UI follow in subsequent PRs.
