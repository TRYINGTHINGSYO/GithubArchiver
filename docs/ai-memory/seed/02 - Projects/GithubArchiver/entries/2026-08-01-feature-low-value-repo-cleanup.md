---
id: feature-low-value-repo-cleanup
date: 2026-08-01
area:
  - storage
  - sqlite
  - ops
  - quality
type: feature
status: open
confidence: confirmed
durability: permanent
schema: 1
migration: 43
relationships:
  - type: related
    id: feature-storage-retention-volume
title: Staged low-value repo cleanup with quarantine
---

## What

Adds staged cleanup for disposable repositories without deleting every unenriched or zero-star repo:

1. Migration **043** — `pending_deletion_at`, `cleanup_protected`, `cleanup_reason`.
2. Presets on `/admin/storage`: Safe / Conservative / **Balanced** (default) / Aggressive.
3. Flow: dry-run preview → quarantine (hidden) → optional restore → permanent purge after 7 days.
4. Always protects favorites, Watch Later / any collection membership, and manual `cleanup_protected`.
5. Balanced targets zero stars/forks, weak/no metadata, no release/website/README/language/topics, no post-create activity, and age ≥ 30 days.
6. Purge deletes related rows that lack `ON DELETE CASCADE` (`repos_fts`, events, aliases, releases/assets, discovery cards) then the `repos` row.

## Why

With ~1.4M repos, volume pressure comes from append-only history **and** mass low-value creates. Blind zero-star or unenriched deletes would destroy Emerging / Birth Feed value. Evidence-gated junk cleanup is safer.

## Tests

- `tests/low-value-cleanup.test.ts`

## Ops

Use Balanced first. Review sample matches before quarantine. Purge only after the quarantine window (or force with explicit admin action). Run VACUUM afterward once free space exists.
