# Product review and future roadmap

## What is already valuable

GithubArchive+ has a coherent core loop that many archive concepts never reach: discover a repository close to birth, enrich it, save direct artifacts, record hashes/times/reasons, preserve selected changes, and make the result browsable. The strongest product choices are:

- first-seen and capture provenance are explicit;
- GitHub event discovery and Search fallback complement each other;
- README/source bytes remain downloadable instead of being reduced to metadata;
- current state, events, and selected history are visibly separated;
- deleted repositories remain in the catalog;
- evidence links, timeline, preservation coverage, and recoverability make archival gaps legible;
- admin exposes operational backlogs rather than hiding collection health;
- SQLite/local disk keep the first deployment understandable and self-hostable.

The repository detail page is the clearest expression of the vision: identity, historical observations, direct artifacts, readable source, releases, links, scoring, related work, and time-based navigation are brought together.

## UX that works well

- Home and Birth Feed offer an immediate “what was just created?” value proposition.
- Repository cards expose preservation state and remain keyboard navigable.
- Filters cover practical dimensions: language, discovery source, dates, stars/forks, archive/README/release/deletion/enrichment state.
- Repository detail makes archive downloads and manual capture visible rather than burying them.
- Admin turns ingest/enrich/archive/backfill state into understandable queues and job outcomes.
- Doctor/storage screens provide concrete samples, not only opaque health colors.
- Timeline and README comparison are appropriate historical-navigation concepts, even though comparison is currently broken.

## Confusing or misleading UX

- “Intelligence,” confidence, preservation score, and recoverability can sound scientifically calibrated; they are fixed heuristics and should say so near the value.
- A homepage/link appears alongside preserved evidence without website verification or capture status.
- The UI can imply source technology/security analysis is available, while the main loader always supplies null.
- “Archive” status may suggest continuing preservation; automatic source capture normally happens once.
- A 100-point preservation scale includes dependency points that can never be earned today.
- Admin `/status` is documented/launched but redirects, while an old implementation remains bundled.
- Metrics roadmap language can be confused with current trend logic; velocity/acceleration APIs do not exist.
- A “live” event feed is actually short-lived process memory combined with database polling.
- Export links use GET to begin expensive mutation; user agents may trigger them unexpectedly.

## Redundant and over-complex areas

- Two daemons embody different scheduling rules.
- Two admin status UIs exist, one unreachable.
- Parent/child/worker job rows can represent one action multiple times.
- The repository detail and admin pages are monolithic components with many local mini-systems.
- Current values, history, events, and FTS are dual-written through several call sites rather than one change transaction.
- Tar, ZIP, bulk export, and full backup can duplicate the same source bytes repeatedly.
- Legacy feed names and sort names overlap, increasing query/UI semantics.

Simplification should preserve product depth while reducing implementation paths: one daemon/queue ownership model, one admin status surface, one typed repository-change writer, one artifact retention model, and smaller reusable UI primitives.

## What feels overengineered

- Separate in-process and CLI daemons encode overlapping orchestration for a single-instance alpha.
- The same logical action can produce daemon-parent, pipeline-parent, and worker job records without an explicit hierarchy.
- The repository detail projection builds a very broad intelligence/evidence/story model before core source analysis is connected and recurring preservation works.
- Multiple copies of the same source bytes (tar, per-repo ZIP, bulk ZIP, full backup) exist without one lifecycle policy.

## What feels underengineered

- Identity/security around the public operator control plane.
- Durable job ownership, heartbeat, cancellation, retry, and concurrency controls.
- Artifact integrity/transaction recovery, capacity admission, and backup verification.
- HTML sanitization and untrusted archive/content threat controls.
- Versioning/evaluation of categories, confidence, scores, evidence derivations, and historical state semantics.
- Test/type/CI gates for a preservation system whose credibility depends on correctness.

## Important missing user value

### Preservation completeness

- recurring source/README capture on change;
- Git references beyond default head, tags/releases as artifacts, submodules and Git LFS awareness;
- dependency lockfiles/packages and build/reconstruction metadata;
- website capture and status history;
- artifact integrity audits and content-addressed storage;
- complete as-of state reconstruction.

### Discovery/community

- trustworthy multi-label taxonomy and semantic search;
- random/serendipity mode;
- favorites, private/public collections, notes, ratings, follows, notifications;
- curated exhibits and themed collections;
- duplicate/fork/mirror relationships;
- ecosystem/dependency navigation;
- safe reporting/moderation.

### Operator trust

- authentication and roles;
- durable queue/leases and multi-process safety;
- observability, alerts, disk/quota forecasts;
- backup policy and verified restore;
- documented evidence retention/legal/privacy policy;
- API versioning and client quotas.

## Growth loops

Potential loops consistent with the product:

1. **Discovery loop:** fresh repositories → useful category/trend feeds → visitors discover projects → maintainers share their preserved page → more readership.
2. **Preservation loop:** users save/follow a project → change capture becomes valuable → timeline/evidence deepens → page becomes a canonical historical reference.
3. **Curation loop:** researchers create public collections/exhibits → collections attract niche communities → community suggests projects/evidence → archive coverage improves.
4. **Research/API loop:** stable historical APIs/datasets support papers/tools → citations and integrations bring contributors/data-quality reports → corpus credibility grows.
5. **Rescue loop:** a repository or website disappears → preserved artifact proves value → users nominate similar at-risk projects → prioritization improves.

These loops require identity, sharing, trustworthy preservation status, moderation, and stable URLs/APIs that do not yet exist.

## Monetization opportunities and constraints

