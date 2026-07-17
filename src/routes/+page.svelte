<script lang="ts">
	import RepoListItem from '$lib/components/RepoListItem.svelte';
	import { timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const feeds = [
		{ id: 'newest', label: 'Newest' },
		{ id: 'new_100_stars', label: 'New 100+ stars' },
		{ id: 'recently_archived', label: 'Recently archived' },
		{ id: 'recently_deleted', label: 'Deleted but saved' },
		{ id: 'recently_released', label: 'Recent releases' },
		{ id: 'recently_updated', label: 'Recently updated' }
	];
	const pageSizes = [10, 25, 50, 75, 100];

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
		if (f.maxStars) params.set('max_stars', String(f.maxStars));
		if (f.minForks) params.set('min_forks', String(f.minForks));
		if (f.neverEnriched) params.set('never_enriched', '1');
		if (f.archivedOnly) params.set('archived_only', '1');
		if (f.hasReadme) params.set('has_readme', '1');
		if (f.hasRelease) params.set('has_release', '1');
		if (f.deletedOnly) params.set('deleted_only', '1');
		if (f.perPage && Number(f.perPage) !== 50) params.set('per_page', String(f.perPage));
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
			maxStars: (fd.get('max_stars') as string) ?? '',
			minForks: (fd.get('min_forks') as string) ?? '',
			perPage: (fd.get('per_page') as string) ?? '50',
			neverEnriched: fd.get('never_enriched') === 'on',
			archivedOnly: fd.get('archived_only') === 'on',
			hasReadme: fd.get('has_readme') === 'on',
			hasRelease: fd.get('has_release') === 'on',
			deletedOnly: fd.get('deleted_only') === 'on',
			page: 1
		});
	}

	function csvEscape(value: string | number | null | undefined): string {
		const text = String(value ?? '');
		return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
	}

	function downloadCurrentPageList() {
		const rows = [
			['repo', 'github_url', 'download_zip_url'],
			...data.repos.map((repo) => [repo.full_name, repo.github_url, repo.download_zip_url ?? ''])
		];
		const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
		const blob = new Blob([`${csv}\n`], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `githubarchive-repos-page-${data.page}-per-${data.perPage}.csv`;
		document.body.append(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	const feedTitle = $derived(feeds.find((f) => f.id === data.filters.feed)?.label ?? 'Repositories');
	const preservationRate = $derived(
		data.archivePulse.totalRepos > 0
			? Math.round((data.archivePulse.preservedRepos / data.archivePulse.totalRepos) * 100)
			: 0
	);
	const pulseMetrics = $derived([
		{
			icon: 'R',
			label: 'Repositories',
			value: data.archivePulse.totalRepos.toLocaleString(),
			detail: 'Discovered and indexed locally'
		},
		{
			icon: 'P',
			label: data.archivePulse.metadataOnly ? 'Metadata tracked' : 'Preserved repos',
			value: (data.archivePulse.metadataOnly ? data.archivePulse.totalRepos : data.archivePulse.preservedRepos).toLocaleString(),
			detail: data.archivePulse.metadataOnly ? 'Artifact storage disabled' : `${preservationRate}% of discovered repos`
		},
		{
			icon: 'M',
			label: 'README saved',
			value: data.archivePulse.readmeSaved.toLocaleString(),
			detail: data.archivePulse.metadataOnly ? 'Artifact storage disabled' : `${data.archivePulse.readmeChanges.toLocaleString()} README change events`
		},
		{
			icon: 'S',
			label: 'Source saved',
			value: data.archivePulse.sourceSaved.toLocaleString(),
			detail: data.archivePulse.metadataOnly ? 'Source and ZIP storage disabled' : `${data.archivePulse.zipAvailable.toLocaleString()} exportable ZIPs`
		},
		{
			icon: 'D',
			label: 'Deleted but saved',
			value: data.archivePulse.deletedButSaved.toLocaleString(),
			detail: `${data.archivePulse.githubArchivedSaved.toLocaleString()} archived-upstream repos preserved`
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
				data.filters.maxStars ||
				data.filters.minForks ||
				data.filters.neverEnriched ||
				data.filters.archivedOnly ||
				data.filters.hasReadme ||
				data.filters.hasRelease ||
				data.filters.deletedOnly ||
				(data.filters.sort && data.filters.sort !== 'newest_discovered' && data.filters.sort !== data.filters.feed)
		)
	);
	const pageStart = $derived(data.total === 0 ? 0 : (data.page - 1) * data.perPage + 1);
	const pageEnd = $derived(Math.min(data.total, data.page * data.perPage));

	const featuredRepos = $derived([
		...data.archivePulse.recentDeletedSaved.map((repo) => ({
			...repo,
			label: 'Deleted but saved',
			detailText: 'GitHub lost it; the archive still has evidence.'
		})),
		...data.archivePulse.recentPreserved.map((repo) => ({
			...repo,
			label: 'Newly preserved',
			detailText: 'Fresh local evidence was captured.'
		})),
		...data.archivePulse.recentReadmeChanges.map((repo) => ({
			...repo,
			label: 'README memory',
			detailText: 'Documentation changed and remains inspectable.'
		}))
	].slice(0, 6));

	function repoPath(owner: string, name: string): string {
		return `/repo/${owner}/${name}`;
	}

	function starsLabel(stars: number | null): string {
		return `${(stars ?? 0).toLocaleString()} stars`;
	}
</script>

<svelte:head>
	<title>GithubArchive+ — Find, understand, and save GitHub repos</title>
</svelte:head>

<section class="section-block archive-inventory" aria-labelledby="pulse-title">
	<div class="section-heading">
		<div>
			<p class="eyebrow">Archive Pulse</p>
			<h1 id="pulse-title">What GitHubArchive+ has so far</h1>
		</div>
		<a href="/admin" class="button-ghost">System health</a>
	</div>
	<div class="pulse-grid">
		{#each pulseMetrics as metric}
			<article class="pulse-card">
				<span class="metric-icon" aria-hidden="true">{metric.icon}</span>
				<div>
					<span>{metric.label}</span>
					<strong>{metric.value}</strong>
					<small>{metric.detail}</small>
				</div>
			</article>
		{/each}
	</div>
</section>

<section class="section-block discovery-lanes" aria-labelledby="discovery-title">
	<div class="section-heading">
		<div>
			<p class="eyebrow">New discovery lanes</p>
			<h2 id="discovery-title">New repos, with and without the 100-star filter</h2>
		</div>
		<a href={buildUrl({ feed: 'new_100_stars', sort: 'newest_discovered', minStars: 100, page: 1 })} class="button-ghost">Open 100+ star feed</a>
	</div>

	<div class="discovery-grid">
		<article class="discovery-card">
			<div class="lane-header">
				<div>
					<span>New repos period</span>
					<strong>Freshly discovered</strong>
				</div>
				<a href={buildUrl({ feed: 'newest', sort: 'newest_discovered', minStars: '', page: 1 })}>View all</a>
			</div>
			{#if data.discoveryLanes.newRepos.length}
				<div class="lane-list">
					{#each data.discoveryLanes.newRepos as repo}
						<a href={repoPath(repo.owner, repo.name)}>
							<strong class="mono">{repo.full_name}</strong>
							<span>{repo.language ?? 'Unknown'} · {starsLabel(repo.stars)}</span>
							<small>{timeAgo(repo.first_seen_at)}</small>
						</a>
					{/each}
				</div>
			{:else}
				<p class="lane-empty">No new repositories discovered yet.</p>
			{/if}
		</article>

		<article class="discovery-card">
			<div class="lane-header">
				<div>
					<span>New repos with 100+ stars</span>
					<strong>Already getting attention</strong>
				</div>
				<a href={buildUrl({ feed: 'new_100_stars', sort: 'newest_discovered', minStars: 100, page: 1 })}>View 100+</a>
			</div>
			{#if data.discoveryLanes.newStarredRepos.length}
				<div class="lane-list">
					{#each data.discoveryLanes.newStarredRepos as repo}
						<a href={repoPath(repo.owner, repo.name)}>
							<strong class="mono">{repo.full_name}</strong>
							<span>{repo.language ?? 'Unknown'} · {starsLabel(repo.stars)}</span>
							<small>{timeAgo(repo.first_seen_at)}</small>
						</a>
					{/each}
				</div>
			{:else}
				<p class="lane-empty">No newly discovered 100+ star repositories yet.</p>
			{/if}
		</article>
	</div>
</section>

<section class="product-hero" aria-labelledby="home-title">
	<div class="hero-copy">
		<p class="eyebrow">Repository intelligence and preservation</p>
		<h2 id="home-title">GitHub Archive+ remembers what GitHub forgets.</h2>
		<p>
			Preserve repositories, understand their evolution, and inspect the evidence behind every insight.
		</p>
		<div class="hero-actions">
			<a class="button" href="#repository-feed">Browse Archive</a>
			<a class="button-secondary" href="/admin">Archive Repository</a>
		</div>
	</div>
	<div class="hero-panel" aria-label="System summary">
		<span>Archive Pulse</span>
		<strong>{data.archivePulse.metadataOnly ? data.archivePulse.totalRepos.toLocaleString() : data.archivePulse.preservedRepos.toLocaleString()}</strong>
		<p>{data.archivePulse.metadataOnly ? 'repositories tracked in metadata-only mode' : 'repositories with preserved local evidence'}</p>
		<a href={buildUrl({ feed: 'recently_archived', page: 1 })}>View preserved repos</a>
	</div>
</section>

<section class="section-block" aria-labelledby="featured-title">
	<div class="section-heading">
		<div>
			<p class="eyebrow">Featured</p>
			<h2 id="featured-title">Interesting repositories</h2>
		</div>
		<a href={buildUrl({ feed: 'recently_archived', page: 1 })} class="button-ghost">See archive feed</a>
	</div>

	{#if featuredRepos.length}
		<div class="featured-grid">
			{#each featuredRepos as repo}
				<a class="featured-card" href={repoPath(repo.owner, repo.name)}>
					<span>{repo.label}</span>
					<strong class="mono">{repo.full_name}</strong>
					<p>{repo.detailText}</p>
					<small>{timeAgo(repo.at)}</small>
				</a>
			{/each}
		</div>
	{:else}
		<div class="empty-state action-empty">
			<h3>{data.archivePulse.metadataOnly ? 'Metadata-only mode is active.' : 'No repositories archived yet.'}</h3>
			<p>{data.archivePulse.metadataOnly ? 'The site is still discovering, enriching, scoring, and tracking repositories without downloading heavy artifacts.' : 'Start Auto-Scan or run GitHub Search ingest to begin preserving repositories.'}</p>
			<div>
				<a class="button" href="/admin">Open Control Center</a>
				<a class="button-secondary" href="/birth-feed">View Live Feed</a>
			</div>
		</div>
	{/if}
</section>

<section class="section-block activity-block" aria-labelledby="activity-title">
	<div class="section-heading">
		<div>
			<p class="eyebrow">Recent activity</p>
			<h2 id="activity-title">Archive activity</h2>
		</div>
		<a href="/birth-feed" class="button-ghost">Live feed</a>
	</div>
	<div class="activity-list">
		{#if data.archivePulse.recentPreserved.length}
			{#each data.archivePulse.recentPreserved.slice(0, 5) as repo}
				<a href={repoPath(repo.owner, repo.name)}>
					<span>Preserved</span>
					<strong class="mono">{repo.full_name}</strong>
					<small>{timeAgo(repo.at)}</small>
				</a>
			{/each}
		{:else}
			<p>No archive events yet. The next saved README or source snapshot will appear here.</p>
		{/if}
	</div>
</section>

<section class="section-block" id="repository-feed" aria-labelledby="feed-title">
	<div class="section-heading">
		<div>
			<p class="eyebrow">Browse</p>
			<h2 id="feed-title">{feedTitle}</h2>
		</div>
		<div class="feed-heading-actions">
			<span class="feed-count">{data.total.toLocaleString()} repositories</span>
			<a class="button-ghost" href="/api/export/names?scope=all&format=txt" download>
				Download names for AI
			</a>
		</div>
	</div>

	<form class="filters search-panel" onsubmit={onSubmit} aria-label="Repository search and filters">
		<label class="search-field">
			<span>Search repositories</span>
			<input
				name="q"
				type="search"
				class="filter-input"
				placeholder="Search name, owner, description..."
				value={data.filters.q}
			/>
		</label>
		<label>
			<span>Sort</span>
			<select name="sort" class="filter-select">
				<option value="">Default</option>
				{#each data.sorts as sort}
					<option value={sort} selected={data.filters.sort === sort}>{sort.replaceAll('_', ' ')}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>Language</span>
			<select name="language" class="filter-select">
				<option value="">All languages</option>
				{#each data.languages as lang}
					<option value={lang} selected={data.filters.language === lang}>{lang}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>Repos per page</span>
			<select name="per_page" class="filter-select">
				{#each pageSizes as size}
					<option value={size} selected={data.perPage === size}>{size}</option>
				{/each}
			</select>
		</label>
		<button type="submit" class="filter-btn">Apply</button>
		{#if hasActiveFilters}
			<a href="/" class="filter-clear">Clear filters</a>
		{/if}

		<details class="advanced-filters">
			<summary>Advanced filters</summary>
			<div>
				<label>
					<span>Discovery source</span>
					<select name="source" class="filter-select">
						<option value="">All sources</option>
						<option value="gharchive" selected={data.filters.source === 'gharchive'}>GH Archive</option>
						<option value="github_search" selected={data.filters.source === 'github_search'}>GitHub Search</option>
						<option value="trending" selected={data.filters.source === 'trending'}>Trending</option>
						<option value="manual" selected={data.filters.source === 'manual'}>Saved by you</option>
					</select>
				</label>
				<label><span>Year</span><input name="year" type="number" class="filter-input" value={data.filters.year} min="2008" max="2099" /></label>
				<label><span>From</span><input name="date_from" type="date" class="filter-input" value={data.filters.dateFrom} /></label>
				<label><span>To</span><input name="date_to" type="date" class="filter-input" value={data.filters.dateTo} /></label>
				<label><span>Minimum stars</span><input name="min_stars" type="number" class="filter-input" value={data.filters.minStars} min="0" /></label>
				<label><span>Maximum stars</span><input name="max_stars" type="number" class="filter-input" value={data.filters.maxStars} min="0" /></label>
				<label><span>Minimum forks</span><input name="min_forks" type="number" class="filter-input" value={data.filters.minForks} min="0" /></label>
				<label class="filter-check"><input type="checkbox" name="archived_only" checked={data.filters.archivedOnly} /> Archived only</label>
				<label class="filter-check"><input type="checkbox" name="has_readme" checked={data.filters.hasReadme} /> Has README</label>
				<label class="filter-check"><input type="checkbox" name="has_release" checked={data.filters.hasRelease} /> Has release</label>
				<label class="filter-check"><input type="checkbox" name="deleted_only" checked={data.filters.deletedOnly} /> Deleted only</label>
				<label class="filter-check"><input type="checkbox" name="never_enriched" checked={data.filters.neverEnriched} /> Never enriched</label>
			</div>
		</details>
	</form>

	<nav class="feed-nav" aria-label="Repository feeds">
		{#each feeds as f}
			<a href={buildUrl({ feed: f.id, sort: 'newest_discovered', minStars: f.id === 'new_100_stars' ? 100 : '', page: 1 })} class="feed-link" class:active={data.filters.feed === f.id}>
				{f.label}
			</a>
		{/each}
	</nav>

	{#if data.filters.q}
		<p class="search-meta">{data.total.toLocaleString()} result{data.total === 1 ? '' : 's'} for "{data.filters.q}"</p>
	{/if}

	<div class="feed-tools" aria-label="Current page tools">
		<p>
			Showing {pageStart.toLocaleString()}-{pageEnd.toLocaleString()} of {data.total.toLocaleString()}
			<span>({data.perPage} per page)</span>
		</p>
		<button type="button" class="button-ghost" onclick={downloadCurrentPageList} disabled={data.repos.length === 0}>
			Download Page List
		</button>
	</div>

	{#if data.repos.length === 0}
		<div class="empty-state action-empty">
			<h3>{data.filters.q ? `No results for "${data.filters.q}".` : 'No repositories match your filters.'}</h3>
			<p>Clear filters, browse the live feed, or open the Control Center to ingest repositories.</p>
			<div>
				<a class="button" href="/">Clear filters</a>
				<a class="button-secondary" href="/admin">Open Control Center</a>
			</div>
		</div>
	{:else}
		<ul class="repo-list">
			{#each data.repos as repo}
				<RepoListItem {repo} isAdmin={data.isAdmin} />
			{/each}
		</ul>

		<nav class="pagination" aria-label="Repository pages">
			{#if data.page > 1}
				<a href={buildUrl({ page: data.page - 1 })}>Previous</a>
			{:else}
				<span class="disabled">Previous</span>
			{/if}
			<span class="page-info">Page {data.page} of {data.totalPages} · {data.perPage} per page</span>
			{#if data.page < data.totalPages}
				<a href={buildUrl({ page: data.page + 1 })}>Next</a>
			{:else}
				<span class="disabled">Next</span>
			{/if}
		</nav>
	{/if}
</section>

<section class="developer-tools" aria-labelledby="developer-title">
	<div>
		<p class="eyebrow">Developer tools</p>
		<h2 id="developer-title">Inspect the archive programmatically</h2>
	</div>
	<div>
		<a href="/api/repos">/api/repos</a>
		<a href="/api/search?q=cursor">/api/search</a>
		<a href="/api/events">/api/events</a>
		<a href="/api/releases/latest">/api/releases/latest</a>
	</div>
</section>

<style>
	.product-hero,
	.section-block,
	.developer-tools {
		margin-bottom: 2rem;
	}

	.archive-inventory {
		padding-top: 1.25rem;
	}

	.product-hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 1.25rem;
		align-items: stretch;
		padding: 1rem 0;
	}

	.hero-copy {
		display: grid;
		gap: 1rem;
		align-content: center;
	}

	.eyebrow {
		margin: 0;
		color: var(--green);
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.product-hero h2 {
		max-width: 830px;
		margin: 0;
		font-size: clamp(2.5rem, 6vw, 5rem);
		line-height: 0.98;
	}

	.product-hero p {
		max-width: 680px;
		margin: 0;
		color: var(--text-muted);
		font-size: 1.08rem;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.hero-panel,
	.pulse-card,
	.discovery-card,
	.featured-card,
	.activity-list,
	.developer-tools {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
		box-shadow: var(--shadow-soft);
	}

	.hero-panel {
		display: grid;
		align-content: end;
		gap: 0.45rem;
		padding: 1.25rem;
		min-height: 260px;
	}

	.hero-panel span,
	.hero-panel p,
	.feed-count {
		color: var(--text-muted);
	}

	.hero-panel strong {
		font-size: 3.4rem;
		line-height: 1;
	}

	.section-heading {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: end;
		margin-bottom: 1rem;
	}

	.archive-inventory .section-heading h1 {
		margin: 0.15rem 0 0;
		font-size: clamp(1.75rem, 4vw, 3rem);
		line-height: 1;
	}

	.feed-heading-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		justify-content: flex-end;
	}

	.section-heading h2,
	.developer-tools h2 {
		margin: 0.15rem 0 0;
		font-size: clamp(1.35rem, 3vw, 2rem);
	}

	.pulse-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.pulse-card {
		display: grid;
		grid-template-columns: 42px minmax(0, 1fr);
		gap: 0.8rem;
		padding: 1rem;
	}

	.metric-icon {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--accent) 18%, var(--bg-hover));
		color: var(--accent);
		font-weight: 800;
	}

	.pulse-card span:not(.metric-icon),
	.pulse-card small,
	.featured-card span,
	.featured-card small,
	.activity-list span,
	.activity-list small {
		color: var(--text-muted);
	}

	.pulse-card strong {
		display: block;
		font-size: 1.75rem;
		line-height: 1.1;
	}

	.discovery-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.discovery-card {
		display: grid;
		gap: 0.8rem;
		padding: 1rem;
	}

	.lane-header {
		display: flex;
		justify-content: space-between;
		gap: 0.85rem;
		align-items: flex-start;
	}

	.lane-header span,
	.lane-list span,
	.lane-list small,
	.lane-empty {
		color: var(--text-muted);
	}

	.lane-header strong {
		display: block;
		margin-top: 0.1rem;
	}

	.lane-header a {
		flex: 0 0 auto;
		font-size: 0.85rem;
		font-weight: 750;
	}

	.lane-list {
		display: grid;
	}

	.lane-list a {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.2rem 0.7rem;
		padding: 0.65rem 0;
		border-top: 1px solid var(--border);
		text-decoration: none;
	}

	.lane-list strong {
		overflow-wrap: anywhere;
	}

	.lane-list span {
		grid-column: 1;
		font-size: 0.84rem;
	}

	.lane-list small {
		grid-column: 2;
		grid-row: 1 / 3;
		align-self: center;
		white-space: nowrap;
	}

	.lane-empty {
		margin: 0;
	}

	.featured-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.featured-card {
		display: grid;
		gap: 0.45rem;
		padding: 1rem;
		color: inherit;
		text-decoration: none;
	}

	.featured-card:hover {
		border-color: var(--border-strong);
		text-decoration: none;
		transform: translateY(-1px);
	}

	.featured-card strong {
		overflow-wrap: anywhere;
	}

	.featured-card p {
		margin: 0;
		color: var(--text-muted);
	}

	.activity-list {
		display: grid;
		padding: 0.35rem 1rem;
	}

	.activity-list a {
		display: grid;
		grid-template-columns: 110px minmax(0, 1fr) auto;
		gap: 1rem;
		padding: 0.7rem 0;
		border-bottom: 1px solid var(--border);
	}

	.activity-list a:last-child {
		border-bottom: 0;
	}

	.search-panel label {
		display: grid;
		gap: 0.25rem;
		color: var(--text-muted);
		font-size: 0.78rem;
		font-weight: 700;
	}

	.search-field {
		flex: 1 1 320px;
	}

	.advanced-filters {
		flex-basis: 100%;
		color: var(--text-muted);
	}

	.advanced-filters summary {
		cursor: pointer;
		font-weight: 700;
	}

	.advanced-filters > div {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
		margin-top: 0.8rem;
	}

	.feed-tools {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: center;
		margin: 0.85rem 0;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-elevated);
	}

	.feed-tools p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.88rem;
	}

	.feed-tools span {
		margin-left: 0.35rem;
	}

	.feed-tools button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.action-empty h3 {
		margin: 0 0 0.45rem;
		color: var(--text);
	}

	.action-empty > div {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.7rem;
		margin-top: 1rem;
	}

	.developer-tools {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		padding: 1rem;
		box-shadow: none;
	}

	.developer-tools > div:last-child {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.developer-tools a {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.35rem 0.55rem;
		font-family: var(--font-mono);
		font-size: 0.82rem;
	}

	@media (max-width: 920px) {
		.product-hero,
		.discovery-grid,
		.featured-grid {
			grid-template-columns: 1fr 1fr;
		}

		.pulse-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.hero-panel {
			min-height: 180px;
		}
	}

	@media (max-width: 680px) {
		.product-hero,
		.pulse-grid,
		.discovery-grid,
		.featured-grid,
		.activity-list a {
			grid-template-columns: 1fr;
		}

		.section-heading,
		.developer-tools {
			align-items: flex-start;
			flex-direction: column;
		}

		.product-hero {
			padding-top: 0;
		}
	}

	@media (max-width: 720px) {
		.archive-inventory {
			margin: -0.3rem -0.25rem 1rem;
			padding-top: 0.25rem;
		}

		.archive-inventory .section-heading {
			display: grid;
			gap: 0.75rem;
			margin-bottom: 0.8rem;
		}

		.archive-inventory .section-heading h1 {
			font-size: 1.55rem;
			line-height: 1.05;
		}

		.archive-inventory .button-ghost {
			justify-self: stretch;
			min-height: 2.5rem;
		}

		.pulse-grid {
			display: grid;
			grid-template-columns: 1fr;
			gap: 0.55rem;
		}

		.pulse-card {
			grid-template-columns: 36px minmax(0, 1fr) auto;
			align-items: center;
			gap: 0.7rem;
			padding: 0.72rem;
			border-radius: 8px;
			box-shadow: none;
		}

		.pulse-card div {
			display: contents;
		}

		.pulse-card span:not(.metric-icon) {
			font-size: 0.9rem;
			font-weight: 750;
			color: var(--text);
		}

		.pulse-card strong {
			grid-column: 3;
			grid-row: 1;
			font-size: 1.2rem;
			text-align: right;
			white-space: nowrap;
		}

		.pulse-card small {
			grid-column: 2 / 4;
			grid-row: 2;
			font-size: 0.75rem;
			line-height: 1.25;
		}

		.metric-icon {
			width: 32px;
			height: 32px;
			grid-row: 1 / 3;
		}

		.product-hero {
			margin-top: 0.75rem;
			padding: 0.85rem;
			border: 1px solid var(--border);
			border-radius: var(--radius);
			background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
		}

		.product-hero h2 {
			font-size: 1.75rem;
			line-height: 1.05;
		}

		.product-hero p {
			font-size: 0.95rem;
		}

		.hero-panel {
			display: none;
		}

		.hero-actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.55rem;
		}

		.hero-actions .button,
		.hero-actions .button-secondary {
			min-height: 2.65rem;
			padding: 0.5rem;
			font-size: 0.84rem;
		}

		.discovery-card {
			padding: 0.8rem;
			border-radius: 8px;
		}

		.lane-header {
			display: grid;
		}

		.lane-list a {
			grid-template-columns: 1fr;
		}

		.lane-list small {
			grid-column: 1;
			grid-row: auto;
		}

		.featured-grid {
			display: flex;
			overflow-x: auto;
			margin: 0 -1rem;
			padding: 0 1rem 0.35rem;
			scroll-snap-type: x mandatory;
		}

		.featured-card {
			min-width: 82%;
			scroll-snap-align: start;
		}

		.activity-block {
			display: none;
		}

		.search-panel {
			position: sticky;
			top: 58px;
			z-index: 25;
			margin: 0 -0.25rem 0.75rem;
			padding: 0.65rem;
			border-radius: 8px;
			background: color-mix(in srgb, var(--bg-subtle) 96%, transparent);
			backdrop-filter: blur(14px);
		}

		.feed-nav {
			flex-wrap: nowrap;
			overflow-x: auto;
			margin: 0 -1rem 0.8rem;
			padding: 0 1rem 0.2rem;
		}

		.feed-link {
			flex: 0 0 auto;
			min-height: 2.25rem;
			display: inline-flex;
			align-items: center;
		}

		.feed-tools {
			display: grid;
			margin: 0.75rem 0;
		}

		.feed-tools .button-ghost {
			width: 100%;
		}

		.developer-tools {
			margin-bottom: 5rem;
		}
	}
</style>
