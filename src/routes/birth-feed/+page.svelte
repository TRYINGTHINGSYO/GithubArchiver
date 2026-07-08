<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { timeAgo, formatDateShort } from '$lib/utils';
	import { repoDetailPath } from '$lib/repo-nav';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const REFRESH_MS = 30_000;
	type StreamEvent = {
		id: number;
		owner: string;
		name: string;
		full_name: string;
		event_type: string;
		label: string;
		event_time: string;
	};

	let streamEvents = $state<StreamEvent[]>([]);
	let autoScroll = $state(false);
	let streamEl = $state<HTMLElement | null>(null);

	onMount(() => {
		void refreshStream();
		const id = setInterval(() => {
			void refreshStream();
			void invalidateAll();
		}, REFRESH_MS);
		return () => clearInterval(id);
	});

	async function refreshStream() {
		const res = await fetch('/api/events?limit=30');
		if (!res.ok) return;
		const body = (await res.json()) as { events: StreamEvent[] };
		streamEvents = body.events;
		if (autoScroll) requestAnimationFrame(() => streamEl?.scrollTo({ top: 0, behavior: 'smooth' }));
	}

	function buildUrl(overrides: Record<string, string | number | boolean | undefined>) {
		const params = new URLSearchParams();
		const f = { ...data.filters, ...overrides };
		if (f.sort && f.sort !== 'newest_discovered') params.set('sort', String(f.sort));
		if (f.source) params.set('source', String(f.source));
		if (f.language) params.set('language', String(f.language));
		if (f.year) params.set('year', String(f.year));
		if (f.dateFrom) params.set('date_from', String(f.dateFrom));
		if (f.dateTo) params.set('date_to', String(f.dateTo));
		if (f.minStars) params.set('min_stars', String(f.minStars));
		if (f.minForks) params.set('min_forks', String(f.minForks));
		if (f.archivedOnly) params.set('archived_only', '1');
		if (f.hasReadme) params.set('has_readme', '1');
		if (f.hasRelease) params.set('has_release', '1');
		if (f.deletedOnly) params.set('deleted_only', '1');
		if (f.page && Number(f.page) > 1) params.set('page', String(f.page));
		const qs = params.toString();
		return qs ? `/birth-feed?${qs}` : '/birth-feed';
	}

	function onSubmit(e: Event) {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		window.location.href = buildUrl({
			sort: (fd.get('sort') as string) ?? '',
			source: (fd.get('source') as string) ?? '',
			language: (fd.get('language') as string) ?? '',
			year: (fd.get('year') as string) ?? '',
			dateFrom: (fd.get('date_from') as string) ?? '',
			dateTo: (fd.get('date_to') as string) ?? '',
			minStars: (fd.get('min_stars') as string) ?? '',
			minForks: (fd.get('min_forks') as string) ?? '',
			archivedOnly: fd.get('archived_only') === 'on',
			hasReadme: fd.get('has_readme') === 'on',
			hasRelease: fd.get('has_release') === 'on',
			deletedOnly: fd.get('deleted_only') === 'on',
			page: 1
		});
	}

	function sourceLabel(source: string): string {
		return source === 'github_search' ? 'github_search' : 'gharchive';
	}

	function velocityIcon(value: 'up' | 'down' | 'flat'): string {
		if (value === 'up') return 'UP';
		if (value === 'down') return 'DOWN';
		return 'FLAT';
	}
</script>

<svelte:head>
	<title>Live Feed - GithubArchive+</title>
</svelte:head>

<h1>Live Feed</h1>
<p class="birth-lead">
	GithubArchive+ watching repository births, enrichments, archives, releases, and refreshes. Updates every 30 seconds.
</p>

<div class="stats-bar" style="margin-bottom: 1.5rem">
	<span>{data.total.toLocaleString()} matching</span>
	<span>Page {data.page} of {data.totalPages}</span>
	<span>{data.overview.discovered24h.toLocaleString()} discovered in 24h</span>
	<span>{data.overview.archived24h.toLocaleString()} archived in 24h</span>
</div>

<nav class="feed-nav">
	<a href="/birth-feed" class="feed-link" class:active={!data.filters.archivedOnly && data.filters.sort !== 'stars'}>Live Feed</a>
	<a href={buildUrl({ sort: 'stars', archivedOnly: false, page: 1 })} class="feed-link" class:active={data.filters.sort === 'stars'}>Trending Feed</a>
	<a href={buildUrl({ archivedOnly: true, sort: 'recently_archived', page: 1 })} class="feed-link" class:active={data.filters.archivedOnly}>Archive Feed</a>
