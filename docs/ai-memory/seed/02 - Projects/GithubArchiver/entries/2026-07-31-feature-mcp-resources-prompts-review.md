---
id: feature-mcp-resources-prompts-review
date: 2026-07-31
commit: 6fbaa7a
area:
  - mcp
  - project-memory
type: feature
status: closed
confidence: confirmed
durability: permanent
relationships:
  - type: related
    id: feat-mcp-intelligence-server
  - type: references
    id: decision-knowledge-engine-philosophy
title: MCP project resources, prompts, and workspace review
---

## What

Expanded the GithubArchive+ MCP server beyond tools-only: portable Cursor `.cursor/mcp.json` (direct `node` + `tsx`, not `npm run`), stderr-clean launcher, richer persistent resources, reusable review prompts, and `review_workspace`.

## Why

Stdio MCP requires JSON-RPC-only stdout; `npm run` lifecycle banners break the protocol. Docs-aligned project memory needed tools + resources + prompts, not one-off commands. Apps UI deferred.

## Tests

- `npm run test:mcp` (13/13)
- `npm run validate:product-registry`
- `npm run build`
- `git diff --check`

## Remaining

Reload Cursor MCP so `githubarchive` picks up prompts/resources. Interactive MCP Apps UI still out of scope.
