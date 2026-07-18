# GPT ⇄ Cursor Relay

A local autonomous middleman between the OpenAI API and Cursor Agent CLI:

```text
GPT API  (persistent chat + streaming)
   ↕
Local Relay  (memory · git review · safety stops · retries)
   ↕
Cursor Agent CLI  (persistent --resume · stream-json)
```

Type the task once. The relay auto-continues until GPT returns `complete` /
`needs_user`, a safety rule fires, or you stop it. **No Continue button.**

## Features (v1.5)

1. **Persistent memory** — task, round history, files changed, tests, decisions
2. **Live streaming** — GPT tokens + Cursor tool/activity stream in the UI
3. **Git diff review** — `status` / `diff` / `diff --stat` fed to GPT every round
4. **Auto project detection** — “Fix SiegeQueue mobile overlay” → detect path
5. **Cost tracking** — per-round GPT USD + Cursor token estimates
6. **Visual diff** — `+` / `-` / `~` with highlighted patch lines
7. **Automatic retries** — Cursor crashes restart up to 3 attempts
8. **Smarter stopping** — duplicate instruction, identical diff, no changes,
   repeated test/build failures, max rounds
9. **Next improvements** — on complete, GPT suggests follow-ups you can continue

Also: Start / Pause / Resume / Stop, approval gates for push / deploy /
delete / secrets.

## Setup

```bash
cd tools/gpt-cursor-relay
npm install
cp .env.example .env
# set OPENAI_API_KEY
# optional: RELAY_KNOWN_PROJECTS='{"GithubArchiver":"/path/to/GithubArchiver"}'
```

Cursor Agent CLI:

```bash
agent -p --trust --workspace /path/to/project "ping"
```

## Run

```bash
npm start
# http://127.0.0.1:8787
```

From repo root: `npm run relay`.

1. Type a task (optionally click **Detect project**)
2. Click **Start**
3. Watch GPT + Cursor stream live; git diff updates each round
4. Relay auto-continues — only pauses for approvals or `needs_user`

## How the loop works

1. Collect git snapshot (`status`, `diff --stat`, `diff`)
2. Stream a GPT planning turn with **session memory + git patch**
3. If `continue` → stream Cursor (`stream-json`, `--resume` when available)
4. Auto-retry Cursor on crash (max 3)
5. Update memory / cost / visual diff
6. Apply smarter stop heuristics
7. Auto-continue (no Continue button)
8. On `complete`, show summary + **next improvements**

## Tests

```bash
npm test
```

## Env

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required |
| `OPENAI_MODEL` | Default `gpt-4.1` |
| `CURSOR_AGENT_BIN` | Default `agent` |
| `CURSOR_API_KEY` | Headless Cursor auth |
| `MAX_ROUNDS` | Default `12` |
| `PORT` | Default `8787` |
| `RELAY_KNOWN_PROJECTS` | JSON name→path map |
| `RELAY_PROJECT_ROOTS` | Extra folders to scan |

## Notes

- Binds to `127.0.0.1` only
- Uses OpenAI API + Cursor CLI — not ChatGPT/Cursor GUI automation
- Keep approval gates on for push / deploy / delete / secrets
