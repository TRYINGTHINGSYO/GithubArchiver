# MCP as the primary knowledge and review layer

## Problem

Product context for agents lived across conversation history, ad-hoc file inspection, and vault notes. That made duplicate work, stale assumptions, and registry drift easy during substantial development sessions.

## Decision

Treat the GithubArchive+ MCP (`githubarchive`) as the first source of truth for substantial product work.

Session cadence:

1. `review_workspace` — Facts / Inferences / Recommendations
2. `get_project_state`
3. `validate_proposed_change` before suggesting implementation

Per-feature loop: review → project state → validate → implement → tests → Feature Registry → Decision Journal (when behavior or architecture changes) → `review_workspace` before commit.

Feature Registry records **what exists**. Decision Journal records **why it exists**.

## Why

End-to-end Cursor validation confirmed tools, prompts, and resources are discoverable and JSON-RPC works. Encoding the workflow in `.cursor/rules` and the product decision journal makes the process part of the project, not tribal memory.

## Alternatives Rejected

- Relying on chat history or manual vault browsing as the default context source.
- Expanding MCP Apps UI before the tool/resource/prompt layer is adopted in daily workflow.

## Affected Systems

- `packages/githubarchive-mcp`
- `.cursor/mcp.json`
- `.cursor/rules/githubarchiver-context.mdc`
- `docs/product/features.json`
- AI-memory decision `decision-mcp-first-dev-workflow`

## Commit

1a012d3

## Date

2026-07-31

## Follow-up Work

- Register MCP capability in the Feature Registry (this change).
- Keep registry and decisions updated when MCP surface area changes.
