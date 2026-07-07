<script lang="ts">
	import { goto } from '$app/navigation';
	import { timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let filterType = $state('');
	let selected = $state<PageData['jobs'][number] | null>(null);
	let loadingDetail = $state(false);

	$effect(() => {
		filterType = data.filterType;
		selected = data.selectedId
			? (data.jobs.find((j) => j.id === data.selectedId) ?? null)
			: null;
	});

	function statusClass(s: string): string {
		if (s === 'running') return 'badge pending';
		if (s === 'success') return 'badge archived';
		if (s === 'failed') return 'badge deleted';
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

	function jobDuration(started: string, finished: string | null): string {
		const end = finished ? new Date(finished).getTime() : Date.now();
		const secs = Math.round((end - new Date(started).getTime()) / 1000);
		if (secs < 60) return `${secs}s`;
		return `${Math.floor(secs / 60)}m ${secs % 60}s`;
	}

	async function selectJob(id: number) {
		loadingDetail = true;
		try {
			const res = await fetch(`/api/admin/jobs?id=${id}`);
			const json = await res.json();
			selected = json.job ?? null;
			void goto(`/admin/jobs?id=${id}`, { replaceState: true, keepFocus: true, noScroll: true });
		} finally {
			loadingDetail = false;
		}
	}

	function applyFilter() {
		const q = filterType ? `?type=${encodeURIComponent(filterType)}` : '';
		void goto(`/admin/jobs${q}`);
	}
</script>

<svelte:head>
	<title>Job History — GithubArchive+</title>
</svelte:head>

<h1>Job History</h1>
<p class="jobs-lead">Every admin action is recorded here. Click a job to recall its full results.</p>

<form class="jobs-filter" onsubmit={(e) => { e.preventDefault(); applyFilter(); }}>
	<select class="filter-select" bind:value={filterType}>
		<option value="">All types</option>
		<option value="daemon">daemon</option>
		<option value="ingest">ingest</option>
		<option value="enrich">enrich</option>
		<option value="refresh">refresh</option>
		<option value="archive">archive</option>
		<option value="pipeline">pipeline</option>
		<option value="backup">backup</option>
		<option value="backfill">backfill</option>
		<option value="maintenance">maintenance</option>
	</select>
	<button type="submit" class="filter-btn">Filter</button>
</form>

<div class="jobs-layout">
	<table class="data-table jobs-table">
		<thead>
			<tr>
				<th>ID</th>
				<th>Type</th>
				<th>Status</th>
				<th>Reason</th>
				<th>Started</th>
				<th>Duration</th>
			</tr>
		</thead>
		<tbody>
			{#each data.jobs as job}
				<tr
					class:selected={selected?.id === job.id}
					role="button"
					tabindex="0"
					onclick={() => selectJob(job.id)}
					onkeydown={(e) => e.key === 'Enter' && selectJob(job.id)}
				>
					<td class="mono">#{job.id}</td>
					<td class="mono">{job.job_type}</td>
					<td><span class={statusClass(job.status)}>{job.status}</span></td>
					<td class="reason-cell" title={job.reason ?? ''}>{job.reason ?? '—'}</td>
					<td>{timeAgo(job.started_at)}</td>
					<td>{jobDuration(job.started_at, job.finished_at)}</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<aside class="jobs-detail">
		{#if loadingDetail}
			<p class="jobs-meta">Loading…</p>
		{:else if selected}
			<h2 class="section-title">Job #{selected.id}</h2>
			<dl class="detail-grid">
				<div><dt>Type</dt><dd class="mono">{selected.job_type}</dd></div>
				<div><dt>Status</dt><dd><span class={statusClass(selected.status)}>{selected.status}</span></dd></div>
				<div><dt>Started</dt><dd>{selected.started_at}</dd></div>
				<div><dt>Finished</dt><dd>{selected.finished_at ?? '—'}</dd></div>
				{#if selected.reason}
					<div class="reason-full"><dt>Reason</dt><dd>{selected.reason}</dd></div>
				{/if}
			</dl>
			{#if selected.error}
				<p class="jobs-error">{selected.error}</p>
			{/if}
			{#if selected.detail_json && selected.detail_json !== '{}'}
				<h3 class="jobs-subtitle">Stored results</h3>
				<pre class="jobs-pre">{formatDetail(selected.detail_json)}</pre>
			{/if}
		{:else}
			<p class="jobs-meta">Select a job to view stored results.</p>
		{/if}
	</aside>
</div>

<style>
	.jobs-lead {
		color: var(--text-muted);
		margin-top: -0.5rem;
	}

	.jobs-filter {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.jobs-layout {
		display: grid;
		grid-template-columns: 1fr minmax(280px, 36%);
		gap: 1.25rem;
		align-items: start;
	}

	@media (max-width: 900px) {
		.jobs-layout {
			grid-template-columns: 1fr;
		}
	}

	.jobs-table tbody tr {
		cursor: pointer;
	}

	.jobs-table tbody tr:hover,
	.jobs-table tbody tr.selected {
		background: var(--bg-elevated);
	}

	.jobs-detail {
		position: sticky;
		top: 1rem;
		padding: 1rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		min-height: 12rem;
	}

	.jobs-pre {
		margin: 0;
		padding: 0.75rem;
		background: var(--bg);
		border-radius: 6px;
		font-size: 0.72rem;
		overflow: auto;
		max-height: 24rem;
	}

	.jobs-meta {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.jobs-error {
		color: var(--red);
		font-size: 0.9rem;
	}

	.jobs-subtitle {
		font-size: 0.95rem;
		margin: 1rem 0 0.5rem;
	}

	.reason-cell {
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.82rem;
		color: var(--text-muted);
	}

	.reason-full dd {
		color: var(--text);
		line-height: 1.4;
	}
</style>
