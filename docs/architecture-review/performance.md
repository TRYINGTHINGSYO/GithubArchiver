# Performance and scalability review

## Measured local baseline

Measurements were taken on the supplied Windows workspace on 2026-08-01. They are development/export measurements, not production load tests.

| Measurement | Result |
|---|---|
| Vite production build | Succeeded |
| Client build phase | About 1.24 seconds |
| Server build phase | About 5.95 seconds |
| Total observed build command | About 9.3 seconds |
| Source/docs/tests inventory | 162 TypeScript/Svelte/Markdown/SQL files, 22,841 lines |
| Logical SQLite allocation | 294,912 bytes, all domain tables empty |
| Production request latency | Not measurable from this export |
| Peak runtime memory | Not measured; database-native module cannot load under host Node 22 |
| Production archive/database growth | Not available |

Largest generated client artifacts:

| Artifact role | Approximate size |
|---|---:|
| Client route node 10 (large detail/admin route mapping) | 31.3 KiB |
| Client route node 4 | 29.4 KiB |
| Shared client chunks | 28.9 KiB and 27.2 KiB |
| Dead `/admin/status` client node | 24.2 KiB |
| Largest route CSS | 19.9 KiB |

Largest generated server artifacts:

| Artifact | Approximate size |
|---|---:|
| Main server `index.js` | 127.9 KiB |
| Largest server shared index chunk | 95.8 KiB |
| Repository projection chunk | 47.2 KiB |
| Refresh chunk | 37.1 KiB |
| Repository detail SSR module | 33.9 KiB |
| Admin SSR module | 29.8 KiB |
| Dead admin status SSR module | 24.2 KiB |

These are uncompressed file sizes and do not sum to per-route transfer size because SvelteKit chunks are shared. There is no bundle budget or CI regression check.

## Main runtime bottlenecks

### Single synchronous event loop

`better-sqlite3`, synchronous filesystem traversal, `readFileSync`, `gunzipSync`, tar parsing, hash calculations, and some archive/backup operations execute in the same Node process as HTTP. A long operation blocks SSR/API responsiveness. The in-process daemon increases the chance that background work and user requests contend.

### Source archive memory and CPU

- Archive download buffers the entire file, default maximum 50 MiB.
- Default archive concurrency is five: raw configured upper bound is roughly 250 MiB before overhead.
- Source analysis reads and gunzips the entire compressed tar synchronously, up to a default 30 MB compressed input.
- Per-file extraction can decompress/scan again.
- Individual snapshot downloads synchronously read the whole file into memory.
- Analysis/index caches have no TTL or maximum entry/byte count.

Large compressible repositories can expand far beyond compressed size. The configured compressed limit is not a decompressed-memory ceiling.

### Filesystem scans

Doctor, storage analysis, backup manifest creation, archive copy, and restore recursively walk local storage. Storage analysis hashes/groups snapshot content and computes repository totals. These are synchronous or largely serial. Runtime grows with artifact count and bytes, and web-triggered maintenance blocks requests.

### Query multiplication

Repository list summary mapping performs per-row archive badge and ZIP availability lookups. With the default 50-item page, this can add roughly 100 queries beyond the base list/total/stats/languages/pulse queries. Repository detail is also a composition of many serial queries.

`getArchivePulse` issues a collection of separate counts rather than a single aggregate. Admin status combines many counts, jobs, ingestion, storage, backups, and optional GitHub quota state and is polled every ten seconds by an open admin page.

### Expensive query shapes

Code inspection identifies likely scale-sensitive patterns:

- deep offset pagination over repository/FTS results;
- year filters using `strftime(...)`, limiting timestamp-index use;
- correlated `EXISTS` and latest-date subqueries for archived/README/release filters and sorts;
- related-project FTS followed by application-side scoring/projection;
- `MAX - MIN` metrics over a growing unretained snapshot table;
- latest history queries per evidence/state component;
- JSON extraction from event payloads for permanent archive-failure exclusion;
- distinct language and multiple global counts on every list request;
- full FTS delete/reinsert after small metadata changes.

Because the fixture is empty, `EXPLAIN` cost on it would not establish production behavior. No slow-query log, statement timer, query plan snapshot, or populated benchmark exists.

## Database growth model

Estimated dominant growth:

