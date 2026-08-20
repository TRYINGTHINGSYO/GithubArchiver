# Semantic search production-readiness report

Generated: 2026-08-20T21:09:52.172Z

> No production DB was available in this environment. Corpus is a representative 10k-repo GithubArchiver-shaped sample (curated gold + realistic noise). Quality conclusions use MiniLM, not hashing-v1.

## Verdict: **GO_BEHIND_FEATURE_FLAG**

### Final gate

This synthetic/harder-noise harness does **not** replace a READ-ONLY production-snapshot run. Do not merge solely on these numbers.

## Corpus

```json
{
  "requested": 10000,
  "seeded": 10000,
  "total": 10000,
  "eligible": 9995,
  "deleted": 3,
  "pending_deletion": 2,
  "gold": 43,
  "noise": 9957,
  "noise_template_count": 35
}
```

## Indexing performance (MiniLM + TurboVec 2-bit)

```json
{
  "indexed": 9995,
  "failed": 0,
  "sqlite_indexed_current": 9995,
  "status_counts": {
    "indexed": 9995
  },
  "wall_clock_s": 47.881,
  "repos_per_sec": 208.74668448862806,
  "index_batch_wall_s": 43.501220449000094,
  "worker_embed_s": 36.61201513101696,
  "worker_upsert_s": 0.03302199999779987,
  "batches_with_worker_timings": 157,
  "sync_wall_s": 0.6282064829999435,
  "timing_note": "index_batch_wall_s is end-to-end HTTP indexBatch (serialize+embed+upsert+response). worker_embed_s / worker_upsert_s come from Python worker instrumentation. sync_wall_s is durable sync() only. No synthetic upsert fraction is invented.",
  "index_bytes": 1326771,
  "model_load_s": 4.815
}
```

## Memory (Node harness vs Python worker)

```json
{
  "node_rss_before_mb": 165,
  "node_rss_peak_mb": 196,
  "node_rss_after_index_mb": 196,
  "python_worker_pid": 12873,
  "python_worker_rss_after_model_load_mb": 839,
  "python_worker_peak_rss_during_index_mb": 948,
  "python_worker_rss_after_index_mb": 948,
  "note": "Python worker RSS includes recursive child processes when visible via ps. Railway sizing uses python_worker_peak_rss_mb, not Node harness RSS.",
  "python_worker_rss_during_query_load_mb": 948,
  "python_worker_peak_rss_mb": 948
}
```

## Quality macro (25 queries)

| Mode | Recall@10 | Precision@10 | MRR |
|------|-----------|--------------|-----|
| keyword | 0.100 | 0.020 | 0.200 |
| semantic | 0.660 | 0.132 | 0.788 |
| hybrid | 0.660 | 0.132 | 0.787 |

Semantic wins vs keyword (MRR): **16** · Keyword wins: **0** · Ties: **9**

## Independent mode latency (not a combined 3-mode wrap)

```json
{
  "note": "Each mode measured independently. Warm stats exclude the cold first query. Combined 3-mode durations are never labeled as hybrid latency.",
  "warm_iterations": 40,
  "keyword": {
    "mode": "keyword",
    "cold_first_query_ms": 0.5945280000014463,
    "warm": {
      "n": 40,
      "mean_ms": 0.3716016499980469,
      "p50_ms": 0.3667060000007041,
      "p95_ms": 0.4097650000039721,
      "min_ms": 0.34742399999231566,
      "max_ms": 0.47851700001046993
    }
  },
  "semantic": {
    "mode": "semantic",
    "cold_first_query_ms": 51.42924800000037,
    "warm": {
      "n": 40,
      "mean_ms": 50.5871982500008,
      "p50_ms": 50.96723700000439,
      "p95_ms": 53.962868000002345,
      "min_ms": 47.34692700000596,
      "max_ms": 56.04445100000885
    }
  },
  "hybrid": {
    "mode": "hybrid",
    "cold_first_query_ms": 50.477035000003525,
    "warm": {
      "n": 40,
      "mean_ms": 52.2930958500001,
      "p50_ms": 52.0038099999947,
      "p95_ms": 52.23408900000504,
      "min_ms": 51.73122600000352,
      "max_ms": 60.25133199999982
    }
  }
}
```

### Regressions (keyword MRR > semantic MRR)

```json
[]
```

## 25-query top-10 comparison

### offline-voice: `local voice assistant that works offline`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | voice/wake-word-local (0.464), voice/offline-speech-kit (0.457), noise89/pkg-3193-nm-voice (0.428), noise30/pkg-2843-nm-voice (0.419), noise54/pkg-3158-nm-voice (0.415), noise86/pkg-183-nm-voice (0.408), noise52/pkg-5678-nm-voice (0.402), noise46/pkg-3053-nm-voice (0.400), noise31/pkg-4978-nm-voice (0.400), noise32/pkg-7113-nm-voice (0.401) |
| hybrid | 1.00 | 1.00 | voice/wake-word-local (0.612), voice/offline-speech-kit (0.544), noise89/pkg-3193-nm-voice (0.390), noise30/pkg-2843-nm-voice (0.326), noise54/pkg-3158-nm-voice (0.297), noise86/pkg-183-nm-voice (0.251), noise52/pkg-5678-nm-voice (0.199), noise46/pkg-3053-nm-voice (0.191), noise31/pkg-4978-nm-voice (0.190), noise70/pkg-3368-nm-voice (0.186) |

