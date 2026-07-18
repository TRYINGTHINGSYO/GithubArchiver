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
	let activeAdminTab = $state<
		'overview' | 'workers' | 'storage' | 'jobs' | 'logs' | 'health' | 'danger'
	>('overview');
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
	const workerTypes = ['daemon', 'ingest', 'enrich', 'refresh', 'archive', 'pipeline', 'backup', 'backfill'] as const;
	const adminTabs = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'workers', label: 'Workers' },
		{ id: 'storage', label: 'Storage' },
		{ id: 'jobs', label: 'Jobs' },
		{ id: 'logs', label: 'Logs' },
		{ id: 'health', label: 'Health' },
		{ id: 'danger', label: 'Danger Zone' }
	] as const;

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
			const result = await fn();
			const msg = (result as { message?: string })?.message;
			actionMsg = msg ?? `${label} started`;
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

	function healthTone(value: number, warnAt: number): 'good' | 'warn' {
		return value > warnAt ? 'warn' : 'good';
	}

	function humanError(message: string): { title: string; detail: string; actions: string[] } {
		if (/database or disk is full|SQLITE_FULL|ENOSPC|no space left/i.test(message)) {
			return {
				title: 'Storage Full',
				detail: 'Archive paused to protect preserved data.',
				actions: ['Clean regenerable ZIP exports', 'Remove orphaned snapshots', 'Increase storage']
			};
		}
		if (/rate limit/i.test(message)) {
			return {
				title: 'GitHub Rate Limit',
				detail: 'GitHub temporarily slowed the archive worker.',
				actions: ['Wait for reset', 'Reduce worker concurrency', 'Confirm token health']
			};
		}
		if (/orphaned/i.test(message)) {
			return {
				title: 'Interrupted Job',
				detail: 'The process restarted before the job could finish.',
				actions: ['Resume the worker', 'Check recent logs', 'Review job history']
			};
		}
		return {
			title: 'Worker Error',
			detail: message,
			actions: ['Open job history', 'Check health', 'Review live logs']
		};
	}
</script>

<svelte:head>
	<title>Admin — GithubArchive+</title>
</svelte:head>

<section class="admin-hero">
	<div>
		<p class="admin-kicker">Operations dashboard</p>
		<h1>Admin Control Center</h1>
		<p class="admin-lead">
			Run ingest, enrichment, backups, archive workers, and recovery tasks without opening a terminal.
		</p>
	</div>
	<a class="button-secondary" href="/admin/jobs">Job history</a>
</section>

<h1>Admin Control Center</h1>
<p class="admin-lead">
	Run ingest, enrichment, backups, and backfill from here — no terminal needed. Results are saved to the database and shown under <a href="/admin/jobs">Job history</a>. Status refreshes every 10 seconds.
</p>

