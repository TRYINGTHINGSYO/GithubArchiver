---
id: feature-intelligence-audit-quality
date: 2026-08-01
area:
  - intelligence
  - classification
  - admin
type: feature
status: open
confidence: confirmed
durability: release
schema: 1
migration: 44
relationships: []
title: Intelligence audit operator UI and classification quality fixes
---

## What

Focused intelligence-quality PR: expanded taxonomy (bot, company-profile, developer-tool, …), fixed bot-vs-library and portfolio name-token errors, compatible secondary clusters, owner-pattern bulk review with confirmation, human overrides preserved on reclassify, redesigned `/admin/intelligence` tabs + guided queue. Migration 044 adds scoring_version, evidence snapshot, overrides, bulk audit log.

## Why

Audit page was a non-actionable dump; classifiers mislabeled bots as libraries and portfolio-token repos as websites.

## Tests

`tests/intelligence-audit-quality.test.ts` plus updated repo-intelligence / cluster suites.
