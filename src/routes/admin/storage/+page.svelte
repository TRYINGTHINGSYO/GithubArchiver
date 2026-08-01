<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatBytes, timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let actionMsg = $state('');
	let actionError = $state(false);
	let actionLoading = $state(false);
	let exportJobId = $state<number | null>(null);
	let exportDownloadUrl = $state<string | null>(null);

	const report = $derived(data.report);

	async function startBulkExport(scope: 'all' | 'active' | 'deleted', label: string) {
		if (!confirm(`${label}? This may take a while for large archives.`)) return;
		actionLoading = true;
		actionMsg = '';
		actionError = false;
		exportJobId = null;
		exportDownloadUrl = null;
		try {
			const res = await fetch(`/api/export/bulk?scope=${scope}&format=zip`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			exportJobId = json.jobId;
			actionMsg = `${label} started — job #${json.jobId}`;
			pollExportJob(json.jobId);
		} catch (err) {
			actionError = true;
			actionMsg = err instanceof Error ? err.message : String(err);
		} finally {
			actionLoading = false;
		}
	}

	async function pollExportJob(jobId: number) {
		for (let i = 0; i < 120; i++) {
			await new Promise((r) => setTimeout(r, 3000));
			const res = await fetch(`/api/export/bulk/${jobId}`);
			if (!res.ok) continue;
			const json = await res.json();
			if (json.job.status === 'success' && json.downloadUrl) {
				exportDownloadUrl = json.downloadUrl;
				actionMsg = `Export #${jobId} ready — ${json.detail.repo_count ?? '?'} repos`;
				return;
			}
			if (json.job.status === 'failed') {
				actionError = true;
				actionMsg = json.job.error ?? `Export #${jobId} failed`;
				return;
			}
		}
	}

	async function runCleanup(opts: Record<string, boolean>, label: string) {
		if (!confirm(`${label}? This cannot be undone.`)) return;
		actionLoading = true;
		actionMsg = '';
		actionError = false;
		try {
			const res = await fetch('/api/admin/maintenance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'storage', ...opts })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			actionMsg = `${label} complete — see Job history for details`;
			await invalidateAll();
		} catch (err) {
			actionError = true;
			actionMsg = err instanceof Error ? err.message : String(err);
		} finally {
			actionLoading = false;
		}
	}

	async function runRetention(opts: Record<string, boolean>, label: string) {
		const warning = opts.vacuum
			? `${label}? VACUUM needs free disk space roughly the size of the database.`
			: `${label}? This cannot be undone.`;
		if (!confirm(warning)) return;
		actionLoading = true;
		actionMsg = '';
		actionError = false;
		try {
			const res = await fetch('/api/admin/maintenance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'retention', ...opts })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			actionMsg = `${label} complete — see Job history for details`;
			await invalidateAll();
		} catch (err) {
			actionError = true;
			actionMsg = err instanceof Error ? err.message : String(err);
		} finally {
			actionLoading = false;
		}
	}

	const db = $derived(report.database);
	const retention = $derived(report.retention);

	let cleanupPreset = $state<'safe' | 'conservative' | 'balanced' | 'aggressive'>('balanced');
	let minAgeDays = $state(30);
	let protectEmergingDays = $state(30);
	let cleanupPreviewOverride = $state<PageData['cleanupPreview'] | null>(null);

	const cleanupPreview = $derived(cleanupPreviewOverride ?? data.cleanupPreview);
	const selectedPresetMeta = $derived(
		data.cleanupPresets.find((preset) => preset.id === cleanupPreset) ?? data.cleanupPresets[2]
	);

	async function runLowValueCleanup(
		action: 'cleanup_preview' | 'cleanup_quarantine' | 'cleanup_restore' | 'cleanup_purge',
		label: string,
		extra: Record<string, unknown> = {}
	) {
		if (action !== 'cleanup_preview' && !confirm(`${label}? Review samples first if unsure.`)) return;
		actionLoading = true;
		actionMsg = '';
		actionError = false;
		try {
			const res = await fetch('/api/admin/maintenance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action,
					preset: cleanupPreset,
					min_age_days: minAgeDays,
					protect_emerging_days: protectEmergingDays,
					sample_size: 100,
					...extra
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			if (action === 'cleanup_preview' && json.report) {
				cleanupPreviewOverride = json.report;
				actionMsg = `Preview: ${json.report.match_count.toLocaleString()} repositories match ${cleanupPreset}`;
			} else {
				actionMsg = json.report?.message ?? `${label} complete`;
				cleanupPreviewOverride = null;
				await invalidateAll();
			}
		} catch (err) {
			actionError = true;
			actionMsg = err instanceof Error ? err.message : String(err);
		} finally {
			actionLoading = false;
		}
	}

	function applyPresetDefaults(id: typeof cleanupPreset) {
		cleanupPreset = id;
		const preset = data.cleanupPresets.find((item) => item.id === id);
		if (!preset) return;
		minAgeDays = preset.minAgeDays;
		protectEmergingDays = preset.protectEmergingDays;
	}
</script>

<svelte:head>
	<title>Storage — GithubArchive+</title>
</svelte:head>

<h1>Archive Storage</h1>
<p class="storage-lead">
	Disk usage, database inventory, duplicates, and cleanup. Actions run in-process and results are
	saved to <a href="/admin/jobs?type=maintenance">Job history</a>.
</p>

<div class="stats-bar" style="margin-bottom: 1.5rem">
	<span>{formatBytes(db.database_bytes)} database</span>
	<span>{formatBytes(db.backups.bytes)} backups</span>
	<span>{formatBytes(report.total_bytes_on_disk)} archives</span>
	<span>{db.metadata_only ? 'metadata-only' : 'artifacts enabled'}</span>
</div>

<section class="detail-section">
	<h2 class="section-title">Database volume</h2>
	<p class="storage-meta mono">{db.database_path}</p>
	<div class="stats-bar" style="margin-bottom: 1rem">
		<span>{formatBytes(db.database_bytes)} db</span>
		<span>{formatBytes(db.wal_bytes)} wal</span>
		<span>{formatBytes(db.shm_bytes)} shm</span>
		{#if db.freelist_count != null}
			<span>{db.freelist_count.toLocaleString()} free pages</span>
		{/if}
	</div>

	{#if db.row_counts.length > 0}
		<table class="data-table">
			<thead>
				<tr>
					<th>Table</th>
					<th>Rows</th>
				</tr>
			</thead>
			<tbody>
				{#each db.row_counts as row}
					<tr>
						<td class="mono">{row.name}</td>
						<td>{row.count.toLocaleString()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if db.table_sizes.length > 0}
		<h3 class="section-title" style="margin-top: 1.25rem">Largest SQLite objects</h3>
		<p class="storage-meta">From <code>dbstat</code> — includes tables and indexes (e.g. FTS).</p>
		<table class="data-table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Size</th>
				</tr>
			</thead>
			<tbody>
				{#each db.table_sizes.slice(0, 12) as row}
					<tr>
						<td class="mono">{row.name}</td>
						<td>{formatBytes(row.bytes)} ({row.megabytes} MB)</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Duplicate repositories</h2>
	<p class="storage-meta">
		Primary key is GitHub numeric id. Owner/name duplicates can be renames or case variants — do not
		blind-delete by name alone.
	</p>
	{#if db.duplicate_github_ids.length === 0 && db.duplicate_owner_names.length === 0}
		<p class="empty-state">No duplicate github_id or owner/name groups found.</p>
	{:else}
		{#if db.duplicate_github_ids.length > 0}
			<p class="storage-meta">{db.duplicate_github_ids.length} github_id group(s)</p>
			<ul class="storage-list">
				{#each db.duplicate_github_ids as group}
					<li class="mono">
						github_id={group.github_id} ×{group.duplicate_count} · {group.full_names.join(', ')}
					</li>
				{/each}
			</ul>
		{/if}
		{#if db.duplicate_owner_names.length > 0}
			<p class="storage-meta">{db.duplicate_owner_names.length} owner/name group(s)</p>
			<ul class="storage-list">
				{#each db.duplicate_owner_names as group}
					<li class="mono">
						{group.owner}/{group.name} ×{group.duplicate_count} · {group.full_names.join(', ')}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Low-value repository cleanup</h2>
	<p class="storage-meta">
		Does <strong>not</strong> delete every unenriched repo. Targets zero-engagement junk while
		protecting Favorites, Watch Later, collections, releases, websites, active projects, and
		anything younger than the emerging-protection window. Recommended preset: <strong>Balanced</strong>.
	</p>

	<div class="storage-actions">
		{#each data.cleanupPresets as preset}
			<button
				type="button"
				class="filter-btn"
				class:active={cleanupPreset === preset.id}
				disabled={actionLoading}
				onclick={() => applyPresetDefaults(preset.id)}
			>
				{preset.name}
			</button>
		{/each}
	</div>
	<p class="storage-meta">{selectedPresetMeta?.description}</p>

	<div class="cleanup-controls">
		<label>
			Min age (days)
			<input type="number" min="1" max="3650" bind:value={minAgeDays} />
		</label>
		<label>
			Protect emerging younger than (days)
			<input type="number" min="0" max="3650" bind:value={protectEmergingDays} />
		</label>
	</div>

	<div class="stats-bar" style="margin-bottom: 1rem">
		<span>{cleanupPreview.match_count.toLocaleString()} match preview</span>
		<span>
			~{cleanupPreview.estimated_bytes_recoverable == null
				? '?'
				: formatBytes(cleanupPreview.estimated_bytes_recoverable)} recoverable
		</span>
		<span>{cleanupPreview.already_quarantined.toLocaleString()} quarantined</span>
		<span>{cleanupPreview.purge_eligible.toLocaleString()} purge-eligible</span>
	</div>

	<div class="storage-actions">
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() => runLowValueCleanup('cleanup_preview', 'Preview low-value matches')}
		>
			Dry-run preview
		</button>
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() => runLowValueCleanup('cleanup_quarantine', 'Quarantine matching repositories')}
		>
			Quarantine matches
		</button>
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() => runLowValueCleanup('cleanup_restore', 'Restore quarantined repositories')}
		>
			Restore quarantine
		</button>
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() =>
				runLowValueCleanup('cleanup_purge', 'Permanently purge quarantine-eligible repos', {
					rebuild_fts: true
				})}
		>
			Permanent purge (7d+)
		</button>
	</div>

	{#if cleanupPreview.samples.length > 0}
		<p class="storage-meta">Random sample ({cleanupPreview.samples.length})</p>
		<ul class="storage-list">
			{#each cleanupPreview.samples as sample}
				<li>
					<a href="/repo/{sample.full_name.split('/')[0]}/{sample.full_name.split('/')[1]}">
						{sample.full_name}
					</a>
					<span class="storage-meta">
						★{sample.stars ?? 0} · forks {sample.forks ?? 0} ·
						{sample.language ?? 'no-lang'} ·
						{sample.description ? sample.description.slice(0, 80) : 'no description'} ·
						{timeAgo(sample.created_at)}
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-state">No preview samples for this preset.</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Retention preview</h2>
	<p class="storage-meta">
		Backups: {formatBytes(db.backups.bytes)} ({db.backups.file_count} files) · Artifacts:
		{db.artifact_archive_enabled ? 'enabled' : 'disabled (recommended)'}
	</p>
	{#if retention}
		<ul class="storage-list">
			{#each retention.actions as action}
				<li>
					<span class="mono">{action.id}</span>
					— {action.message}
					{#if action.deleted > 0}
						<span class="storage-meta">({action.deleted.toLocaleString()})</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<div class="storage-actions">
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() =>
				runRetention(
					{ apply_retention: true, prune_job_runs: true, prune_metrics: true, prune_events: true, prune_backups: true },
					'Apply retention (jobs, metrics, events, backups)'
				)}
		>
			Apply retention
		</button>
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() =>
				runRetention(
					{
						apply_retention: true,
						vacuum: true,
						prune_job_runs: false,
						prune_metrics: false,
						prune_events: false,
						prune_backups: false
					},
					'VACUUM database'
				)}
		>
			VACUUM database
		</button>
	</div>
</section>

<section class="detail-section">
	<h2 class="section-title">Largest repos</h2>
	{#if report.largest_repos.length === 0}
		<p class="empty-state">No archived snapshots yet.</p>
	{:else}
		<table class="data-table">
			<thead>
				<tr>
					<th>Repository</th>
					<th>Snapshots</th>
					<th>Size</th>
				</tr>
			</thead>
			<tbody>
				{#each report.largest_repos as repo}
					<tr>
						<td>
							<a href="/repo/{repo.full_name.split('/')[0]}/{repo.full_name.split('/')[1]}">{repo.full_name}</a>
						</td>
						<td>{repo.snapshot_count}</td>
						<td>{formatBytes(repo.total_bytes)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Duplicate SHA-256</h2>
	<p class="storage-meta">
		{report.duplicate_groups.length} group(s) shown ·
		~{formatBytes(report.duplicate_bytes_recoverable)} recoverable
	</p>
	{#if report.duplicate_groups.length === 0}
		<p class="empty-state">No duplicate content hashes.</p>
	{:else}
		<ul class="storage-list">
			{#each report.duplicate_groups as group}
				<li class="mono">
					{group.sha256.slice(0, 16)}… ×{group.count} · {formatBytes(group.total_bytes)}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Missing DB rows (orphan files)</h2>
	<p class="storage-meta">{formatBytes(report.missing_db_bytes)} unreferenced on disk</p>
	{#if report.missing_db_rows.length === 0}
		<p class="empty-state">No orphan files.</p>
	{:else}
		<ul class="storage-list">
			{#each report.missing_db_rows as path}
				<li class="mono">{path}</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Old snapshots</h2>
	<p class="storage-meta">
		Beyond keep-last-{report.keep_last_n} per repo/type ·
		{formatBytes(report.old_snapshot_bytes)} (latest README/source always kept)
	</p>
	{#if report.old_snapshots.length === 0}
		<p class="empty-state">No old snapshots beyond retention preview.</p>
	{:else}
		<ul class="storage-list">
			{#each report.old_snapshots as row}
				<li>
					<span class="mono">#{row.id}</span>
					<a href="/repo/{row.full_name.split('/')[0]}/{row.full_name.split('/')[1]}">{row.full_name}</a>
					<span class="badge">{row.snapshot_type}</span>
					<span class="storage-meta">{formatBytes(row.file_size)} · {timeAgo(row.archived_at)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Cleanup</h2>
	<div class="storage-actions">
		<button type="button" class="filter-btn" disabled={actionLoading} onclick={() => runCleanup({ delete_orphans: true }, 'Delete orphan files on disk')}>
			Delete orphans
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading} onclick={() => runCleanup({ delete_duplicates: true }, 'Delete duplicate snapshot files')}>
			Delete duplicates
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading} onclick={() => runCleanup({ trim_old: true }, `Trim snapshots beyond keep-last-${report.keep_last_n}`)}>
			Trim old snapshots
		</button>
	</div>
	{#if actionMsg}
		<p class="storage-meta" class:storage-error={actionError}>{actionMsg}</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Repo names for AI</h2>
	<p class="storage-meta">
		Download every repository name with a ready-to-paste prompt so an AI model can infer what
		projects are. Includes description/language/stars when available.
	</p>
	<div class="storage-actions">
		<a class="filter-btn" href="/api/export/names?scope=all&format=txt" download>All names (.txt)</a>
		<a class="filter-btn" href="/api/export/names?scope=all&format=json" download>All names (.json)</a>
		<a class="filter-btn" href="/api/export/names?scope=active&format=txt" download>Active only</a>
		<a class="filter-btn" href="/api/export/names?scope=deleted&format=txt" download>Deleted only</a>
	</div>
</section>

<section class="detail-section">
	<h2 class="section-title">Bulk export</h2>
	<p class="storage-meta">
		Builds a zip from on-disk <code>archive_snapshots</code> (no GitHub re-fetch). Includes
		<code>manifest.json</code>. Runs as a background job — poll Job history or the status link.
	</p>
	<div class="storage-actions">
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() => startBulkExport('all', 'Export all repos with snapshots')}
		>
			Export all
		</button>
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() => startBulkExport('active', 'Export active repos only')}
		>
			Export active only
		</button>
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading}
			onclick={() => startBulkExport('deleted', 'Export deleted repos only')}
		>
			Export deleted only
		</button>
	</div>
	{#if exportJobId}
		<p class="storage-meta">
			Export job <a href="/admin/jobs">#{exportJobId}</a> —
			<a href="/api/export/bulk/{exportJobId}">status</a>
			{#if exportDownloadUrl}
				· <a href={exportDownloadUrl}>download zip</a>
			{/if}
		</p>
	{/if}
</section>

<p class="api-hint">
	<a href="/admin/doctor">Health</a> ·
	<a href="/admin">Control center</a> ·
	<a href="/">← Back to repos</a>
</p>

<style>
	.storage-lead {
		color: var(--text-muted);
		margin-top: -0.5rem;
	}

	.storage-meta {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: 0 0 0.75rem;
	}

	.storage-list {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: 0.9rem;
	}

	.storage-list li {
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--border);
		word-break: break-all;
	}

	.storage-error {
		color: var(--red);
	}

	.storage-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.storage-actions a.filter-btn {
		display: inline-flex;
		align-items: center;
		text-decoration: none;
	}

	.storage-actions .filter-btn.active {
		border-color: var(--text);
		background: color-mix(in srgb, var(--text) 8%, transparent);
	}

	.cleanup-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 0 0 1rem;
	}

	.cleanup-controls label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.cleanup-controls input {
		width: 8rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text);
	}
</style>
