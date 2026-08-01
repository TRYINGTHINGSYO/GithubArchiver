# Fix packet 09 — Intelligence and classification quality

## Problem

Classification confidence is still heuristic (score-derived constants), duplicate detection is partial (emerging-topic / github_id / archive SHA — not general repo identity), and human review coverage is uneven (admin intelligence review exists; emerging POST was ungated — security fixed in packet 01).

## Evidence

- `src/lib/server/classify-repo.ts` — confidence from score formula, not calibration
- Emerging duplicate grouping — `src/lib/server/emerging-topics.ts`
- Admin review — `src/routes/api/admin/intelligence/review/+server.ts`
- Prior review overstated “clusters/human review absent”; quality gaps remain

## Affected files

- `src/lib/server/classify-repo.ts`
- Cluster assignment thresholds — `cluster-repo.ts` / `apply-repo-clusters.ts`
- Emerging quality — `topic-quality.ts`, `emerging-topics.ts`
- Admin intelligence UI
- Audit/eval scripts: `scripts/audit-intelligence.ts`, dataset compare scripts
- Tests under `tests/repo-intelligence.test.ts`, topic quality tests

## User impact

Users see confident-looking labels/clusters that are weakly evidenced; review workload is noisy.

## Severity

**P3** (quality). Do not mix into P0/P1 security/correctness PRs.

## Exact desired behavior

1. UI copy distinguishes heuristic confidence from calibrated probability.
2. Classifier version stamped on category/cluster decisions.
3. Human overrides (admin review) win and are visible in audit.
4. Expand duplicate signals only where evals show precision gains (start with github_id + name+owner renames already partially handled).
5. Emerging topic promotion requires admin (packet 01) and records reason codes.

## Implementation constraints

- No LLM dependency required for this packet
- Improve knowledge/evals before building new retrieval frameworks
- Keep deterministic rules explainable with evidence references

## Schema changes

Possibly `classification_version`, `confidence_kind` (`heuristic` vs `override`) columns if not present.

## API changes

Review API already exists — ensure responses expose override vs heuristic.

## UI changes

- Labels: “Heuristic confidence” wording
- Intelligence admin shows override state

## Migration and rollback

- Additive columns
- Rollback hides new fields

## Tests

- Override beats heuristic
- Confidence kind exposed
- Topic quality fixtures for duplicate_token / generic terms remain green
- Optional eval snapshot via `npm run audit:intelligence`

## Explicit out-of-scope

- Embeddings / semantic duplicates
- Full ML calibration pipeline
- Website moderation product (packet 08)
- Empty-volume cluster defect (packet 03)

## Acceptance criteria

- [ ] Heuristic confidence is labeled honestly in UI
- [ ] Overrides persisted and preferred
- [ ] Classifier version recorded
- [ ] No security regressions on emerging review routes
