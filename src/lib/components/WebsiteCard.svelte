<script lang="ts">
	import { timeAgo } from '$lib/utils';
	import { websiteVisitHref } from '$lib/website-visit';
	import type { WebsiteCardModel } from '$lib/website-types';

	let {
		site,
		density = 'comfortable'
	}: {
		site: WebsiteCardModel;
		density?: 'compact' | 'comfortable' | 'detailed';
	} = $props();

	const detailHref = $derived(`/websites/${encodeURIComponent(site.registrable_domain)}`);
	const externalHref = $derived(websiteVisitHref(site));
</script>

<article class="website-card" class:compact={density === 'compact'} class:detailed={density === 'detailed'}>
	<header>
		<div class="identity">
			<h2>
				<a href={detailHref}>{site.page_title || site.registrable_domain}</a>
			</h2>
			{#if site.page_title}
				<a class="domain" href={detailHref}>{site.registrable_domain}</a>
			{/if}
		</div>
		<div class="signals" aria-label="Community signals">
			{#if site.rating_avg != null && (site.rating_count ?? 0) > 0}
				<span title={`${site.rating_count} ratings`}>
					<strong>{site.rating_avg.toFixed(1)}</strong> rating
				</span>
			{/if}
			{#if (site.favorite_count ?? 0) > 0}
				<span><strong>{site.favorite_count}</strong> saved</span>
			{/if}
		</div>
	</header>

	{#if site.summary && density !== 'compact'}
		<p class="summary">{site.summary}</p>
	{/if}

	<div class="meta">
		<span class="badge live">Verified live</span>
		{#if site.http_status}<span class="badge">HTTP {site.http_status}</span>{/if}
		{#if site.category}<span class="badge category">{site.category}</span>{/if}
		{#if density === 'detailed' && site.source_ct}<span class="badge">CT source</span>{/if}
		{#if density === 'detailed' && site.source_zone}<span class="badge">Zone source</span>{/if}
		<span class="when">{timeAgo(site.verified_at ?? site.first_seen_at)}</span>
	</div>

	<div class="actions">
		<a class="btn" href={detailHref}>View details</a>
		{#if externalHref}
			<a
				class="btn primary"
				href={externalHref}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Visit ${site.registrable_domain} in a new tab`}
			>Visit website</a>
		{:else}
			<span class="btn unavailable" aria-disabled="true">Visit unavailable</span>
		{/if}
	</div>
</article>

<style>
	.website-card {
		border: 1px solid var(--border);
		border-radius: 14px;
		background:
			linear-gradient(160deg, color-mix(in srgb, var(--web-accent) 8%, var(--bg-elevated)), var(--bg-elevated));
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		min-height: 100%;
		transition: border-color 120ms ease, transform 120ms ease;
	}

	.website-card:hover {
		border-color: color-mix(in srgb, var(--web-accent) 50%, var(--border));
		transform: translateY(-1px);
	}

	.website-card.compact {
		padding: 0.75rem 0.85rem;
		gap: 0.5rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: flex-start;
	}

	.identity {
		min-width: 0;
	}

	h2 {
		font-size: 1rem;
		line-height: 1.3;
		margin: 0;
	}

	h2 a {
		color: var(--text);
		text-decoration: none;
		word-break: break-word;
	}

	.domain {
		display: block;
		margin-top: 0.12rem;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--text-muted);
		text-decoration: none;
		word-break: break-all;
	}

	.signals {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.15rem;
		flex: 0 0 auto;
		font-size: 0.74rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.signals strong {
		color: var(--orange);
	}

	.summary {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.88rem;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}

	.badge {
		font-size: 0.68rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.12rem 0.45rem;
		color: var(--text-muted);
	}

	.badge.live {
		border-color: color-mix(in srgb, var(--green) 50%, var(--border));
		color: var(--green);
	}

	.badge.category {
		border-color: color-mix(in srgb, var(--web-accent) 38%, var(--border));
	}

	.when {
		margin-left: auto;
		font-size: 0.72rem;
		color: var(--text-muted);
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-top: auto;
		padding-top: 0.15rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.45rem;
		border: 1px solid var(--border);
		border-radius: 9px;
		padding: 0.42rem 0.6rem;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-muted);
		text-align: center;
		text-decoration: none;
	}

	.btn:hover {
		border-color: var(--border-strong);
		color: var(--text);
		text-decoration: none;
	}

	.btn.primary {
		background: color-mix(in srgb, var(--web-accent) 18%, transparent);
		border-color: color-mix(in srgb, var(--web-accent) 45%, var(--border));
		color: var(--text);
	}

	.btn.unavailable {
		cursor: not-allowed;
		opacity: 0.65;
	}

	@media (max-width: 520px) {
		header {
			flex-direction: column;
		}

		.signals {
			align-items: flex-start;
			flex-direction: row;
			flex-wrap: wrap;
		}

		.actions {
			grid-template-columns: 1fr;
		}

		.btn {
			min-height: 2.75rem;
		}
	}
</style>
