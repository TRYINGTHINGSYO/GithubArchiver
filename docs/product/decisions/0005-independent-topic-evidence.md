# Independent topic evidence

## Problem

Copied, forked, templated, and near-identical repositories could inflate emerging-topic counts and create fake trends.

## Decision

Group repositories into independent evidence families before scoring emerging topics. Keep raw records, but score and public examples from independent evidence.

## Why

The archive should preserve all repository records while preventing copy floods from manufacturing intelligence.

## Alternatives Rejected

- Delete duplicate repositories.
- Hide duplicates only in the UI while keeping raw counts in scores.
- Trust owner diversity alone.

## Affected Systems

- Emerging topic detection
- Emerging topic detail pages
- Discovery homepage cards
- Duplicate analysis evidence

## Commit

73ed029

## Date

2026-07-31

## Follow-up Work

- Add persistent duplicate-family records if production grouping is unstable.
- Add manual merge/split overrides.
