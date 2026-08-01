<script lang="ts">
	import { page } from '$app/stores';

	let {
		trendingRepos = [] as Array<{ full_name: string; score?: number | null }>,
		trendingWebsites = [] as Array<{ domain: string; title?: string | null; rating?: number | null }>
	}: {
		trendingRepos?: Array<{ full_name: string; score?: number | null }>;
		trendingWebsites?: Array<{ domain: string; title?: string | null; rating?: number | null }>;
	} = $props();

	const path = $derived($page.url.pathname);
	const onWebsite = $derived(path.startsWith('/websites'));
</script>

<aside class="right-rail" aria-label="Intelligence">
	{#if onWebsite}
		<section>
			<h2>Trending websites</h2>
			{#if trendingWebsites.length === 0}
				<p class="empty">Ratings will surface leaders here.</p>
			{:else}
				<ul>
					{#each trendingWebsites as site}
						<li>
							<a href={`/websites/${encodeURIComponent(site.domain)}`}>{site.domain}</a>
							{#if site.rating != null}
								<span class="meta">{site.rating.toFixed(1)}★</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section>
			<h2>Why this matters</h2>
			<p class="blurb">
				Website discovery is a peer product: CT-verified domains, community ratings, and links
				back to source repositories.
			</p>
		</section>
	{:else}
		<section>
			<h2>Trending repositories</h2>
			{#if trendingRepos.length === 0}
				<p class="empty">Open Discover for live lanes.</p>
			{:else}
				<ul>
					{#each trendingRepos as repo}
						<li>
							<a href={`/repo/${repo.full_name}`}>{repo.full_name}</a>
							{#if repo.score != null}
								<span class="meta">{Math.round(repo.score)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section>
			<h2>Topic cloud</h2>
			<div class="topics">
				<a href="/search?q=AI">AI</a>
				<a href="/search?q=security">Security</a>
				<a href="/search?q=cli">CLI</a>
				<a href="/websites">Websites</a>
				<a href="/discover/emerging">Emerging</a>
				<a href="/search?q=self-hosted">Self-hosted</a>
			</div>
		</section>
	{/if}

	<section>
		<h2>Quick jumps</h2>
		<ul>
			<li><a href="/websites/random">Random website</a></li>
			<li><a href="/favorites">Favorites</a></li>
			<li><a href="/birth-feed">Birth feed</a></li>
			<li><a href="/discover">Discover</a></li>
		</ul>
	</section>
</aside>

<style>
	.right-rail {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 0.25rem 0 2rem;
	}

	section h2 {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-family: var(--font-display);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.86rem;
	}

	a {
		color: var(--text);
		text-decoration: none;
		word-break: break-all;
	}

	a:hover {
		color: var(--accent);
	}

	.meta,
	.empty,
	.blurb {
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	.topics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.topics a {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.2rem 0.55rem;
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.topics a:hover {
		border-color: var(--accent);
		color: var(--accent);
		text-decoration: none;
	}
</style>
