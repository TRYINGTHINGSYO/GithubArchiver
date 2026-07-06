<script lang="ts">
	import { formatBytes, timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const report = $derived(data.report);
</script>

<svelte:head>
	<title>Storage — GithubArchive+</title>
</svelte:head>

<h1>Archive Storage</h1>
<p class="storage-lead">
	Disk usage, duplicates, and cleanup candidates. Run analysis with
	<code>npm run storage:analyze</code>.
</p>

<div class="stats-bar" style="margin-bottom: 1.5rem">
	<span>{formatBytes(report.total_bytes_on_disk)} on disk</span>
	<span>{formatBytes(report.total_bytes_indexed)} indexed</span>
	<span>{report.snapshot_count} snapshots</span>
	<span>{report.file_count_on_disk} files</span>
</div>

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
	<h2 class="section-title">Safe cleanup (CLI)</h2>
	<dl class="detail-grid">
		<div>
			<dt>Delete orphans</dt>
			<dd><code>STORAGE_DELETE_ORPHANS=1 npm run storage:analyze</code></dd>
		</div>
		<div>
			<dt>Delete duplicates</dt>
			<dd><code>STORAGE_DELETE_DUPLICATES=1 npm run storage:analyze</code></dd>
		</div>
		<div>
			<dt>Trim old snapshots</dt>
			<dd><code>STORAGE_KEEP_LAST_N=5 npm run storage:analyze</code></dd>
		</div>
	</dl>
</section>

<p class="api-hint">
	<a href="/admin/doctor">Doctor</a> ·
	<a href="/admin/status">Status</a> ·
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
</style>
