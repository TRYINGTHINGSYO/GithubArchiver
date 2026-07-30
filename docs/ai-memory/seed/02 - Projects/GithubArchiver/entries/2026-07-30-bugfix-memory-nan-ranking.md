---
schema: 1
id: bugfix-memory-nan-ranking
date: 2026-07-30
area:
  - memory
  - retrieval
type: bugfix
status: verified
confidence: confirmed
durability: permanent
relationships:
  - type: related
    id: pr-11-retrieval-scoring
  - type: related
    id: pr-12-multistage-retrieval
  - type: references
    id: decision-knowledge-engine-philosophy
title: One invalid status value made NaN scores randomise the whole ranking
migration: null
---

# NaN scores silently corrupted memory retrieval

Nine entries appended earlier today used `status: done`, which is not in
`EntryStatus` (`merged | open | verified | superseded | open-debt`).
`scoreStatusBoost('done')` fell through its switch and returned `undefined`, so
`composeScore` produced `total: NaN`.

The damage was not limited to those nine entries. `NaN` comparisons are always false,
so `ranked.sort((a, b) => b.score - a.score)` became order-dependent garbage for the
*entire* result set. Symptoms: `queryMemory('incident-gharchive-createevent')` returned
`incident-freshness-stall` first, and `'search fallback'` no longer returned
`incident-search-fallback-stale` at all — the entry that is literally about search
fallback.

A second, independent defect masked the first fix attempt: stage-3 re-rank applied
`concept: Math.min(40, concept)`, discarding any exact-stable-id signal scored above
the cap.

## Fixes

- `status: done` → `verified` on the nine affected entries.
- `scoreStatusBoost` has a `default` branch; `composeScore` coerces a non-finite total
  to 0. One unscoreable entry can no longer affect any other entry's rank.
- Exact stable-id match returns `CONCEPT_EXACT_ID_SCORE` (70), above the 40 concept cap,
  so an identifier lookup outranks newer loosely-related entries that also saturate the
  cap. Stage 3 no longer re-caps concept.

## Per the knowledge-engine philosophy

The knowledge was fixed (invalid frontmatter) *and* a correctness bug was fixed — but no
new retrieval capability was added. The cap collapsing "exact identifier" into "vaguely
related" was a latent scoring defect; growing the corpus only made it observable.

`tests/ai-memory-query.test.ts` now plants a malformed-status entry directly, bypassing
frontmatter validation, and asserts no hit scores non-finite and that the exact-id match
still ranks first.
