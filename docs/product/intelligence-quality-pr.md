# Intelligence Audit Quality PR — delivery notes

## 1. Audit of current implementation (baseline)

See `intelligence-scoring-rules-baseline.md` (baseline captured before this change; filename historical).

Key problems found:
- `library` matcher awarded 0.6 to `*-bot` names with low stars
- `portfolio` matcher fired on bare `\bportfolio\b` in names
- No first-class `bot` / `company-profile` categories
- Multi-cluster audit listed all multi-memberships as conflicts
- Generic terms (`ai`, `agent`, `llm`) weighted too heavily in clusters
- Audit UI was a flat list without operator workflow

## 2. Taxonomy changes

Added: `application`, `developer-tool`, `dataset`, `documentation`, `template`, `company-profile`, `portfolio-collection`, `research-project`, `bot`, `generated-content` (kept `portfolio` for stored values).

Legacy: `web-app→application`, `docs-site→documentation`; `bot` is first-class again.

## 3. Database / API

Migration **044** (from `main@43`):
- `repos.scoring_version`, `classification_evidence_json`, `classification_warnings_json`
- `intelligence_human_overrides`
- `intelligence_owner_pattern_rules`
- `intelligence_bulk_operations`

APIs:
- Extended review outcomes + optional corrected category (writes override)
- `POST /api/admin/intelligence/bulk` preview/apply (confirm-only)

**Note:** Open redesign PR #28 also proposes a migration 044 (websites). Whichever merges second must renumber.

## 4. UI

`/admin/intelligence` redesigned with summary header, tabs, guided review queue, owner-pattern bulk confirm, explainable false-positive text.

## 5. Tests

`tests/intelligence-audit-quality.test.ts` — bots vs library, portfolio name ambiguity, company profiles, compatible clusters, overrides, bulk audit.

## 6. Before → after (known issues)

| Case | Before | After |
|------|--------|-------|
| telegram-ai-terminal | library/product | **bot** |
| discord/trading bots | library/product | **bot** |
| “My Professional Portfolio Website” | portfolio contradiction risk | **personal-website** |
| portfolio-data-mining | portfolio website | **data-science / research** (not portfolio site) |
| AI interview simulator | portfolio risk | not portfolio/personal-website |
| api-evangelist company profiles | independent portfolios | **company-profile** + owner pattern bulk |
| telegram-bots + ai-agents | “conflict” | compatible secondary |
| generic ai/agent/llm | strong cluster weight | weak-only (`WEAK_WEIGHT=2`, requireStrongEvidence) |

## 7. Remaining ambiguous cases

- Thin repos with both package.json and bot wording
- Org marketing sites vs company-profile templates
- “Portfolio” of open-source projects (`portfolio-collection` vs awesome-list)
- Recalculation preview UI (schema/version ready; full dry-run commit UI deferred)
