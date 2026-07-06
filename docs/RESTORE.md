# Restore from backup

Use `npm run restore` to restore from a local backup created by `npm run backup`.

## Quick restore

```bash
# Stop daemon and dev server first (Ctrl+C)

RESTORE_BACKUP_PATH=./data/backups/2026-07-05_16-10-34 RESTORE_CONFIRM=1 npm run restore
```

Compressed backup:

```bash
RESTORE_BACKUP_PATH=./data/backups/2026-07-05_16-10-35.tar.gz RESTORE_CONFIRM=1 npm run restore
```

PowerShell:

```powershell
$env:RESTORE_BACKUP_PATH='.\data\backups\2026-07-05_16-10-34'
$env:RESTORE_CONFIRM='1'
npm run restore
```

## What the restore command does

1. Requires `RESTORE_CONFIRM=1` (prints a warning otherwise)
2. Warns if dev server (port 5173) or daemon appears to be running
3. Creates an automatic **pre-restore backup** of the current state
4. Restores the SQLite database from the backup
5. Removes stale `*.db-wal` and `*.db-shm` files
6. Restores `archives/` **only if** the backup contains an `archives/` folder
7. Runs `npm run db:init` to apply any pending migrations

## Backup formats supported

| Source | `RESTORE_BACKUP_PATH` example |
|--------|-------------------------------|
| Backup folder | `./data/backups/2026-07-05_16-10-34` |
| Compressed `.tar.gz` | `./data/backups/2026-07-05_16-10-35.tar.gz` |

## What each backup contains

Each backup is stored under `data/backups/` as either a folder or a compressed `.tar.gz` (when `BACKUP_COMPRESS=1`).

| File | Description |
|------|-------------|
| `githubarchive.db` | Point-in-time SQLite copy of the application database |
| `archives-manifest.json` | Listing of files under `ARCHIVE_DIR` plus `archive_snapshots` rows |
| `metadata.json` | Schema version, backup type, source paths, table counts, backup size |
| `archives/` | **Full backups only** (`BACKUP_INCLUDE_ARCHIVES=1`) — copy of snapshot files |

### Backup types

| Type | Env | Archive bytes |
|------|-----|---------------|
| `manifest-only` | default | Manifest only — README/tarball files are **not** copied |
| `full` | `BACKUP_INCLUDE_ARCHIVES=1` | `archives/` folder included in the backup |

`metadata.json` records `backup_type`, `include_archives`, and `compressed`.

## Prerequisites

1. Stop the daemon and any workers (`Ctrl+C` on `npm run daemon`).
2. Stop the dev server if it is running (`Ctrl+C` on `npm run dev`).
3. Set `RESTORE_BACKUP_PATH` to the backup folder or `.tar.gz` file.
4. Set `RESTORE_CONFIRM=1` to acknowledge the warning.

## Manual restore (alternative)

If you prefer not to use `npm run restore`:

```bash
BACKUP_DIR=./data/backups/2026-07-05_16-04-30

cp ./data/githubarchive.db ./data/githubarchive.db.before-restore
cp "$BACKUP_DIR/githubarchive.db" ./data/githubarchive.db
rm -f ./data/githubarchive.db-wal ./data/githubarchive.db-shm
npm run db:init
```

### Full backup archives (manual)

```bash
mv ./data/archives ./data/archives.before-restore
cp -r "$BACKUP_DIR/archives" ./data/archives
```

### Manifest-only backup

Archive snapshot files are not in the backup. After DB restore, either:

1. Restore `data/archives/` from your own copy, or
2. Re-download snapshots:

```bash
npm run archive:repos
```

## Verify

```bash
npm run dev
# Open http://localhost:5173/admin/status
# Check backup type, repo counts, and archive storage match expectations
```

## Start workers again

```bash
npm run daemon
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESTORE_BACKUP_PATH` | yes | Path to backup folder or `.tar.gz` |
| `RESTORE_CONFIRM` | yes | Set to `1` to proceed after reading warnings |

## Troubleshooting

| Issue | Action |
|-------|--------|
| `RESTORE_CONFIRM=1` required | Set the env var after stopping daemon/dev server |
| Schema mismatch after restore | `npm run db:init` runs automatically; check `metadata.json` → `schema_version` |
| Missing README/tarball downloads | Manifest-only backup — restore `data/archives/` separately or re-run `archive:repos` |
| `database is locked` | Stop daemon and dev server before restoring |
| Compressed backup | `npm run restore` extracts `.tar.gz` automatically; no manual `tar` step needed |
| Wrong state after restore | Use the automatic pre-restore backup in `data/backups/` to roll back |
