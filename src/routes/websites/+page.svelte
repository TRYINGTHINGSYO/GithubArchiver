<script lang="ts">
	import WebsiteCard from '$lib/components/WebsiteCard.svelte';

	let { data } = $props();
	let density = $state<'compact' | 'comfortable' | 'detailed'>('comfortable');
</script>

<svelte:head>
	<title>Websites — GithubArchive+</title>
</svelte:head>

<section class="websites-page">
	<header class="page-header">
		<p class="eyebrow">First-class website discovery</p>
		<h1>Websites</h1>
		<p class="lede">
			Live domains from Certificate Transparency (and optional zone feeds), verified before they
			appear here. Rate, favorite, and jump to source repositories without auto-opening unknown
			sites.
		</p>
		<div class="toolbar">
			<p class="meta">{data.total.toLocaleString()} verified live</p>
			<a class="random" href="/websites/random">Random Website</a>
			<label>
				Sort
				<select
					value={data.sort}
					onchange={(event) => {
						const sort = (event.currentTarget as HTMLSelectElement).value;
						window.location.href = sort === 'recent' ? '/websites' : `/websites?sort=${sort}`;
					}}
				>
					<option value="recent">Recently verified</option>
					<option value="rated">Highest rated</option>
					<option value="favorites">Most favorited</option>
				</select>
			</label>
			<label>
				Density
				<select bind:value={density}>
					<option value="compact">Compact</option>
					<option value="comfortable">Comfortable</option>
					<option value="detailed">Detailed</option>
				</select>
			</label>
		</div>
	</header>

	{#if data.sites.length === 0}
		<p class="empty">
			No verified-live websites yet. Discovery runs in the background — check back soon.
		</p>
	{:else}
		<div class="website-grid">
			{#each data.sites as site (site.registrable_domain)}
				<WebsiteCard {site} {density} />
			{/each}
		</div>

		<nav class="pager" aria-label="Pagination">
			{#if data.page > 1}
				<a href={`/websites?page=${data.page - 1}`}>Newer</a>
			{/if}
			<span>Page {data.page}</span>
			{#if data.hasMore}
				<a href={`/websites?page=${data.page + 1}`}>Older</a>
			{/if}
		</nav>
	{/if}
</section>

<style>
	.websites-page {
		padding: 0.5rem 0 2rem;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0 0 0.35rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.8rem, 3vw, 2.4rem);
	}

	.lede {
		color: var(--text-muted);
		max-width: 46rem;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		margin: 1rem 0 1.25rem;
	}

	.meta {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.random {
		border-radius: 999px;
		padding: 0.4rem 0.8rem;
		background: color-mix(in srgb, var(--web-accent) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--web-accent) 40%, var(--border));
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
	}

	label {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		color: var(--text-muted);
		font-size: 0.85rem;
		margin-left: auto;
	}

	select {
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text);
		border-radius: 8px;
		padding: 0.3rem 0.45rem;
	}

	.empty {
		color: var(--text-muted);
	}

	.pager {
		display: flex;
		gap: 1rem;
		justify-content: center;
		margin-top: 1.5rem;
		color: var(--text-muted);
	}
</style>
