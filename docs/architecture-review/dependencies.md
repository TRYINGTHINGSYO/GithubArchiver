# Dependencies and toolchain

## Declared direct dependencies

| Package | Manifest range | Installed version | Role |
|---|---:|---:|---|
| `archiver` | `^8.0.0` | 8.x (lock/install) | Generate ZIP/tar-style export archives and compressed backups |
| `better-sqlite3` | `^11.9.1` | 11.10.0 | Synchronous SQLite connection, queries, backup, migrations |
| `dotenv` | `^16.5.0` | 16.6.1 | Load `.env` for CLI scripts |
| `marked` | `^15.0.7` | 15.0.12 | Convert README Markdown to HTML |

## Development dependencies

| Package | Manifest range | Installed version | Role |
|---|---:|---:|---|
| `@sveltejs/adapter-node` | `^5.2.12` | 5.5.7 | Standalone Node production server |
| `@sveltejs/kit` | `^2.21.0` | 2.69.1 | Full-stack routing, SSR, endpoint framework |
| `@sveltejs/vite-plugin-svelte` | `^5.0.3` | 5.1.1 | Svelte compilation in Vite |
| `svelte` | `^5.30.0` | 5.56.4 | UI/runtime |
| `vite` | `^6.3.5` | 6.4.3 | Development/build tooling |
| `vitest` | `^3.2.4` | 3.2.6 | Unit/integration test runner |
| `typescript` | `^5.8.3` | 5.9.3 | Static typing/transpilation input |
| `tsx` | `^4.19.4` | 4.23.x | Run TypeScript CLI scripts |
| `@types/archiver` | `^8.0.0` | 8.x | Archiver types |
| `@types/better-sqlite3` | `^7.6.12` | 7.6.13 | SQLite binding types |

The lockfile is present and Docker uses `npm ci`, providing reproducible resolved packages for that lockfile and platform. No package-manager engine constraint or Node `engines` field is declared.

## Native dependency risk

`better-sqlite3` includes a native binary. The supplied `node_modules` binary targets ABI 115 while the host uses Node 22/ABI 127, causing all database-backed tests and runtime startup to fail locally. Docker pins Node 20, but local docs only say Node LTS and the launcher reuses any existing `node_modules`. The project needs an explicit supported Node version (`engines`, `.nvmrc`/`.node-version`, Volta, or equivalent) and clean install guidance.

The lockfile also marks transitive `prebuild-install@7.1.3` as deprecated/no longer maintained. It arrives through native-addon tooling rather than a direct application import; replacement depends on an upstream `better-sqlite3` packaging update or a deliberate native dependency change.

## Security and correctness implications

- `marked` parses Markdown but does not sanitize hostile HTML. The code applies a custom regex cleaner instead of a dedicated allowlist sanitizer. Markdown from arbitrary public repositories is untrusted.
- `archiver` and manual tar parsing process untrusted archive structures. Limits/path normalization tests are security-critical.
- Synchronous `better-sqlite3` simplifies transactions but makes query/file-heavy work block the server event loop.
- Broad caret ranges have already resolved SvelteKit/Svelte/TypeScript significantly above manifest minimums. Lockfile discipline is therefore important.
- No dependency scanning, license report, SBOM generation, lockfile audit job, or automated update configuration appears in the repository.

## Notable missing dependencies/capabilities

Absence is not automatically a defect, but it clarifies the architecture:

| Capability | Current state |
|---|---|
| HTML sanitization | No dedicated sanitizer |
| Request/body schema validation | No Zod/Valibot/JSON Schema layer |
| Authentication/session | No auth dependency |
| Structured logging | Console/text only |
| Metrics/tracing | No OpenTelemetry/Prometheus client |
| Background queue | No queue/broker client |
| Object storage | Local filesystem only |
| Browser automation/screenshots | No Playwright/Puppeteer runtime |
| Semantic/vector search | No embedding/vector dependency |
| Date handling | Native `Date`/ISO strings |
| UI component system | Page-local Svelte/CSS |
| E2E/accessibility testing | No browser/axe dependency |

## Replacement candidates

- The custom regular-expression HTML cleanup should be replaced by a maintained allowlist HTML sanitizer appropriate for server-side Svelte/Node rendering; `marked` itself can remain the Markdown parser.
- The process-local promise queue and daemon ownership need a durable lease/queue implementation before multi-process deployment. That does not require a hosted broker immediately; a SQLite queue table is already named in the roadmap.
- `prebuild-install` is transitive and deprecated; update/replace it through the upstream native database package rather than importing another copy directly.
- `better-sqlite3` is not an obvious near-term replacement for a single-node archive—it provides useful simplicity and backup support. CPU/file-heavy jobs should first be isolated from the HTTP process. Reconsider the database engine only when measured corpus size, concurrent writers, or replica requirements exceed SQLite's model.
- The hand-written tar parser deserves either a hardened, streaming archive library or a stronger fuzz/security test envelope. A replacement decision should preserve GitHub-root stripping and strict resource/path limits.

## Package/toolchain drift

- Package version `0.1.0`, GitHub HTTP user-agent `0.3`, and roadmap schema/version labels are not synchronized.
- The build script does not run `tsc` or `svelte-check`; current generated output coexists with 32 type errors.
- Type declarations for `ArchiveSnapshotRow` are imported from a non-exporting module in two files, evidence of module-boundary drift.
- There is no enforced formatter/linter, contributing to unused imports, dead components, and type mismatches surviving the normal build.
