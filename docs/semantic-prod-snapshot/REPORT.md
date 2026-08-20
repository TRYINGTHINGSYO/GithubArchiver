# Production-snapshot gate report

Generated: 2026-08-20T23:19:57.057807+00:00

## Verdict: **GO_MERGE_KEEP_FLAG_OFF**

Do **not** merge automatically. Inspect `HUMAN_REVIEW.md` before enabling the feature flag.

### Snapshot provenance

- Source: Railway project `new` / service `new` volume `new-volume`
- Method: Python `sqlite3.Connection.backup()` to container `/tmp`, then gzip stream off-box
- Local copy: `/workspace/data/prod-snapshot-copy.db` (gitignored)
- Source unchanged after gate: `True`

## Corpus inventory
```json
{
  "total": 816347,
  "enriched": 46371,
  "deleted": 1543,
  "pending_deletion": 0,
  "eligible": 46360,
  "with_description": 20718,
  "with_topics": 1939,
  "with_summary": 46371,
  "with_readme_snapshot": 0,
  "weak_or_no_useful_semantic_text": 0
}
```

Top languages: (null)=779619, Python=10531, HTML=6256, TypeScript=5298, JavaScript=5116, CSS=1472, Jupyter Notebook=1078, Java=1009

Top categories: (null)=768444, unknown=27792, portfolio=10076, ai-project=2954, product=2262, spam-template=901, data-science=894, library=764

## 2-bit index
```json
{
  "indexing": {
    "indexed": 46360,
    "failed": 0,
    "eligible": 46360,
    "wall_clock_s": 350.589,
    "repos_per_sec": 132.2346108976608,
    "index_batch_wall_s": 334.24657608800044,
    "worker_embed_s": 302.05260129100316,
    "worker_upsert_s": 0.20748438699774852,
    "sync_wall_s": 3.118556757999442,
    "index_bytes": 5252787,
    "sqlite_indexed_current": 46360
  },
  "memory": {
    "python_worker_rss_after_model_load_mb": 840,
    "python_worker_peak_rss_during_index_mb": 1044,
    "python_worker_rss_after_index_mb": 1044,
    "python_worker_rss_during_query_load_mb": 850
  },
  "latency": {
    "warm_iterations_target": 60,
    "keyword": {
      "n": 60,
      "mean_ms": 2.3792951999998575,
      "p50_ms": 1.4214500000234693,
      "p95_ms": 7.310462999972515,
      "p99_ms": 7.323549000022467,
      "min_ms": 0.5483539999695495,
      "max_ms": 7.978126999980304
    },
    "semantic": {
      "n": 60,
      "mean_ms": 51.25850515000153,
      "p50_ms": 52.04633799998555,
      "p95_ms": 53.81833799998276,
      "p99_ms": 54.52925800002413,
      "min_ms": 15.635881999973208,
      "max_ms": 58.96343599999091
    },
    "hybrid": {
      "n": 60,
      "mean_ms": 53.47596569999393,
      "p50_ms": 52.31265600002371,
      "p95_ms": 58.10368000000017,
      "p99_ms": 59.31763900001533,
      "min_ms": 49.56199499999639,
      "max_ms": 59.80717899999581
    }
  },
  "restart": {
    "indexed_before": 46360,
    "indexed_after": 46360,
    "top_ids_before": [
      661502,
      178145,
      1676205,
      208847,
      574986
    ],
    "top_ids_after": [
      661502,
      178145,
      1676205,
      208847,
      574986
    ],
    "ids_stable": true,
    "removed_ids": [
      661502,
      178145
    ],
    "removed_still_absent": true
  }
}
```

## 4-bit index
```json
{
  "indexing": {
    "indexed": 46360,
    "failed": 0,
    "eligible": 46360,
    "wall_clock_s": 338.447,
    "repos_per_sec": 136.9786111267052,
    "index_batch_wall_s": 322.2805790100011,
    "worker_embed_s": 290.166148219014,
    "worker_upsert_s": 0.21495949198106246,
    "sync_wall_s": 3.1182903709992535,
    "index_bytes": 9903699,
    "sqlite_indexed_current": 46360
  },
  "memory": {
    "python_worker_rss_after_model_load_mb": 839,
    "python_worker_peak_rss_during_index_mb": 1084,
    "python_worker_rss_after_index_mb": 1084,
    "python_worker_rss_during_query_load_mb": 853
  },
  "latency": {
    "warm_iterations_target": 60,
    "keyword": {
      "n": 60,
      "mean_ms": 2.316276883337802,
      "p50_ms": 1.3665920000057667,
      "p95_ms": 7.234542999998666,
      "p99_ms": 7.2721979999914765,
      "min_ms": 0.5288189999992028,
      "max_ms": 8.041028999956325
    },
    "semantic": {
      "n": 60,
      "mean_ms": 49.62243524999164,
      "p50_ms": 49.87722600006964,
      "p95_ms": 53.087532999925315,
      "p99_ms": 55.227524999994785,
      "min_ms": 12.172014000010677,
      "max_ms": 58.67270600004122
    },
    "hybrid": {
      "n": 60,
      "mean_ms": 53.10070813333926,
      "p50_ms": 52.24262799997814,
      "p95_ms": 57.79321200004779,
      "p99_ms": 59.77813599992078,
      "min_ms": 48.95821000006981,
      "max_ms": 60.56990299990866
    }
  },
  "restart": {
    "indexed_before": 46360,
    "indexed_after": 46360,
    "top_ids_before": [
      661502,
      1676205,
      208847,
      178145,
      574986
    ],
    "top_ids_after": [
      661502,
      1676205,
      208847,
      178145,
      574986
    ],
    "ids_stable": true,
    "removed_ids": [
      661502,
      1676205
    ],
    "removed_still_absent": true
  }
}
```