{#if data.loadError}
	<div class="empty-state admin-error">
		<p>Failed to load status: {data.loadError}</p>
		<p class="admin-meta">Check that the database exists (<code>npm run db:init</code>) and retry.</p>
	</div>
{:else if status}
<section class="health-banner" aria-label="System Health">
	<div>
		<p class="admin-kicker">System Health</p>
		<h2>Archive operations</h2>
	</div>
	<div class="health-pills">
		<span class={daemon.running || status.backgroundWorker?.running ? 'good' : 'warn'}>
			{daemon.running || status.backgroundWorker?.running ? 'Archive worker running' : 'Archive worker stopped'}
		</span>
		<span class={healthTone(status.archive.indexedBytes, 4_500_000_000)}>
			{status.archive.metadataOnly ? 'Metadata-only mode' : healthTone(status.archive.indexedBytes, 4_500_000_000) === 'warn' ? 'Storage needs attention' : 'Disk healthy'}
		</span>
		<span class={status.stats.unenrichedRepos > 0 ? 'warn' : 'good'}>
			{status.stats.unenrichedRepos.toLocaleString()} repositories waiting
		</span>
		<span class={status.rateLimit && status.rateLimit.remaining < 100 ? 'warn' : 'good'}>
			{status.rateLimit ? 'GitHub rate limit healthy' : 'GitHub rate limit unknown'}
		</span>
	</div>
	<p class="admin-meta">
		Recommended action:
		{#if status.stats.unenrichedRepos > 0}
			Enrich and archive backlog from Workers.
		{:else if !daemon.running && !status.backgroundWorker?.running}
			Start Auto-Scan when you are ready to collect.
		{:else}
			{status.archive.metadataOnly ? 'Metadata-only mode is protecting disk while discovery and intelligence continue.' : 'Archive is healthy. Monitor jobs and storage.'}
		{/if}
	</p>
</section>

<nav class="admin-tabs" aria-label="Admin sections">
	{#each adminTabs as tab}
		<button
			type="button"
			class:active={activeAdminTab === tab.id}
			onclick={() => (activeAdminTab = tab.id)}
		>
			{tab.label}
		</button>
	{/each}
</nav>

<div class={`admin-tab-panel tab-${activeAdminTab}`}>
<section class="detail-section">
	<h2 class="section-title">Auto-scan</h2>
	<p class="admin-meta">Continuous ingest → enrich → refresh loop. Artifact archive storage is opt-in.</p>
	<div class="admin-actions">
		<button type="button" class="filter-btn primary" disabled={actionLoading !== null} onclick={() => runAction('Start auto-scan', () => postJson('/api/admin/daemon', { action: 'start' }))}>
			{actionLoading === 'Start auto-scan' ? 'Starting…' : 'Start Auto-Scan'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Stop auto-scan', () => postJson('/api/admin/daemon', { action: 'stop' }))}>
			{actionLoading === 'Stop auto-scan' ? 'Stopping…' : 'Stop Auto-Scan'}
		</button>
	</div>
	{#if status.backgroundWorker}
		<p class="admin-meta">
			Auto-scan: <strong>{status.backgroundWorker.running ? 'running' : 'stopped'}</strong>
			{#if status.backgroundWorker.phase} · phase: {status.backgroundWorker.phase}{/if}
			{#if status.backgroundWorker.currentJob} · job: {status.backgroundWorker.currentJob}{/if}
		</p>
	{/if}
</section>

<section class="detail-section">
	<h2 class="section-title">One-shot jobs</h2>
	<div class="admin-actions">
		<button type="button" class="filter-btn primary" disabled={actionLoading !== null} onclick={() => runAction('Search ingest', () => postJson('/api/admin/workers', { action: 'search-ingest' }))}>
			{actionLoading === 'Search ingest' ? 'Starting…' : 'GitHub Search Ingest'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Ingest missing', () => postJson('/api/admin/workers', { action: 'ingest-missing' }))}>
			{actionLoading === 'Ingest missing' ? 'Starting…' : 'Ingest Missing Hours'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Pipeline', () => postJson('/api/admin/workers', { action: 'pipeline' }))}>
			{actionLoading === 'Pipeline' ? 'Starting…' : 'Full Pipeline'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Ingest hour', () => postJson('/api/admin/workers', { action: 'ingest' }))}>
			{actionLoading === 'Ingest hour' ? 'Starting…' : 'Ingest Current Hour'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Enrich', () => postJson('/api/admin/workers', { action: 'enrich' }))}>
			{actionLoading === 'Enrich' ? 'Starting…' : 'Enrich Batch'}
		</button>
		{#if status.archive.metadataOnly}
			<button type="button" class="filter-btn" disabled title="Artifact archive storage is disabled">
				Archive storage disabled
			</button>
		{:else}
			<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Archive', () => postJson('/api/admin/workers', { action: 'archive' }))}>
				{actionLoading === 'Archive' ? 'Starting…' : 'Archive Batch'}
			</button>
		{/if}
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Refresh', () => postJson('/api/admin/workers', { action: 'refresh' }))}>
			{actionLoading === 'Refresh' ? 'Starting…' : 'Refresh Metadata'}
		</button>
		<button type="button" class="filter-btn" disabled={actionLoading !== null} onclick={() => runAction('Backup', () => postJson('/api/admin/workers', { action: 'backup' }))}>
			{actionLoading === 'Backup' ? 'Starting…' : 'Create Backup'}
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

{#if status.pipeline}
	<section class="detail-section">
		<h2 class="section-title">Discovery pipeline</h2>
		<dl class="detail-grid">
			<div>
				<dt>Discovered</dt>
				<dd>{status.pipeline.discoveryStatus.repositoriesDiscovered.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Enriched</dt>
				<dd>{status.pipeline.discoveryStatus.enriched.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Classified</dt>
				<dd>{status.pipeline.discoveryStatus.classified.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Clustered</dt>
				<dd>{status.pipeline.discoveryStatus.clustered.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Worker</dt>
				<dd>{status.pipeline.discoveryStatus.workerStatus}</dd>
			</div>
			<div>
				<dt>Last discovery analysis</dt>
				<dd>
					{status.pipeline.discoveryStatus.lastDiscoveryAnalysisAt
						? timeAgo(status.pipeline.discoveryStatus.lastDiscoveryAnalysisAt)
						: '—'}
				</dd>
			</div>
		</dl>
		{#if status.pipeline.enrichment}
			<h3 class="section-title" style="margin-top:1.25rem">Enrichment throughput</h3>
			<p class="admin-meta">
				Continuous concurrent queue. Claimable backlog is what the worker will process; deferred stays
				metadata-only until promoted.
			</p>
			<dl class="detail-grid">
				<div>
					<dt>Repos / minute</dt>
					<dd>{status.pipeline.enrichment.throughputPerMin.toFixed(1)}</dd>
				</div>
				<div>
					<dt>Enriched last hour</dt>
					<dd>{(status.pipeline.enrichment.enrichedLastHour ?? 0).toLocaleString()}</dd>
				</div>
				<div>
					<dt>Avg seconds / repo</dt>
					<dd>{status.pipeline.enrichment.avgSecondsPerRepo ?? '—'}</dd>
				</div>
				<div>
					<dt>API req / repo</dt>
					<dd>{status.pipeline.enrichment.requestsPerRepo ?? '—'}</dd>
				</div>
				{#if status.pipeline.enrichment.stageTimings}
					<div>
						<dt>Metadata fetch</dt>
						<dd>{Math.round(status.pipeline.enrichment.stageTimings.metadataMs)} ms</dd>
					</div>
					<div>
						<dt>Classification</dt>
						<dd>{Math.round(status.pipeline.enrichment.stageTimings.classificationMs)} ms</dd>
					</div>
					<div>
						<dt>README</dt>
						<dd>{Math.round(status.pipeline.enrichment.stageTimings.readmeMs)} ms</dd>
					</div>
					<div>
						<dt>Story generation</dt>
						<dd>{Math.round(status.pipeline.enrichment.stageTimings.storyMs)} ms</dd>
					</div>
					<div>
						<dt>DB write</dt>
						<dd>{Math.round(status.pipeline.enrichment.stageTimings.dbWriteMs)} ms</dd>
					</div>
					<div>
						<dt>Total / repo</dt>
						<dd>{Math.round(status.pipeline.enrichment.stageTimings.totalMs)} ms</dd>
					</div>
				{/if}
				<div>
					<dt>Concurrency</dt>
					<dd>
						{status.pipeline.enrichment.concurrency}
						{#if status.pipeline.enrichment.configuredConcurrency}
							<span class="admin-meta"> / {status.pipeline.enrichment.configuredConcurrency}</span>
						{/if}
					</dd>
				</div>
				<div>
					<dt>Batch size</dt>
					<dd>{status.pipeline.enrichment.batchSize ?? '—'}</dd>
				</div>
				<div>
					<dt>API remaining</dt>
					<dd>{status.pipeline.enrichment.quota.remaining ?? '—'}</dd>
				</div>
				<div>
					<dt>Claimable queue</dt>
					<dd>{(status.pipeline.enrichment.claimableBacklog ?? 0).toLocaleString()}</dd>
				</div>
				<div>
					<dt>Deferred (metadata-only)</dt>
					<dd>{(status.pipeline.enrichment.deferredBacklog ?? 0).toLocaleString()}</dd>
				</div>
				<div>
					<dt>ETA claimable</dt>
					<dd>
						{status.pipeline.enrichment.etaClaimableMinutes != null
							? `${status.pipeline.enrichment.etaClaimableMinutes} min`
							: '—'}
					</dd>
				</div>
				<div>
					<dt>ETA urgent+high</dt>
					<dd>
						{status.pipeline.enrichment.etaUrgentHighMinutes != null
							? `${status.pipeline.enrichment.etaUrgentHighMinutes} min`
							: '—'}
					</dd>
				</div>
				<div>
					<dt>Oldest waiting</dt>
					<dd class="mono">{status.pipeline.enrichment.oldestWaitingAt ?? '—'}</dd>
				</div>
				<div>
					<dt>Fast enriched</dt>
					<dd>{status.pipeline.enrichment.depths.fast.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Deep enriched</dt>
					<dd>{status.pipeline.enrichment.depths.deep.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Backlog urgent</dt>
					<dd>{status.pipeline.enrichment.tiers.urgent.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Backlog high</dt>
					<dd>{status.pipeline.enrichment.tiers.high.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Backlog normal</dt>
					<dd>{status.pipeline.enrichment.tiers.normal.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Backlog low</dt>
					<dd>{status.pipeline.enrichment.tiers.low.toLocaleString()}</dd>
				</div>
			</dl>
		{/if}
		{#if status.pipeline.scheduledJobs.length > 0}
			<table class="admin-table">
				<thead>
					<tr>
						<th>Job</th>
						<th>Status</th>
						<th>Last completed</th>
						<th>Next run</th>
						<th>Failures</th>
					</tr>
				</thead>
				<tbody>
					{#each status.pipeline.scheduledJobs as job}
						<tr>
							<td>{job.job_name}</td>
							<td>{job.status ?? '—'}</td>
							<td>{job.last_completed_at ? timeAgo(job.last_completed_at) : '—'}</td>
							<td>{job.next_run_at ? timeAgo(job.next_run_at) : '—'}</td>
							<td>{job.consecutive_failures}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
{/if}

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
	<p class="admin-meta">Manual refresh runs from the button above. <a href="/admin/jobs">View job history →</a></p>
</section>

<section class="detail-section">
	<h2 class="section-title">Ingestion & discovery</h2>
	<div class="status-hierarchy">
		<div>
			<h3 class="status-hierarchy-label">Current activity</h3>
			<p class="admin-meta">
				{#if status.ingestion.ingestRunning}
					Ingest batch running
				{:else if status.daemon.running}
					Daemon loop active
				{:else}
					Workers idle
				{/if}
				· Worker last ran
				{status.ingestion.workerLastRanAt
					? timeAgo(status.ingestion.workerLastRanAt)
					: '—'}
			</p>
		</div>
		<div>
			<h3 class="status-hierarchy-label">Progress</h3>
			<dl class="detail-grid">
				<div>
					<dt>Enriched</dt>
					<dd>{status.stats.enrichedRepos.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Waiting</dt>
					<dd>{status.stats.unenrichedRepos.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Repos ingested (last hour)</dt>
					<dd>{status.ingestion.reposLastHour.toLocaleString()}</dd>
				</div>
				<div>
					<dt>Repos ingested (today UTC)</dt>
					<dd>{status.ingestion.reposToday.toLocaleString()}</dd>
				</div>
			</dl>
		</div>
		<div>
			<h3 class="status-hierarchy-label">Discovery</h3>
			<dl class="detail-grid">
				<div>
					<dt>Latest completed archive hour</dt>
					<dd class="mono">{status.ingestion.latestHour ?? '—'}</dd>
				</div>
				<div>
					<dt>Archive backlog</dt>
					<dd>{status.ingestion.missingHours.length} hours</dd>
				</div>
				<div>
					<dt>Target hour (GH Archive)</dt>
					<dd class="mono">{status.ingestion.targetHour}</dd>
				</div>
				<div>
					<dt>Hours ingested</dt>
					<dd>{status.ingestion.totalHours}</dd>
				</div>
				<div>
					<dt>Search fallback</dt>
					<dd>{status.discovery.searchFallbackActive ? 'Yes' : 'No'}</dd>
				</div>
				<div>
					<dt>Historical Search-fallback discoveries</dt>
					<dd>{status.discovery.githubSearchRepos.toLocaleString()}</dd>
				</div>
			</dl>
		</div>
	</div>
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
		Use <strong>Create Backup</strong> above, or enable full archives when triggering backup via API.
		<a href="/admin/jobs">View backup jobs →</a>
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
	<p class="admin-meta"><a href="/admin/jobs">Full job history with details →</a></p>
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

</div>

<p class="api-hint"><a href="/">← Back to repos</a></p>
{/if}

<style>
	.status-hierarchy {
		display: grid;
		gap: 1.1rem;
	}

	.status-hierarchy-label {
		margin: 0 0 0.4rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.admin-hero,
	.health-banner {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-elevated);
		padding: 1rem;
		margin-bottom: 1rem;
		box-shadow: var(--shadow-soft);
	}

	.admin-hero + h1,
	.admin-hero + h1 + .admin-lead {
		display: none;
	}

	.admin-kicker {
		margin: 0;
		color: var(--green);
		font-size: 0.74rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.admin-hero h1,
	.health-banner h2 {
		margin: 0.15rem 0 0;
	}

	.admin-lead {
		color: var(--text-muted);
		margin: 0.35rem 0 0;
		max-width: 66ch;
	}

	.health-banner {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr);
		align-items: start;
		box-shadow: none;
	}

	.health-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.health-pills span {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.22rem 0.6rem;
		font-size: 0.82rem;
		font-weight: 700;
	}

	.health-pills .good {
		border-color: color-mix(in srgb, var(--green) 62%, var(--border));
		color: var(--green);
	}

	.health-pills .warn {
		border-color: color-mix(in srgb, var(--orange) 62%, var(--border));
		color: var(--orange);
	}

	.admin-tabs {
		position: sticky;
		top: 66px;
		z-index: 30;
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin: 1rem 0;
		padding: 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--bg) 92%, transparent);
		backdrop-filter: blur(14px);
	}

	.admin-tabs button {
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--text-muted);
		padding: 0.42rem 0.75rem;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 800;
		cursor: pointer;
	}

	.admin-tabs button.active {
		border-color: var(--accent);
		background: var(--accent-dim);
		color: var(--accent);
	}

	.admin-tab-panel > .detail-section {
		display: none;
	}

	.tab-overview > .detail-section:nth-of-type(1),
	.tab-overview > .detail-section:nth-of-type(2),
	.tab-overview > .detail-section:nth-of-type(3),
	.tab-overview > .detail-section:nth-of-type(6),
	.tab-workers > .detail-section:nth-of-type(4),
	.tab-workers > .detail-section:nth-of-type(5),
	.tab-workers > .detail-section:nth-of-type(8),
	.tab-workers > .detail-section:nth-of-type(9),
	.tab-workers > .detail-section:nth-of-type(10),
	.tab-workers > .detail-section:nth-of-type(11),
	.tab-storage > .detail-section:nth-of-type(12),
	.tab-storage > .detail-section:nth-of-type(13),
	.tab-jobs > .detail-section:nth-of-type(15),
	.tab-logs > .detail-section:nth-of-type(7),
	.tab-logs > .detail-section:nth-of-type(14),
	.tab-logs > .detail-section:nth-of-type(15),
	.tab-health > .detail-section:nth-of-type(6),
	.tab-health > .detail-section:nth-of-type(8),
	.tab-health > .detail-section:nth-of-type(9),
	.tab-health > .detail-section:nth-of-type(14),
	.tab-danger > .detail-section:nth-of-type(12),
	.tab-danger > .detail-section:nth-of-type(13),
	.tab-danger > .detail-section:nth-of-type(14) {
		display: block;
	}

	.detail-section {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--bg-elevated) 86%, transparent);
		padding: 1rem;
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

	.filter-btn.primary {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 15%, var(--bg-elevated));
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
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 0.6rem;
		background: var(--bg-subtle);
	}

	.admin-query {
		max-width: 280px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 760px) {
		.admin-hero,
		.health-banner {
			display: grid;
			grid-template-columns: 1fr;
		}

		.admin-tabs {
			position: static;
		}
	}
</style>
