# UI Design — Discovery Platform

**Principle:** Stop designing like a database. Answer **"What's new?"**, **"What's interesting?"**, and **"Why should I care?"** before exposing filters and historical analysis.

Mirrors backend progression: `Collect → Preserve → Derive → Reconstruct → Analyze`.

---

## Information hierarchy (priority order)

1. **Hero stats** — total archived, activity in 24h, live status
2. **Discovery feeds** — exploding, growing, new, archived, deleted
3. **Live activity stream** — icon + color + repo + time
4. **Repository cards** — stars, language, license, status icons, interest hints
5. **Quick filters** — one-click common views
6. **Advanced filters** — collapsed by default

---

## Roadmap by item

| # | Change | Status | Depends on |
|---|--------|--------|------------|
| 1 | Hero answers 3 questions immediately | **Shipped** | `getLiveOverview()` |
| 2 | Stat cards replace tiny text row | **Shipped** | layout server load |
| 3 | Quick filters + collapsible advanced | **Shipped** | — |
| 4 | Live feed event icons | **Shipped** | `events-ui.ts` |
| 5 | Color-coded event types | **Shipped** | CSS event color tokens |
| 6 | Feed row layout: icon → repo → time | **Shipped** | `EventStreamItem` |
| 7 | Richer repository cards | **Shipped** | `RepoCard` |
| 8 | Icon badges instead of text pills | **Shipped** | `RepoCard` status icons |
| 9 | Feature icons (Docker, Bun, …) | v12 | `repo_features` |
| 10 | "Interesting because" hints | **Partial** | heuristics now; v11 metrics later |
| 11 | Sidebar navigation | **Shipped** | layout shell |
| 12 | Trending language bars | **Shipped** | `TrendBars` |
| 13 | Command palette (`/`) | **Shipped** | `/api/search` |
| 14 | Repository evolution timeline | **Partial** | `/repo/.../timeline` exists; archaeology UI v10+ |
| 15 | Discovery homepage sections | **Shipped** | feed nav + hero CTAs |

---

## Event display (canonical)

Defined in `src/lib/events-ui.ts`. Server `eventLabel()` should stay aligned for API responses.

| Category | Color | Events |
|----------|-------|--------|
| green | New | `first_seen` |
| blue | Archive | `readme_changed`, `snapshot_created`, `archived`, `unarchived` |
| orange | Metadata | `metadata_updated`, `metrics_updated`, `default_branch_updated`, `license_changed`, `topics_changed` |
| purple | Release | `release_detected` |
| red | Destructive | `deleted`, `enrichment_failed` |
| muted | Other | `renamed` |

---

## Interest hints (until v11)

Heuristic bullets from existing fields:

- `just discovered` moment tag
- positive velocity indicator
- first release / README archived
- AI-related topics (`ai`, `llm`, `agent`, `mcp`, …)
- license / topics changes → from timeline (future)

v11 adds: star velocity, acceleration, weekly gainers.

---

## Layout

```
┌──────────┬────────────────────────────────────┐
│ Sidebar  │  Hero / stats / discovery          │
│          │  Live stream / trending bars       │
│ Browse   │  Quick filters                     │
│ Live     │  ▼ Advanced filters                │
│ Trending │  Repository cards                  │
│ …        │                                    │
└──────────┴────────────────────────────────────┘
```

Max content width ~1200px. Sidebar ~200px, collapses on mobile.

---

## Future (v11+)

- Velocity/acceleration badges on cards
- `repo_features` icon row (v12)
- Full archaeology milestone timeline on repo page
- Bar charts for topic velocity

*Last updated: July 2026*