**Chosen bit width: 4-bit** — 4-bit recommended: mean semantic top-10 overlap vs 2-bit=0.759 (material disagreement), disk ratio=1.89×, hybrid p95 delta=-0.3ms.

## Filters
```json
[
  {
    "name": "language",
    "opts": {
      "language": "Python"
    },
    "eligibleCount": 10531,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "source",
    "opts": {
      "source": "gharchive"
    },
    "eligibleCount": 713340,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "year",
    "opts": {
      "year": 2026
    },
    "eligibleCount": 814804,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "date range",
    "opts": {
      "dateFrom": "2018-01-01",
      "dateTo": "2030-12-31"
    },
    "eligibleCount": 814804,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "minStars",
    "opts": {
      "minStars": 10
    },
    "eligibleCount": 18,
    "retrievalPath": "allowlist",
    "returned": 18,
    "leaks": []
  },
  {
    "name": "maxStars",
    "opts": {
      "maxStars": 10000
    },
    "eligibleCount": 46360,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "minForks",
    "opts": {
      "minForks": 1
    },
    "eligibleCount": 125,
    "retrievalPath": "allowlist",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "category",
    "opts": {
      "category": "unknown"
    },
    "eligibleCount": 27792,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "signalTier",
    "opts": {
      "signalTier": "low"
    },
    "eligibleCount": 25318,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "minInterestingScore",
    "opts": {
      "minInterestingScore": 1
    },
    "eligibleCount": 46360,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "cluster",
    "opts": {
      "cluster": "portfolio-websites"
    },
    "eligibleCount": 10070,
    "retrievalPath": "post-filter",
    "returned": 3,
    "leaks": []
  },
  {
    "name": "multiple clusters",
    "opts": {
      "clusters": [
        "portfolio-websites",
        "llm-wrappers"
      ],
      "clusterMatch": "any"
    },
    "eligibleCount": 11607,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "hasReadme",
    "opts": {
      "hasReadme": true
    },
    "eligibleCount": 0,
    "retrievalPath": "unfiltered",
    "returned": 0,
    "leaks": []
  },
  {
    "name": "hasRelease",
    "opts": {
      "hasRelease": true
    },
    "eligibleCount": 5,
    "retrievalPath": "allowlist",
    "returned": 5,
    "leaks": []
  },
  {
    "name": "archivedOnly",
    "opts": {
      "archivedOnly": true
    },
    "eligibleCount": 0,
    "retrievalPath": "unfiltered",
    "returned": 0,
    "leaks": []
  },
  {
    "name": "tombstones baseline",
    "opts": {},
    "eligibleCount": 814804,
    "retrievalPath": "unfiltered",
    "returned": 25,
    "leaks": []
  },
  {
    "name": "large eligibility soft-max",
    "opts": {
      "language": "Python"
    },
    "eligibleCount": 10531,
    "retrievalPath": "post-filter",
    "returned": 25,
    "leaks": []
  }
]
```

## Railway recommendation
```json
{
  "measured_python_worker_peak_rss_mb": 1084,
  "suggested_ram_gb": 4,
  "suggested_vcpu": 1,
  "persistent_volume_note": "Size for SQLite + temporary/rebuild TurboVec indexes; 2-bit\u2248index_bytes, 4-bit larger. Keep worker private."
}
```

## Limitations
- Human must inspect HUMAN_REVIEW.md before enabling the flag
- README text availability depends on archive snapshot files present beside the DB copy
- This run must not mutate the operator source file (verified by fingerprint)
- `hasReadme` / `archivedOnly` eligible counts are 0 in this snapshot (no readme archive_snapshot rows present).
- README file bodies were not available beside the DB copy; embeddings used description/summary/topics only.
- 80 discovery queries; human review required for enable-behind-flag.
- Revalidated multi-cluster assertion to honor clusterMatch=any (prior false-positive leaks).

## Recommendation object
```json
{
  "verdict": "GO_MERGE_KEEP_FLAG_OFF",
  "production_gate_passed": true,
  "do_not_merge_automatically": true,
  "chosen_vector_bits": 4,
  "bits_rationale": "4-bit recommended: mean semantic top-10 overlap vs 2-bit=0.759 (material disagreement), disk ratio=1.89\u00d7, hybrid p95 delta=-0.3ms.",
  "mean_semantic_top10_overlap_2_vs_4": 0.75875,
  "railway": {
    "measured_python_worker_peak_rss_mb": 1084,
    "suggested_ram_gb": 4,
    "suggested_vcpu": 1,
    "persistent_volume_note": "Size for SQLite + temporary/rebuild TurboVec indexes; 2-bit\u2248index_bytes, 4-bit larger. Keep worker private."
  },
  "filter_failed": false,
  "limitations": [
    "Human must inspect HUMAN_REVIEW.md before enabling the flag",
    "README text availability depends on archive snapshot files present beside the DB copy",
    "This run must not mutate the operator source file (verified by fingerprint)"
  ]
}
```
