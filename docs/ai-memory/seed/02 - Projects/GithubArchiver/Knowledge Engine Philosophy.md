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

## Operating loop

```text
Use retrieval during real work
        ↓
Notice a miss or bad ranking
        ↓
Add the missing fact as an entry
        ↓
Add an eval that captures the expected result
        ↓
Regenerate and keep working
```

**If retrieval fails, improve the knowledge. Not the framework.**

## What success looks like

Do **not** optimize for entry count, graph size, edge count, or document count.

Measure:

- **Retrieval precision** — How often does the top context contain what the agent actually needed?
- **Eval stability** — Do retrieval changes improve results without breaking existing queries?
- **Time to context** — How quickly can a new engineer or agent become productive?
- **Knowledge capture rate** — Are important production incidents and architectural decisions consistently entering the event log?

## Provenance

Retrieval and generated views are read-only. They never become new facts. Durable knowledge enters only through explicit append-only entries.
