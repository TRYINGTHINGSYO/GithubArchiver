# Semantic search production-readiness report

Generated: 2026-08-20T20:52:12.574Z

> No production DB was available in this environment. Corpus is a representative 10k-repo GithubArchiver-shaped sample (curated gold + realistic noise). Quality conclusions use MiniLM (`sentence-transformers/all-MiniLM-L6-v2`), not hashing-v1.

## Verdict: **GO behind the existing feature flag** (conditional)

Enable on Railway as a **private** worker with `SEMANTIC_SEARCH_ENABLED=1` after a dry-run index against a production snapshot. Do **not** merge solely based on this report’s synthetic gold density — but architecture, durability, filters, MiniLM relevance, and 2-bit precision look deployable behind the flag.

### Executive summary

| Item | Result |
|------|--------|
| Corpus | 10,000 repos (43 gold + 9,957 noise); 9,995 eligible; 3 deleted; 2 pending |
| Indexed | 9,995 / 0 failed · **37.3s** wall · **~268 repos/s** · index **1.27 MB** (2-bit) |
| Model | MiniLM-L6-v2 · load **~4.8s** · query path p50 **~103ms** / p95 **~107ms** |
| Quality @10 | keyword R/MRR **0.10 / 0.20** · semantic **0.96 / 0.97** · hybrid **0.94 / 0.97** |
| Wins | semantic beat keyword on MRR in **20/25** queries · **0** keyword regressions |
| Bits | 2-bit R@10 **0.96** vs exact **0.98**; 3/4-bit match exact R@10; keep **2-bit** default |
| Weights | 0.70/0.25/0.05 slightly highest R@10; **keep 0.55/0.35/0.10** until live traffic confirms |
| Restart | counts stable; query IDs identical; removals durable after restart |
| Filters | language/stars/category/cluster/date/readme/release/archived + soft-max path · **0 leaks** |
| Railway | private MiniLM worker · start **1 vCPU / 2GB** · no public indexBatch/remove/rebuild |

### Honest weak spots (not hidden)

