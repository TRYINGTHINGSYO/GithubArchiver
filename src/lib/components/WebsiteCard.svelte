<script lang="ts">
	import { timeAgo } from '$lib/utils';
	import type { WebsiteCardModel } from '$lib/website-types';

	let {
		site,
		density = 'comfortable'
	}: {
		site: WebsiteCardModel;
		density?: 'compact' | 'comfortable' | 'detailed';
	} = $props();

	const detailHref = $derived(`/websites/${encodeURIComponent(site.registrable_domain)}`);
	const externalHref = $derived(
		site.final_url && site.final_url.startsWith('http')
			? site.final_url
			: `https://${site.registrable_domain}/`
	);
</script>

<article class="website-card" class:compact={density === 'compact'} class:detailed={density === 'detailed'}>
	<header>
		<a class="domain" href={detailHref}>{site.registrable_domain}</a>
		{#if site.rating_avg != null && (site.rating_count ?? 0) > 0}
			<span class="rating" title={`${site.rating_count} ratings`}>
				{site.rating_avg.toFixed(1)}★
			</span>
		{/if}
	</header>

	{#if site.page_title}
		<p class="title">{site.page_title}</p>
	{/if}
	{#if site.summary && density !== 'compact'}
		<p class="summary">{site.summary}</p>
	{/if}

	<div class="meta">
		<span class="badge live">{site.verify_status}</span>
		{#if site.http_status}<span class="badge">{site.http_status}</span>{/if}
		{#if site.source_ct}<span class="badge">CT</span>{/if}
		{#if site.source_zone}<span class="badge">Zone</span>{/if}
		{#if site.category}<span class="badge">{site.category}</span>{/if}
		<span class="when">{timeAgo(site.verified_at ?? site.first_seen_at)}</span>
	</div>

	<div class="actions">
		<a class="btn" href={detailHref}>Details</a>
		<a class="btn primary" href={externalHref} target="_blank" rel="noopener noreferrer">Visit Website</a>
		<a class="btn" href="/websites/random">Next Random</a>
	</div>
</article>

<style>
	.website-card {
		border: 1px solid var(--border);
		border-radius: 14px;
		background:
			linear-gradient(160deg, color-mix(in srgb, var(--web-accent) 8%, var(--bg-elevated)), var(--bg-elevated));
		padding: 0.9rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 100%;
		transition: border-color 120ms ease, transform 120ms ease;
	}

	.website-card:hover {
		border-color: color-mix(in srgb, var(--web-accent) 50%, var(--border));
		transform: translateY(-1px);
	}

	.website-card.compact {
		padding: 0.65rem 0.8rem;
		gap: 0.3rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: baseline;
	}

	.domain {
		font-family: var(--font-display);
		font-weight: 650;
		color: var(--text);
		text-decoration: none;
		word-break: break-all;
	}

	.rating {
		color: var(--orange);
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}

	.title,
	.summary {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}

	.badge {
		font-size: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		color: var(--text-muted);
	}

	.badge.live {
		border-color: color-mix(in srgb, var(--green) 50%, var(--border));
		color: var(--green);
	}

	.when {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.25rem;
	}

	.btn {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.28rem 0.55rem;
		font-size: 0.8rem;
		color: var(--text-muted);
		text-decoration: none;
	}

	.btn:hover {
		color: var(--text);
		text-decoration: none;
	}

	.btn.primary {
		background: color-mix(in srgb, var(--web-accent) 18%, transparent);
		border-color: color-mix(in srgb, var(--web-accent) 45%, var(--border));
		color: var(--text);
	}
</style>
