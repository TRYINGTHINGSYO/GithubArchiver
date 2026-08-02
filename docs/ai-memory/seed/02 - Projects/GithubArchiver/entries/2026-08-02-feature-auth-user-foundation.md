---
id: feature-auth-user-foundation
date: 2026-08-02
area:
  - auth
  - security
  - accounts
  - sqlite
type: feature
status: verified
confidence: confirmed
durability: permanent
schema: 1
migration: 45
relationships:
  - type: related
    id: feature-intelligence-discovery-redesign
title: Auth.js GitHub accounts and centralized access control
---

## What

- Adds Auth.js GitHub OAuth with a SQLite adapter for users, linked accounts, and database sessions.
- Bootstraps administrators from explicit GitHub ID/login allowlists and hydrates typed request locals.
- Centralizes user/admin route guards and exact same-origin checks for protected mutations.
- Adds user-owned saved repositories and notes with foreign keys to `repos(id)`.
- Moves on-demand repository export generation to authenticated POST requests while preserving signed-in snapshot downloads.

## Why

Replace the shared-password admin cookie with durable identities and role-based authorization, while
providing the account foundation needed for personalized feeds, watchlists, and future user workspaces.
