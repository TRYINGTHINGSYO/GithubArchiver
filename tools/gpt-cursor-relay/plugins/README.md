# Orchestrator plugins

Place project-agnostic plugins here (or under a project's `.relay/plugins/`).

Each plugin folder can provide either:

1. `plugin.json` — declarative verify commands

```json
{
  "id": "my-tool",
  "name": "My Tool",
  "verifyCommands": [
    { "name": "my-tool:check", "command": "npm run my-check" }
  ]
}
```

2. `plugin.js` / `index.js` — a module exporting `{ id, name, autoDetect?, verifyCommands?, verify? }`

Built-in plugins (always available): `sqlite`, `railway`, `playwright`, `github`, `vercel`, `docker`, `supabase`, `custom`.

Enable in `relay.config.yaml`:

```yaml
plugins:
  - playwright
  - railway
  - sqlite
```

If `plugins` is omitted, the orchestrator auto-detects applicable built-ins.