</nav>

<section class="live-stream">
	<div class="stream-head">
		<h2 class="section-title">Global activity stream</h2>
		<label class="filter-check"><input type="checkbox" bind:checked={autoScroll} /> auto-scroll</label>
	</div>
	<div class="stream-list" bind:this={streamEl}>
		{#if streamEvents.length === 0}
			<p class="muted">Waiting for repository events...</p>
		{:else}
			{#each streamEvents as event}
				<a href="/repo/{event.owner}/{event.name}">
					<span>{timeAgo(event.event_time)}</span>
					<strong>{event.label}</strong>
					<em class="mono">{event.full_name}</em>
				</a>
			{/each}
		{/if}
	</div>
</section>

<section class="trend-grid">
	<div>
		<h2 class="section-title">Fastest growing stars</h2>
		{#each data.trends.fastestGrowingStars.slice(0, 5) as repo}
			<a href="/repo/{repo.owner}/{repo.name}"><span class="mono">{repo.full_name}</span><strong>+{repo.stars_delta}</strong></a>
		{/each}
	</div>
	<div>
		<h2 class="section-title">New languages today</h2>
		{#each data.trends.newLanguagesToday.slice(0, 5) as item}
			<p><span>{item.language}</span><strong>{item.count}</strong></p>
		{/each}
	</div>
	<div>
		<h2 class="section-title">Trending topics</h2>
		<div class="topic-cloud">
			{#each data.trends.trendingTopics.slice(0, 10) as item}
				<span>{item.topic} / {item.count}</span>
			{/each}
		</div>
	</div>
</section>

<form class="filters" onsubmit={onSubmit}>
	<select name="sort" class="filter-select">
		<option value="">Sort: newest discovered</option>
		{#each data.sorts as sort}
			<option value={sort} selected={data.filters.sort === sort}>{sort.replaceAll('_', ' ')}</option>
		{/each}
	</select>
	<select name="source" class="filter-select">
		<option value="">All sources</option>
		{#each data.sources as src}
			<option value={src} selected={data.filters.source === src}>{sourceLabel(src)}</option>
		{/each}
	</select>
	<select name="language" class="filter-select">
		<option value="">All languages</option>
		{#each data.languages as lang}
			<option value={lang} selected={data.filters.language === lang}>{lang}</option>
		{/each}
	</select>
	<input name="year" type="number" class="filter-input" placeholder="Year" value={data.filters.year} min="2008" max="2099" />
	<input name="date_from" type="date" class="filter-input" value={data.filters.dateFrom} />
	<input name="date_to" type="date" class="filter-input" value={data.filters.dateTo} />
	<input name="min_stars" type="number" class="filter-input" placeholder="Min stars" value={data.filters.minStars} min="0" />
	<input name="min_forks" type="number" class="filter-input" placeholder="Min forks" value={data.filters.minForks} min="0" />
	<label class="filter-check"><input type="checkbox" name="archived_only" checked={data.filters.archivedOnly} /> Archived only</label>
	<label class="filter-check"><input type="checkbox" name="has_readme" checked={data.filters.hasReadme} /> Has README</label>
	<label class="filter-check"><input type="checkbox" name="has_release" checked={data.filters.hasRelease} /> Has release</label>
	<label class="filter-check"><input type="checkbox" name="deleted_only" checked={data.filters.deletedOnly} /> Deleted only</label>
	<button type="submit" class="filter-btn">Apply</button>
	{#if data.filters.sort !== 'newest_discovered' || data.filters.source || data.filters.language || data.filters.year || data.filters.dateFrom || data.filters.dateTo || data.filters.minStars || data.filters.minForks || data.filters.archivedOnly || data.filters.hasReadme || data.filters.hasRelease || data.filters.deletedOnly}
		<a href="/birth-feed" class="filter-clear">Clear</a>
	{/if}
</form>

<section>
	<h2 class="section-title">Repository feed</h2>

	{#if data.repos.length === 0}
		<div class="empty-state">
			<p>No repositories match your filters.</p>
			<p class="empty-hint">Try clearing filters or run <code>npm run ingest:hour</code> to discover new repos.</p>
		</div>
	{:else}
		<ul class="repo-list birth-list">
			{#each data.repos as repo}
				<li class="repo-item repo-item-link">
					<div class="repo-dates">
						<span class="repo-time" title={repo.first_seen_at}>First seen by archive: {timeAgo(repo.first_seen_at)}</span>
						<span class="repo-time muted" title={repo.created_at}>GitHub created: {timeAgo(repo.created_at)} ({formatDateShort(repo.created_at)})</span>
					</div>
					<a class="repo-name" href={repoDetailPath(repo.owner, repo.name)}>{repo.full_name}</a>
					{#if repo.download_zip_url}
						<a
							class="download-zip"
							href={repo.download_zip_url}
							download
						>
							Download ZIP
						</a>
					{/if}
					<div class="birth-badges">
						<span class="badge velocity" class:up={repo.velocity === 'up'} class:down={repo.velocity === 'down'}>{velocityIcon(repo.velocity)}</span>
						<span class="badge moment">{repo.moment_tag}</span>
						<span class="badge source" class:search={repo.discovery_source === 'github_search'}>{sourceLabel(repo.discovery_source)}</span>
						<span class="badge" class:archived={repo.enriched} class:pending={!repo.enriched}>{repo.enriched ? 'enriched' : 'pending'}</span>
						<span class="badge" class:archived={repo.archived} class:pending={!repo.archived}>{repo.archived ? 'archived' : 'not archived'}</span>
						<span class="badge" class:archived={repo.has_readme} class:pending={!repo.has_readme}>{repo.has_readme ? 'README saved' : 'no README'}</span>
						{#if repo.has_release}<span class="badge archived">has release</span>{/if}
					</div>
					<div class="repo-meta">
						{#if repo.language}<span>{repo.language}</span>{/if}
						{#if repo.license}<span>{repo.license}</span>{/if}
						{#if repo.topics.length > 0}<span class="birth-topics">{repo.topics.slice(0, 5).join(' / ')}</span>{/if}
						{#if repo.description}<span>{repo.description}</span>{/if}
					</div>
				</li>
			{/each}
		</ul>

		<nav class="pagination">
			{#if data.page > 1}<a href={buildUrl({ page: data.page - 1 })}>Previous</a>{:else}<span class="disabled">Previous</span>{/if}
			<span class="page-info">{data.total.toLocaleString()} repos</span>
			{#if data.page < data.totalPages}<a href={buildUrl({ page: data.page + 1 })}>Next</a>{:else}<span class="disabled">Next</span>{/if}
		</nav>
	{/if}
</section>

<p class="api-hint">
	API: <a href="/api/birth-feed">/api/birth-feed</a> | <a href="/api/events">/api/events</a> |
	<a href="/api/trends">/api/trends</a> | <a href="/admin">Admin</a> | <a href="/">All repos</a>
</p>

<style>
	.birth-lead,
	.muted,
	.birth-topics,
	.repo-time.muted {
		color: var(--text-muted);
	}

	.birth-lead {
		margin-top: -0.5rem;
	}

	.live-stream,
	.trend-grid > div {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
		padding: 1rem;
		margin-bottom: 1.5rem;
	}

	.stream-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
	}

	.stream-list {
		display: grid;
		gap: 0.45rem;
		max-height: 260px;
		overflow: auto;
	}

	.stream-list a,
	.trend-grid a,
	.trend-grid p {
		display: grid;
		grid-template-columns: 120px 1fr auto;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--border);
		margin: 0;
	}

	.stream-list span,
	.stream-list em {
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.trend-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
	}

	.topic-cloud,
	.birth-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.topic-cloud span {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.birth-badges {
		margin: 0.35rem 0;
	}

	.badge.source {
		background: var(--bg-elevated);
		color: var(--text-muted);
	}

	.badge.source.search,
	.badge.moment {
		color: var(--accent);
	}

	.badge.velocity.up {
		border-color: var(--green);
		color: var(--green);
	}

	.badge.velocity.down {
		border-color: var(--orange);
		color: var(--orange);
	}

	.birth-list .repo-item {
		padding-bottom: 1rem;
	}

	.birth-list .repo-name {
		color: var(--text);
		text-decoration: none;
	}

	.birth-list .repo-name:hover {
		color: var(--accent);
		text-decoration: underline;
	}

	.download-zip {
		display: inline-block;
		margin: 0.35rem 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.25rem 0.55rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
		background: var(--bg-elevated);
	}

	.download-zip:hover {
		background: var(--bg-hover);
		text-decoration: none;
	}

	.repo-dates {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-bottom: 0.25rem;
	}

	.repo-time.muted,
	.empty-hint {
		font-size: 0.85rem;
	}

	@media (max-width: 820px) {
		.trend-grid {
			grid-template-columns: 1fr;
		}

		.stream-list a,
		.trend-grid a,
		.trend-grid p {
			grid-template-columns: 1fr;
		}
	}
</style>
