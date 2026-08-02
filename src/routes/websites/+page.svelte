<script lang="ts">
	import { navigating } from '$app/state';
	import WebsiteCard from '$lib/components/WebsiteCard.svelte';

	let { data } = $props();
	let density = $state<'compact' | 'comfortable' | 'detailed'>('comfortable');
	const isRefreshing = $derived(navigating.to?.url.pathname === '/websites');

	function pageHref(pageNumber: number): string {
		const params = new URLSearchParams();
		if (data.query) params.set('q', data.query);
		if (data.category) params.set('category', data.category);
		if (data.sort !== 'recent') params.set('sort', data.sort);
		if (pageNumber > 1) params.set('page', String(pageNumber));
		const query = params.toString();
		return query ? `/websites?${query}` : '/websites';
	}

	function submitSelect(event: Event) {
		(event.currentTarget as HTMLSelectElement).form?.requestSubmit();
	}
</script>

<svelte:head>
	<title>Websites — GithubArchive+</title>
</svelte:head>

<section class="websites-page" class:refreshing={isRefreshing} aria-busy={isRefreshing}>
	<header class="page-header">
		<div class="heading-row">
			<div>
				<p class="eyebrow">First-class website discovery</p>
				<h1>Find a website worth opening</h1>
			</div>
			<a class="random button-secondary" href="/websites/random">Surprise me</a>
		</div>
		<p class="lede">
			Browse verified live domains, compare community signals, and open the details safely before
			visiting an unfamiliar site.
		</p>

		<form class="discovery-controls" method="GET" aria-label="Filter websites">
			<label class="field search-field">
				<span>Search websites</span>
				<input
					type="search"
					name="q"
					value={data.query}
					placeholder="Domain, title, or description"
					autocomplete="off"
				/>
			</label>

			<label class="field">
				<span>Category</span>
				<select name="category" value={data.category} onchange={submitSelect}>
					<option value="">All categories</option>
					{#each data.categories as item}
						<option value={item.category}>{item.category} ({item.count})</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>Sort by</span>
				<select name="sort" value={data.sort} onchange={submitSelect}>
					<option value="recent">Recently verified</option>
					<option value="rated">Highest rated</option>
					<option value="favorites">Most favorited</option>
				</select>
			</label>

			<button class="button apply" type="submit" disabled={isRefreshing}>
				{isRefreshing ? 'Updating…' : 'Search'}
			</button>
			{#if data.query || data.category || data.sort !== 'recent'}
				<a class="clear" href="/websites">Clear</a>
			{/if}
		</form>
	</header>

	<div class="results-bar" role="status" aria-live="polite">
		<p>
			<strong>{data.total.toLocaleString()}</strong>
			{data.total === 1 ? 'website' : 'websites'}
			{#if data.total !== data.allTotal}
				<span>of {data.allTotal.toLocaleString()} verified live</span>
			{:else}
				<span>verified live</span>
			{/if}
		</p>
		<label class="density-field">
			<span>Card view</span>
			<select bind:value={density}>
				<option value="compact">Compact</option>
				<option value="comfortable">Comfortable</option>
				<option value="detailed">Detailed</option>
			</select>
		</label>
	</div>

	{#if data.sites.length === 0}
		<div class="empty">
			{#if data.allTotal === 0}
				<h2>Website discovery is warming up</h2>
				<p>Verified sites will appear here as the background discovery pipeline confirms them.</p>
				<a class="button-secondary" href="/discover">Explore repositories</a>
			{:else}
				<h2>No websites match those filters</h2>
				<p>Try a shorter search, another category, or return to the complete verified list.</p>
				<a class="button-secondary" href="/websites">Show all websites</a>
			{/if}
		</div>
	{:else}
		<div class="website-grid">
			{#each data.sites as site (site.registrable_domain)}
				<WebsiteCard {site} {density} />
			{/each}
		</div>

		<nav class="pager" aria-label="Website pages">
			{#if data.page > 1}
				<a class="button-secondary" href={pageHref(data.page - 1)}>Newer</a>
			{/if}
			<span>Page {data.page}</span>
			{#if data.hasMore}
				<a class="button-secondary" href={pageHref(data.page + 1)}>Older</a>
			{/if}
		</nav>
	{/if}
</section>

<style>
	.websites-page {
		padding: 0.5rem 0 2rem;
	}

	.page-header {
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: clamp(1rem, 3vw, 1.5rem);
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--web-accent) 11%, transparent), transparent 58%),
			var(--bg-elevated);
		box-shadow: var(--shadow-soft);
	}

	.heading-row,
	.results-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.75rem;
		color: var(--web-accent);
		margin: 0 0 0.35rem;
		font-weight: 800;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.8rem, 4vw, 2.65rem);
		line-height: 1.08;
	}

	.lede {
		color: var(--text-muted);
		max-width: 50rem;
		margin: 0.75rem 0 1.1rem;
	}

	.random {
		flex: 0 0 auto;
		border-color: color-mix(in srgb, var(--web-accent) 45%, var(--border));
	}

	.discovery-controls {
		display: grid;
		grid-template-columns: minmax(13rem, 2fr) minmax(10rem, 1fr) minmax(10rem, 1fr) auto auto;
		gap: 0.75rem;
		align-items: end;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.field,
	.density-field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
		color: var(--text-muted);
		font-size: 0.76rem;
		font-weight: 750;
	}

	input,
	select {
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		border: 1px solid var(--border-strong);
		background: var(--bg-subtle);
		color: var(--text);
		border-radius: 10px;
		padding: 0.55rem 0.7rem;
		font: inherit;
		font-weight: 500;
	}

	.apply {
		min-height: 2.75rem;
		cursor: pointer;
	}

	.apply:disabled {
		cursor: wait;
		opacity: 0.7;
	}

	.clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0 0.3rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.results-bar {
		min-height: 4.25rem;
	}

	.results-bar p {
		margin: 0;
		color: var(--text);
	}

	.results-bar p span {
		color: var(--text-muted);
	}

	.density-field {
		flex-direction: row;
		align-items: center;
		white-space: nowrap;
	}

	.density-field select {
		min-height: 2.4rem;
		width: auto;
	}

	.empty {
		text-align: center;
		padding: clamp(2rem, 8vw, 4rem) 1.25rem;
		border: 1px dashed var(--border-strong);
		border-radius: 16px;
		background: var(--bg-elevated);
		color: var(--text-muted);
	}

	.empty h2 {
		margin: 0;
		color: var(--text);
	}

	.empty p {
		margin: 0.5rem auto 1.25rem;
		max-width: 32rem;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 1rem;
		justify-content: center;
		margin-top: 1.5rem;
		color: var(--text-muted);
	}

	.refreshing .website-grid {
		opacity: 0.55;
		transition: opacity 120ms ease;
	}

	@media (max-width: 820px) {
		.discovery-controls {
			grid-template-columns: 1fr 1fr;
		}

		.search-field {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 620px) {
		.websites-page {
			padding-top: 0;
		}

		.page-header {
			border-radius: 14px;
			padding: 1rem;
		}

		.heading-row {
			align-items: flex-start;
			flex-direction: column;
		}

		.random {
			width: 100%;
		}

		.discovery-controls {
			grid-template-columns: 1fr;
		}

		.search-field {
			grid-column: auto;
		}

		.clear {
			min-height: 2.25rem;
		}

		.results-bar {
			align-items: flex-start;
			flex-direction: column;
			padding: 0.85rem 0;
			gap: 0.65rem;
		}

		.density-field {
			width: 100%;
			justify-content: space-between;
		}

		.density-field select {
			width: min(11rem, 60%);
		}

		.pager {
			justify-content: space-between;
		}
	}
</style>
