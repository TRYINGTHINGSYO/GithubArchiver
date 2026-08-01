# Fix packet 06 — Worker and web process isolation

## Problem

Although production start already spawns web + daemon as siblings, heavy work can still run in the web process (hooks background worker, admin-triggered job runners), and there is no durable multi-process ownership/lease model. Sync SQLite + CPU-heavy jobs still contend with SSR/API.

## Evidence

- `scripts/start-production.ts` — spawns `node build` with `BACKGROUND_WORKER=0` and `scripts/daemon.ts`
- `src/hooks.server.ts` — `ensureBackgroundWorker()` on first request
- Admin workers API queues/runs jobs that can execute in-process
- Prior review architecture concerns remain partially valid

## Affected files

- `src/hooks.server.ts`
- `src/lib/server/background-daemon.ts`
- `src/lib/server/job-runner.ts`
- `scripts/start-production.ts` / Railway start config
- Possibly new lightweight lease helpers in `src/lib/server/db/jobs.ts`
- Ops docs

## User impact

Interactive pages stall during ingest/enrich/archive/backup; duplicate daemons risk double-processing if misconfigured.

## Severity

**P2**

## Exact desired behavior

1. Web process never starts the discovery daemon when production launcher is used (already mostly true).
2. Admin “run worker” actions enqueue durable jobs consumed by the daemon process, not execute heavy cycles inline in the web request/event loop (except tiny status ops).
3. Single-owner lease/heartbeat for daemon leadership on a shared SQLite DB.
4. Clear env contract: `BACKGROUND_WORKER`, daemon-only vs web-only modes.

## Implementation constraints

- Keep SQLite; do not require Redis/Postgres for this packet
- Do not redesign the entire pipeline planner
- Prefer incremental: move inline execution behind queue + daemon claim

## Schema changes

Possibly extend `job_runs` with lease owner/heartbeat columns if not sufficient today.

## API changes

Admin worker POST remains, but semantics become “enqueue” only; response returns job id.

## UI changes

Admin jobs UI already lists jobs — ensure it shows queued vs running accurately.

## Migration and rollback

- Additive lease columns
- Rollback: allow inline execution behind env flag for emergencies

## Tests

- Web mode with `BACKGROUND_WORKER=0` does not run daemon loops
- Enqueue from admin creates job row claimed by daemon worker
- Two daemon claimants → only one lease winner

## Explicit out-of-scope

- Horizontal multi-node scale-out beyond single SQLite writer
- Migrating off better-sqlite3 (packet 07 may bound queries only)
- Auth (packet 01)

## Acceptance criteria

- [ ] Documented process topology: web vs daemon responsibilities
- [ ] No heavy archive/enrich/ingest cycle runs inside web request handlers
- [ ] Lease test proves single owner
- [ ] Production start script remains the supported path
