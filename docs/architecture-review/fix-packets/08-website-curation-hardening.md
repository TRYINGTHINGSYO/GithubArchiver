# Fix packet 08 — Website curation hardening

## Problem

PR #28 delivered ratings, favorites, collections dual-write, random discovery, and verify pipeline foundations. Remaining risks are abuse/hardening gaps (anonymous cookie trust, rate limits, hide/random edge cases, moderation absence) rather than missing tables/routes.

## Evidence

- Migration 044 + APIs/UI present and tested (`tests/website-curation.test.ts` green)
- Ownership is anonymous cookie only — `collection-owner.ts`
- No rate limits on rating/favorite/random
- Screenshots / operator dead-site moderation still thin/absent
- Release hardening already done in `a961895` — this packet is follow-up hardening, not re-implementation

## Affected files

- `src/lib/server/website-ratings.ts`
- `src/lib/server/db/collections.ts` / `websites.ts`
- `src/routes/api/websites/[domain]/*`
- `src/routes/websites/random/*`
- Possibly lightweight rate-limit helper
- Tests extending `website-curation.test.ts`

## User impact

Rating aggregates can be skewed by cookie churn; random feed can be abused; operators lack moderation tools for toxic reviews.

## Severity

**P2** (abuse/reliability) with some **P3** product gaps. Not a “feature absent” P0.

## Exact desired behavior

1. Per-owner rate limits on rating/favorite/hide/random advance.
2. Rating aggregates ignore soft-deleted rows (already intended — regression-lock).
3. Random eligibility never returns hidden domains for that owner; empty state when pool exhausted.
4. Basic admin moderation: hide review / clear rating by domain (admin-gated).
5. Continue dual-write invariants for `collection_items` ↔ repo collection tables until retirement migration.

## Implementation constraints

- Do not introduce full user accounts
- Do not build screenshot crawling in this packet
- Keep polymorphic `collection_items` design

## Schema changes

Optional: `website_ratings.moderation_state` or admin tombstone fields.

## API changes

- Admin endpoints to moderate a rating/review
- 429 responses when rate-limited

## UI changes

- Random empty/exhausted copy (if not already complete)
- Admin moderation minimal controls on domain page for admins only

## Migration and rollback

- Additive moderation columns
- Rate limits are env-tunable

## Tests

- Rate limit trips after N writes
- Hidden domains excluded from random for owner
- Aggregate math with soft-delete
- Dual-write delete sync regressions remain green

## Explicit out-of-scope

- Screenshots, TLS grading UX, public profiles
- Semantic website search
- Replacing anonymous owners with accounts

## Acceptance criteria

- [ ] Abuse rate limits enforced and tested
- [ ] Admin can moderate a abusive review
- [ ] Random/hide invariants locked by tests
- [ ] Existing curation tests still pass
