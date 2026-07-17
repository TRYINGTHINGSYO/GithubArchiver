<script lang="ts">
	import { goto } from '$app/navigation';
	import { buildRepoListUrl, hasAdvancedFilters, type RepoListFilterState } from '$lib/repo-url';

	let {
		basePath,
		filters,
		languages,
		sorts,
		sources = [],
		showSearch = true
	}: {
		basePath: string;
		filters: RepoListFilterState;
		languages: string[];
		sorts: string[];
		sources?: string[];
		showSearch?: boolean;
	} = $props();

	let advancedOpen = $state(false);

	$effect(() => {
		if (hasAdvancedFilters(filters)) advancedOpen = true;
	});

	const quickFilters = $derived([
		{ label: 'Today', href: buildRepoListUrl(basePath, filters, { dateFrom: todayIso(), page: 1 }) },
		{ label: 'This week', href: buildRepoListUrl(basePath, filters, { dateFrom: weekAgoIso(), page: 1 }) },
		{ label: 'Trending', href: buildRepoListUrl(basePath, filters, { sort: 'stars', page: 1 }) },
		{ label: 'AI', href: buildRepoListUrl(basePath, filters, { q: 'ai', page: 1 }) },
		{
			label: 'Recently archived',
			href: buildRepoListUrl(basePath, filters, { feed: 'recently_archived', page: 1 })
		},
		{ label: 'Deleted', href: buildRepoListUrl(basePath, filters, { deletedOnly: true, page: 1 }) }
	]);

	function todayIso(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function weekAgoIso(): string {
		const d = new Date();
		d.setDate(d.getDate() - 7);
		return d.toISOString().slice(0, 10);
	}

	function onSubmit(e: Event) {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		void goto(
			buildRepoListUrl(basePath, filters, {
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
				page: 1
			}),
			{ keepFocus: true, noScroll: true }
		);
	}
</script>

<nav class="quick-filters" aria-label="Quick filters">
	{#each quickFilters as item}
		<a href={item.href} class="quick-filter">{item.label}</a>
	{/each}
</nav>

<form class="filters-form" onsubmit={onSubmit}>
	{#if showSearch}
		<input
			name="q"
			type="search"
			class="filter-input search-input"
			placeholder="Search repositories… (press /)"
			value={filters.q ?? ''}
		/>
	{/if}

	<select name="language" class="filter-select">
		<option value="">All languages</option>
		{#each languages as lang}
			<option value={lang} selected={filters.language === lang}>{lang}</option>
		{/each}
	</select>

	<input
		name="min_stars"
		type="number"
		class="filter-input filter-input-narrow"
		placeholder="Min ★"
		value={filters.minStars ?? ''}
		min="0"
	/>

	<label class="filter-check">
		<input type="checkbox" name="archived_only" checked={filters.archivedOnly} />
		Archived
	</label>

	<button type="submit" class="filter-btn">Apply</button>

	<details class="advanced" bind:open={advancedOpen}>
		<summary>Advanced filters</summary>
		<div class="advanced-body">
			<select name="sort" class="filter-select">
				<option value="">Sort: default</option>
				{#each sorts as sort}
					<option value={sort} selected={filters.sort === sort}>{sort.replaceAll('_', ' ')}</option>
				{/each}
			</select>
			{#if sources.length > 0}
				<select name="source" class="filter-select">
					<option value="">All sources</option>
					{#each sources as src}
						<option value={src} selected={filters.source === src}>{src}</option>
					{/each}
				</select>
			{:else}
				<select name="source" class="filter-select">
					<option value="">All sources</option>
					<option value="gharchive" selected={filters.source === 'gharchive'}>gharchive</option>
					<option value="github_search" selected={filters.source === 'github_search'}>github_search</option>
				</select>
			{/if}
			<input name="year" type="number" class="filter-input" placeholder="Year" value={filters.year ?? ''} min="2008" max="2099" />
			<input name="date_from" type="date" class="filter-input" value={filters.dateFrom ?? ''} />
			<input name="date_to" type="date" class="filter-input" value={filters.dateTo ?? ''} />
			<input name="min_forks" type="number" class="filter-input" placeholder="Min forks" value={filters.minForks ?? ''} min="0" />
			<label class="filter-check">
				<input type="checkbox" name="has_readme" checked={filters.hasReadme} />
				Has README
			</label>
			<label class="filter-check">
				<input type="checkbox" name="has_release" checked={filters.hasRelease} />
				Has release
			</label>
			<label class="filter-check">
				<input type="checkbox" name="deleted_only" checked={filters.deletedOnly} />
				Deleted only
			</label>
			<label class="filter-check">
				<input type="checkbox" name="never_enriched" checked={filters.neverEnriched} />
				Never enriched
			</label>
		</div>
	</details>

	<a href={basePath} class="filter-clear">Clear all</a>
</form>

<style>
	.quick-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin-bottom: 1rem;
	}

	.quick-filter {
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		font-size: 0.82rem;
		color: var(--text-muted);
		text-decoration: none;
	}

	.quick-filter:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-dim);
		text-decoration: none;
	}

	.filters-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.search-input {
		flex: 1 1 220px;
		min-width: 180px;
	}

	.filter-input-narrow {
		flex: 0 1 100px;
		width: 100px;
	}

	.advanced {
		flex: 1 1 100%;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		background: var(--bg-elevated);
	}

	.advanced summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--text-muted);
		font-weight: 500;
		user-select: none;
	}

	.advanced-body {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}
</style>