### windows-analyzer: `Windows program/executable analyzer`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | win/binary-explain (0.387), win/pe-inspector (0.353), noise41/pkg-9741-nm-windows (0.290), noise96/pkg-9602-nm-windows (0.282), noise9/pkg-397-nm-windows (0.282), noise81/pkg-8132-nm-windows (0.279), noise94/pkg-1937-nm-windows (0.278), noise72/pkg-9287-nm-windows (0.278), noise94/pkg-8727-nm-windows (0.277), noise71/pkg-3757-nm-windows (0.276) |
| hybrid | 1.00 | 1.00 | win/binary-explain (0.550), win/pe-inspector (0.438), noise96/pkg-9602-nm-windows (0.202), noise9/pkg-397-nm-windows (0.201), noise41/pkg-9741-nm-windows (0.191), noise81/pkg-8132-nm-windows (0.188), noise94/pkg-1937-nm-windows (0.184), noise72/pkg-9287-nm-windows (0.183), noise94/pkg-8727-nm-windows (0.178), noise71/pkg-3757-nm-windows (0.177) |

### download-manager: `torrent and normal download manager`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.00 | 0.00 | noise92/pkg-189-nm-download (0.484), noise70/pkg-4144-nm-download (0.483), noise40/pkg-7994-nm-download (0.483), noise58/pkg-2289-nm-download (0.482), noise79/pkg-2989-nm-download (0.482), noise65/pkg-259-nm-download (0.481), noise3/pkg-7084-nm-download (0.480), noise84/pkg-3479-nm-download (0.480), noise86/pkg-7749-nm-download (0.480), noise52/pkg-3059-nm-download (0.478) |
| hybrid | 0.00 | 0.00 | noise92/pkg-189-nm-download (0.650), noise70/pkg-4144-nm-download (0.599), noise40/pkg-7994-nm-download (0.598), noise58/pkg-2289-nm-download (0.574), noise79/pkg-2989-nm-download (0.554), noise65/pkg-259-nm-download (0.518), noise84/pkg-3479-nm-download (0.495), noise86/pkg-7749-nm-download (0.487), noise3/pkg-7084-nm-download (0.481), noise52/pkg-3059-nm-download (0.442) |

### net-monitor: `self-hosted network monitoring`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | ops/host-pulse (0.289), noise13/pkg-2535-nm-network (0.276), ops/infra-dashboard (0.266), noise66/pkg-3655-nm-network (0.253), noise53/pkg-3060-nm-network (0.247), noise72/pkg-4146-nm-network (0.246), noise74/pkg-365-nm-network (0.244), noise67/pkg-5790-nm-network (0.243), web/miniflux-tools (0.246), noise0/pkg-5335-nm-network (0.242) |
| hybrid | 1.00 | 1.00 | ops/host-pulse (0.622), noise13/pkg-2535-nm-network (0.538), ops/infra-dashboard (0.436), noise66/pkg-3655-nm-network (0.337), noise53/pkg-3060-nm-network (0.293), noise72/pkg-4146-nm-network (0.263), noise74/pkg-365-nm-network (0.258), noise67/pkg-5790-nm-network (0.254), noise0/pkg-5335-nm-network (0.236), web/miniflux-tools (0.228) |

### mc-economy: `Minecraft server economy tracker`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 0.20 | noise16/pkg-2538-nm-minecraft (0.387), noise75/pkg-2888-nm-minecraft (0.377), noise26/pkg-3518-nm-minecraft (0.376), noise26/pkg-6913-nm-minecraft (0.371), mc/shop-stats (0.374), noise39/pkg-7508-nm-minecraft (0.371), noise94/pkg-2713-nm-minecraft (0.369), noise6/pkg-1558-nm-minecraft (0.367), noise29/pkg-3133-nm-minecraft (0.367), noise93/pkg-578-nm-minecraft (0.367) |
| hybrid | 0.50 | 0.17 | noise16/pkg-2538-nm-minecraft (0.650), noise75/pkg-2888-nm-minecraft (0.492), noise26/pkg-3518-nm-minecraft (0.486), noise26/pkg-6913-nm-minecraft (0.406), noise39/pkg-7508-nm-minecraft (0.399), mc/shop-stats (0.366), noise94/pkg-2713-nm-minecraft (0.360), noise6/pkg-1558-nm-minecraft (0.336), noise29/pkg-3133-nm-minecraft (0.332), noise93/pkg-578-nm-minecraft (0.330) |

### gh-backup: `GitHub backup/archive utility`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | archive/gh-mirror (0.443), archive/repo-vault (0.396), noise19/pkg-407-nm-git (0.307), noise34/pkg-4011-nm-git (0.298), cli/tig-plus (0.295), noise96/pkg-8632-nm-git (0.290), noise1/pkg-2717-nm-git (0.285), noise82/pkg-9297-nm-git (0.282), noise64/pkg-8212-nm-git (0.281), noise12/pkg-9227-nm-git (0.281) |
| hybrid | 1.00 | 1.00 | archive/gh-mirror (0.600), archive/repo-vault (0.433), noise19/pkg-407-nm-git (0.212), noise34/pkg-4011-nm-git (0.192), noise96/pkg-8632-nm-git (0.157), cli/tig-plus (0.151), noise82/pkg-9297-nm-git (0.132), noise1/pkg-2717-nm-git (0.131), noise64/pkg-8212-nm-git (0.127), noise12/pkg-9227-nm-git (0.126) |

