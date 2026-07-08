<script lang="ts">
	import RepoListItem from '$lib/components/RepoListItem.svelte';
	import { timeAgo, formatDateShort } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const feeds = [
		{ id: 'newest', label: '🔥 Newest' },
		{ id: 'recently_archived', label: '📦 Recently Archived' },
		{ id: 'recently_deleted', label: '💀 Recently Deleted' },
		{ id: 'recently_released', label: '🚀 Recently Released' },
		{ id: 'recently_updated', label: '📈 Recently Updated' }
	];

	function buildUrl(overrides: Record<string, string | number | boolean | undefined>) {
		const params = new URLSearchParams();
		const f = { ...data.filters, ...overrides };
		if (f.q) params.set('q', String(f.q));
		if (f.sort && f.sort !== 'newest_discovered') params.set('sort', String(f.sort));
		else if (f.feed && f.feed !== 'newest') params.set('feed', String(f.feed));
		if (f.language) params.set('language', String(f.language));
		if (f.source) params.set('source', String(f.source));
		if (f.year) params.set('year', String(f.year));
		if (f.dateFrom) params.set('date_from', String(f.dateFrom));
		if (f.dateTo) params.set('date_to', String(f.dateTo));
		if (f.minStars) params.set('min_stars', String(f.minStars));
		if (f.minForks) params.set('min_forks', String(f.minForks));
		if (f.neverEnriched) params.set('never_enriched', '1');
		if (f.archivedOnly) params.set('archived_only', '1');
		if (f.hasReadme) params.set('has_readme', '1');
		if (f.hasRelease) params.set('has_release', '1');
		if (f.hasRelease) params.set('has_release', '1');
		if (f.deletedOnly) params.set('deleted_only', '1');
		if (f.page && Number(f.page) > 1) params.set('page', String(f.page));
		const qs = params.toString();
		return qs ? `/?${qs}` : '/';
	}

	function onSubmit(e: Event) {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		window.location.href = buildUrl({
			q: (fd.get('q') as string) ?? '',
			sort: (fd.get('sort') as string) ?? '',
			language: (fd.get('language') as string) ?? '',
			source: (fd.get('source') as string) ?? '',
			year: (fd.get('year') as string) ?? '',
			dateFrom: (fd.get('date_from') as string) ?? '',
			dateTo: (fd.get('date_to') as string) ?? '',
			minStars: (fd.get('min_stars') as string) ?? '',
			minForks: (fd.get('min_forks') as string) ?? '',
			neverEnriched: fd.get('never_enriched') === 'on',
			archivedOnly: fd.get('archived_only') === 'on',
			hasReadme: fd.get('has_readme') === 'on',
			hasRelease: fd.get('has_release') === 'on',
			deletedOnly: fd.get('deleted_only') === 'on',
			minForks: (fd.get('min_forks') as string) ?? '',
			page: 1
		});
	}

	const feedTitle = $derived(feeds.find((f) => f.id === data.filters.feed)?.label ?? 'Repositories');
	const preservationRate = $derived(
		data.archivePulse.totalRepos > 0
			? Math.round((data.archivePulse.preservedRepos / data.archivePulse.totalRepos) * 100)
			: 0
	);
	const pulseMetrics = $derived([
		{
			label: 'Preserved repos',
			value: data.archivePulse.preservedRepos.toLocaleString(),
			detail: `${preservationRate}% of discovered repos`
		},
		{
			label: 'README saved',
			value: data.archivePulse.readmeSaved.toLocaleString(),
			detail: `${data.archivePulse.readmeChanges.toLocaleString()} README change events`
		},
		{
			label: 'Source saved',
			value: data.archivePulse.sourceSaved.toLocaleString(),
			detail: `${data.archivePulse.zipAvailable.toLocaleString()} ZIP exports available`
		},
		{
			label: 'Deleted but saved',
			value: data.archivePulse.deletedButSaved.toLocaleString(),
			detail: `${data.archivePulse.githubArchivedSaved.toLocaleString()} GitHub-archived repos preserved`
		}
	]);

	const hasActiveFilters = $derived(
		Boolean(
			data.filters.q ||
				data.filters.language ||
				data.filters.source ||
				data.filters.year ||
				data.filters.dateFrom ||
				data.filters.dateTo ||
				data.filters.minStars ||
				data.filters.minForks ||
				data.filters.neverEnriched ||
				data.filters.archivedOnly ||
				data.filters.hasReadme ||
				data.filters.hasRelease ||
				data.filters.deletedOnly ||
				(data.filters.sort && data.filters.sort !== 'newest_discovered' && data.filters.sort !== data.filters.feed)
		)
	);

	function repoPath(owner: string, name: string): string {
		return `/repo/${owner}/${name}`;
	}

	function snapshotLabel(detail: string | null): string {
		if (!detail) return 'local archive snapshot';
		return detail
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
			.sort()
			.join(' + ');
	}
</script>

<svelte:head>
	<title>GithubArchive+ — {feedTitle}</title>
</svelte:head>

