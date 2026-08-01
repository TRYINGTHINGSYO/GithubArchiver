# Fix packet 10 — Search and discovery follow-up

## Problem

Core search remains SQLite FTS5 with limited query features. Snippets are rendered via `{@html}` without a proven sanitizer path dedicated to FTS fragments. Discovery product surface grew (websites, clusters, random), but search itself did not gain semantic/faceted capabilities.

## Evidence

- Search routes: `src/routes/search`, `src/routes/api/search`
- Snippet HTML: `src/lib/components/RepoCard.svelte`, `RepoListItem.svelte` (`{@html repo.search_snippet}`)
- Markdown sanitizer is regex-based — `src/lib/server/markdown.ts` — not clearly applied to FTS snippets
- No embeddings/semantic search modules found for repos

## Affected files

- Search query builders / FTS index maintenance
- Snippet rendering components
- Possibly shared HTML escape helper
- `tests/` for search XSS / escaping
- Docs for search behavior

## User impact

- XSS risk if attacker-controlled README/metadata reaches snippets unsanitized
- Users lack semantic “similar repos” and richer filters

## Severity

Snippet escaping: **P1** if exploitable; treat as hardening in this follow-up unless security review proves exploit now (then pull into packet 01/02 PR).  
Semantic/faceted search features: **P3**.

## Exact desired behavior

1. FTS snippets are escaped or sanitized with a tested path before `{@html}` (or switch to text rendering with safe highlight markers).
2. Search API enforces query length/limit timeouts.
3. Discovery follow-ups (optional in later PR): facet filters already partially present remain accurate; no fake semantic mode.
4. Document that semantic similarity is not offered yet.

## Implementation constraints

- Do not claim semantic search until embeddings exist
- Prefer escaping + highlight tokens over broad HTML allowlists
- Keep FTS as primary engine for this packet

## Schema changes

None required for escaping. Semantic search would need new tables later — out of scope.

## API changes

- Stricter validation on `/api/search`
- Snippet field may become structured `{ text, highlights[] }` instead of raw HTML

## UI changes

- Safe highlight rendering for search results
- Honest empty/advanced-search copy

## Migration and rollback

- Mostly rendering/API shape; if snippet becomes structured, keep backward compatible field briefly

## Tests

- XSS payloads in README/description do not execute via snippets
- Query oversize rejected
- Existing search relevance smoke tests remain

## Explicit out-of-scope

- Vector DB / embeddings
- Autocomplete service
- Website full-text crawl index
- Cluster wipe defect (packet 03)

## Acceptance criteria

- [ ] Snippet XSS regression test passes
- [ ] No raw unsanitized FTS HTML in components
- [ ] Query bounds enforced
- [ ] Docs state semantic search is not implemented
