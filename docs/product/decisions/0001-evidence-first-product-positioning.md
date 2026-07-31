# Evidence-first product positioning

## Problem

GithubArchive+ had strong preservation and history infrastructure, but user-facing explanations could feel like claims rather than auditable conclusions.

## Decision

Make GithubArchive+ an evidence-first repository intelligence platform: every summary, badge, score, narrative, recommendation, and warning should link back to preserved artifacts or deterministic facts.

## Why

The project is most trustworthy when intelligence is reproducible from evidence. This separates it from a generic repository browser or AI summarizer.

## Alternatives Rejected

- Treat AI summaries as authoritative text without provenance.
- Build more visual sections without a shared evidence model.

## Affected Systems

- Repository Intelligence Report
- Archive Score
- Recoverability
- Archive Story
- Emerging Topics
- Future MCP tools

## Commit

N/A

## Date

2026-07-31

## Follow-up Work

- Implement stable EvidenceReference and Evidence Graph models.
- Version intelligence outputs separately from immutable evidence.
