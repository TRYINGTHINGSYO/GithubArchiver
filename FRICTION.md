# Friction log & engineering journal

Use this while building **real** projects with Foundry (starting with Inventory).
Every v0.6+ change should trace to an entry here.

**Rule:** if it did not happen while building a real project, it does not ship.

---

## How to log an issue

Copy a block per incident:

```text
### YYYY-MM-DD — short title
Project: Inventory | Foundry: v0.5.0-beta.1

Task:
What I was trying to do.

Expectation:
What I thought Foundry would do.

Reality:
What actually happened.

Fix:
What changed (PR / commit), or "deferred".

Validated:
Did the next project prove the fix? (date / project)
```

Promote fixed items into [ROADMAP.md](./ROADMAP.md) → **Validated improvements**.
Leave speculative wants in ROADMAP → **Ideas**.

---

## Open friction

*(none yet — Inventory not started)*

---

## Resolved (candidates for v0.6+)

*(none yet)*

---

## Release checklist (after publish)

1. [ ] Publish `TRYINGTHINGSYO/Foundry` (`PUBLISH.md`)
2. [ ] `FOUNDRY_ACCEPTANCE_GITHUB=1 npm run acceptance:github`
3. [ ] Tag: `git tag -a v0.5.0-beta.1 -m "Foundry v0.5 — standalone project birth"` && `git push origin v0.5.0-beta.1`
4. [ ] Build Inventory entirely with Foundry; fill this log
5. [ ] Ship v0.6 with only validated fixes from this log