### local-notes: `local-first note application`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | notes/ink-local (0.315), noise89/pkg-1350-nm-notes (0.265), noise89/pkg-4745-nm-notes (0.264), noise91/pkg-2225-nm-notes (0.263), noise34/pkg-6145-nm-notes (0.263), noise82/pkg-3380-nm-notes (0.262), noise77/pkg-2890-nm-notes (0.259), noise19/pkg-4675-nm-notes (0.259), noise62/pkg-1420-nm-notes (0.257), noise67/pkg-8700-nm-notes (0.257) |
| hybrid | 0.50 | 1.00 | notes/ink-local (0.638), noise89/pkg-1350-nm-notes (0.260), noise91/pkg-2225-nm-notes (0.247), noise34/pkg-6145-nm-notes (0.245), noise89/pkg-4745-nm-notes (0.244), noise82/pkg-3380-nm-notes (0.243), noise77/pkg-2890-nm-notes (0.220), noise19/pkg-4675-nm-notes (0.215), noise62/pkg-1420-nm-notes (0.203), noise67/pkg-8700-nm-notes (0.202) |

### term-fm: `terminal file manager`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | cli/yazi-twin (-12.044) |
| semantic | 1.00 | 1.00 | cli/yazi-twin (0.382), cli/ranger-like (0.371), noise94/pkg-1937-nm-windows (0.333), noise33/pkg-4107-nm-windows (0.316), noise62/pkg-4912-nm-windows (0.316), noise6/pkg-4177-nm-windows (0.314), noise2/pkg-2427-nm-windows (0.311), noise6/pkg-782-nm-windows (0.309), noise64/pkg-2392-nm-windows (0.311), noise67/pkg-2007-nm-windows (0.309) |
| hybrid | 1.00 | 1.00 | cli/yazi-twin (0.914), cli/ranger-like (0.507), noise94/pkg-1937-nm-windows (0.338), noise33/pkg-4107-nm-windows (0.231), noise62/pkg-4912-nm-windows (0.226), noise6/pkg-4177-nm-windows (0.199), noise6/pkg-782-nm-windows (0.185), noise2/pkg-2427-nm-windows (0.183), noise67/pkg-2007-nm-windows (0.182), noise64/pkg-2392-nm-windows (0.171) |

### pe-re: `reverse engineering PE tool`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | win/pe-inspector (0.398), re/importscope (0.310), noise70/pkg-5017-nm-windows (0.264), noise67/pkg-8797-nm-windows (0.255), noise64/pkg-2392-nm-windows (0.254), noise94/pkg-8727-nm-windows (0.249), noise33/pkg-4107-nm-windows (0.248), noise48/pkg-8002-nm-git (0.249), noise81/pkg-1924-nm-ops (0.247), noise54/pkg-8202-nm-windows (0.245) |
| hybrid | 1.00 | 1.00 | win/pe-inspector (0.617), re/importscope (0.258), noise67/pkg-8797-nm-windows (0.177), noise70/pkg-5017-nm-windows (0.166), noise64/pkg-2392-nm-windows (0.162), noise94/pkg-8727-nm-windows (0.157), noise33/pkg-4107-nm-windows (0.153), noise48/pkg-8002-nm-git (0.145), noise81/pkg-1924-nm-ops (0.145), noise54/pkg-8202-nm-windows (0.144) |

### dep-viz: `software dependency visualizer`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | dev/dep-graph (0.509), noise86/pkg-571-nm-windows (0.419), noise84/pkg-6486-nm-windows (0.424), noise51/pkg-536-nm-windows (0.414), noise93/pkg-5331-nm-windows (0.414), noise15/pkg-1761-nm-windows (0.412), noise93/pkg-1936-nm-windows (0.412), noise63/pkg-5786-nm-windows (0.411), noise59/pkg-641-nm-windows (0.410), cli/tig-plus (0.411) |
| hybrid | 0.50 | 1.00 | dev/dep-graph (0.632), noise86/pkg-571-nm-windows (0.201), noise84/pkg-6486-nm-windows (0.182), noise51/pkg-536-nm-windows (0.175), noise15/pkg-1761-nm-windows (0.168), noise93/pkg-1936-nm-windows (0.167), noise93/pkg-5331-nm-windows (0.166), noise63/pkg-5786-nm-windows (0.160), noise23/pkg-5261-nm-windows (0.149), noise85/pkg-5226-nm-windows (0.147) |

### ssg: `static site generator`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | web/tiny-ssg (-12.018) |
| semantic | 1.00 | 1.00 | web/md-site-kit (0.377), web/tiny-ssg (0.350), noise89/pkg-9789-nm-photos (0.300), noise69/pkg-7829-nm-photos (0.285), noise79/pkg-2019-nm-photos (0.281), noise44/pkg-1984-nm-photos (0.279), noise61/pkg-4329-nm-photos (0.274), noise28/pkg-1774-nm-photos (0.284), noise36/pkg-1879-nm-photos (0.273), noise14/pkg-9229-nm-photos (0.273) |
| hybrid | 1.00 | 1.00 | web/tiny-ssg (0.820), web/md-site-kit (0.605), noise89/pkg-9789-nm-photos (0.284), noise69/pkg-7829-nm-photos (0.226), noise79/pkg-2019-nm-photos (0.207), noise44/pkg-1984-nm-photos (0.196), noise61/pkg-4329-nm-photos (0.173), noise36/pkg-1879-nm-photos (0.169), noise14/pkg-9229-nm-photos (0.167), noise46/pkg-2859-nm-photos (0.167) |