The archive mission suggests monetization should fund preservation without paywalling public evidence.

| Opportunity | Customer/value | Prerequisite |
|---|---|---|
| Hosted managed instance | Organizations/research groups avoid operations | Auth, tenancy, object storage, quotas, backups, observability |
| Preservation sponsorship | Communities fund storage/capture for projects/ecosystems | Transparent costs, retention promise, sponsor governance |
| Research/data API plans | High-volume historical queries/exports | Versioned API, rate limits, provenance, privacy/legal review |
| Private organization archives | Internal Git hosting/history preservation | Private repo auth, encryption, access controls, compliance |
| Curated reports/datasets | Analysts track ecosystem birth/growth/abandonment | Correct derived metrics, reproducible snapshots, licenses |
| Institutional partnerships | Libraries/universities fund durable replicas | Fixity, replication, retention/legal policy, export standards |

Avoid presenting heuristic scores or unverified websites as paid “intelligence” until derivations are versioned and evaluated. GitHub/API terms, repository licenses, author email storage, deleted content, takedowns, and website crawling all require policy/legal review before commercial scale.

## Current roadmap mapped to implementation

### Pre-v10 foundation

Roadmap lists schema v9 ingest/search/enrich/archive/metrics/events/FTS/admin/Railway as shipped. Current code has advanced schema to v13 and includes much of v10/v11-ops, so the shipped label is stale.

### v10 — Historical Resolution

**Implemented:** commit snapshots, license history, topics history, change-only recording, partial `getRepoState(as_of)`.

**Incomplete:** broader metadata state, source/README/release/metric reconstruction, milestone UI, complete historical resolution.

### v11 — Derived Intelligence

**Implemented in simpler form:** metrics snapshots and coarse 24-hour trend.

**Planned only:** elapsed-time-correct velocity, acceleration, percentiles, `/api/trending/velocity`, `/gainers`, `/acceleration`, `/emerging`, sleeping giant, and dedicated UI feeds.

### v11-ops — Autonomous daemon and repository intelligence

**Largely implemented:** planner/backlogs/decisions, summaries/categories, category balancing, job reasons, capture reasons, admin control.

**Gaps:** durable ownership, file-path classifier input, zero-category balancing, calibration/review, consolidation with CLI daemon.

### v11.5 — Discovery UI refresh

Some hierarchy/card/detail work appears in the current large Svelte pages and `docs/UI.md` referenced by roadmap is not present in this export. Completion cannot be established against the missing spec.

### v12 — Archive Intelligence

**Prototype only:** tar file list/language/security/technology analysis in memory.

**Planned only:** append-only `repo_files`, `repo_features`, durable feature evidence, feature queries.

**Blocking defect:** current detail loader disconnect.

### v12.5 — Repository Understanding

**Partially implemented:** intelligence report UI concepts, evidence grouping, preservation score, recoverability, significance-like story.

**Incomplete:** dependency evidence, durable/versioned derivations, full evidence explorer/trail, calibrated reconstruction assessment.

### v13 — Ecosystem Intelligence

Planned only. No `repo_dependencies`, dependency graph, reverse-dependency queries, ecosystem clusters, or package-resolution pipeline. Schema version 13 in code is only a ZIP index and should not be confused with product roadmap v13.

### v14+ and later outline

Repository memory/significance explanations, release analytics/abandonment, public paginated history/state/trending APIs, covering indexes, incremental FTS, and worker queue table remain roadmap ideas. Some `/state` and timeline APIs exist earlier than the roadmap outline but are narrower than the envisioned public platform.

## Recommended sequencing

### Phase 0 — make the existing product safe and truthful

1. Protect admin/mutations with authentication, authorization, CSRF/origin controls, and network policy.
2. Fix type checking, README comparison, source-analysis connection, and unsafe GET mutations.
3. Label heuristic/unverified states accurately in UI/docs.
4. Define supported Node version and make CI execute type/tests/build.

### Phase 1 — preservation integrity

1. Define change-based recurring capture and explicit retention/cost policy.
2. Introduce artifact fixity verification and transaction recovery.
3. Establish durable worker ownership, heartbeat, retries, and disk/quota admission.
4. Verify offsite/full backups through automated restore drills.

### Phase 2 — complete historical evidence

1. Make state reconstruction cover current metadata, metrics, README/source/releases.
2. Persist source file/features with derivation version and evidence pointers.
3. Capture dependencies/build inputs and represent forks/mirrors/duplicates.
4. Add website observation/capture only with safety, legal, and status semantics.

### Phase 3 — trustworthy discovery intelligence

1. Implement time-correct derived metrics and production-shaped validation.
2. Version classifiers/scores, support multi-label and human review.
3. Add semantic/graph similarity after a ground-truth evaluation plan exists.
4. Build random/curated/collection/favorite experiences on an identity and moderation foundation.

### Phase 4 — platform and sustainable growth

1. Stable versioned public/research APIs and bulk datasets.
2. Shared object storage, durable queue, horizontal read scaling, observability/SLOs.
3. Institutional replication/export standards and governance.
4. Monetization tied to hosting, capacity, and research services rather than withholding public preservation evidence.

## Product north star

The most defensible north star is: **for any project in the catalog, show exactly what GithubArchive+ directly observed and preserved, when it did so, what can be reconstructed from that evidence, and what remains unknown.**

That framing aligns discovery, archive integrity, historical state, intelligence transparency, website status, and operator trust. It also provides a clear test for future features: they should either acquire stronger evidence, make evidence easier to understand, or make preservation more durable.
