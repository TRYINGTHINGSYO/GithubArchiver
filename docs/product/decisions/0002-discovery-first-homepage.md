# Discovery-first homepage

## Problem

The homepage originally exposed repository data too much like a table, which hid the product's value as discovery and intelligence.

## Decision

Lead with Archive Pulse and discovery signals before detailed lists.

## Why

New users should immediately understand what the archive contains, what is changing, and why it matters.

## Alternatives Rejected

- Keep the homepage as a generic searchable repository table.
- Move all intelligence to repository detail pages only.

## Affected Systems

- `/`
- Discovery materialized payloads
- Archive Pulse
- Repo card badges

## Commit

N/A

## Date

2026-07-31

## Follow-up Work

- Expose materialization freshness.
- Make discovery cards traceable to evidence.
