---
status: active
project: githubarchiver
type: status
---

# Current Status

Read [[Timeline]] for the chronological operating history. This note is only the **live summary**.

## Now

- **PR #5** merged and verified in production for activity/progress/discovery hierarchy.
- **PR #6** open — Search fallback active stale-state fix (deploy + verify table in entry).
- **PR #7** open — Cursor Project Rules + seed vault.
- **PR #8** open — structured checkpoint metadata + generated timeline.

## Open verification

After PR #6 deploys: Search fallback **No** during ordinary enrich/GH Archive ingest; **Yes** only while Search executes; stale restart rows reconcile to **No**.

## Open debt

- Production Railway needs a real `GITHUB_TOKEN` — see [[Open Technical Debt]].

## How to checkpoint

1. Add `entries/YYYY-MM-DD-*.md` with required frontmatter (see `entries/SCHEMA.md`).
2. Run `npm run memory:timeline`.
3. Update this file’s **Now** section if the live summary changed.
