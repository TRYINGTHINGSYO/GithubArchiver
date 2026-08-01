# Intelligence scoring rules (baseline before quality PR)

Documented from code on `main` prior to the intelligence-audit-quality changes. Do not treat this as the live algorithm after merge.

## Category classification (`classify-repo.ts`)

### Taxonomy (16)
`product`, `library`, `framework`, `awesome-list`, `personal-website`, `portfolio`, `school-assignment`, `ai-project`, `game`, `devops`, `security`, `data-science`, `mobile-app`, `hardware-iot`, `spam-template`, `unknown`

Legacy map: `bot→product`, `cli-tool→library`, `web-app→product`, `data-ml→data-science`, `docs-site→personal-website`, `template→spam-template`, `other→unknown`

### Win order
`school-assignment` → `spam-template` → `awesome-list` → `ai-project` → `game` → `hardware-iot` → `mobile-app` → `security` → `devops` → `data-science` → `framework` → `library` → `product` → `portfolio` → `personal-website` → `unknown`

Each category takes the **max** matcher score; highest score wins (ties keep earlier priority).

### Confidence formula
```
confidence = min(0.95, round((0.38 + bestScore * 0.57) * 100) / 100)
```
Empty scores → `{ unknown, 0.35 }`. Weak AI (`ai-project` &lt; 0.55) may demote to runner-up or unknown.

### Known problematic matchers
- `library`: `name.endsWith('-bot') && stars < 50 → 0.6` (bots misclassified as libraries)
- `portfolio`: `\bportfolio\b` on name/desc/readme → 0.85 (name-token false positives)
- `product`: `name.endsWith('-bot') && stars >= 5 → 0.7` (no first-class `bot`)
- Description contradictions treat “portfolio” in personal-website descriptions as conflicts

## Cluster matching (`cluster-repo.ts`)

Weights: topics 50, name 25, readme 15, files 10, weak 5.

```
confidence = min(1, strongest*0.55 + (rawScore/100)*0.45)
```

Reject below `minimumScore` (often 0.45). Multi-membership allowed; audit lists all multi-cluster repos as “conflicts” without compatibility filtering.

## Audit (`intelligence-audit.ts`)

- False positives: confidence &lt; minimumScore + 0.1
- Contradictions: description matches another category’s hint regex
- Reviews: append-only `intelligence_reviews` (migration 035); does not rewrite assignments
- No owner-pattern detection
- No scoring-version field
