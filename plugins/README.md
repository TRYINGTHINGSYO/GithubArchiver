# Foundry plugins

Built-in plugins live in `src/plugins/builtin.ts`. Extra plugins can be dropped under:

- `tools/foundry/plugins/<id>/plugin.json` (marketplace installs)
- `<project>/.foundry/plugins/`
- `<project>/.relay/plugins/` (legacy)

Enable in `foundry.config.yaml`:

```yaml
plugins:
  - playwright
  - railway
  - sqlite
```

Browse the local marketplace via the UI or `GET /api/marketplace`. Install stubs with `POST /api/marketplace/install` `{ "id": "svelte" }`.
