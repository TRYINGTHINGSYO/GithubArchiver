<script lang="ts">
	import RepoListItem from '$lib/components/RepoListItem.svelte';
	import { buildRepoPageTsv } from '$lib/tsv-export';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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
		if (f.category) params.set('category', String(f.category));
		if (f.signalTier) params.set('signal_tier', String(f.signalTier));
		if (f.minInterestingScore) params.set('min_interesting_score', String(f.minInterestingScore));
		if (f.cluster) params.set('cluster', String(f.cluster));
		if (f.clusters) params.set('clusters', String(f.clusters));
		if (f.clusterMatch) params.set('cluster_match', String(f.clusterMatch));
		if (f.minClusterConfidence) {
			params.set('min_cluster_confidence', String(f.minClusterConfidence));
		}
		if (f.mode && f.mode !== 'keyword') params.set('mode', String(f.mode));
		if (f.neverEnriched) params.set('never_enriched', '1');
		if (f.archivedOnly) params.set('archived_only', '1');
		if (f.hasReadme) params.set('has_readme', '1');
		if (f.hasRelease) params.set('has_release', '1');
		if (f.deletedOnly) params.set('deleted_only', '1');
		if (f.perPage && Number(f.perPage) !== 50) params.set('per_page', String(f.perPage));
		if (f.page && Number(f.page) > 1) params.set('page', String(f.page));

		const qs = params.toString();
		return qs ? `/search?${qs}` : '/search';
	}

	function downloadCurrentPage() {
		const blob = new Blob([buildRepoPageTsv(data.repos)], { type: 'text/tab-separated-values' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `githubarchive-search-page-${data.page}-repos.tsv`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head>
	<title>Search repositories - GithubArchive+</title>
	<meta
		name="description"
		content="Search the GithubArchive+ repository corpus by name, language, stars, category, cluster, and archive evidence."
	/>
</svelte:head>

<section class="search-hero" aria-labelledby="search-title">
	<p class="eyebrow">Repository search</p>
	<h1 id="search-title">Search the indexed corpus</h1>
	<p>
		Use this when you need exact repositories, filters, page-size control, and a downloadable list
		of the visible results. The discovery homepage stays focused on what is worth exploring first.
	</p>
</section>

<form class="search-filters" method="get" action="/search">
	<label>
		<span>Search</span>
		<input
			name="q"
			type="search"
			value={data.filters.q}
			placeholder="owner, name, topic, phrase, or meaning"
		/>
	</label>

	{#if data.semanticEnabled}
		<label>
			<span>Mode</span>
			<select name="mode">
				<option value="keyword" selected={data.filters.mode === 'keyword' || !data.filters.mode}
					>Keyword</option
				>
				<option value="hybrid" selected={data.filters.mode === 'hybrid'}>Hybrid</option>
				<option value="semantic" selected={data.filters.mode === 'semantic'}>Semantic</option>
			</select>
		</label>
	{/if}

	<label>
		<span>Sort</span>
		<select name="sort">
			{#each data.sorts as sort}
				<option value={sort} selected={data.filters.sort === sort}>{sort.replaceAll('_', ' ')}</option>
			{/each}
		</select>
	</label>

	<label>
		<span>Per page</span>
		<select name="per_page">
			{#each pageSizes as size}
				<option value={size} selected={data.perPage === size}>{size}</option>
			{/each}
		</select>
	</label>

	<label>
		<span>Language</span>
		<select name="language">
			<option value="">All languages</option>
			{#each data.languages as language}
				<option value={language} selected={data.filters.language === language}>{language}</option>
			{/each}
		</select>
	</label>

	<label>
		<span>Min stars</span>
		<input name="min_stars" type="number" min="0" value={data.filters.minStars} />
	</label>

	<label>
		<span>Category</span>
		<input name="category" value={data.filters.category} placeholder="ai-tooling" />
	</label>

	<label>
		<span>Cluster</span>
		<input name="cluster" value={data.filters.cluster} placeholder="agentic-ai" />
	</label>

	<label>
		<span>Signal tier</span>
		<select name="signal_tier">
			<option value="">Any signal</option>
			<option value="high" selected={data.filters.signalTier === 'high'}>High</option>
			<option value="normal" selected={data.filters.signalTier === 'normal'}>Normal</option>
			<option value="low" selected={data.filters.signalTier === 'low'}>Low</option>
		</select>
	</label>

	<div class="checks">
		<label><input type="checkbox" name="has_release" checked={data.filters.hasRelease} /> Has release</label>
		<label><input type="checkbox" name="has_readme" checked={data.filters.hasReadme} /> README saved</label>
		<label><input type="checkbox" name="deleted_only" checked={data.filters.deletedOnly} /> Deleted only</label>
		<label><input type="checkbox" name="never_enriched" checked={data.filters.neverEnriched} /> Details pending</label>
	</div>

	<div class="form-actions">
		<button type="submit" class="btn primary">Apply filters</button>
		<a class="btn" href="/search">Clear</a>
	</div>
</form>

<section class="results-shell" aria-labelledby="results-title">
	<div class="results-head">
		<div>
			<p class="eyebrow">Results</p>
			<h2 id="results-title">{data.total.toLocaleString()} repositories</h2>
			<p>
				Page {data.page.toLocaleString()} of {data.totalPages.toLocaleString()} showing
				{data.repos.length.toLocaleString()} results.
			</p>
		</div>
		<button type="button" class="btn" onclick={downloadCurrentPage} disabled={data.repos.length === 0}>
			Download current page
		</button>
	</div>

	{#if data.repos.length === 0}
		<div class="empty-state">
			<p>No repositories match your filters.</p>
			<p>Try clearing filters or lowering the star threshold.</p>
		</div>
	{:else}
		<ul class="repo-list" data-sveltekit-preload-data="off">
			{#each data.repos as repo}
				<RepoListItem {repo} isAdmin={data.isAdmin} />
			{/each}
		</ul>

		<nav class="pagination" aria-label="Repository results pages">
			{#if data.page > 1}
				<a href={buildUrl({ page: data.page - 1 })}>Previous</a>
			{:else}
				<span class="disabled">Previous</span>
			{/if}
			<span class="page-info">{data.total.toLocaleString()} repos</span>
			{#if data.page < data.totalPages}
				<a href={buildUrl({ page: data.page + 1 })}>Next</a>
			{:else}
				<span class="disabled">Next</span>
			{/if}
		</nav>
	{/if}
</section>

<style>
	.search-hero,
	.search-filters,
	.results-shell {
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--bg-elevated);
		padding: clamp(1rem, 3vw, 1.5rem);
		margin-bottom: 1rem;
	}

	.search-hero h1,
	.results-head h2 {
		margin: 0;
	}

	.search-hero p,
	.results-head p,
	.empty-state p {
		color: var(--text-muted);
		line-height: 1.6;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.search-filters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.85rem;
		align-items: end;
	}

	.search-filters label {
		display: grid;
		gap: 0.35rem;
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 700;
	}

	.search-filters input,
	.search-filters select {
		width: 100%;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg);
		color: var(--text);
		padding: 0.7rem 0.8rem;
		font: inherit;
	}

	.checks {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.checks label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.35rem 0.65rem;
		background: var(--bg);
	}

	.form-actions,
	.results-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	.form-actions {
		grid-column: 1 / -1;
	}

	.results-head {
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.7rem 1rem;
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}

	.btn:hover {
		border-color: var(--accent);
		text-decoration: none;
	}

	.btn.primary {
		background: color-mix(in srgb, var(--accent) 20%, var(--bg));
		border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	@media (max-width: 700px) {
		.search-filters,
		.results-head {
			display: grid;
			grid-template-columns: 1fr;
		}

		.form-actions .btn,
		.results-head .btn {
			width: 100%;
		}
	}
</style>
