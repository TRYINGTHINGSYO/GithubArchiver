<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { formatJobTypeLabel } from '$lib/status-display';
	import { timeAgo, formatBytes } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let actionMsg = $state('');
	let actionError = $state(false);
	let actionLoading = $state<string | null>(null);
	let backfillStart = $state('');
	let backfillEnd = $state('');
	let backfillSource = $state('auto');
	let backfillMaxHours = $state(6);

	const status = $derived(data.status);
	const daemon = $derived(
		data.status?.daemon ?? {
			processRunning: false,
			running: false,
			job: null,
			detail: null,
			lastRunAt: null,
			nextRunAt: null,
			logTail: [] as string[]
		}
	);
	const workerTypes = ['daemon', 'ingest', 'enrich', 'refresh', 'archive'] as const;

	const backfillEstimate = $derived.by(() => {
		if (!backfillStart || !backfillEnd) return null;
		const start = new Date(`${backfillStart}T00:00:00Z`);
		const end = new Date(`${backfillEnd}T23:59:59Z`);
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
		const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
		return { days, hours: days * 24 };
	});

	onMount(() => {
		const id = setInterval(() => void invalidateAll(), 10_000);
		return () => clearInterval(id);
	});

	async function postJson(url: string, body: Record<string, unknown>) {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error ?? json.message ?? res.statusText);
		return json;
	}

	async function runAction(label: string, fn: () => Promise<unknown>) {
		actionLoading = label;
		actionMsg = '';
		actionError = false;
		try {
			await fn();
			actionMsg = `${label} started`;
			await invalidateAll();
		} catch (err) {
			actionError = true;
			actionMsg = err instanceof Error ? err.message : String(err);
		} finally {
			actionLoading = null;
		}
	}

	function confirmBackfill(): boolean {
		if (!backfillStart || !backfillEnd) return false;
		const est = backfillEstimate;
		if (!est) {
			actionError = true;
			actionMsg = 'Invalid date range — end date must be on or after start date.';
			return false;
		}

		let message = `Start backfill from ${backfillStart} to ${backfillEnd}?\n\n`;
		message += `Estimated ~${est.hours.toLocaleString()} UTC hours (~${est.days} day${est.days === 1 ? '' : 's'}).\n`;
		message += `Each run processes up to ${backfillMaxHours} hours; the worker loops until finished or stopped.\n`;

		if (est.days >= 365) {
			message +=
				'\n⚠ WARNING: This is a full-year (or multi-year) backfill. It may take days, hit rate limits, and use significant disk space. Consider smaller date ranges first.';
		} else if (est.days >= 30) {
			message += '\n⚠ This is a large backfill and may take many hours.';
		}

		return confirm(message);
	}

	function backfillProgressPct(progress: { completed: number; total: number }): number {
		if (progress.total <= 0) return 0;
		return Math.round((progress.completed / progress.total) * 100);
	}

	function jobDuration(started: string, finished: string | null): string {
		const end = finished ? new Date(finished).getTime() : Date.now();
		const secs = Math.round((end - new Date(started).getTime()) / 1000);
		if (secs < 60) return `${secs}s`;
		return `${Math.floor(secs / 60)}m ${secs % 60}s`;
	}

	function statusClass(s: string): string {
		if (s === 'running') return 'badge pending';
		if (s === 'success') return 'badge archived';
		if (s === 'failed') return 'badge deleted';
		if (s === 'interrupted') return 'badge';
		if (s === 'cancelled') return 'badge';
		return 'badge';
	}

	function formatDetail(json: string): string {
		try {
			return JSON.stringify(JSON.parse(json), null, 2);
		} catch {
			return json;
		}
	}
</script>

<svelte:head>
	<title>Worker Status — GithubArchive+</title>
</svelte:head>

<h1>Worker Status</h1>
<p class="admin-lead">
	Automatic scanning and backfill controls. Status refreshes every 10 seconds.
</p>

