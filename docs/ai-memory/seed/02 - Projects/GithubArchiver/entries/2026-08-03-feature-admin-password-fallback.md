---
id: feature-admin-password-fallback
date: 2026-08-03
area:
  - auth
  - admin
  - security
type: feature
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: related
    id: feature-auth-user-foundation
title: Restore ADMIN_PASSWORD admin login beside GitHub OAuth
---

## What

- Restores shared `ADMIN_PASSWORD` cookie sessions (`gha_admin`) as an admin access path.
- `/login` always offers the password form; GitHub OAuth remains optional when Auth.js is configured.
- When GitHub OAuth env vars are missing, admin routes no longer dead-end on "Sign-in is not connected yet".
- Logout clears the password admin cookie and only hits Auth.js signout when OAuth is configured.

## Why

Production had Auth.js GitHub sign-in unconfigured, so operators could not reach `/admin`. Password
admin is the break-glass path for ops without requiring a GitHub OAuth app.

## Tests

- `tests/admin-password.test.ts`
- `tests/login-page.test.ts`
- `tests/auth-access.test.ts`

## Remaining verification

- Deploy and confirm `/login` password → `/admin` on Railway without `AUTH_GITHUB_*`.
- Set a non-default `ADMIN_PASSWORD` in production.
