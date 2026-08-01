# Intelligence, evidence, classification, and scoring

## What “intelligence” means in the current code

The current intelligence layer is deterministic application logic over repository metadata, README text, history rows, events, releases, and archive presence. It does not call an LLM, train a model, use embeddings, maintain a vector database, or run a human-labeling workflow. Confidence numbers are rule-assigned constants, not calibrated probabilities.

The implemented outputs are:

- one summary and one category per repository;
- grouped evidence references;
- archive/preservation score;
- recoverability score;
- project signal score;
- repository story/narrative text assembled from facts;
- related-project ranking;
- 24-hour trend and live-overview projections;
- source archive file/language/security/technology analysis, currently disconnected from the main detail loader.

## Repository summaries

`summarize-repo.ts` produces a maximum 280-character deterministic summary. It prefers a useful repository description, can add a language hint, then tries the first useful README line, then falls back to repository identity/category-style wording. Generated text and timestamp are stored in `repos.summary` and `summary_generated_at` during enrich/refresh.

There is no versioned prompt/model, attribution, summary history, moderation state, human edit, multilingual generation, or factuality score. Re-running after metadata changes overwrites the current summary.

## Category taxonomy and classification

The closed taxonomy is:

| Category | Typical signals | Assigned confidence range |
|---|---|---:|
| `bot` | Bot naming/topics/descriptions | 0.85 |
| `library` | Library/package/framework topics and ecosystem metadata | 0.80 |
| `cli-tool` | CLI/terminal/command topics or naming | 0.75 |
| `web-app` | Web/application/full-stack signals | 0.78 |
| `mobile-app` | iOS/Android/mobile signals | 0.72 |
| `game` | Game/engine/game-dev signals | 0.70 |
| `data-ml` | ML/AI/data/notebook signals | 0.68 |
| `devops` | Infrastructure/container/CI/automation signals | 0.65 |
| `docs-site` | Documentation/site/static-doc signals | 0.70 |
| `template` | Template/starter/boilerplate signals | 0.60 |
| `other` | No earlier rule matches | 0.40 |

Rules are first-match regex/string checks over lowercased name, description, language, topics, README excerpt, and optional file paths. Order therefore determines outcome; a repository cannot be multi-label. Confidence is the constant attached to the winning rule. No observed accuracy, confusion matrix, threshold tuning, taxonomy version, explanation fields, or review override is stored.

`applyRepoIntelligence` loads at most roughly 4,000 README characters and metadata/topics, then saves the result. It does not pass source file paths to `classifyRepo`, so classifier branches based on `package.json`, `Dockerfile`, mobile project structure, and other paths do not run in the real enrichment pipeline.

## Category-balancing discovery

`repo_category_daily` stores counts and percentages for categories present at rollup time. `getUnderrepresentedCategories` finds rows below 1%, and `category-discovery.ts` maps a subset to GitHub Search qualifiers:

- CLI tools;
- games;
- data/ML;
- DevOps;
- web applications;
- libraries.

A deterministic hash of the hour rotates candidate choice. Bot, mobile, docs, template, and other have no qualifier. A completely absent category has no daily row and is not recognized as underrepresented. Supplemental discoveries are not explicitly labeled with the category/search rationale, so later classification can disagree with the gap that caused collection.

## Evidence model

Evidence is a projected TypeScript structure, not a database table. References have:

- evidence category;
- title/label and explanatory text;
- direct or derived confidence;
- source identifier/anchor/URL when available;
- associated observed time or repository fact.

Evidence categories are:

| Category | Examples | Nature |
|---|---|---|
| README | README snapshots, rendered content, changed events | Direct artifact evidence |
| Source | Source/ZIP snapshots, head SHA, file analysis | Direct when connected; some derived features |
| Release | Release/tag/asset rows | Direct GitHub-observed metadata |
| Timeline | Repository events and history observations | Direct observation plus schema-less payload |
| Metric | Stars/forks/watchers/issues snapshots | Direct observation at refresh time |
| Derived | Category, summaries, scores, narratives, related ranking | Application inference |

The detail projection groups references and renders anchors. Evidence does not have a stable table id, versioned derivation, derivation code version, input hash, review state, or invalidation graph. If scoring logic changes, historical scores cannot be reproduced unless the code version and underlying inputs are retained externally.

## Archive/preservation score

The score is an additive 100-point checklist:

| Signal | Points | Current implementation |
|---|---:|---|
| README preserved | 10 | Presence of README snapshot |
| Source preserved | 25 | Presence of source snapshot |
| Releases | 10 | At least one release |
| Commit history | 10 | Commit snapshot/history evidence |
| Timeline/history | 10 | Repository event/history evidence |
| Feature extraction | 10 | Source/intelligence feature availability |
| Dependencies | 10 | Always zero; dependency system is planned |
| Active development | 10 | Current activity/freshness signals |
| Deleted but preserved | 5 | Deleted repository with preserved artifacts |