### photo-manager: `self-hosted photo manager`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | media/photoprism-lite (0.461), noise71/pkg-1914-nm-photos (0.305), noise9/pkg-1949-nm-photos (0.295), noise89/pkg-9789-nm-photos (0.295), noise70/pkg-8703-nm-photos (0.294), noise35/pkg-1878-nm-photos (0.290), noise0/pkg-3104-nm-photos (0.290), noise27/pkg-6429-nm-photos (0.289), noise49/pkg-9264-nm-photos (0.289), noise83/pkg-3769-nm-photos (0.288) |
| hybrid | 0.50 | 1.00 | media/photoprism-lite (0.629), noise71/pkg-1914-nm-photos (0.182), noise9/pkg-1949-nm-photos (0.150), noise89/pkg-9789-nm-photos (0.148), noise70/pkg-8703-nm-photos (0.147), noise35/pkg-1878-nm-photos (0.135), noise0/pkg-3104-nm-photos (0.135), noise27/pkg-6429-nm-photos (0.133), noise49/pkg-9264-nm-photos (0.132), noise83/pkg-3769-nm-photos (0.129) |

### discord-voice: `Discord voice bot`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | voice/whisper-discord-bot (-12.751), noise10/pkg-10-nm-discord (-10.302), noise45/pkg-45-nm-discord (-10.302), noise80/pkg-80-nm-discord (-10.302), noise18/pkg-115-nm-discord (-10.302), noise53/pkg-150-nm-discord (-10.302), noise88/pkg-185-nm-discord (-10.302), noise26/pkg-220-nm-discord (-10.302), noise61/pkg-255-nm-discord (-10.302), noise96/pkg-290-nm-discord (-10.302) |
| semantic | 0.50 | 1.00 | voice/whisper-discord-bot (0.581), noise8/pkg-2530-nm-discord (0.556), noise80/pkg-6870-nm-discord (0.553), noise92/pkg-1935-nm-discord (0.553), noise34/pkg-7115-nm-discord (0.553), noise67/pkg-2880-nm-discord (0.552), noise59/pkg-6170-nm-discord (0.551), noise0/pkg-9215-nm-discord (0.549), noise91/pkg-3195-nm-discord (0.549), noise70/pkg-9285-nm-discord (0.548) |
| hybrid | 0.50 | 1.00 | voice/whisper-discord-bot (0.992), noise8/pkg-2530-nm-discord (0.373), noise80/pkg-6870-nm-discord (0.336), noise92/pkg-1935-nm-discord (0.332), noise34/pkg-7115-nm-discord (0.323), noise67/pkg-2880-nm-discord (0.318), noise59/pkg-6170-nm-discord (0.309), noise0/pkg-9215-nm-discord (0.292), noise91/pkg-3195-nm-discord (0.285), noise70/pkg-9285-nm-discord (0.272) |

### db-migrate: `database migration tool`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | db/flyway-lite (0.500), db/schema-evolve (0.446), data/sheet-to-sql (0.346), re/importscope (0.345), noise11/pkg-1951-nm-db (0.323), noise8/pkg-3306-nm-network (0.318), noise65/pkg-1811-nm-db (0.318), noise73/pkg-1916-nm-db (0.315), noise27/pkg-5556-nm-db (0.314), noise40/pkg-6151-nm-db (0.314) |
| hybrid | 1.00 | 1.00 | db/flyway-lite (0.589), db/schema-evolve (0.461), data/sheet-to-sql (0.168), noise11/pkg-1951-nm-db (0.153), noise8/pkg-3306-nm-network (0.141), noise73/pkg-1916-nm-db (0.131), noise27/pkg-5556-nm-db (0.130), noise40/pkg-6151-nm-db (0.129), noise65/pkg-1811-nm-db (0.128), noise32/pkg-6046-nm-db (0.126) |

### pcap: `network packet analyzer`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 0.50 | noise80/pkg-9780-nm-network (0.346), net/pcap-viewer (0.341), net/wire-glance (0.334), noise13/pkg-2535-nm-network (0.328), noise0/pkg-8730-nm-network (0.327), noise62/pkg-1905-nm-network (0.326), noise96/pkg-1939-nm-download (0.317), noise70/pkg-2010-nm-network (0.315), noise67/pkg-5790-nm-network (0.315), noise73/pkg-1625-nm-network (0.313) |
| hybrid | 1.00 | 0.50 | noise80/pkg-9780-nm-network (0.643), net/pcap-viewer (0.531), noise13/pkg-2535-nm-network (0.457), noise0/pkg-8730-nm-network (0.452), noise62/pkg-1905-nm-network (0.437), net/wire-glance (0.434), noise96/pkg-1939-nm-download (0.329), noise70/pkg-2010-nm-network (0.324), noise67/pkg-5790-nm-network (0.323), noise73/pkg-1625-nm-network (0.300) |

### meaning-voice-channel: `program that talks back to people in a voice channel`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.00 | 0.00 | voice/offline-speech-kit (0.445), noise59/pkg-253-nm-voice (0.425), noise89/pkg-3193-nm-voice (0.402), noise68/pkg-2493-nm-voice (0.399), noise76/pkg-2598-nm-voice (0.394), noise46/pkg-3053-nm-voice (0.391), noise30/pkg-2843-nm-voice (0.390), noise82/pkg-1828-nm-voice (0.390), noise19/pkg-9913-nm-voice (0.386), noise57/pkg-9563-nm-voice (0.386) |
| hybrid | 0.00 | 0.00 | voice/offline-speech-kit (0.550), noise59/pkg-253-nm-voice (0.492), noise89/pkg-3193-nm-voice (0.309), noise68/pkg-2493-nm-voice (0.284), noise76/pkg-2598-nm-voice (0.241), noise46/pkg-3053-nm-voice (0.221), noise30/pkg-2843-nm-voice (0.211), noise82/pkg-1828-nm-voice (0.200), noise19/pkg-9913-nm-voice (0.183), noise57/pkg-9563-nm-voice (0.183) |

