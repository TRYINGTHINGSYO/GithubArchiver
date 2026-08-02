# GithubArchive+ Redesign Plan (2026-08)

Based on a live codebase audit. Implement in phases; do not reset data.

## PR #28 status (foundation slice)

Shipped / in review: three-column shell, theme modes, migration **044**, website cards/detail/random, independent website favorites, Bayesian ratings, homepage dual discovery.

### Dual-write source of truth (current)

| Item type | Authoritative **reads** | **Writes** |
|-----------|-------------------------|------------|
| Repository system collections (Favorites / Watch Later) | `collection_repositories` | Dual-write: `collection_repositories` **and** `collection_items` (`item_type='repository'`) in one SQLite transaction |
| Website favorites / watch later | `collection_items` (`item_type='website'`) | `collection_items` only |
| Admin protection favorites | `repo_favorites` | Unchanged; **not** dual-written |

Website identity remains `candidate_domains.registrable_domain` (no separate `websites.id` yet). Rating/favorite ownership uses the existing anonymous `collectionOwner` cookie (`owner_type` + `owner_key`), matching repository collections. There is no end-user password auth in this app — only admin sessions.

### Rollback strategy (PR #28)

1. **Code rollback:** redeploy previous release. Additive tables/columns are unused by old code paths for repositories (`collection_repositories` still authoritative for repo reads).
2. **Do not DROP** `collection_items`, `website_ratings`, or `website_user_state` in production without a backup — old binaries ignore them safely.
3. **Aggregates on `candidate_domains`:** unused by pre-044 code; safe to leave.
4. If a bad 044 deploy corrupts only aggregates, recompute from `website_ratings WHERE deleted_at IS NULL`.

### Dual-write retirement (planned migration, not in #28)

1. Switch repository membership **reads** to `collection_items` (feature-flag or migration PR).
2. Verify parity job: every `collection_repositories` row has a matching `collection_items` row and vice versa for `item_type='repository'`.
3. Stop writing `collection_repositories` (or keep as projection).
4. Only then consider dropping `collection_repositories` in a later, explicit migration.

### Known limitations in PR #28

- No dedicated rate-limit middleware on rating/favorite APIs (same-origin cookie model + SvelteKit CSRF for form posts; abuse controls deferred to moderation PR).
- No screenshot capture; random/detail use placeholder previews.
- Website sort/nav links cover recent/rated/favorites only — not full brief taxonomy.
- Random eligibility is `verify_status='live'` + `random_eligible` + optional HTTP&lt;400; richer safety/topic filters deferred.
- Soft-deleted ratings keep a single unique row per owner+domain (no multi-version history table).
- Keyboard shortcuts are client-side only; form-focus guard is implemented.

### Deferred work → PR #29 (unified discovery and search)

- Repository / Website / Both switch on Discover
- Unified search tabs + shared filters
- Topic cloud
- Trending website rail
- Stronger random-discovery eligibility and repeat avoidance

Then PR #30 (repo detail intelligence), PR #31 (screenshots + moderation). Do **not** combine those into #29.

---

## Current state (audit baseline)

| Area | Reality at audit |
|------|------------------|
| Shell | Sticky top header + single centered column; mobile bottom tabs. No left/right rails. |
| Homepage | Long vertical discovery landing (repos only). |
| Repos | Rich detail page; Discover lanes; Birth Feed; Search. |
| Websites | v1 pipeline: CT/zone → `candidate_domains` → verify → `/websites` list. |
| Collections | Repo-only: `collections` + `collection_repositories`. |
| Ratings | None for websites. |
| Theme | Dark-only tokens. |

## Preservation rules

1. Keep all existing routes working (`/`, `/discover*`, `/repo/*`, `/websites`, `/favorites`, `/watch-later`, `/admin/*`, APIs, workers).
2. Additive migrations only; no drops of `candidate_domains` or `collection_repositories`.
3. Dual-write repo collection membership into `collection_items` while keeping `collection_repositories`.
4. Website identity remains `registrable_domain` until a richer `websites` entity is justified.
5. Regression tests for websites, favorites, and repo accessibility after shell change.

## Phase plan

### Phase 1 — Audit + plan — done
### Phase 2 — Shell + theme — done in PR #28
### Phase 3 — Repository discovery UI — incremental (post-#28)
### Phase 4 — Website discovery UI foundations — done in PR #28
### Phase 5 — Favorites / collections / ratings foundations — done in PR #28
### Phase 6 — Search + similarity — PR #29 / #30
### Phase 7 — Performance + hardening — ongoing; screenshots/moderation in #31
