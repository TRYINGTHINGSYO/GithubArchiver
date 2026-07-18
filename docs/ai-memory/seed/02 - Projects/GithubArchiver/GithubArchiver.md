---
status: active
project: githubarchiver
type: index
---

# GithubArchiver

## Purpose

GithubArchive+ is an evidence-first GitHub repository intelligence platform.
It ingests repository creation signals, enriches repositories, classifies them, assigns clusters, calculates Interesting Scores, generates Archive Stories, and detects emerging themes.

## Current Architecture

- SvelteKit application
- SQLite with numbered migrations
- GH Archive ingestion
- GitHub Search fallback
- Background daemon
- Enrichment pipeline
- Clustering and emerging-topic analysis
- Railway production deploy (auto from `main`)

## Current Operating Principles

- GH Archive is the primary discovery source.
- Search is fallback behavior, not the default.
- Enrichment backlog does not pause ingestion.
- UI status must distinguish current activity, progress, and discovery.
- Stale runtime rows must be reconciled after process restarts.

## Memory map

- [[Architecture]] — subsystem boundaries and data flow
- [[Decisions]] — locked / durable choices
- [[Current Status]] — latest verified state and open verification

## Related repo paths

- Code: this GithubArchiver git repository
- Cursor rules: `.cursor/rules/`
- Seed copy in repo: `docs/ai-memory/seed/02 - Projects/GithubArchiver/`