### meaning-windows-does: `figure out what a Windows program does`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | win/binary-explain (0.509), noise41/pkg-9741-nm-windows (0.384), noise31/pkg-1971-nm-windows (0.371), noise71/pkg-9286-nm-windows (0.363), noise66/pkg-2006-nm-windows (0.363), noise36/pkg-9251-nm-windows (0.361), noise93/pkg-1936-nm-windows (0.358), noise69/pkg-1621-nm-windows (0.357), noise10/pkg-8061-nm-windows (0.356), noise58/pkg-1901-nm-windows (0.354) |
| hybrid | 0.50 | 1.00 | win/binary-explain (0.617), noise41/pkg-9741-nm-windows (0.237), noise31/pkg-1971-nm-windows (0.211), noise71/pkg-9286-nm-windows (0.186), noise66/pkg-2006-nm-windows (0.184), noise36/pkg-9251-nm-windows (0.180), noise93/pkg-1936-nm-windows (0.169), noise69/pkg-1621-nm-windows (0.165), noise10/pkg-8061-nm-windows (0.162), noise58/pkg-1901-nm-windows (0.158) |

### meaning-network-eye: `keep an eye on machines on my network`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | ops/host-pulse (0.222), noise14/pkg-2536-nm-network (0.192), noise40/pkg-5860-nm-network (0.191), net/wire-glance (0.193), noise35/pkg-1975-nm-network (0.185), noise36/pkg-1976-nm-network (0.185), noise69/pkg-7926-nm-network (0.184), noise61/pkg-4426-nm-network (0.185), noise27/pkg-9921-nm-network (0.183), noise13/pkg-2535-nm-network (0.183) |
| hybrid | 0.50 | 1.00 | ops/host-pulse (0.611), noise14/pkg-2536-nm-network (0.342), noise40/pkg-5860-nm-network (0.333), net/wire-glance (0.285), noise35/pkg-1975-nm-network (0.277), noise36/pkg-1976-nm-network (0.270), noise69/pkg-7926-nm-network (0.264), noise27/pkg-9921-nm-network (0.251), noise13/pkg-2535-nm-network (0.251), noise60/pkg-2291-nm-network (0.247) |

### container-orch: `lightweight container orchestration`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | ops/compose-fleet (0.372), noise26/pkg-9920-nm-network (0.298), noise66/pkg-3655-nm-network (0.285), noise25/pkg-995-nm-network (0.284), noise88/pkg-6490-nm-network (0.286), noise62/pkg-8695-nm-network (0.282), noise82/pkg-470-nm-network (0.282), noise60/pkg-1030-nm-network (0.282), noise80/pkg-2990-nm-network (0.280), noise70/pkg-2010-nm-network (0.279) |
| hybrid | 0.50 | 1.00 | ops/compose-fleet (0.623), noise26/pkg-9920-nm-network (0.257), noise66/pkg-3655-nm-network (0.189), noise25/pkg-995-nm-network (0.187), noise62/pkg-8695-nm-network (0.175), noise82/pkg-470-nm-network (0.174), noise60/pkg-1030-nm-network (0.173), noise88/pkg-6490-nm-network (0.167), noise70/pkg-2010-nm-network (0.158), noise67/pkg-5790-nm-network (0.157) |

### password-mgr: `self-hosted password manager`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.00 | 0.00 | noise79/pkg-1922-nm-password (0.404), noise55/pkg-1607-nm-password (0.391), noise20/pkg-4967-nm-password (0.385), noise92/pkg-2517-nm-password (0.383), noise22/pkg-2447-nm-password (0.381), noise44/pkg-1887-nm-password (0.377), noise52/pkg-1992-nm-password (0.374), noise57/pkg-9272-nm-password (0.373), noise28/pkg-1677-nm-password (0.373), noise49/pkg-5772-nm-password (0.372) |
| hybrid | 0.00 | 0.00 | noise79/pkg-1922-nm-password (0.650), noise55/pkg-1607-nm-password (0.503), noise20/pkg-4967-nm-password (0.429), noise92/pkg-2517-nm-password (0.402), noise22/pkg-2447-nm-password (0.378), noise44/pkg-1887-nm-password (0.334), noise52/pkg-1992-nm-password (0.300), noise57/pkg-9272-nm-password (0.286), noise28/pkg-1677-nm-password (0.286), noise49/pkg-5772-nm-password (0.274) |

### ci-cache: `CI build cache for monorepos`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | dev/remote-cache (-30.126) |
| semantic | 1.00 | 1.00 | dev/remote-cache (0.411), dev/turbo-cache-proxy (0.384), noise38/pkg-1590-nm-network (0.304), noise31/pkg-3620-nm-network (0.303), noise60/pkg-7820-nm-network (0.290), noise31/pkg-225-nm-network (0.289), noise31/pkg-7015-nm-network (0.286), noise1/pkg-4075-nm-network (0.283), noise74/pkg-3760-nm-network (0.283), noise18/pkg-6420-nm-network (0.282) |
| hybrid | 1.00 | 1.00 | dev/remote-cache (0.915), dev/turbo-cache-proxy (0.478), noise38/pkg-1590-nm-network (0.239), noise31/pkg-3620-nm-network (0.229), noise60/pkg-7820-nm-network (0.185), noise31/pkg-225-nm-network (0.182), noise31/pkg-7015-nm-network (0.170), noise1/pkg-4075-nm-network (0.159), noise74/pkg-3760-nm-network (0.157), noise18/pkg-6420-nm-network (0.156) |

