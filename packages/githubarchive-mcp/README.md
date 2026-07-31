# GithubArchive+ MCP Intelligence Server

This package exposes GithubArchive+ as a read-only MCP intelligence server for AI coding and product-analysis agents.

Its job is to answer:

- what GithubArchive+ currently does
- which features already exist
- what data the archive has collected
- how detection, enrichment, scoring, and discovery work
- what changed recently
- what is broken, stale, suspicious, or incomplete
- whether a proposed change would duplicate existing work

## Architecture

```text
AI client
  -> GithubArchive+ MCP Server
    -> feature registry
    -> decision journal
    -> source index
    -> Git history
    -> read-only SQLite database
    -> route manifest
```

The server follows the project rule:

> Every conclusion should be explainable. Every explanation should be backed by preserved evidence.

## Install And Run

From the repository root:

```bash
npm run mcp:githubarchive
```

Validate the product registry before trusting it in an AI workflow:

```bash
npm run validate:product-registry
```

Optional environment:

```bash
DATABASE_PATH=A:/chatgptcodex/GithubArchiver-push-worktree/data/githubarchive.db
GITHUBARCHIVE_PRODUCTION_URL=https://your-production-host.example
GITHUBARCHIVE_DEPLOYED_COMMIT=da9e821
GITHUBARCHIVE_MCP_MAX_ROWS=100
```

The MCP server communicates over stdio using JSON-RPC MCP methods:

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`

## Security Model

- Read-only by default.
- Opens SQLite with `readonly: true` and `PRAGMA query_only = ON`.
- Does not expose arbitrary SQL.
- Does not expose arbitrary shell execution.
- Does not deploy, push, mutate config, rerun workers, or delete data.
- Bounds result sizes.
- Redacts tokens, passwords, cookies, authorization headers, and API-key-looking values.

## Tools

Product:

- `get_project_state`
- `get_product_overview`
- `list_features`
- `get_feature_detail`
- `search_existing_capabilities`
- `search_product_decisions`
- `get_product_decision`

Routes and UI:

- `list_routes`
- `inspect_route`
- `inspect_navigation`
- `capture_page_snapshot`
- `compare_page_snapshots`

Source and Git:

- `search_code`
- `get_symbol`
- `get_recent_commits`
- `explain_change_history`
- `find_uncovered_code`
- `inspect_test_coverage`

Archive and repositories:

- `get_archive_summary`
- `query_repositories`
- `inspect_repository`
- `get_data_quality_report`
- `query_duplicate_families`

Detection:

- `explain_repository_score`
- `explain_topic_detection`
- `compare_detection_versions`
- `list_detection_runs`
- `inspect_cluster`
- `inspect_classification`

Operations:

- `get_system_health`
- `get_job_status`
- `verify_read_only_enforcement`
- `list_recent_failures`
- `get_performance_report`
- `compare_deployments`

Analysis:

- `analyze_site`
- `find_improvement_opportunities`
- `validate_proposed_change`
- `validate_product_registry`
- `prioritize_backlog`
- `generate_change_brief`

## Most Important Tool

Use `get_project_state` first, then `validate_proposed_change` before planning product work.

Example:

```json
{
  "proposal": "Add independent repository evidence grouping to emerging topics"
}
```

Expected behavior:

- finds `emerging-topic-evidence-dedupe`
- identifies detection version 2
- cites source/tests/decisions
- separates facts, inferences, and recommendations
- reports remaining gaps such as persistent duplicate-family overrides
- does not recommend rebuilding the completed feature

## Resources

- `githubarchive://architecture/philosophy`
- `githubarchive://product/features`
- `githubarchive://schema/source`
- `githubarchive://product/decisions/{id}`

## Example Prompts

- "Explain everything GithubArchive+ knows about this repository."
- "What changed in the product during the last ten commits?"
- "What features already exist for duplicate detection?"
- "Find five high-impact missing product capabilities."
- "Why did this topic receive its Emerging Score?"
- "Compare the deployed product with the current source branch."
- "Find routes that have no meaningful tests."
- "Identify data-quality problems affecting public intelligence."

## Current Limitations

- `capture_page_snapshot` needs `GITHUBARCHIVE_PRODUCTION_URL`.
- Deployment comparison is partial until deployment history is connected.
- Performance p50/p95 reports need persisted route timing samples.
- Duplicate families are currently read from emerging-topic `evidence_json`; persistent manual family records are future work.
- Intelligence algorithm versions are not yet persisted as first-class `IntelligenceResult` rows.
