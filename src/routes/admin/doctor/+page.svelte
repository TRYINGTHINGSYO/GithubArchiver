<script lang="ts">
	import type { PageData } from './$types';
	import type { CheckStatus } from '$lib/server/doctor';

	let { data }: { data: PageData } = $props();

	const report = $derived(data.report);

	function statusClass(status: CheckStatus): string {
		if (status === 'ok') return 'badge archived';
		if (status === 'warn') return 'badge pending';
		return 'badge deleted';
	}
</script>

<svelte:head>
	<title>Doctor — GithubArchive+</title>
</svelte:head>

<h1>Archive Doctor</h1>
<p class="doctor-lead">
	Health checks for database, snapshots, FTS, jobs, and daemon checkpoints.
	Run repairs with <code>npm run doctor</code> and env flags.
</p>

<div class="stats-bar" style="margin-bottom: 1.5rem">
	<span class={report.healthy ? 'badge archived' : 'badge deleted'}>
		{report.healthy ? 'healthy' : 'issues found'}
	</span>
	<span>{report.checks.length} checks</span>
</div>

<section class="detail-section">
	<h2 class="section-title">Checks</h2>
	<ul class="doctor-checks">
		{#each report.checks as check}
			<li class="doctor-check">
				<div class="doctor-check-head">
					<span class={statusClass(check.status)}>{check.status}</span>
					<strong>{check.name}</strong>
					{#if check.count !== undefined}
						<span class="doctor-count">{check.count}</span>
					{/if}
				</div>
				<p class="doctor-message">{check.message}</p>
				{#if check.samples && check.samples.length > 0}
					<ul class="doctor-samples">
						{#each check.samples as sample}
							<li class="mono">{sample}</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<section class="detail-section">
	<h2 class="section-title">Repairs (CLI)</h2>
	<dl class="detail-grid">
		<div>
			<dt>Rebuild FTS</dt>
			<dd><code>DOCTOR_REBUILD_FTS=1 npm run doctor</code></dd>
		</div>
		<div>
			<dt>Mark missing snapshots</dt>
			<dd><code>DOCTOR_MARK_MISSING_SNAPSHOTS=1 npm run doctor</code></dd>
		</div>
	</dl>
	<p class="doctor-meta">
		Mark missing removes <code>archive_snapshots</code> rows whose files are absent on disk.
	</p>
</section>

<p class="api-hint">
	<a href="/admin/status">Worker status</a> ·
	<a href="/">← Back to repos</a>
</p>

<style>
	.doctor-lead {
		color: var(--text-muted);
		margin-top: -0.5rem;
	}

	.doctor-checks {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.doctor-check {
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--border);
	}

	.doctor-check-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.doctor-count {
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.doctor-message {
		margin: 0.35rem 0 0;
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.doctor-samples {
		margin: 0.5rem 0 0;
		padding-left: 1rem;
		font-size: 0.8rem;
		color: var(--text-muted);
		word-break: break-all;
	}

	.doctor-meta {
		font-size: 0.85rem;
		color: var(--text-muted);
	}
</style>
