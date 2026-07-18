# GPT ↔ Cursor Relay

A small local middleman that automates the copy/paste loop between ChatGPT and Cursor:

```text
GPT API
   ↕
Local Relay
   ↕
Cursor Agent CLI
```

You type the task once. The relay asks GPT for the next instruction, runs it through `agent` (Cursor Agent CLI), sends the result back to GPT, and repeats until GPT returns `complete`, asks a question, hits the max-round limit, or you stop it.

No clipboard juggling. No switching windows to paste.

## First version features

- Project folder selector
- Task box
- Start / Pause / Resume / Stop
- GPT + Cursor message log (Notepad-style local UI)
- Automatic Cursor completion detection (process exit)
- Maximum-round limit
- Approval gate before pushes, deployments, deletions, or secret changes
- Final summary + changed-files list

## Requirements

- Node.js 20+
- [Cursor Agent CLI](https://cursor.com/docs/cli/headless) (`agent`) installed and authenticated
- OpenAI API key

## Setup

```bash
cd tools/gpt-cursor-relay
npm install
cp .env.example .env
# edit .env — set OPENAI_API_KEY
# optional: CURSOR_API_KEY, OPENAI_MODEL, MAX_ROUNDS, PORT
```

Make sure the Cursor CLI works:

```bash
agent -p --trust --workspace /path/to/your/project "Summarize this repo in one sentence"
```

## Run

```bash
npm start
# open http://127.0.0.1:8787
```

1. Paste a project folder path (for example your GithubArchiver checkout)
2. Type a task: `Fix the cluster link and verify it with tests.`
3. Click **Start**
4. Watch the log:
   - Round 1: GPT → Cursor instruction
   - Round 2: Cursor edits + report
   - …
   - Final: summary + changed files

If GPT (or the safety scanner) wants to push, deploy, delete files, or touch secrets, the UI pauses for **Approve / Deny**.

## How the loop works

1. GPT receives the task + recent log and returns JSON:
   - `continue` + `instruction`
   - `complete` + `summary`
   - `ask` + `question`
   - `needs_approval` + `instruction` + `approval_reason`
2. The relay scans the instruction for sensitive actions
3. Cursor runs headlessly:

```bash
agent -p --force --trust --workspace <project> --output-format text "<instruction>"
```

4. When the process exits, stdout/stderr go back to GPT
5. Repeat until done

## Tests

```bash
npm test
```

## Notes

- This tool is intentionally local (`127.0.0.1` only).
- It does not scrape the ChatGPT website or drive the Cursor GUI.
- Keep approvals on for anything that can push, deploy, delete, or change credentials.
- `CURSOR_AGENT_BIN` can point at a stub binary for dry runs.
