---
id: feature-gpt-cursor-relay
date: 2026-07-18
pr: 26
commit: 6994512
area:
  - tooling
  - automation
type: feature
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: implemented-by
    id: pr-26
  - type: related
    id: feature-cursor-memory-rules
title: Local GPT ↔ Cursor Agent CLI relay (v1)
---

## What

Added `tools/gpt-cursor-relay` — a local middleman that eliminates the ChatGPT ↔ Cursor copy/paste loop.

Flow: GPT API ↔ Local Relay ↔ Cursor Agent CLI (`agent -p --force --trust --workspace …`).

## Why

Daily work was stuck in a fragile clipboard loop (read reply → paste into Cursor → copy result → paste back). The reliable automation path is API + CLI, not GUI scraping.

## v1 surface

- Project folder + task box
- Start / Pause / Resume / Stop
- Notepad-style message log (local UI on `127.0.0.1`)
- Cursor completion via process exit
- Max-round limit
- Approval gate for push / deploy / deletion / secrets
- Final summary + changed-files list

## Tests

`npm --prefix tools/gpt-cursor-relay test` — approval scanner, GPT JSON parse, relay loop (complete / approval deny / max rounds).

## Remaining verification

- Live run on a real machine with `OPENAI_API_KEY` + authenticated `agent` CLI against GithubArchiver
- Optional later: Electron shell, richer stream-json progress, resume across restarts
