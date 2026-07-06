# Derived Metrics (v11)

Canonical definitions for velocity, acceleration, and trending feeds. All metrics are **derived** from `repo_metrics_snapshots` and `repos` — reproducible, never a competing source of truth.

**Source table:** `repo_metrics_snapshots`

| Column | Use |
|--------|-----|
| `repo_id` | Join to `repos` |
| `stars`, `forks`, `watchers` | Primary growth signals |
| `open_issues`, `size` | Available for future metrics; not used in v11 feeds |
| `captured_at` | Observation time (ISO 8601) |

Snapshots are written on enrich/refresh. Intervals are **irregular** — definitions below account for that.

---

## Snapshot selection

For a repo and reference time `T` (usually “now”):

| Symbol | Meaning |
|--------|---------|
| `S(T)` | Latest snapshot where `captured_at ≤ T` |
| `S₀` | `S(now)` — current observation |
| `S₁` | `S(now − window)` — baseline observation |

If `S₀` or `S₁` is missing, the metric is **undefined** for that repo/window (exclude from ranked feeds).

### Elapsed time

```
elapsed_days = max(
  (captured_at(S₀) − captured_at(S₁)) / 86_400_000,
  MIN_ELAPSED_DAYS
)
```

| Constant | Value | Rationale |
|----------|-------|-----------|
| `MIN_ELAPSED_DAYS` | `1/24` (1 hour) | Avoid division by zero when two refreshes land close together |

### Delta

For metric field `M` ∈ `{stars, forks, watchers}`:

```
ΔM(window) = S₀.M − S₁.M
```

Deltas may be negative (declining repos). Feeds that rank “fastest growing” filter `ΔM > 0` unless noted.

---

## Velocity

**Definition:** change per day over a window.

```
velocity_M(window) = ΔM(window) / elapsed_days
```

| Metric key | Window | Field |
|------------|--------|-------|
| `star_velocity_24h` | 24 hours | `stars` |
| `star_velocity_7d` | 7 days | `stars` |
| `fork_velocity_7d` | 7 days | `forks` |
| `watcher_velocity_7d` | 7 days | `watchers` |

**Units:** count / day (e.g. `12.5` = ~12.5 stars per day over the window).

**Notes:**

- Window labels (`24h`, `7d`) describe the *lookback*, not the exact span between snapshots. Actual span = time between `S₀` and `S₁`.
- Prefer `star_velocity_7d` when ranking weekly gainers — more stable than 24h with sparse refreshes.
- `getTrendSnapshot()` today uses `MAX(stars) − MIN(stars)` over 24h; v11 replaces that with `velocity_M` for consistency.

---

## Acceleration

**Definition:** change in star velocity between two consecutive windows of equal length.

```
v_recent  = velocity_stars(7d)   // S₀ vs S(now − 7d)
v_prior   = velocity_stars(7d prior)  // S(now − 7d) vs S(now − 14d)
star_acceleration = v_recent − v_prior
```

Expanded:

```
star_acceleration =
  (Δstars[now → now−7d] / elapsed_recent)
  − (Δstars[now−7d → now−14d] / elapsed_prior)
```

| Constant | Value | Rationale |
|----------|-------|-----------|
| `ACCEL_WINDOW` | 7 days | Same window length for recent and prior velocity |

**Units:** (stars/day) / day — effectively “stars per day per week”. Display as raw difference in stars/day (e.g. `+3.2 stars/day vs prior week`).

**Requirements:** three usable snapshots spanning ~14 days (`S₀`, `S(now−7d)`, `S(now−14d)`). Otherwise undefined.

**Interpretation:**

| Sign | Meaning |
|------|---------|
| `> 0` | Growth is speeding up |
| `< 0` | Growth is slowing down |
| `≈ 0` | Steady velocity |

---

## Growth percentile

**Definition:** percentile rank of `star_velocity_7d` within a cohort.

```
growth_percentile(repo) =
  100 × (count of cohort peers with velocity < repo.velocity) / cohort_size
```

| Cohort key | Default | Purpose |
|------------|---------|---------|
| `language` | repo’s `repos.language` | Fair comparison within ecosystem |
| `discovery_week` | ISO week of `repos.first_seen_at` | Compare repos discovered in the same week |

**Minimum cohort size:** 10 repos with defined `star_velocity_7d`. Below that, percentile is undefined (omit or show “insufficient cohort”).

**Range:** `0` (slowest in cohort) to `100` (fastest). Ties use average rank (standard percentile tie-breaking).

---

## Feed categories

Feeds are **ranked lists** with shared filters. They reuse the metrics above; they are not separate calculations.

### Common query parameters

| Param | Type | Default | Applies to |
|-------|------|---------|------------|
| `language` | string | — | All |
| `created_after` | ISO date | — | All |
| `min_stars` | integer | `0` | All |
| `min_growth` | number | `0` | Velocity, gainers |
| `limit` | integer | `25` | All (cap 100) |

Filter on `repos` columns; rank on derived metrics.

---

### Fastest Growing (`/api/trending/velocity`)

**Rank by:** `star_velocity_24h` DESC (default window param: `24h`; also support `7d` → `star_velocity_7d`).

