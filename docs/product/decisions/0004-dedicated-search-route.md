# Dedicated search route

## Problem

The main page had to serve both product discovery and repository search, which made the primary experience crowded.

## Decision

Use a dedicated `/search` route for repository search, page-size selection, and TSV export.

## Why

Discovery and search are different user intents. Separating them keeps the homepage product-focused while preserving power-user search.

## Alternatives Rejected

- Keep all search controls on the homepage.
- Only expose search through API endpoints.

## Affected Systems

- `/search`
- `/api/export/names`
- Repo query helpers

## Commit

N/A

## Date

2026-07-31

## Follow-up Work

- Add route-level search latency reporting for 10, 50, and 100 result pages.