### llm-local: `run language models locally on CPU`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | ai/local-infer (0.383), ai/llamacpp-ui (0.301), noise50/pkg-244-nm-ops (0.281), noise91/pkg-1643-nm-llm (0.273), noise36/pkg-6438-nm-llm (0.272), noise8/pkg-978-nm-llm (0.271), noise18/pkg-1958-nm-llm (0.263), noise85/pkg-279-nm-ops (0.262), noise62/pkg-838-nm-llm (0.262), noise2/pkg-1748-nm-llm (0.261) |
| hybrid | 1.00 | 1.00 | ai/local-infer (0.620), ai/llamacpp-ui (0.314), noise50/pkg-244-nm-ops (0.228), noise91/pkg-1643-nm-llm (0.195), noise36/pkg-6438-nm-llm (0.192), noise8/pkg-978-nm-llm (0.188), noise18/pkg-1958-nm-llm (0.156), noise85/pkg-279-nm-ops (0.153), noise62/pkg-838-nm-llm (0.150), noise2/pkg-1748-nm-llm (0.146) |

### rss-reader: `self-hosted RSS feed reader`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | web/miniflux-tools (-15.667) |
| semantic | 1.00 | 1.00 | web/feed-nest (0.514), noise50/pkg-6646-nm-rss (0.500), noise36/pkg-521-nm-rss (0.499), noise80/pkg-2796-nm-rss (0.496), noise83/pkg-2411-nm-rss (0.493), noise71/pkg-7346-nm-rss (0.492), noise70/pkg-5211-nm-rss (0.492), web/miniflux-tools (0.495), noise74/pkg-171-nm-rss (0.489), noise6/pkg-976-nm-rss (0.488) |
| hybrid | 1.00 | 1.00 | web/miniflux-tools (0.617), web/feed-nest (0.550), noise50/pkg-6646-nm-rss (0.440), noise36/pkg-521-nm-rss (0.422), noise80/pkg-2796-nm-rss (0.381), noise83/pkg-2411-nm-rss (0.325), noise71/pkg-7346-nm-rss (0.322), noise70/pkg-5211-nm-rss (0.319), noise74/pkg-171-nm-rss (0.273), noise6/pkg-976-nm-rss (0.256) |

### git-tui: `terminal git client with diff review`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.00 | 0.00 | noise57/pkg-5586-nm-git (0.445), noise77/pkg-4151-nm-git (0.445), noise10/pkg-301-nm-git (0.445), noise57/pkg-2191-nm-git (0.440), noise95/pkg-1841-nm-git (0.436), noise80/pkg-371-nm-git (0.436), noise61/pkg-3941-nm-git (0.433), noise0/pkg-2716-nm-git (0.432), noise15/pkg-4186-nm-git (0.432), noise3/pkg-5726-nm-git (0.429) |
| hybrid | 0.00 | 0.00 | noise57/pkg-5586-nm-git (0.636), noise77/pkg-4151-nm-git (0.619), noise10/pkg-301-nm-git (0.556), noise57/pkg-2191-nm-git (0.549), noise95/pkg-1841-nm-git (0.476), noise80/pkg-371-nm-git (0.472), noise61/pkg-3941-nm-git (0.437), noise0/pkg-2716-nm-git (0.404), noise15/pkg-4186-nm-git (0.398), noise3/pkg-5726-nm-git (0.354) |

### csv-etl: `transform messy CSV into a clean database`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | data/csv-normalize (0.512), noise17/pkg-9232-nm-csv (0.441), noise12/pkg-1952-nm-csv (0.439), noise43/pkg-3632-nm-csv (0.429), noise25/pkg-9337-nm-csv (0.427), noise82/pkg-2022-nm-csv (0.426), noise41/pkg-9547-nm-csv (0.424), noise2/pkg-4367-nm-csv (0.424), noise47/pkg-1987-nm-csv (0.422), noise39/pkg-1882-nm-csv (0.422) |
| hybrid | 0.50 | 1.00 | data/csv-normalize (0.572), noise17/pkg-9232-nm-csv (0.270), noise12/pkg-1952-nm-csv (0.260), noise43/pkg-3632-nm-csv (0.204), noise25/pkg-9337-nm-csv (0.197), noise82/pkg-2022-nm-csv (0.192), noise41/pkg-9547-nm-csv (0.182), noise2/pkg-4367-nm-csv (0.178), noise47/pkg-1987-nm-csv (0.169), noise39/pkg-1882-nm-csv (0.167) |

## Hybrid weight comparison

```json
[
  {
    "weights": {
      "semantic": 0.7,
      "lexical": 0.25,
      "quality": 0.05
    },
    "macro_recall_at_10": 0.66,
    "macro_mrr": 0.79
  },
  {
    "weights": {
      "semantic": 0.6,
      "lexical": 0.3,
      "quality": 0.1
    },
    "macro_recall_at_10": 0.66,
    "macro_mrr": 0.7866666666666666
  },
  {
    "weights": {
      "semantic": 0.55,
      "lexical": 0.35,
      "quality": 0.1
    },
    "macro_recall_at_10": 0.66,
    "macro_mrr": 0.7866666666666666
  },
  {
    "weights": {
      "semantic": 0.45,
      "lexical": 0.45,
      "quality": 0.1
    },
    "macro_recall_at_10": 0.66,
    "macro_mrr": 0.7857142857142857
  }
]
```