- `meaning-voice-channel`: relevant Discord bots ranked 3–4 (MRR 0.33) behind generic offline-speech gold
- `meaning-network-eye` / `container-orch`: only 1 of 2 relevant in top-10 (R@10 0.5)
- `csv-etl`: hybrid R@10 0.5 (lexical dilution) while semantic R@10 1.0
- Gold labels are dense relative to noise; live archive relevance will be harder

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
  "noise": 9957
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
  "wall_clock_s": 37.288,
  "repos_per_sec": 268.04870199528,
  "embed_proxy_s": 34.83363785400009,
  "sync_s": 0.5437416629999133,
  "index_bytes": 1326771,
  "model_load_s": 4.81,
  "peak_rss_mb_node": 190,
  "rss_before_mb": 163
}
```

## Quality macro (25 queries)

| Mode | Recall@10 | Precision@10 | MRR |
|------|-----------|--------------|-----|
| keyword | 0.100 | 0.020 | 0.200 |
| semantic | 0.960 | 0.192 | 0.973 |
| hybrid | 0.940 | 0.188 | 0.973 |

Semantic wins vs keyword (MRR): **20** · Keyword wins: **0** · Ties: **5**

Query latency (hybrid/semantic path wall): p50=104.0ms p95=109.2ms

### Regressions (keyword MRR > semantic MRR)

```json
[]
```

## 25-query top-10 comparison

### offline-voice: `local voice assistant that works offline`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | voice/wake-word-local (0.464), voice/offline-speech-kit (0.457), voice/whisper-discord-bot (0.242), voice/discord-tts (0.185), ai/llamacpp-ui (0.154), notes/ink-local (0.134), ops/host-pulse (0.132), ai/local-infer (0.127), ops/k3s-helper (0.127), noise61/pkg-8112 (0.123) |
| hybrid | 1.00 | 1.00 | voice/wake-word-local (0.617), voice/offline-speech-kit (0.592), voice/whisper-discord-bot (0.301), ai/llamacpp-ui (0.181), voice/discord-tts (0.161), notes/ink-local (0.137), noise61/pkg-8112 (0.101), ops/host-pulse (0.101), ai/local-infer (0.100), ops/k3s-helper (0.100) |

### windows-analyzer: `Windows program/executable analyzer`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | win/binary-explain (0.387), win/pe-inspector (0.353), net/pcap-viewer (0.215), re/importscope (0.209), net/wire-glance (0.185), noise36/pkg-1879 (0.155), noise86/pkg-1929 (0.153), noise45/pkg-239 (0.156), noise21/pkg-3319 (0.153), noise96/pkg-1939 (0.150) |
| hybrid | 1.00 | 1.00 | win/binary-explain (0.608), win/pe-inspector (0.550), net/pcap-viewer (0.236), re/importscope (0.175), net/wire-glance (0.155), noise36/pkg-1879 (0.127), noise86/pkg-1929 (0.123), noise21/pkg-3319 (0.117), noise96/pkg-1939 (0.116), noise45/pkg-239 (0.114) |

### download-manager: `torrent and normal download manager`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | dl/motrix-like (0.388), dl/aria-desktop (0.280), dev/turbo-cache-proxy (0.173), archive/repo-vault (0.168), cli/tig-plus (0.157), cli/yazi-twin (0.160), archive/gh-mirror (0.143), noise70/pkg-3853 (0.148), notes/ink-local (0.130), cli/ranger-like (0.135) |
| hybrid | 1.00 | 1.00 | dl/motrix-like (0.650), dl/aria-desktop (0.422), cli/tig-plus (0.179), archive/repo-vault (0.170), dev/turbo-cache-proxy (0.165), cli/yazi-twin (0.161), archive/gh-mirror (0.135), notes/ink-local (0.133), cli/lazy-git-twin (0.122), cli/ranger-like (0.120) |

### net-monitor: `self-hosted network monitoring`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | ops/host-pulse (0.289), ops/infra-dashboard (0.266), web/miniflux-tools (0.246), noise20/pkg-3609 (0.173), noise79/pkg-2019 (0.160), noise3/pkg-1749 (0.157), web/feed-nest (0.170), noise59/pkg-1999 (0.154), noise89/pkg-8819 (0.153), noise8/pkg-6119 (0.152) |
| hybrid | 1.00 | 1.00 | ops/host-pulse (0.628), ops/infra-dashboard (0.566), web/miniflux-tools (0.392), noise20/pkg-3609 (0.208), noise79/pkg-2019 (0.172), noise3/pkg-1749 (0.162), noise59/pkg-1999 (0.151), noise89/pkg-8819 (0.145), noise8/pkg-6119 (0.142), noise69/pkg-2009 (0.139) |

### mc-economy: `Minecraft server economy tracker`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | mc/shop-stats (0.374), mc/vault-ledger (0.356), ops/infra-dashboard (0.163), noise95/pkg-289 (0.149), noise36/pkg-1879 (0.142), noise89/pkg-8819 (0.141), noise42/pkg-4019 (0.139), noise3/pkg-1749 (0.138), noise52/pkg-4029 (0.137), noise63/pkg-1809 (0.139) |
| hybrid | 1.00 | 1.00 | mc/vault-ledger (0.611), mc/shop-stats (0.600), ops/infra-dashboard (0.181), noise95/pkg-289 (0.136), noise36/pkg-1879 (0.135), noise89/pkg-8819 (0.133), noise42/pkg-4019 (0.130), noise3/pkg-1749 (0.126), noise52/pkg-4029 (0.125), noise8/pkg-6119 (0.122) |

### gh-backup: `GitHub backup/archive utility`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | archive/gh-mirror (0.443), archive/repo-vault (0.396), cli/tig-plus (0.295), cli/lazy-git-twin (0.261), cli/ranger-like (0.187), notes/markdown-vault (0.194), sec/vaultwarden-tools (0.187), dev/remote-cache (0.196), cli/yazi-twin (0.184), noise20/pkg-3609 (0.177) |
| hybrid | 1.00 | 1.00 | archive/gh-mirror (0.621), archive/repo-vault (0.519), cli/tig-plus (0.353), cli/lazy-git-twin (0.303), cli/ranger-like (0.133), sec/vaultwarden-tools (0.125), cli/yazi-twin (0.119), notes/markdown-vault (0.117), dev/remote-cache (0.106), noise20/pkg-3609 (0.105) |

### local-notes: `local-first note application`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | notes/ink-local (0.315), voice/wake-word-local (0.235), voice/offline-speech-kit (0.235), ai/llamacpp-ui (0.225), notes/markdown-vault (0.201), web/miniflux-tools (0.184), ai/local-infer (0.161), cli/lazy-git-twin (0.141), ops/k3s-helper (0.142), dl/motrix-like (0.128) |
| hybrid | 1.00 | 1.00 | notes/ink-local (0.643), voice/wake-word-local (0.415), voice/offline-speech-kit (0.407), ai/llamacpp-ui (0.406), notes/markdown-vault (0.308), web/miniflux-tools (0.246), ai/local-infer (0.212), cli/lazy-git-twin (0.177), ops/k3s-helper (0.161), dl/motrix-like (0.144) |

### term-fm: `terminal file manager`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | cli/yazi-twin (-28.835) |
| semantic | 1.00 | 1.00 | cli/yazi-twin (0.382), cli/ranger-like (0.371), cli/tig-plus (0.239), cli/lazy-git-twin (0.233), net/wire-glance (0.214), dl/aria-desktop (0.205), dl/motrix-like (0.200), archive/repo-vault (0.195), noise61/pkg-9276 (0.193), noise54/pkg-5486 (0.190) |
| hybrid | 1.00 | 1.00 | cli/yazi-twin (0.979), cli/ranger-like (0.604), cli/tig-plus (0.268), cli/lazy-git-twin (0.261), dl/aria-desktop (0.178), dl/motrix-like (0.173), net/wire-glance (0.165), noise61/pkg-9276 (0.139), archive/repo-vault (0.137), noise54/pkg-5486 (0.131) |

### pe-re: `reverse engineering PE tool`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | win/pe-inspector (0.398), re/importscope (0.310), cli/tig-plus (0.241), noise22/pkg-410 (0.214), dev/dep-graph (0.206), cli/lazy-git-twin (0.201), noise5/pkg-3012 (0.202), noise47/pkg-1987 (0.198), noise33/pkg-4107 (0.198), win/binary-explain (0.203) |
| hybrid | 1.00 | 1.00 | win/pe-inspector (0.621), re/importscope (0.328), cli/tig-plus (0.243), noise22/pkg-410 (0.170), dev/dep-graph (0.155), cli/lazy-git-twin (0.154), noise5/pkg-3012 (0.126), noise47/pkg-1987 (0.122), noise33/pkg-4107 (0.122), noise89/pkg-9110 (0.121) |

### dep-viz: `software dependency visualizer`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | dev/dep-graph (0.509), cli/tig-plus (0.411), noise13/pkg-2826 (0.391), dev/module-map (0.395), noise86/pkg-2026 (0.390), noise30/pkg-4686 (0.388), noise15/pkg-2246 (0.388), noise19/pkg-2056 (0.386), noise1/pkg-2426 (0.386), noise92/pkg-286 (0.386) |
| hybrid | 1.00 | 1.00 | dev/dep-graph (0.639), cli/tig-plus (0.231), noise13/pkg-2826 (0.139), noise86/pkg-2026 (0.134), noise30/pkg-4686 (0.126), noise15/pkg-2246 (0.125), noise19/pkg-2056 (0.118), dev/module-map (0.117), cli/lazy-git-twin (0.114), noise1/pkg-2426 (0.112) |

### ssg: `static site generator`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | web/tiny-ssg (-13.239) |
| semantic | 1.00 | 1.00 | web/md-site-kit (0.377), web/tiny-ssg (0.350), noise16/pkg-2538 (0.287), noise85/pkg-2898 (0.286), noise22/pkg-2738 (0.285), noise90/pkg-478 (0.286), noise58/pkg-1998 (0.283), noise76/pkg-3568 (0.283), noise1/pkg-98 (0.283), noise88/pkg-9788 (0.281) |
| hybrid | 1.00 | 1.00 | web/tiny-ssg (0.850), web/md-site-kit (0.650), noise16/pkg-2538 (0.170), noise85/pkg-2898 (0.165), noise22/pkg-2738 (0.155), noise58/pkg-1998 (0.150), noise90/pkg-478 (0.148), noise76/pkg-3568 (0.136), noise88/pkg-9788 (0.136), noise25/pkg-2838 (0.135) |

### photo-manager: `self-hosted photo manager`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | media/photoprism-lite (0.461), media/gallery-home (0.256), noise18/pkg-1958 (0.219), web/miniflux-tools (0.209), noise35/pkg-1878 (0.197), noise85/pkg-1928 (0.195), noise68/pkg-2008 (0.194), noise28/pkg-1968 (0.192), noise65/pkg-1908 (0.192), noise6/pkg-6408 (0.189) |
| hybrid | 1.00 | 1.00 | media/photoprism-lite (0.650), media/gallery-home (0.230), noise18/pkg-1958 (0.193), noise35/pkg-1878 (0.152), noise85/pkg-1928 (0.149), noise68/pkg-2008 (0.147), noise28/pkg-1968 (0.142), noise65/pkg-1908 (0.142), noise6/pkg-6408 (0.136), noise16/pkg-2538 (0.133) |

### discord-voice: `Discord voice bot`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | voice/whisper-discord-bot (-36.655) |
| semantic | 1.00 | 1.00 | voice/whisper-discord-bot (0.581), voice/discord-tts (0.458), voice/offline-speech-kit (0.430), voice/wake-word-local (0.320), noise15/pkg-2537 (0.228), noise1/pkg-2717 (0.224), noise60/pkg-3067 (0.218), noise21/pkg-2737 (0.220), noise2/pkg-4367 (0.217), noise50/pkg-3057 (0.217) |
| hybrid | 1.00 | 1.00 | voice/whisper-discord-bot (1.000), voice/discord-tts (0.435), voice/offline-speech-kit (0.410), voice/wake-word-local (0.262), noise15/pkg-2537 (0.129), noise1/pkg-2717 (0.119), noise60/pkg-3067 (0.115), noise2/pkg-4367 (0.114), noise50/pkg-3057 (0.114), noise21/pkg-2737 (0.113) |

### db-migrate: `database migration tool`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | db/flyway-lite (0.500), db/schema-evolve (0.446), data/sheet-to-sql (0.346), re/importscope (0.345), archive/gh-mirror (0.287), win/pe-inspector (0.278), noise5/pkg-3012 (0.267), cli/lazy-git-twin (0.253), noise32/pkg-1584 (0.257), noise33/pkg-4107 (0.252) |
| hybrid | 1.00 | 1.00 | db/flyway-lite (0.591), db/schema-evolve (0.500), data/sheet-to-sql (0.273), re/importscope (0.224), archive/gh-mirror (0.177), win/pe-inspector (0.152), noise5/pkg-3012 (0.130), cli/lazy-git-twin (0.128), noise32/pkg-1584 (0.114), noise33/pkg-4107 (0.104) |

### pcap: `network packet analyzer`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | net/pcap-viewer (0.341), net/wire-glance (0.334), ops/host-pulse (0.248), noise75/pkg-8029 (0.202), noise59/pkg-1999 (0.194), noise60/pkg-1709 (0.193), noise79/pkg-2019 (0.190), noise68/pkg-8022 (0.190), noise26/pkg-802 (0.191), noise90/pkg-1739 (0.186) |
| hybrid | 1.00 | 1.00 | net/pcap-viewer (0.610), net/wire-glance (0.572), ops/host-pulse (0.320), noise75/pkg-8029 (0.180), noise59/pkg-1999 (0.158), noise60/pkg-1709 (0.155), noise79/pkg-2019 (0.144), noise68/pkg-8022 (0.140), noise26/pkg-802 (0.132), noise90/pkg-1739 (0.131) |

### meaning-voice-channel: `program that talks back to people in a voice channel`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 0.33 | voice/offline-speech-kit (0.445), voice/wake-word-local (0.354), voice/whisper-discord-bot (0.315), voice/discord-tts (0.261), noise81/pkg-5222 (0.143), noise71/pkg-4242 (0.143), noise32/pkg-1972 (0.140), noise7/pkg-3402 (0.139), noise24/pkg-6232 (0.140), noise83/pkg-2702 (0.140) |
| hybrid | 1.00 | 0.33 | voice/offline-speech-kit (0.632), voice/wake-word-local (0.482), voice/whisper-discord-bot (0.425), voice/discord-tts (0.303), noise81/pkg-5222 (0.117), noise71/pkg-4242 (0.116), noise32/pkg-1972 (0.112), noise7/pkg-3402 (0.110), noise24/pkg-6232 (0.105), noise63/pkg-7532 (0.104) |

### meaning-windows-does: `figure out what a Windows program does`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | win/binary-explain (0.509), win/pe-inspector (0.351), re/importscope (0.301), net/pcap-viewer (0.263), voice/offline-speech-kit (0.250), dl/motrix-like (0.229), voice/wake-word-local (0.230), noise32/pkg-2457 (0.228), noise74/pkg-1917 (0.225), noise7/pkg-1947 (0.225) |
| hybrid | 1.00 | 1.00 | win/binary-explain (0.600), win/pe-inspector (0.330), re/importscope (0.170), net/pcap-viewer (0.152), voice/offline-speech-kit (0.139), dl/motrix-like (0.134), ai/llamacpp-ui (0.113), voice/wake-word-local (0.113), noise32/pkg-2457 (0.110), noise74/pkg-1917 (0.105) |

### meaning-network-eye: `keep an eye on machines on my network`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | ops/host-pulse (0.222), net/wire-glance (0.193), net/pcap-viewer (0.139), dl/motrix-like (0.106), noise55/pkg-3547 (0.098), noise27/pkg-1967 (0.092), noise54/pkg-2867 (0.091), voice/wake-word-local (0.088), web/feed-nest (0.093), noise93/pkg-2227 (0.085) |
| hybrid | 0.50 | 1.00 | ops/host-pulse (0.626), net/wire-glance (0.501), net/pcap-viewer (0.324), dl/motrix-like (0.236), noise27/pkg-1967 (0.170), noise54/pkg-2867 (0.168), noise55/pkg-3547 (0.166), voice/wake-word-local (0.156), noise93/pkg-2227 (0.145), web/feed-nest (0.140) |

### container-orch: `lightweight container orchestration`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 0.50 | 1.00 | ops/compose-fleet (0.372), noise5/pkg-9899 (0.258), noise95/pkg-8049 (0.256), noise85/pkg-8039 (0.253), noise65/pkg-8019 (0.253), noise38/pkg-8089 (0.251), noise28/pkg-8079 (0.249), noise16/pkg-8649 (0.246), noise60/pkg-1709 (0.245), noise54/pkg-9269 (0.244) |
| hybrid | 0.50 | 1.00 | ops/compose-fleet (0.644), noise5/pkg-9899 (0.193), noise95/pkg-8049 (0.187), noise85/pkg-8039 (0.174), noise65/pkg-8019 (0.168), noise38/pkg-8089 (0.166), noise28/pkg-8079 (0.158), noise16/pkg-8649 (0.149), noise60/pkg-1709 (0.144), noise54/pkg-9269 (0.137) |

### password-mgr: `self-hosted password manager`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | sec/vaultwarden-tools (0.260), sec/pass-server (0.262), mc/vault-ledger (0.114), web/miniflux-tools (0.117), noise20/pkg-3609 (0.092), ops/infra-dashboard (0.088), notes/markdown-vault (0.094), noise79/pkg-2019 (0.087), archive/repo-vault (0.085), noise74/pkg-5409 (0.077) |
| hybrid | 1.00 | 1.00 | sec/vaultwarden-tools (0.625), sec/pass-server (0.579), mc/vault-ledger (0.238), web/miniflux-tools (0.167), noise20/pkg-3609 (0.153), ops/infra-dashboard (0.151), noise79/pkg-2019 (0.148), notes/markdown-vault (0.138), archive/repo-vault (0.127), noise74/pkg-5409 (0.118) |

### ci-cache: `CI build cache for monorepos`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | dev/remote-cache (-32.475) |
| semantic | 1.00 | 1.00 | dev/remote-cache (0.411), dev/turbo-cache-proxy (0.384), dev/module-map (0.255), noise76/pkg-3859 (0.250), noise19/pkg-6809 (0.242), noise62/pkg-4039 (0.236), noise77/pkg-3569 (0.232), cli/tig-plus (0.227), noise94/pkg-2519 (0.228), noise43/pkg-7609 (0.225) |
| hybrid | 1.00 | 1.00 | dev/remote-cache (0.956), dev/turbo-cache-proxy (0.541), noise76/pkg-3859 (0.166), dev/module-map (0.163), noise19/pkg-6809 (0.153), noise62/pkg-4039 (0.148), cli/tig-plus (0.132), noise94/pkg-2519 (0.125), noise77/pkg-3569 (0.124), noise43/pkg-7609 (0.117) |

### llm-local: `run language models locally on CPU`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | ai/local-infer (0.383), ai/llamacpp-ui (0.301), dev/turbo-cache-proxy (0.259), voice/wake-word-local (0.250), voice/offline-speech-kit (0.241), noise38/pkg-8089 (0.222), noise28/pkg-8079 (0.222), noise69/pkg-2009 (0.222), noise19/pkg-6809 (0.223), noise75/pkg-8029 (0.222) |
| hybrid | 1.00 | 1.00 | ai/local-infer (0.621), ai/llamacpp-ui (0.393), dev/turbo-cache-proxy (0.220), voice/wake-word-local (0.210), voice/offline-speech-kit (0.172), noise38/pkg-8089 (0.123), noise28/pkg-8079 (0.123), noise69/pkg-2009 (0.121), noise75/pkg-8029 (0.117), noise52/pkg-4029 (0.117) |

### rss-reader: `self-hosted RSS feed reader`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.50 | 1.00 | web/miniflux-tools (-33.864) |
| semantic | 1.00 | 1.00 | web/feed-nest (0.514), web/miniflux-tools (0.495), ops/host-pulse (0.222), noise81/pkg-1924 (0.208), noise78/pkg-1824 (0.210), noise61/pkg-1904 (0.195), noise82/pkg-1634 (0.190), noise8/pkg-1754 (0.188), noise89/pkg-4454 (0.194), noise31/pkg-1874 (0.186) |
| hybrid | 1.00 | 1.00 | web/miniflux-tools (0.879), web/feed-nest (0.560), ops/host-pulse (0.151), noise81/pkg-1924 (0.148), noise78/pkg-1824 (0.141), noise61/pkg-1904 (0.126), noise82/pkg-1634 (0.118), noise8/pkg-1754 (0.115), noise31/pkg-1874 (0.112), noise63/pkg-2294 (0.110) |

### git-tui: `terminal git client with diff review`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | cli/lazy-git-twin (0.411), cli/tig-plus (0.400), cli/ranger-like (0.270), noise80/pkg-2020 (0.244), noise95/pkg-5430 (0.244), noise2/pkg-1360 (0.243), dev/dep-graph (0.242), noise18/pkg-5450 (0.238), noise14/pkg-1760 (0.237), archive/gh-mirror (0.241) |
| hybrid | 1.00 | 1.00 | cli/lazy-git-twin (0.650), cli/tig-plus (0.604), cli/ranger-like (0.208), noise80/pkg-2020 (0.160), noise95/pkg-5430 (0.159), noise2/pkg-1360 (0.156), noise18/pkg-5450 (0.143), dev/dep-graph (0.139), noise14/pkg-1760 (0.138), noise12/pkg-1370 (0.131) |

### csv-etl: `transform messy CSV into a clean database`

| mode | R@10 | MRR | top results |
|------|------|-----|-------------|
| keyword | 0.00 | 0.00 |  |
| semantic | 1.00 | 1.00 | data/csv-normalize (0.512), noise66/pkg-2006 (0.306), noise93/pkg-1936 (0.303), noise73/pkg-1916 (0.301), data/sheet-to-sql (0.305), noise56/pkg-1996 (0.296), noise20/pkg-2736 (0.297), noise36/pkg-1976 (0.295), noise71/pkg-3466 (0.293), noise86/pkg-9786 (0.294) |
| hybrid | 0.50 | 1.00 | data/csv-normalize (0.629), noise66/pkg-2006 (0.162), noise93/pkg-1936 (0.154), noise73/pkg-1916 (0.149), noise56/pkg-1996 (0.139), noise36/pkg-1976 (0.136), noise20/pkg-2736 (0.135), noise71/pkg-3466 (0.132), noise26/pkg-1966 (0.129), noise83/pkg-1926 (0.129) |

## Hybrid weight comparison

```json
[
  {
    "weights": {
      "semantic": 0.7,
      "lexical": 0.25,
      "quality": 0.05
    },
    "macro_recall_at_10": 0.96,
    "macro_mrr": 0.9733333333333334
  },
  {
    "weights": {
      "semantic": 0.6,
      "lexical": 0.3,
      "quality": 0.1
    },
    "macro_recall_at_10": 0.94,
    "macro_mrr": 0.9733333333333334
  },
  {
    "weights": {
      "semantic": 0.55,
      "lexical": 0.35,
      "quality": 0.1
    },
    "macro_recall_at_10": 0.94,
    "macro_mrr": 0.9733333333333334
  },
  {
    "weights": {
      "semantic": 0.45,
      "lexical": 0.45,
      "quality": 0.1
    },
    "macro_recall_at_10": 0.94,
    "macro_mrr": 0.9733333333333334
  }
]
```

## TurboVec 2/3/4-bit vs exact

```json
{
  "ok": true,
  "n_docs": 3000,
  "model": "sentence-transformers/all-MiniLM-L6-v2",
  "model_load_s": 1.1331176049998248,
  "embed_docs_s": 7.022396905000278,
  "docs_per_s": 427.2045628557193,
  "exact_query_p50_ms": 7.982122000612435,
  "exact_query_p95_ms": 119.44318820005718,
  "exact_macro_recall_at_10": 0.98,
  "exact_macro_mrr": 0.9733333333333333,
  "bits": [
    {
      "bits": 2,
      "index_bytes": 569907,
      "build_s": 0.01212355400002707,
      "search_p50_ms": 0.07631100015714765,
      "search_p95_ms": 0.10063480058306593,
      "macro_recall_at_10": 0.96,
      "macro_mrr": 0.9733333333333333,
      "mean_overlap_at_10_vs_exact": 0.62
    },
    {
      "bits": 3,
      "index_bytes": 1058195,
      "build_s": 0.006390036000084365,
      "search_p50_ms": 0.08927099952416029,
      "search_p95_ms": 0.09363879999000346,
      "macro_recall_at_10": 0.98,
      "macro_mrr": 0.9733333333333333,
      "mean_overlap_at_10_vs_exact": 0.6920000000000001
    },
    {
      "bits": 4,
      "index_bytes": 1058259,
      "build_s": 0.0059299049999026465,
      "search_p50_ms": 0.09833500007516704,
      "search_p95_ms": 0.10778880005091196,
      "macro_recall_at_10": 0.98,
      "macro_mrr": 0.9733333333333333,
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
    4,
    2,
    1,
    2581
  ],
  "top_ids_after": [
    3,
    4,
    2,
    1,
    2581
  ],
  "removed_ids": [
    3,
    4,
    2
  ],
  "removed_still_absent": true,
  "contains": {
    "present": [],
    "missing": [
      3,
      4,
      2
    ]
  }
}
```

## Filters

```json
[
  {
    "name": "language=Python",
    "query": "offline speech recognition wake word",
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "minStars=500",
    "query": "download manager torrent",
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "maxStars=50",
    "query": "utility formatting JSON logs",
    "returned": 11,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "category=networking",
    "query": "network monitoring dashboard",
    "returned": 6,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "cluster=ops",
    "query": "infrastructure monitoring",
    "returned": 16,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "date range 2024",
    "query": "local voice assistant",
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "hasReadme",
    "query": "GitHub backup archive",
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "hasRelease",
    "query": "GitHub backup archive",
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "archivedOnly",
    "query": "GitHub backup archive",
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "language=Python soft-max exceeded",
    "query": "offline speech recognition wake word",
    "returned": 20,
    "semanticAvailable": true,
    "leaks": []
  },
  {
    "name": "no hard filters still hides tombstones",
    "query": "utility formatting JSON logs",
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
  "default_weights_note": "Do not change defaults from this run alone unless evidence is overwhelming; current 0.55/0.35/0.10 remains recommended unless bestWeight clearly dominates on real production data.",
  "observed_best_weights": {
    "weights": {
      "semantic": 0.7,
      "lexical": 0.25,
      "quality": 0.05
    },
    "macro_recall_at_10": 0.96,
    "macro_mrr": 0.9733333333333334
  },
  "vector_bits_default": 2,
  "vector_bits_note": "2-bit remains sensible for production (smallest index, sub-ms queries in microbench). Re-check recall vs exact on full production archive before raising bits.",
  "railway": {
    "worker_private": true,
    "expose_publicly": false,
    "suggested_resources": "Start with 1 vCPU / 2GB RAM private service for ≤~100k repos; plan 4GB+ and dedicated disk for multi-hundred-thousand archives. Keep indexBatch/remove/rebuild on localhost/private network only.",
    "disk_estimate_2bit_per_100k": "~12–15 MB TurboVec + SQLite state overhead",
    "startup": "MiniLM load ~1–5s once cached; cold HF download longer",
    "query_latency_target": "end-to-end hybrid p95 well under 200ms locally on 10k"
  },
  "blockers": [],
  "limitations": [
    "Corpus is representative, not a full production dump",
    "Railway MCP unavailable — resource estimates are extrapolated",
    "Weight recommendation should be revalidated on live archive traffic"
  ]
}
```

PR #33 was **not** merged by this validation run.
