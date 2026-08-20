# Production-snapshot gate — BLOCKED

Generated: 2026-08-20T21:22:56.579Z

## Verdict: **NO_GO** (gate not executed)

Railway MCP/CLI access to the production volume was unavailable in this environment.
A synthetic corpus **must not** substitute for this gate.

## Absolute safety rule

Never point this harness at the writable production database.
Provide a **copy** (or filesystem snapshot / backup export). The harness will copy again
into a temp work DB and will never write to the source file or any existing production
TurboVec index.

## Artifact needed from the operator

1. A byte-for-byte (or SQLite backup) copy of the production GithubArchiver SQLite file
   (whatever `DATABASE_PATH` points at in production — often `githubarchive.db` on the Railway volume).
2. Place it where this agent can read it (upload artifact, mount read-only path, or local path).
3. Re-run:

```bash
SEMANTIC_PROD_SNAPSHOT_SOURCE=/absolute/path/to/prod-copy.db \
SEMANTIC_PROD_SNAPSHOT_ACK=I_CONFIRM_THIS_IS_A_NON_PRODUCTION_COPY \
npm run semantic:prod-snapshot-gate
```

## What the harness does once a copy is supplied

- Corpus inventory (read-only on the work copy)
- Separate temporary 2-bit and 4-bit MiniLM TurboVec indexes
- ≥50 discovery queries with human-review pack (keyword / semantic / hybrid × bits)
- Production filter leak checks
- Scale latency (p50/p95/p99)
- Worker process-tree RSS + Railway sizing
- Restart/removal durability on the temporary index only
- Final GO / NO_GO recommendation (**still does not merge**)

## Safety proof

`npm run semantic:prod-snapshot-gate -- --safety-proof` proves copy-open-inventory
and source immutability on a disposable fixture. That proof **does not** pass the
production gate.
