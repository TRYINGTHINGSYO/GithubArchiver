# Local desktop use

GithubArchive+ can run as a local desktop-style app from a Windows launcher script. This does not add new archive behavior; it only wraps the existing Node/Svelte app startup steps.

## First-time setup

1. Install Node.js LTS from <https://nodejs.org/>.
2. Open the GithubArchive+ folder.
3. Optional but recommended: copy `.env.example` to `.env` and set `GITHUB_TOKEN` for higher GitHub API limits.
4. Double-click `start-githubarchive.bat`.

The launcher installs dependencies when `node_modules/` is missing, runs `npm run db:init`, starts the Svelte dev server, and opens:

```text
http://localhost:5173/admin/status
```

Leave the "GithubArchive+ Server" window open while using the app.

## Normal use

1. Double-click `start-githubarchive.bat`.
2. Use the browser window that opens to `/admin/status`.
3. Start or stop the daemon from the status page as needed.
4. When finished, close the "GithubArchive+ Server" window or double-click `stop-githubarchive.bat`.

If the browser opens before the server is ready, refresh the page after a few seconds.

## Backup and restore

Create a normal manifest-only backup from the project folder:

```powershell
npm run backup
```

Create a full backup that includes archived README/source files:

```powershell
$env:BACKUP_INCLUDE_ARCHIVES='1'
npm run backup
```

Restore only after stopping the dev server and daemon:

```powershell
$env:RESTORE_BACKUP_PATH='.\data\backups\YYYY-MM-DD_HH-mm-ss'
$env:RESTORE_CONFIRM='1'
npm run restore
```

Manifest-only backups do not contain the files under `data/archives/`. For a complete restore of downloaded snapshots, use a full backup or restore `data/archives/` from another copy.

See `docs/RESTORE.md` for the full restore checklist.

## Backfill warning

Backfills can process many GH Archive hours and create large local databases and archive folders. Run small date ranges first, watch `/admin/status`, and make a backup before starting a large backfill. Keep the computer awake while a backfill is running.