<section class="archive-pulse" aria-label="Archive Pulse">
	<div class="pulse-hero">
		<p class="pulse-kicker">Archive Pulse</p>
		<h1>GitHub Archive+ remembers what GitHub forgets.</h1>
		<p class="pulse-copy">
			Preserved READMEs, source snapshots, ZIP exports, releases, and repository events turn discovery into durable project memory and explainable software history.
		</p>
		<div class="pulse-actions">
			<a href="/birth-feed">Live feed</a>
			<a href={buildUrl({ feed: 'recently_archived', page: 1 })}>Recently archived</a>
			<a href="/admin">Control center</a>
		</div>
	</div>

	<div class="pulse-metrics">
		{#each pulseMetrics as metric}
			<div class="pulse-metric">
				<span>{metric.label}</span>
				<strong>{metric.value}</strong>
				<small>{metric.detail}</small>
			</div>
		{/each}
	</div>

	<div class="pulse-lanes">
		<section>
			<div class="pulse-lane-head">
				<h2>Newly Preserved</h2>
				<span>{data.archivePulse.lastSeenOnGithub ? `GitHub checked ${timeAgo(data.archivePulse.lastSeenOnGithub)}` : 'Awaiting GitHub checks'}</span>
			</div>
			{#if data.archivePulse.recentPreserved.length}
				{#each data.archivePulse.recentPreserved as repo}
					<a href={repoPath(repo.owner, repo.name)}>
						<strong class="mono">{repo.full_name}</strong>
						<span>{snapshotLabel(repo.detail)} saved {timeAgo(repo.at)}</span>
					</a>
				{/each}
			{:else}
				<p>No local snapshots yet.</p>
			{/if}
		</section>

		<section>
			<div class="pulse-lane-head">
				<h2>Deleted But Saved</h2>
				<span>{data.archivePulse.deletedButSaved.toLocaleString()} preserved</span>
			</div>
			{#if data.archivePulse.recentDeletedSaved.length}
				{#each data.archivePulse.recentDeletedSaved as repo}
					<a href={repoPath(repo.owner, repo.name)}>
						<strong class="mono">{repo.full_name}</strong>
						<span>Deleted on GitHub, archive retained {timeAgo(repo.at)}</span>
					</a>
				{/each}
			{:else}
				<p>No deleted preserved repos yet.</p>
			{/if}
		</section>

		<section>
			<div class="pulse-lane-head">
				<h2>README Memory</h2>
				<span>{data.archivePulse.readmeChanges.toLocaleString()} changes</span>
			</div>
			{#if data.archivePulse.recentReadmeChanges.length}
				{#each data.archivePulse.recentReadmeChanges as repo}
					<a href={repoPath(repo.owner, repo.name)}>
						<strong class="mono">{repo.full_name}</strong>
						<span>README changed {timeAgo(repo.at)}</span>
					</a>
				{/each}
			{:else}
				<p>No README changes captured yet.</p>
			{/if}
		</section>
	</div>
</section>

<div class="stats-bar" style="margin-bottom: 1.5rem">
	<span>{data.stats.total.toLocaleString()} ingested</span>
	<span>{data.stats.unenriched.toLocaleString()} awaiting enrichment</span>
	<span>Page {data.page} of {data.totalPages}</span>
</div>

<nav class="feed-nav">
	{#each feeds as f}
		<a href={buildUrl({ feed: f.id, page: 1 })} class="feed-link" class:active={data.filters.feed === f.id}>
			{f.label}
		</a>
	{/each}
</nav>

<form class="filters" onsubmit={onSubmit}>
	<input
		name="q"
		type="search"
		class="filter-input"
		placeholder="Search name, owner, description…"
		value={data.filters.q}
	/>
	<select name="sort" class="filter-select">
		<option value="">Sort: default</option>
		{#each data.sorts as sort}
			<option value={sort} selected={data.filters.sort === sort}>{sort.replaceAll('_', ' ')}</option>
		{/each}
	</select>
	<select name="source" class="filter-select">
		<option value="">All sources</option>
		<option value="gharchive" selected={data.filters.source === 'gharchive'}>gharchive</option>
		<option value="github_search" selected={data.filters.source === 'github_search'}>github_search</option>
	</select>
	<input name="year" type="number" class="filter-input" placeholder="Year" value={data.filters.year} min="2008" max="2099" />
	<input name="date_from" type="date" class="filter-input" value={data.filters.dateFrom} />
	<input name="date_to" type="date" class="filter-input" value={data.filters.dateTo} />
	<input name="min_stars" type="number" class="filter-input" placeholder="Min ★" value={data.filters.minStars} min="0" />
	<input name="min_forks" type="number" class="filter-input" placeholder="Min forks" value={data.filters.minForks} min="0" />
	<select name="language" class="filter-select">
		<option value="">All languages</option>
		{#each data.languages as lang}
			<option value={lang} selected={data.filters.language === lang}>{lang}</option>
		{/each}
	</select>
	<label class="filter-check">
		<input type="checkbox" name="archived_only" checked={data.filters.archivedOnly} />
		Archived
	</label>
	<label class="filter-check">
		<input type="checkbox" name="has_readme" checked={data.filters.hasReadme} />
		Has README
	</label>
	<label class="filter-check">
		<input type="checkbox" name="has_release" checked={data.filters.hasRelease} />
		Has release
	</label>
	<label class="filter-check">
		<input type="checkbox" name="deleted_only" checked={data.filters.deletedOnly} />
		Deleted only
	</label>
	<label class="filter-check">
		<input type="checkbox" name="never_enriched" checked={data.filters.neverEnriched} />
		Never enriched
	</label>
	<button type="submit" class="filter-btn">Apply</button>
	{#if hasActiveFilters}
		<a href="/" class="filter-clear">Clear filters</a>
	{/if}
</form>

<section>
	<h2 class="section-title">{feedTitle}</h2>

	{#if data.filters.q}
		<p class="search-meta">{data.total.toLocaleString()} FTS result{data.total === 1 ? '' : 's'} for “{data.filters.q}”</p>
	{/if}

	{#if data.repos.length === 0}
		<div class="empty-state">
			{#if data.filters.q}
				<p>No results for “{data.filters.q}” with the current filters.</p>
			{:else}
				<p>No repositories match your filters.</p>
			{/if}
			<p class="empty-hint">No repos yet — open <a href="/admin">Admin</a> and click <strong>GitHub Search Ingest</strong> or start <strong>Auto-Scan</strong>.</p>
		</div>
	{:else}
		<ul class="repo-list">
			{#each data.repos as repo}
				<RepoListItem {repo} />
			{/each}
		</ul>

		<nav class="pagination">
			{#if data.page > 1}
				<a href={buildUrl({ page: data.page - 1 })}>← Previous</a>
			{:else}
				<span class="disabled">← Previous</span>
			{/if}
			<span class="page-info">{data.total.toLocaleString()} repos</span>
			{#if data.page < data.totalPages}
				<a href={buildUrl({ page: data.page + 1 })}>Next →</a>
			{:else}
				<span class="disabled">Next →</span>
			{/if}
		</nav>
	{/if}
</section>

<p class="api-hint">
	API: <a href="/api/repos">/api/repos</a> · <a href="/api/search?q=cursor">/api/search</a> ·
	<a href="/api/events">/api/events</a> ·
	<a href="/api/releases/latest">/api/releases/latest</a>
</p>

<style>
	.archive-pulse {
		display: grid;
		gap: 1rem;
		margin: 0 0 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.pulse-hero {
		display: grid;
		gap: 0.75rem;
	}

	.pulse-kicker {
		margin: 0;
		color: var(--green);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.pulse-hero h1 {
		max-width: 820px;
		margin: 0;
		font-size: clamp(2rem, 5vw, 4.2rem);
		line-height: 0.98;
	}

	.pulse-copy {
		max-width: 760px;
		margin: 0;
		color: var(--text-muted);
		font-size: 1rem;
	}

	.pulse-actions,
	.pulse-metrics,
	.pulse-lanes {
		display: grid;
		gap: 0.75rem;
	}

	.pulse-actions {
		display: flex;
		flex-wrap: wrap;
	}

	.pulse-actions a {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.45rem 0.7rem;
		background: var(--bg-elevated);
		color: var(--accent);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
	}

	.pulse-actions a:hover {
		background: var(--bg-hover);
	}

	.pulse-metrics {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.pulse-metric {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.85rem;
		background: var(--bg-elevated);
	}

	.pulse-metric span,
	.pulse-metric small,
	.pulse-lane-head span,
	.pulse-lanes p,
	.pulse-lanes a span {
		color: var(--text-muted);
	}

	.pulse-metric span {
		font-size: 0.8rem;
	}

	.pulse-metric strong {
		font-size: 1.55rem;
		line-height: 1.1;
	}

	.pulse-metric small {
		font-size: 0.78rem;
	}

	.pulse-lanes {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.pulse-lanes section {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
		padding: 0.9rem;
	}

	.pulse-lane-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: baseline;
		margin-bottom: 0.65rem;
	}

	.pulse-lane-head h2 {
		margin: 0;
		font-size: 0.95rem;
	}

	.pulse-lane-head span {
		font-size: 0.78rem;
		text-align: right;
	}

	.pulse-lanes a {
		display: grid;
		gap: 0.1rem;
		padding: 0.5rem 0;
		border-top: 1px solid var(--border);
		text-decoration: none;
	}

	.pulse-lanes a strong {
		color: var(--text);
		font-size: 0.86rem;
		overflow-wrap: anywhere;
	}

	.pulse-lanes a span,
	.pulse-lanes p {
		margin: 0;
		font-size: 0.82rem;
	}

	.empty-hint {
		font-size: 0.9rem;
		color: var(--text-muted);
		margin-top: 0.5rem;
	}

	@media (max-width: 900px) {
		.pulse-metrics,
		.pulse-lanes {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 640px) {
		.pulse-metrics,
		.pulse-lanes {
			grid-template-columns: 1fr;
		}

		.pulse-hero h1 {
			font-size: 2.15rem;
		}
	}
</style>