| Data | Approximate cardinality driver | Retention |
|---|---|---|
| `repos` | One per unique discovered full name | Forever |
| FTS | One document per repo, up to 50k README chars | Forever; rewritten |
| Metrics | One per refresh/repo, roughly daily | None |
| Events | Each detected lifecycle/archive change/failure | None |
| Commit history | Each observed default-branch head change | None |
| Job/decision telemetry | Each worker and daemon loop; duplicated wrappers possible | None |
| Search telemetry | Each query and recursive shard | None |
| Source files | Up to 50 MiB each capture | Cleanup policy optional |
| ZIP files | Potential second full representation of each source | Cleanup optional |
| Full backups | Copy of DB plus entire archive tree | No automatic rotation |
| Bulk exports | Scope-specific ZIPs, potentially all repos | No retention |

The archive filesystem will dominate capacity. With the current automated queue only one source capture is normally created per repo, which slows growth but undermines historical preservation. Correcting that cadence without object storage/retention planning would materially increase disk demand.

## Network and upstream rate constraints

GitHub enrichment is request-heavy: metadata, README, commit, releases, tags, and rate-limit checks can require multiple calls per repository. The token raises quota from the unauthenticated level, but there is no centralized budget. Enrich and refresh delays are static, archive concurrency is separate, admin actions can overlap, and optional subfetch errors can be swallowed.

GitHub Search waits two seconds between pages and shards overloaded windows. A one-hour search can generate many shard requests. GH Archive streams reduce memory versus downloading the compressed event file whole, which is a positive design choice.

No ETag/If-None-Match, If-Modified-Since, request coalescing, HTTP cache, or shared circuit breaker is implemented.

## Caching review

| Cache | Scope | Limit/eviction | Risk |
|---|---|---|---|
| Trend snapshot maps | One process | TTL around 5–10 min; fixed logical keys | Stale/different across replicas |
| Source analysis | One process | No TTL/size bound | Memory grows with browsed/reanalyzed snapshots |
| Source tar entry index | One process | No TTL/size bound | Same |
| HTTP repository detail | Browser/private cache | 60s + 300s stale | Manual updates can briefly show stale data |
| Probe/robots/sitemap | Public HTTP cache | 1 day / 1 hour | Low risk |
| Snapshot download | Browser/private cache | 1 hour | Whole file still allocated on server |

There is no cache invalidation across processes. Storage deletion can invalidate memory cache entries that still describe deleted files.

## Scalability ceilings

### Repository count

FTS and indexed SQLite can support a substantial single-node corpus, but current N+1 projections, repeated global counts, offset pagination, and daily unbounded metrics will degrade before the database engine's theoretical limit. A populated benchmark is required to state a repository ceiling.

### Worker throughput

Static delays and GitHub quota dominate enrich/refresh throughput. At 50 repositories per batch and several API calls each, a 5,000 requests/hour token may be the practical ceiling before archive bandwidth. Multiple tokens/accounts are not modeled.

### Horizontal replicas

Unsafe without redesign: every replica can start a daemon, has its own manual queue/live events/caches, and assumes local files. SQLite WAL supports concurrent readers and a writer but is not a distributed job coordinator.

### Disk

No quota reservation, free-space admission control, high-watermark pause, object lifecycle, or alert exists. Storage analysis reports use after the fact. A bulk export/full backup can temporarily require another archive-sized allocation.

## Performance improvements suggested by evidence

These are review recommendations, not implemented changes:

1. Instrument request/query/job latency, event-loop delay, memory, disk, upstream calls, and queue depth before optimizing.
2. Replace per-result archive/ZIP queries with set-based joins/CTEs or batched lookups.
3. Stream snapshot downloads and source archive processing; impose decompressed-byte limits.
4. Move CPU/filesystem-heavy work to isolated worker processes with durable leases.
5. Bound caches by entries/bytes and invalidate on cleanup.
6. Add cursor pagination and query-plan/load tests on a production-shaped synthetic database.
7. Make date/year filters index-friendly and introduce covering/partial indexes based on measured plans.
8. Add retention/downsampling for operational and metrics history while preserving required evidence policy.
9. Move archive objects/exports/backups to capacity-managed object storage before multi-replica scale.
10. Centralize GitHub quota/concurrency and use conditional requests.
