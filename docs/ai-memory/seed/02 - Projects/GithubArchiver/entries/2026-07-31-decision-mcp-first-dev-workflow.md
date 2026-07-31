---
schema: 1
id: decision-mcp-first-dev-workflow
date: 2026-07-31
pr: null
commit: 6fbaa7a
area:
  - mcp
  - project-memory
  - adoption
type: decision
status: verified
confidence: confirmed
durability: permanent
relationships:
  - type: references
    id: feature-mcp-resources-prompts-review
  - type: related
    id: decision-knowledge-engine-philosophy
  - type: validates
    id: feature-mcp-resources-prompts-review
title: MCP is the primary knowledge and review layer
---

# Decision — MCP-first development workflow

End-to-end Cursor validation succeeded: green `githubarchive` MCP connection, `get_project_state` JSON-RPC round-trip, discovery of tools/prompts/resources.

## Rule

Treat the GithubArchive+ MCP as the first source of truth for substantial product work — ahead of conversation history and ad-hoc manual inspection.

Session start for substantial work:

1. `review_workspace` → summarize Facts / Inferences / Recommendations
2. `get_project_state`
3. `validate_proposed_change` before suggesting any implementation

Per-feature loop:

1. `review_workspace`
2. `get_project_state`
3. `validate_proposed_change`
4. Implement
5. Add/update tests
6. Update Feature Registry
7. Decision Journal entry when behavior or architecture changes
8. `review_workspace` again before committing

## Observed ops snapshot at validation

- Working tree dirty
- DB available: 164720 repositories, 3488 enriched
- Latest emerging detection run: id 5
- Homepage materialization unavailable (candidate future work)

## Remaining

None for install/validation. Homepage materialization remains separate product work.