Labels: at least 90 `excellent`, 75 `strong`, 55 `partial`, 30 `thin`, otherwise `needs attention` (display wording follows UI helpers). The score measures evidence coverage, not artifact correctness, legal preservability, build reproducibility, malware safety, or future availability. A project cannot currently reach a true dependency-complete maximum because dependency points are unimplemented.

## Recoverability score

Weighted components:

| Component | Weight |
|---|---:|
| README/documentation | 20% |
| Source | 30% |
| Releases | 10% |
| Metadata | 10% |
| History | 25% |
| Dependencies | 5% |

Each component is mapped from evidence presence/quality, then combined. Dependencies remain zero. This is a heuristic completeness percentage, not a measured probability that a project builds or runs. It does not inspect licenses, external package availability, submodules, Git LFS, build secrets, services, databases, model weights, binary assets, or platform toolchains.

## Project signal

Five 20-point components create a current “project signal”:

- activity;
- documentation;
- maintenance;
- popularity;
- freshness.

Archived/deleted repositories are capped around 60. Inputs come from current metadata and available evidence. It is not time-normalized by project age, ecosystem, or language; star counts can dominate in ways that disadvantage new/niche work. No explanation audit is stored beyond display-time component values.

## Related projects and similarity

Related projects use lexical retrieval and a simple score:

1. Build an FTS query from the first three topics; if topics are absent, use language.
2. Exclude the current repository.
3. Score shared topics at 4 points each, same language at 2, same owner at 1, and add a small stars term (`stars / 100000`).
4. Return the top five.

This is not semantic similarity. Requiring all prefix-expanded topic terms can be narrow; topic order affects the query inputs; popularity slightly biases results. There is no cluster id, embedding, graph walk, co-dependency signal, README semantic comparison, diversity reranking, feedback, or evaluation set.

## Trends and metrics intelligence

Current trend code computes approximate 24-hour star growth using `MAX(stars) - MIN(stars)` across snapshots, plus language/topic/event-burst summaries. Results are cached in memory for minutes. It does not guarantee two well-spaced points, normalize by elapsed time, distinguish a one-hour from 24-hour observation window, calculate acceleration, normalize by baseline/project age, or compute percentiles.

`docs/METRICS.md` defines correct snapshot selection, elapsed time, delta, velocity, acceleration, growth percentile, and APIs for velocity/gainers/acceleration/emerging/sleeping giant. Those routes and UI feeds are not implemented. The document is a design specification, not current behavior.

## Source intelligence

On analysis, the tar parser derives:

- file/folder tree and counts;
- extension/language distribution;
- largest files;
- common manifest/config/build/deployment technology signals;
- filenames commonly associated with secrets/security policy;
- archive truncation and error state.

It does not parse ASTs, dependencies, licenses within source, commit history inside Git, build graphs, vulnerabilities, malware, secrets content, code quality, test coverage, or actual runtime behavior. Security-file recognition means “a filename exists,” not “the repository is secure” or “a secret was found.”

The detail loader currently sets this analysis to null. File browsing calls it through a separate endpoint, but preservation score/evidence detail cannot reliably use the derived results.

## Rules, confidence, and review lifecycle

| Capability | Status |
|---|---|
| Hardcoded deterministic rules | Implemented |
| Rule version stored with output | Absent |
| Multiple labels | Absent |
| Calibrated confidence | Absent |
| Ground-truth evaluation | Absent |
| Human review/override | Absent |
| Review queue/moderation | Absent |
| Recompute/invalidation job | Only incidental enrich/refresh and manual source reanalysis |
| Explanation/audit record | Display-time projection only |
| LLM/model pipeline | Absent |
| Embeddings/vector store | Absent |

## Clusters and duplicate detection

Repository clustering is absent: no cluster table, assignment, centroid, relationship edge, worker, API, or UI. Duplicate repository detection is also absent. `storage.ts` detects duplicate archive artifacts by SHA-256 to save disk, which is not the same as identifying forked, mirrored, renamed, template-derived, or copied repositories.

GitHub forks are not modeled explicitly in the current `repos` columns. Similar README/source content is not hashed into cross-repository similarity. No canonical-repository merge/review workflow exists.

## Intelligence data quality risks

- Current summaries/categories are overwritten without history or algorithm version.
- First-match single-label classification compresses multi-purpose repositories.
- Fixed confidence values can be mistaken for probabilities.
- Missing file-path input disables part of classification.
- Initial metrics baseline is delayed until refresh.
- Optional GitHub fetch failures may appear as absence of evidence.
- Related ranking is lexical and biased by sparse/mutable topics.
- Source analysis is unbounded in cache count and disconnected from main projection.
- Dependency points are shown in scoring models despite no dependency collector.
- Website/homepage presence is not verification.
- No human feedback can correct or audit decisions.
