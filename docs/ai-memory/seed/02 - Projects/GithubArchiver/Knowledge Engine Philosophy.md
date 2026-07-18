---
status: active
project: githubarchiver
type: philosophy
schema: 1
---

# Knowledge Engine Philosophy

The knowledge engine exists to improve engineering work, not to accumulate features.

When retrieval fails:

1. Determine whether the required knowledge exists.
2. If not, append a durable event entry.
3. Add an evaluation that captures the expected retrieval behavior.
4. Regenerate the derived artifacts.
5. Continue shipping.

Do not add retrieval capabilities until repeated real-world failures demonstrate that the current architecture cannot represent or retrieve the required knowledge.

## Maintenance mode

The knowledge engine is in **maintenance mode**. Its job is to support GithubArchiver, not compete with it for development time.

Do **not** change the retrieval framework because of a single miss. Only consider framework changes when multiple real-world misses reveal the same limitation and the existing architecture cannot express or retrieve the needed knowledge.

## Operating loop

```text
Develop GithubArchiver
        ↓
Use memory:query when context is needed
        ↓
If retrieval is sufficient
        → keep shipping

If retrieval misses
        ↓
Append durable entry
        ↓
Add eval
        ↓
Verify evals pass
        ↓
Continue development
```

**If retrieval fails, improve the knowledge. Not the framework.**

## What success looks like

Do **not** optimize for entry count, graph size, edge count, document count, or new PRs against the engine.

Practical indicators during real GithubArchiver work:

- Did the top retrieval give enough context to solve the task?
- Did you have to search manually after using `memory:query`?
- How often do you add new entries?
- How often do evals catch regressions after retrieval changes?

Broader measures:

- **Retrieval precision** — How often does the top context contain what the agent actually needed?
- **Eval stability** — Do retrieval changes improve results without breaking existing queries?
- **Time to context** — How quickly can a new engineer or agent become productive?
- **Knowledge capture rate** — Are important production incidents and architectural decisions consistently entering the event log?

## Provenance

Retrieval and generated views are read-only. They never become new facts. Durable knowledge enters only through explicit append-only entries.
