# Website discovery, verification, screenshots, and community features

## Implemented website-related behavior

GithubArchive+ has two sources of outbound web presence:

1. `repos.homepage`, copied from GitHub repository metadata during enrich/refresh.
2. URLs and images extracted from the latest README for repository detail rendering.

The README projection classifies links for presentation into broad groups such as project website, documentation, social/community, and package/container registries. Relative README links and images are resolved against the repository's default branch using `raw.githubusercontent.com` or GitHub blob URLs. Common badge hosts are recognized so badges can be treated differently from content images.

The detail page displays the homepage and link groups as evidence/convenience. This is link discovery, not website preservation.

## Website lifecycle status

| Requested capability | Status | Evidence/current behavior |
|---|---|---|
| Discover GitHub homepage metadata | Implemented | `repos.homepage` from GitHub API |
| Extract README links | Implemented | Detail projection parses Markdown/link text |
| Classify link purpose | Partially implemented | Hardcoded host/path heuristics |
| Resolve README relative URLs/images | Implemented | Default-branch raw/blob URL builders |
| Fetch/crawl project website | Absent | No HTTP website worker/client |
| Verify reachability/status code | Absent | Homepage is never checked |
| Verify redirects/canonical domain | Absent | No redirect or domain record |
| TLS/certificate inspection | Absent | No implementation |
| Capture website HTML/assets | Absent | No storage/table/snapshot type |
| Website screenshot | Absent | No browser automation or image store |
| Screenshot history/diff | Absent | No model or UI |
| Dead-site detection | Absent | `deleted_at` refers to GitHub repository, not website |
| Website health/status history | Absent | No table/event type |
| Domain ownership/association proof | Absent | GitHub homepage value is trusted as metadata |
| Safety/malware/phishing checks | Absent | Links are rendered for users |
| Moderation/reporting | Absent | No user or moderation system |

No screenshots are available in the repository. There is no screenshot directory, website-capture table, object-storage integration, headless browser dependency, or route for displaying captures.

## Verification semantics

The UI should be read as “GitHub/README claims this URL,” not “GithubArchive+ verified this site.” Current data cannot answer:

- whether the domain resolves;
- whether HTTP succeeds;
- whether content belongs to the repository owner;
- whether the site is safe;
- whether the content has changed or disappeared;
- whether redirects now point elsewhere;
- whether an archive capture exists.

The evidence model should label these links as metadata/README assertions. They should not increase recoverability as preserved website evidence.

## Ratings, favorites, collections, and discovery modes

| Product system | Status | Missing primitives |
|---|---|---|
| User ratings | Absent | User identity, rating table, aggregate, anti-abuse, API, UI |
| Favorites/stars inside GithubArchive+ | Absent | User identity, favorite relation, privacy, UI |
| Collections/lists | Absent | Collection/entry tables, ownership/sharing/order, CRUD routes |
| Random repository discovery | Absent | Route/query/UI; no safe sampling/index strategy |
| Personalized recommendations | Absent | User events/profile, ranking model, consent |
| Moderation | Absent | Reports, decisions, roles, audit log, appeal state |
| Curated featured projects | No durable system | Home presentation is query-driven; no curator table/workflow |
| Dead-site review | Absent | Website checks, state machine, review UI |

GitHub stars are displayed and used in project signal/trends, but they are external popularity counts and must not be confused with an in-product rating or favorite.

## Website discovery risks

- A malicious repository can set a deceptive homepage or README link; no warning/reputation layer exists.
- Rendering remote images leaks reader network metadata and permits tracking pixels unless browser/content security policy blocks them; no CSP is configured in source.
- README HTML sanitization is regex-based rather than a robust allowlist sanitizer.
- Link heuristics can misclassify URLs and have no review/correction path.
- Renamed/deleted GitHub repositories retain a homepage value that can later change ownership independently.
- No URL normalization/canonicalization means equivalent URLs can appear as separate evidence.
- No timestamps are stored for extracted links; only the underlying README snapshot time provides indirect provenance.

## What a complete subsystem would require

This is a future design boundary, not an instruction to implement it now. A defensible website preservation feature would need separate `websites`, `website_observations`, `website_captures`, and review/moderation records; normalized URLs and domain associations; bounded/sandboxed fetch/browser workers; robots/legal policy; response/TLS/redirect history; hashes and object storage; screenshot/HTML provenance; dead/alive state transitions with retry hysteresis; and explicit evidence labels distinguishing claimed, observed, and preserved states.