{#if data.loadError}
	<div class="empty-state admin-error">
		<p>Failed to load status: {data.loadError}</p>
		<p class="admin-meta">Check that the database exists (<code>npm run db:init</code>) and retry.</p>
	</div>
{:else if status}
<section class="detail-section">
	<h2 class="section-title">Controls</h2>
	<div class="admin-actions">
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Start daemon', () => postJson('/api/admin/daemon', { action: 'start' }))}>
			{actionLoading === 'Start daemon' ? 'Starting…' : 'Start Daemon'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Stop daemon', () => postJson('/api/admin/daemon', { action: 'stop' }))}>
			{actionLoading === 'Stop daemon' ? 'Stopping…' : 'Stop Daemon'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Pipeline', () => postJson('/api/admin/workers', { action: 'pipeline' }))}>
			{actionLoading === 'Pipeline' ? 'Starting…' : 'Run Pipeline Now'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Ingest', () => postJson('/api/admin/workers', { action: 'ingest' }))}>
			{actionLoading === 'Ingest' ? 'Starting…' : 'Ingest Now'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Enrich', () => postJson('/api/admin/workers', { action: 'enrich' }))}>
			{actionLoading === 'Enrich' ? 'Starting…' : 'Enrich Now'}
		</button>
		{#if status.archive.metadataOnly}
			<button type="button" class="filter-btn" disabled title="Artifact archive storage is disabled">
				Archive storage disabled
			</button>
		{:else}
			<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Archive', () => postJson('/api/admin/workers', { action: 'archive' }))}>
				{actionLoading === 'Archive' ? 'Starting…' : 'Archive Now'}
			</button>
		{/if}
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Refresh', () => postJson('/api/admin/workers', { action: 'refresh' }))}>
			{actionLoading === 'Refresh' ? 'Starting…' : 'Refresh Metadata'}
		</button>
	</div>
	{#if actionMsg}
		<p class="admin-meta" class:admin-error={actionError} class:admin-success={!actionError}>{actionMsg}</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Repository stats</h2>
	<dl class="detail-grid">
		<div><dt>Total repos</dt><dd>{status.stats.totalRepos.toLocaleString()}</dd></div>
		<div><dt>Enriched</dt><dd>{status.stats.enrichedRepos.toLocaleString()}</dd></div>
		<div><dt>Archived</dt><dd>{status.stats.archivedRepos.toLocaleString()}</dd></div>
		<div><dt>With README</dt><dd>{status.stats.readmeRepos.toLocaleString()}</dd></div>
		<div><dt>With releases</dt><dd>{status.stats.releaseRepos.toLocaleString()}</dd></div>
		<div><dt>Unenriched</dt><dd>{status.stats.unenrichedRepos.toLocaleString()}</dd></div>
	</dl>
	{#if status.stats.reposByYear.length > 0}
		<p class="admin-meta">
			By year:
			{#each status.stats.reposByYear as row}
				{row.year} ({row.count.toLocaleString()}){#if row !== status.stats.reposByYear[status.stats.reposByYear.length - 1]}, {/if}
			{/each}
		</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Backfill</h2>
	{#if backfillEstimate && backfillEstimate.days >= 365}
		<p class="admin-warning">
			⚠ Full-year or multi-year backfills can take days and consume significant disk/API quota. Prefer smaller ranges for testing.
		</p>
	{:else if backfillEstimate && backfillEstimate.days >= 30}
		<p class="admin-warning">⚠ Large date range selected — expect a long-running job.</p>
	{/if}
	<form
		class="filters"
		onsubmit={(e) => {
			e.preventDefault();
			if (!confirmBackfill()) return;
			runAction('Backfill', () =>
				postJson('/api/admin/backfill', {
					start_date: backfillStart,
					end_date: backfillEnd,
					source: backfillSource,
					max_hours_per_run: backfillMaxHours,
					run_now: true
				})
			);
		}}
	>
		<input type="date" class="filter-input" bind:value={backfillStart} required aria-label="Start date" />
		<input type="date" class="filter-input" bind:value={backfillEnd} required aria-label="End date" />
		<select class="filter-select" bind:value={backfillSource}>
			<option value="auto">auto</option>
			<option value="gharchive">gharchive</option>
			<option value="github_search">github_search</option>
		</select>
		<input type="number" class="filter-input" min="1" max="48" bind:value={backfillMaxHours} title="Max hours per batch" aria-label="Max hours per batch" />
		<button type="submit" class="filter-btn" disabled={actionLoading !== null}>
			{actionLoading === 'Backfill' ? 'Starting…' : 'Start backfill'}
		</button>
		<button
			type="button"
			class="filter-btn"
			disabled={actionLoading !== null}
			onclick={() => runAction('Resume backfill', () => postJson('/api/admin/backfill?resume=1', {}))}
		>
			{actionLoading === 'Resume backfill' ? 'Resuming…' : 'Resume'}
		</button>
	</form>
	{#if backfillEstimate}
		<p class="admin-meta">Estimated scope: ~{backfillEstimate.hours.toLocaleString()} UTC hours ({backfillEstimate.days} day{backfillEstimate.days === 1 ? '' : 's'})</p>
	{/if}
	{#if status.backfill}
		{@const p = status.backfill.progress}
		<div class="backfill-progress">
			<div class="backfill-progress-bar" style="width: {backfillProgressPct(p)}%"></div>
		</div>
		<p class="admin-meta">
			Job #{status.backfill.job.id} ({status.backfill.job.status}): {status.backfill.job.start_date} → {status.backfill.job.end_date}
			· {p.completed}/{p.total} completed ({backfillProgressPct(p)}%)
			· {p.pending} pending · {p.running} running · {p.failed} failed · {p.unavailable} unavailable
		</p>
	{:else}
		<p class="empty-state">No backfill jobs yet.</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">GitHub Search ingestion</h2>
	{#if status.searchIngest.summary.latest}
		{@const s = status.searchIngest.summary.latest}
		<dl class="detail-grid">
			<div><dt>Latest hour</dt><dd class="mono">{s.hour_key}</dd></div>
			<div><dt>Shards</dt><dd>{s.shard_count}</dd></div>
			<div><dt>GitHub total_count (sum)</dt><dd>{s.total_count_sum.toLocaleString()}</dd></div>
			<div><dt>Found / inserted / skipped</dt><dd>{s.found_sum} / {s.inserted_sum} / {s.skipped_sum}</dd></div>
			<div><dt>Pages fetched</dt><dd>{s.pages_sum}</dd></div>
			{#if s.failed_shards > 0}
				<div><dt>Failed shards</dt><dd class="admin-error">{s.failed_shards}</dd></div>
			{/if}
		</dl>
		<p class="admin-meta">
			Low insert counts usually mean dedupe (repos already in DB) or a narrow hour window — not a broken API.
		</p>
	{:else}
		<p class="empty-state">No GitHub Search ingest runs recorded yet.</p>
	{/if}
	{#if status.searchIngest.summary.lastError}
		<p class="admin-error">
			Last search error ({timeAgo(status.searchIngest.summary.lastError.started_at)}):
			{status.searchIngest.summary.lastError.error}
		</p>
	{/if}
	{#if status.searchIngest.recent.length > 0}
		<table class="data-table" style="margin-top: 1rem">
			<thead>
				<tr>
					<th>Query</th>
					<th>total_count</th>
					<th>found</th>
					<th>inserted</th>
					<th>skipped</th>
					<th>pages</th>
					<th>status</th>
				</tr>
			</thead>
			<tbody>
				{#each status.searchIngest.recent as row}
					<tr>
						<td class="mono admin-query" title={row.query}>{row.query}</td>
						<td>{row.total_count ?? '—'}</td>
						<td>{row.found}</td>
						<td>{row.inserted}</td>
						<td>{row.skipped}</td>
						<td>{row.pages_fetched}</td>
						<td><span class={statusClass(row.status === 'completed' ? 'success' : row.status)}>{row.status}</span></td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">GitHub API</h2>
	{#if status.rateLimit}
		<dl class="detail-grid">
			<div><dt>Core remaining</dt><dd>{status.rateLimit.remaining} / {status.rateLimit.limit}</dd></div>
			<div><dt>Core resets</dt><dd>{status.rateLimit.resetAt ? timeAgo(status.rateLimit.resetAt) : '—'}</dd></div>
			<div><dt>Search remaining</dt><dd>{status.rateLimit.searchRemaining} / {status.rateLimit.searchLimit}</dd></div>
			<div><dt>Search resets</dt><dd>{status.rateLimit.searchResetAt ? timeAgo(status.rateLimit.searchResetAt) : '—'}</dd></div>
		</dl>
	{:else}
		<p class="admin-meta">Rate limit unavailable</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Live log</h2>
	<pre class="admin-pre admin-log">{daemon.logTail?.join('\n') ?? 'No worker log yet.'}</pre>
</section>

<section class="detail-section">
	<h2 class="section-title">Daemon</h2>
	{#if daemon.job}
		<dl class="detail-grid">
			<div>
				<dt>Status</dt>
				<dd>
					<span class={daemon.running ? 'badge archived' : statusClass(daemon.job.status)}>
						{daemon.running ? 'running' : daemon.job.status}
					</span>
				</dd>
			</div>
			<div>
				<dt>Next run</dt>
				<dd>{daemon.nextRunAt ? timeAgo(daemon.nextRunAt) : '—'}</dd>
			</div>
			<div>
				<dt>Process</dt>
				<dd>{daemon.processRunning ? 'running' : 'stopped'}</dd>
			</div>
			<div>
				<dt>PID</dt>
				<dd class="mono">{daemon.detail?.pid ?? '—'}</dd>
			</div>
			<div>
				<dt>Phase</dt>
				<dd class="mono">{daemon.detail?.phase ?? '—'}</dd>
			</div>
			<div>
				<dt>Started</dt>
				<dd>{timeAgo(daemon.job.started_at)}</dd>
			</div>
			{#if daemon.detail?.sleep_until}
				<div>
					<dt>Sleep until</dt>
					<dd class="mono">{daemon.detail.sleep_until}</dd>
				</div>
			{/if}
			{#if daemon.detail?.failure_streak}
				<div>
					<dt>Failure streak</dt>
					<dd>{daemon.detail.failure_streak}</dd>
				</div>
			{/if}
		</dl>
		{#if daemon.job.error}
			<p class="admin-error">{daemon.job.error}</p>
		{/if}
	{:else}
		<p class="empty-state">No daemon runs recorded yet.</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Workers (latest run)</h2>
	<table class="data-table">
		<thead>
			<tr>
				<th>Worker</th>
				<th>Status</th>
				<th>Started</th>
				<th>Duration</th>
			</tr>
		</thead>
		<tbody>
			{#each workerTypes as type}
				{@const job = status.workers[type]}
				<tr>
					<td class="mono">{type}</td>
					<td>
						{#if job}
							<span class={statusClass(job.status)}>{job.status}</span>
						{:else}
							<span class="badge">—</span>
						{/if}
					</td>
					<td>{job ? timeAgo(job.started_at) : '—'}</td>
					<td>{job ? jobDuration(job.started_at, job.finished_at) : '—'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section class="detail-section">
	<h2 class="section-title">Refresh / metrics</h2>
	<dl class="detail-grid">
		<div>
			<dt>Refresh interval</dt>
			<dd>{status.refresh.intervalHours}h</dd>
		</div>
		<div>
			<dt>Repos due for refresh</dt>
			<dd>{status.refresh.dueCount}</dd>
		</div>
		<div>
			<dt>Metric snapshots</dt>
			<dd>{status.refresh.totalSnapshots}</dd>
		</div>
		<div>
			<dt>Repos with snapshots</dt>
			<dd>{status.refresh.reposWithSnapshots}</dd>
		</div>
		<div>
			<dt>Last refresh job</dt>
			<dd>
				{#if status.refresh.lastJob}
					<span class={statusClass(status.refresh.lastJob.status)}>
						{status.refresh.lastJob.status}
					</span>
					· {timeAgo(status.refresh.lastJob.started_at)}
				{:else}
					—
				{/if}
			</dd>
		</div>
		{#if status.refresh.lastDetail}
			<div>
				<dt>Last batch</dt>
				<dd>
					{status.refresh.lastDetail.refreshed ?? 0} refreshed,
					{status.refresh.lastDetail.metricsChanged ?? 0} metric changes
				</dd>
			</div>
		{/if}
	</dl>
	<p class="admin-meta">Manual refresh: <code>npm run enrich:refresh</code></p>
</section>

<section class="detail-section">
	<h2 class="section-title">Ingestion & discovery</h2>
	<dl class="detail-grid">
		<div>
			<dt>Repos ingested (last hour)</dt>
			<dd>{status.ingestion.reposLastHour.toLocaleString()}</dd>
		</div>
		<div>
			<dt>Repos ingested (today UTC)</dt>
			<dd>{status.ingestion.reposToday.toLocaleString()}</dd>
		</div>
		<div>
			<dt>Historical Search-fallback discoveries</dt>
			<dd>{status.discovery.githubSearchRepos.toLocaleString()}</dd>
		</div>
		<div>
			<dt>Search fallback active</dt>
			<dd>{status.discovery.searchFallbackActive ? 'Yes' : 'No'}</dd>
		</div>
		<div>
			<dt>Worker last ran</dt>
			<dd>
				{status.ingestion.workerLastRanAt
					? timeAgo(status.ingestion.workerLastRanAt)
					: '—'}
				{#if status.ingestion.ingestRunning}
					· <span class="badge pending">running</span>
				{/if}
			</dd>
		</div>
		<div>
			<dt>Target hour (GH Archive)</dt>
			<dd class="mono">{status.ingestion.targetHour}</dd>
		</div>
		<div>
			<dt>Latest completed archive hour</dt>
			<dd class="mono">{status.ingestion.latestHour ?? '—'}</dd>
		</div>
		<div>
			<dt>Hours ingested</dt>
			<dd>{status.ingestion.totalHours}</dd>
		</div>
		<div>
			<dt>Archive hour backlog</dt>
			<dd>{status.ingestion.missingHours.length}</dd>
		</div>
		<div>
			<dt>Unenriched repos</dt>
			<dd>{status.stats.unenrichedRepos} / {status.stats.totalRepos}</dd>
		</div>
	</dl>
	{#if status.ingestion.missingHours.length > 0}
		<p class="admin-meta mono">{status.ingestion.missingHours.join(', ')}</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Backups</h2>
	<dl class="detail-grid">
		<div>
			<dt>Backup type</dt>
			<dd>
				{#if status.backup.latest}
					<span class="badge" class:archived={status.backup.latest.backupType === 'full'}>
						{status.backup.latest.backupType}
					</span>
					{#if status.backup.latest.compressed}
						<span class="badge pending">compressed</span>
					{/if}
				{:else}
					—
				{/if}
			</dd>
		</div>
		<div>
			<dt>Latest backup</dt>
			<dd>
				{#if status.backup.latest?.createdAt}
					{timeAgo(status.backup.latest.createdAt)}
				{:else if status.backup.latest}
					<span class="mono">{status.backup.latest.dirName}</span>
				{:else}
					—
				{/if}
			</dd>
		</div>
		<div>
			<dt>Backup size</dt>
			<dd>
				{#if status.backup.latest}
					{formatBytes(status.backup.latest.totalBytes)}
				{:else}
					—
				{/if}
			</dd>
		</div>
		<div>
			<dt>Backup folders</dt>
			<dd>{status.backup.backupCount}</dd>
		</div>
		{#if status.backup.latest}
			<div>
				<dt>Folder</dt>
				<dd class="mono">data/backups/{status.backup.latest.dirName}</dd>
			</div>
		{/if}
	</dl>
	<p class="admin-meta">
		Create: <code>npm run backup</code> ·
		full: <code>BACKUP_INCLUDE_ARCHIVES=1</code> ·
		compress: <code>BACKUP_COMPRESS=1</code> ·
		restore: <code>docs/RESTORE.md</code>
	</p>
</section>

<section class="detail-section">
	<h2 class="section-title">Archive storage</h2>
	{#if status.archive.metadataOnly}
		<p class="admin-warning">Metadata-only mode is active. README, source, and ZIP archive downloads are disabled by default; discovery, enrichment, metrics, events, and summaries continue.</p>
	{/if}
	<dl class="detail-grid">
		<div>
			<dt>Snapshot files</dt>
			<dd>{status.archive.fileCount.toLocaleString()}</dd>
		</div>
		<div>
			<dt>Indexed disk usage</dt>
			<dd>{formatBytes(status.archive.indexedBytes)}</dd>
		</div>
	</dl>
	<p class="admin-meta">
		<a href="/birth-feed">Birth feed</a> · indexed bytes from <code>archive_snapshots.file_size</code>
	</p>
</section>

<section class="detail-section">
	<h2 class="section-title">Latest errors</h2>
	{#if status.latestErrors.length === 0}
		<p class="empty-state">No recent errors.</p>
	{:else}
		<ul class="admin-errors">
			{#each status.latestErrors as err}
				<li><span class="mono">{err.source}</span> · {timeAgo(err.at)} · {err.message}</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">Recent jobs</h2>
	{#if status.recentJobs.length === 0}
		<p class="empty-state">No jobs yet.</p>
	{:else}
		<ul class="timeline-list admin-jobs">
			{#each status.recentJobs as job}
				<li class="timeline-item">
					<span class="timeline-time mono">{timeAgo(job.started_at)}</span>
					<span class="timeline-label mono" title={job.job_type}>{formatJobTypeLabel(job)}</span>
					<span class={statusClass(job.status)}>{job.status}</span>
				</li>
				{#if job.detail_json && job.detail_json !== '{}'}
					<li class="admin-detail-row">
						<pre class="admin-pre">{formatDetail(job.detail_json)}</pre>
					</li>
				{/if}
				{#if job.error}
					<li class="admin-detail-row admin-error">{job.error}</li>
				{/if}
			{/each}
		</ul>
	{/if}
</section>

<p class="api-hint"><a href="/">← Back to repos</a></p>
{/if}

<style>
	.admin-lead {
		color: var(--text-muted);
		margin-top: -0.5rem;
	}

	.admin-meta {
		font-size: 0.85rem;
		color: var(--text-muted);
		word-break: break-all;
	}

	.admin-error {
		color: var(--red);
		font-size: 0.9rem;
	}

	.admin-success {
		color: var(--green, #3d9970);
	}

	.admin-warning {
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-elevated));
		border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
		border-radius: 6px;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	.backfill-progress {
		height: 8px;
		background: var(--bg-elevated);
		border-radius: 4px;
		overflow: hidden;
		margin: 0.5rem 0;
	}

	.backfill-progress-bar {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s ease;
	}

	.filter-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.admin-jobs .timeline-item {
		grid-template-columns: 120px 100px 1fr auto;
	}

	.admin-detail-row {
		padding: 0 0 0.75rem 0;
		border-bottom: 1px solid var(--border);
	}

	.admin-pre {
		margin: 0;
		padding: 0.75rem;
		background: var(--bg-elevated);
		border-radius: 6px;
		font-size: 0.75rem;
		overflow-x: auto;
		max-height: 12rem;
	}

	.admin-log {
		max-height: 16rem;
		white-space: pre-wrap;
	}

	.admin-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.admin-errors {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.admin-errors li {
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--border);
	}

	.admin-query {
		max-width: 280px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