## TurboVec 2/3/4-bit vs exact

```json
{
  "ok": true,
  "n_docs": 3000,
  "model": "sentence-transformers/all-MiniLM-L6-v2",
  "model_load_s": 0.8821096770006989,
  "embed_docs_s": 8.522691087000567,
  "docs_per_s": 352.001494525106,
  "exact_query_p50_ms": 114.06265900041035,
  "exact_query_p95_ms": 123.48124979980639,
  "exact_macro_recall_at_10": 0.76,
  "exact_macro_mrr": 0.88,
  "bits": [
    {
      "bits": 2,
      "index_bytes": 569907,
      "build_s": 0.012003362999166711,
      "search_p50_ms": 0.07837100019969512,
      "search_p95_ms": 0.09887940068438182,
      "macro_recall_at_10": 0.74,
      "macro_mrr": 0.85,
      "mean_overlap_at_10_vs_exact": 0.49200000000000005
    },
    {
      "bits": 3,
      "index_bytes": 1058195,
      "build_s": 0.006820577000326011,
      "search_p50_ms": 0.08963700020103715,
      "search_p95_ms": 0.0937000000703847,
      "macro_recall_at_10": 0.72,
      "macro_mrr": 0.8533333333333333,
      "mean_overlap_at_10_vs_exact": 0.612
    },
    {
      "bits": 4,
      "index_bytes": 1058259,
      "build_s": 0.00719123899943952,
      "search_p50_ms": 0.09892200068861712,
      "search_p95_ms": 0.10169919878535438,
      "macro_recall_at_10": 0.74,
      "macro_mrr": 0.88,
      "mean_overlap_at_10_vs_exact": 0.772
    }
  ],
  "sample_names": [
    "voice/wake-word-local",
    "voice/offline-speech-kit",
    "voice/whisper-discord-bot",
    "voice/discord-tts",
    "win/pe-inspector"
  ]
}
```

## TurboVec microbench (random vectors)

```json
[
  {
    "n": 10000,
    "dim": 384,
    "bits": 2,
    "build_seconds": 0.04258988999936264,
    "vectors_per_sec": 234797.5071114213,
    "index_bytes": 1326771,
    "last_sync_at": "2026-08-20T20:40:20Z",
    "query_p50_ms": 0.03325499983475311,
    "query_p95_ms": 0.04565400013234466,
    "query_p99_ms": 0.18598400038172258,
    "queries_per_sec": 25466.871411106218,
    "filtered_p50_ms": 0.07459300013579195,
    "filtered_p95_ms": 0.09861200032901252,
    "add_p50_ms": 0.004400000761961564,
    "remove_p50_ms": 0.0010109997674589977
  },
  {
    "n": 10000,
    "dim": 384,
    "bits": 3,
    "build_seconds": 0.023634417999346624,
    "vectors_per_sec": 423111.75169519515,
    "index_bytes": 2487827,
    "last_sync_at": "2026-08-20T20:40:21Z",
    "query_p50_ms": 0.06904000019858358,
    "query_p95_ms": 0.08745200011617271,
    "query_p99_ms": 0.1822479998736526,
    "queries_per_sec": 13574.972370189142,
    "filtered_p50_ms": 0.12051900012011174,
    "filtered_p95_ms": 0.12939299995196052,
    "add_p50_ms": 0.004343999535194598,
    "remove_p50_ms": 0.0014320003174361773
  },
  {
    "n": 10000,
    "dim": 384,
    "bits": 4,
    "build_seconds": 0.02424410200001148,
    "vectors_per_sec": 412471.4538816601,
    "index_bytes": 2487891,
    "last_sync_at": "2026-08-20T20:40:22Z",
    "query_p50_ms": 0.10831899999175221,
    "query_p95_ms": 0.12471399986679899,
    "query_p99_ms": 0.20454100013012066,
    "queries_per_sec": 8895.979972979716,
    "filtered_p50_ms": 0.15944900042086374,
    "filtered_p95_ms": 0.18597399957798189,
    "add_p50_ms": 0.004532999810180627,
    "remove_p50_ms": 0.0014219995136954822
  },
  {
    "n": 50000,
    "dim": 384,
    "bits": 2,
    "build_seconds": 0.09068614600073488,
    "vectors_per_sec": 551352.1326575597,
    "index_bytes": 5646771,
    "last_sync_at": "2026-08-20T20:40:28Z",
    "query_p50_ms": 0.10572500013950048,
    "query_p95_ms": 0.24165400009223958,
    "query_p99_ms": 0.3149429994664388,
    "queries_per_sec": 7795.5644408342005,
    "filtered_p50_ms": 0.4077659996255534,
    "filtered_p95_ms": 0.5510910004886682,
    "add_p50_ms": 0.004538000212050974,
    "remove_p50_ms": 0.0010080002539325505
  },
  {
    "n": 50000,
    "dim": 384,
    "bits": 3,
    "build_seconds": 0.11731375199997274,
    "vectors_per_sec": 426207.4918549329,
    "index_bytes": 10647827,
    "last_sync_at": "2026-08-20T20:40:34Z",
    "query_p50_ms": 0.17196400040120352,
    "query_p95_ms": 0.3030090001630015,
    "query_p99_ms": 0.5388859999584383,
    "queries_per_sec": 5123.18703188403,
    "filtered_p50_ms": 0.5031769997003721,
    "filtered_p95_ms": 0.7587070003864937,
    "add_p50_ms": 0.004645000444725156,
    "remove_p50_ms": 0.001463999979023356
  },
  {
    "n": 50000,
    "dim": 384,
    "bits": 4,
    "build_seconds": 0.1111801529996228,
    "vectors_per_sec": 449720.55399284826,
    "index_bytes": 10647891,
    "last_sync_at": "2026-08-20T20:40:40Z",
    "query_p50_ms": 0.1592900007381104,
    "query_p95_ms": 0.35368200042285025,
    "query_p99_ms": 0.41715899988048477,
    "queries_per_sec": 5317.502773042324,
    "filtered_p50_ms": 0.4360270004326594,
    "filtered_p95_ms": 0.5688979999831645,
    "add_p50_ms": 0.004787000762007665,
    "remove_p50_ms": 0.0014360002751345746
  }
]
```

