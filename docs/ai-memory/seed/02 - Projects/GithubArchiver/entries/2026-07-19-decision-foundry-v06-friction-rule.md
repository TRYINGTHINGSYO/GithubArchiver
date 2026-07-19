---
id: decision-foundry-v06-friction-rule
date: 2026-07-19
pr: 26
area:
  - tooling
  - automation
type: decision
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: related
    id: decision-foundry-v05-complete
  - type: implemented-by
    id: pr-26
title: Foundry v0.6 rule — only friction from real projects; ROADMAP.md
---

## Decision

After v0.5 freeze, every Foundry change must eliminate friction encountered
while building a real project (starting with Inventory). Speculative features
live in `ROADMAP.md` → Ideas until justified.

Cadence: freeze v0.5 → build Inventory with Foundry → friction log → ship only
those fixes as v0.6 → repeat.

Foundry is the tool used to build the next projects, not the perpetual product
under expansion.