**Include when:**

- `star_velocity_*` is defined
- `Δstars > 0` (optional strict mode; default on for this feed)
- Passes common filters

**UI label:** 🚀 Fastest Growing

---

### Biggest Weekly Gainers (`/api/trending/gainers`)

**Rank by:** `Δstars(7d)` DESC — absolute star gain, not rate.

**Include when:** `Δstars(7d) > 0` and baseline snapshot exists.

**Difference from velocity feed:** a repo with 10k stars gaining 500/week outranks a repo with 5 stars gaining 4/week.

**UI label:** ⭐ Biggest Weekly Gainers

---

### Highest Acceleration (`/api/trending/acceleration`)

**Rank by:** `star_acceleration` DESC.

**Include when:**

- `star_acceleration` is defined
- `star_acceleration > 0` (growth speeding up)

**UI label:** 📈 Highest Acceleration

---

### Emerging Projects (`/api/trending/emerging`)

**Rank by:** composite score (see below).

**Intent:** high acceleration with **relatively low** absolute stars — projects breaking out, not established giants.

```
emerging_score =
  star_acceleration × log10(max(S₀.stars, 10))
  × (1 − min(S₀.stars / EMERGING_STAR_CAP, 1))
```

| Constant | Value | Rationale |
|----------|-------|-----------|
| `EMERGING_STAR_CAP` | `500` | Down-rank repos already large |

**Include when:**

- `star_acceleration > 0`
- `S₀.stars < EMERGING_STAR_CAP`
- `S₀.stars ≥ min_stars` (default `5` for this feed)

**UI label:** 🌱 Emerging Projects

---

### Sleeping Giant (v11 stretch / same release if time)

**Rank by:** `star_acceleration` DESC with sustained-growth gate.

**Intent:** established repos with **sustained** positive acceleration — not one-week spikes.

**Include when:**

- `S₀.stars ≥ 1000`
- `star_acceleration > 0`
- `star_velocity_7d > 0` **and** prior-window velocity `> 0` (both recent and prior 7d windows show positive star velocity)

**UI label:** 😴 Sleeping Giants

---

## API response shape (sketch)

Each endpoint returns:

```json
{
  "feed": "velocity",
  "window": "24h",
  "generated_at": "2026-07-06T06:00:00.000Z",
  "filters": { "language": "TypeScript", "limit": 25 },
  "items": [
    {
      "repo_id": 1,
      "owner": "org",
      "name": "repo",
      "full_name": "org/repo",
      "language": "TypeScript",
      "stars": 120,
      "metrics": {
        "star_velocity_24h": 15.2,
        "star_velocity_7d": 8.1,
        "stars_delta_7d": 57,
        "star_acceleration": 2.3,
        "growth_percentile": 94.5
      }
    }
  ]
}
```

Only populate `metrics` keys relevant to the feed; shared helper can compute the full set once per repo.

---

## Implementation strategy

### Phase 1 — SQL-derived metrics

- **Preferred:** SQLite views or CTEs computing `S₀`, `S₁`, deltas, and velocities per repo.
- **Cache:** in-process TTL cache (same pattern as `intelligence.ts` `cached()`) if view queries exceed ~200ms.
- **Optional materialized table** `repo_growth_daily` — only if profiling demands it; must be rebuildable from snapshots via `REFRESH` job.

No migration required for views. A materialized table would be migration v11 with explicit “derived, refreshable” documentation.

### Phase 2 — API

| Endpoint | Default sort |
|----------|--------------|
| `GET /api/trending/velocity` | `star_velocity_24h` |
| `GET /api/trending/gainers` | `Δstars(7d)` |
| `GET /api/trending/acceleration` | `star_acceleration` |
| `GET /api/trending/emerging` | `emerging_score` |

Refactor `getTrendSnapshot()` to call shared metric helpers instead of ad-hoc `MAX − MIN` SQL.

### Phase 3 — UI

- Trending dashboard or birth-feed sections: Fastest Growing, Weekly Gainers, Acceleration, Emerging.
- Repo cards: show `star_velocity_7d` badge when defined (extends existing `velocityIndicator`).

---

## Relationship to existing code

| Today | v11 |
|-------|-----|
| `getTrendSnapshot()` — `MAX − MIN` stars in 24h | `star_velocity_24h` with proper elapsed time |
| `velocityIndicator()` — heuristic from `pushed_at` | Keep for cards without snapshots; prefer metric when available |
| `getRepoState(..., asOf).metrics` | Point-in-time metrics; trending uses rolling windows from now |

---

## Test cases (v11)

1. Two snapshots 7 days apart, +70 stars → `star_velocity_7d ≈ 10`.
2. Flat stars over window → velocity `0`; excluded from “growing” feeds with `min_growth > 0`.
3. Sparse snapshots: only one row in window → metric undefined.
4. Acceleration: velocity 10/day then 20/day → `star_acceleration ≈ +10`.
5. Emerging: 50 stars + high acceleration ranks above 5k stars + same acceleration.
6. Percentile: repo at median of 100-repo cohort → ~50.

---

*These definitions are normative for v11 SQL, API, and UI. Update this file if formulas change — not scattered comments in query code.*
