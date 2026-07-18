---
id: feature-gpt-cursor-relay-v15
date: 2026-07-18
pr: 26
area:
  - tooling
  - automation
type: feature
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: supersedes
    id: feature-gpt-cursor-relay
  - type: implemented-by
    id: pr-26
title: GPT ↔ Cursor relay v1.5 — autonomous loop
---

## What

Upgraded `tools/gpt-cursor-relay` from a message relay into an autonomous coding loop.

## Changes

- Persistent GPT conversation + Cursor `--resume` chat id
- Live streaming (OpenAI SSE + Cursor `stream-json`)
- Session memory (task, rounds, files, tests, decisions)
- Git review every round (`status` / `diff` / `--stat`) before GPT plans
- Visual diff UI (`+` / `-` / `~`)
- Auto project detection from task text
- Cost tracking (GPT USD + Cursor token estimates)
- Cursor crash auto-retry (3 attempts)
- Smarter stops: duplicate instruction, identical diff, no changes, repeated test/build failures, max rounds
- `needs_user` status (legacy `ask` accepted)
- On `complete`, GPT returns `next_improvements` with optional continue

## Tests

`npm --prefix tools/gpt-cursor-relay test` — 24 passing.

## Remaining verification

Live run with real `OPENAI_API_KEY` + authenticated `agent` CLI.