## Restart / removal

```json
{
  "indexed_before": 9995,
  "indexed_after_restart": 9995,
  "top_ids_before": [
    3,
    2574,
    6914,
    1979,
    7159
  ],
  "top_ids_after": [
    3,
    2574,
    6914,
    1979,
    7159
  ],
  "removed_ids": [
    3,
    2574,
    6914
  ],
  "removed_still_absent": true,
  "contains": {
    "present": [],
    "missing": [
      3,
      2574,
      6914
    ]
  }
}
```

## Filters (every returned row asserted)

```json
[
  {
    "name": "language=Python",
    "query": "offline speech recognition wake word",
    "opts": {
      "language": "Python"
    },
    "softMax": 80,
    "eligibleCount": 1430,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 2,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "minStars=500",
    "query": "download manager torrent",
    "opts": {
      "minStars": 500
    },
    "softMax": 80,
    "eligibleCount": 8972,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "maxStars=50",
    "query": "utility formatting JSON logs",
    "opts": {
      "maxStars": 50
    },
    "softMax": 80,
    "eligibleCount": 101,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 2,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "category=networking",
    "query": "network monitoring dashboard",
    "opts": {
      "category": "networking"
    },
    "softMax": 80,
    "eligibleCount": 1146,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "cluster=ops",
    "query": "infrastructure monitoring",
    "opts": {
      "cluster": "ops"
    },
    "softMax": 80,
    "eligibleCount": 322,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 11,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "date range 2024",
    "query": "local voice assistant",
    "opts": {
      "dateFrom": "2024-01-01",
      "dateTo": "2024-12-31"
    },
    "softMax": 80,
    "eligibleCount": 9995,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "hasReadme",
    "query": "GitHub backup archive",
    "opts": {
      "hasReadme": true
    },
    "softMax": 80,
    "eligibleCount": 906,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "hasRelease",
    "query": "GitHub backup archive",
    "opts": {
      "hasRelease": true
    },
    "softMax": 80,
    "eligibleCount": 433,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 19,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "archivedOnly",
    "query": "GitHub backup archive",
    "opts": {
      "archivedOnly": true
    },
    "softMax": 80,
    "eligibleCount": 906,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": null,
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "language=Python soft-max exceeded",
    "query": "offline speech recognition wake word",
    "opts": {
      "language": "Python"
    },
    "softMax": 50,
    "eligibleCount": 1430,
    "retrievalPath": "post-filter",
    "postFilterPathExercised": true,
    "returned": 2,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "no hard filters still hides tombstones",
    "query": "utility formatting JSON logs",
    "opts": {},
    "softMax": 80,
    "eligibleCount": 9995,
    "retrievalPath": "unfiltered",
    "postFilterPathExercised": null,
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  }
]
```

## Recommended production configuration

```json
{
  "verdict": "GO_BEHIND_FEATURE_FLAG",
  "go": true,
  "keep_default_weights": true,
  "default_weights_note": "Do not change defaults from this synthetic run alone. Current 0.55/0.35/0.10 remains recommended unless production-snapshot traffic clearly prefers another mix.",
  "observed_best_weights": {
    "weights": {
      "semantic": 0.7,
      "lexical": 0.25,
      "quality": 0.05
    },
    "macro_recall_at_10": 0.66,
    "macro_mrr": 0.79
  },
  "vector_bits_default": 2,
  "vector_bits_note": "2-bit remains sensible (smallest index, labeled R@10 near exact). Re-check on a production snapshot before raising bits.",
  "railway": {
    "worker_private": true,
    "expose_publicly": false,
    "measured_python_worker_peak_rss_mb": 948,
    "suggested_ram_gb": 4,
    "suggested_resources": "Private MiniLM worker: start with 4 GB RAM / 1 vCPU for this measured peak (948 MB) with headroom. Scale disk/CPU with archive size. Keep indexBatch/remove/rebuild private.",
    "disk_estimate_2bit_per_100k": "~12–15 MB TurboVec + SQLite state overhead",
    "startup": "MiniLM load typically a few seconds once weights are cached",
    "hybrid_warm_p95_ms": 52.23408900000504
  },
  "blockers": [],
  "limitations": [
    "Corpus is representative with harder near-miss noise — still not a full production dump",
    "Final gate remains a READ-ONLY production-snapshot run of this harness",
    "Weight recommendation must be revalidated on live archive traffic"
  ]
}
```

PR #33 was **not** merged by this validation run.
