<script lang="ts">
	let { data } = $props();

	function hrefFor(domain: string, finalUrl: string | null): string {
		return finalUrl && finalUrl.startsWith('http') ? finalUrl : `https://${domain}/`;
	}
</script>

<svelte:head>
	<title>Websites — GithubArchive+</title>
</svelte:head>

<section class="websites-page">
	<header class="page-header">
		<p class="eyebrow">Live web discovery</p>
		<h1>Websites</h1>
		<p class="lede">
			Newly seen domains from Certificate Transparency (and optional registration feeds),
			verified live — reverse-chronological, volume-first. Parked and dead hosts stay off this list.
		</p>
		<p class="meta">{data.total.toLocaleString()} verified live</p>
	</header>

	{#if data.sites.length === 0}
		<p class="empty">No verified-live websites yet. Discovery runs in the background — check back soon.</p>
	{:else}
		<ul class="site-list">
			{#each data.sites as site (site.registrable_domain)}
				<li class="site-item">
					<a
						class="site-link"
						href={hrefFor(site.registrable_domain, site.final_url)}
						target="_blank"
						rel="noopener noreferrer"
					>
						<span class="domain">{site.registrable_domain}</span>
						{#if site.page_title}
							<span class="title">{site.page_title}</span>
						{/if}
					</a>
					<div class="badges">
						{#if site.source_ct}
							<span class="badge">CT</span>
						{/if}
						{#if site.source_zone}
							<span class="badge">Zone</span>
						{/if}
						{#if site.http_status}
							<span class="badge muted">{site.http_status}</span>
						{/if}
					</div>
					<time datetime={site.verified_at ?? site.first_seen_at}>
						{site.verified_at ?? site.first_seen_at}
					</time>
				</li>
			{/each}
		</ul>

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
		padding: 1.5rem 0 3rem;
	}
	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.75rem;
		opacity: 0.7;
		margin: 0 0 0.35rem;
	}
	.page-header h1 {
		margin: 0 0 0.5rem;
		font-size: clamp(1.8rem, 3vw, 2.4rem);
	}
	.lede {
		max-width: 42rem;
		line-height: 1.45;
		opacity: 0.85;
	}
	.meta {
		font-size: 0.9rem;
		opacity: 0.65;
	}
	.empty {
		padding: 2rem 0;
		opacity: 0.75;
	}
	.site-list {
		list-style: none;
		padding: 0;
		margin: 1.5rem 0;
		display: grid;
		gap: 0.75rem;
	}
	.site-item {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.35rem 1rem;
		padding: 0.85rem 0;
		border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	}
	.site-link {
		grid-column: 1 / -1;
		text-decoration: none;
		color: inherit;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.site-link:hover .domain {
		text-decoration: underline;
	}
	.domain {
		font-weight: 650;
		font-size: 1.05rem;
	}
	.title {
		opacity: 0.75;
		font-size: 0.92rem;
	}
	.badges {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.badge {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.15rem 0.4rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
	}
	.badge.muted {
		opacity: 0.65;
	}
	time {
		font-size: 0.8rem;
		opacity: 0.55;
		justify-self: end;
	}
	.pager {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-top: 1.5rem;
	}
</style>
