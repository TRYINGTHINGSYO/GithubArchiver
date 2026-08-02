<script lang="ts">
	import { formatCategoryLabel, formatSignalTierLabel } from '$lib/category-labels';
	import CollectionControls from '$lib/components/CollectionControls.svelte';
	import { repoDetailPath } from '$lib/repo-nav';
	import { formatStarDisplay } from '$lib/utils';

	export interface DiscoveryRepoCardData {
		id: number;
		owner: string;
		name: string;
		full_name: string;
		description: string | null;
		summary: string | null;
		category: string | null;
		language: string | null;
		stars: number | null;
		interesting_score: number | null;
		signal_tier: string | null;
		deleted_at: string | null;
		github_archived: boolean;
		clusters: { slug: string; name: string; confidence: number }[];
		storyPreview: string | null;
		preservationState: string;
		hasReadme: boolean;
		hasSource: boolean;
		rankScore: number;
		rankingReason: string;
	}

	let {
		repo,
		variant = 'default'
	}: { repo: DiscoveryRepoCardData; variant?: 'default' | 'featured' } = $props();

	const href = $derived(repoDetailPath(repo.owner, repo.name));
	const categoryLabel = $derived(formatCategoryLabel(repo.category));
	const signalLabel = $derived(formatSignalTierLabel(repo.signal_tier));
	const blurb = $derived(repo.summary || repo.description);
	const storyLine = $derived(repo.storyPreview?.split('. ').slice(0, 2).join('. '));
</script>

<article class="discovery-repo-card" class:featured={variant === 'featured'}>
	<a
		class="card-main-link"
		href={href}
		aria-label="Open intelligence for {repo.full_name}"
		data-sveltekit-preload-code="eager"
	></a>
	<div class="card-head">
		<div class="repo-copy">
			<span class="repo-name" title={repo.full_name}>{repo.full_name}</span>
			{#if blurb}<p class="description">{blurb}</p>{/if}
		</div>
		<div class="score-box">
			<span class="score">{repo.interesting_score ?? '—'}</span>
			<span>Interesting</span>
		</div>
	</div>

	<div class="facts">
		{#if categoryLabel}<span>{categoryLabel}</span>{/if}
		{#if signalLabel}<span>{signalLabel}</span>{/if}
		{#if repo.language}<span>{repo.language}</span>{/if}
		{#if repo.stars != null}<span>{formatStarDisplay(repo.stars)} stars</span>{/if}
		{#if repo.deleted_at}<span class="danger">Deleted</span>{/if}
		{#if repo.github_archived}<span>Archived upstream</span>{/if}
		<span>{repo.preservationState}</span>
	</div>

	<div class="save-controls">
		<CollectionControls repoId={repo.id} />
	</div>

	{#if repo.clusters.length > 0}
		<div class="clusters" aria-label="Cluster matches">
			{#each repo.clusters as cluster}
				<a href="/discover/fastest-growing?cluster={cluster.slug}" class="cluster-badge">
					{cluster.name}
					<span>{Math.round(cluster.confidence * 100)}%</span>
				</a>
			{/each}
		</div>
	{/if}

	{#if storyLine}
		<div class="story">
			<p class="story-label">Archive Story</p>
			<p>{storyLine}</p>
			<p class="story-label signal-label">Opportunity Signal</p>
			<p class="rank-reason">{repo.rankingReason}</p>
		</div>
	{:else}
		<div class="story">
			<p class="story-label">Opportunity Signal</p>
			<p class="rank-reason">{repo.rankingReason}</p>
		</div>
	{/if}
</article>

<style>
	.discovery-repo-card {
		position: relative;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		border-radius: 14px;
		padding: 1rem;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			transform 0.15s ease;
	}

	.discovery-repo-card.featured {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(250px, 0.65fr);
		column-gap: 1.25rem;
		padding: 1.15rem;
	}

	.discovery-repo-card:hover {
		background: var(--bg-hover);
		border-color: var(--border-strong);
		transform: translateY(-1px);
	}

	.discovery-repo-card:active {
		transform: translateY(0);
	}

	.card-main-link {
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: inherit;
	}

	.card-main-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.card-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1rem;
		align-items: start;
	}

	.repo-copy {
		min-width: 0;
	}

	.repo-name {
		display: block;
		color: var(--text);
		font-family: var(--font-mono);
		font-weight: 700;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.repo-name:hover {
		color: var(--accent);
	}

	.description,
	.rank-reason,
	.story p {
		color: var(--text-muted);
		line-height: 1.5;
		margin: 0.45rem 0 0;
	}

	.description {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
	}

	.score-box {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.45rem 0.6rem;
		text-align: center;
		min-width: 5rem;
		color: var(--text-muted);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.score {
		display: block;
		color: var(--text);
		font-size: 1.25rem;
		font-family: var(--font-mono);
		font-weight: 700;
		letter-spacing: 0;
	}

	.facts,
	.clusters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		align-content: flex-start;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.save-controls {
		margin-top: 0.65rem;
		position: relative;
		z-index: 2;
	}

	.facts span,
	.cluster-badge {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.25rem 0.55rem;
		color: var(--text-muted);
		font-size: 0.78rem;
		text-decoration: none;
	}

	.cluster-badge {
		position: relative;
		z-index: 2;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.cluster-badge span {
		margin-left: 0.3rem;
		color: var(--text-muted);
	}

	.danger {
		color: var(--red, #d14);
	}

	.story {
		margin-top: 0.85rem;
	}

	.story > p:not(.story-label) {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
	}

	.featured .card-head {
		grid-column: 1 / -1;
	}

	.featured .description {
		max-width: 52rem;
		-webkit-line-clamp: 2;
	}

	.featured .facts,
	.featured .save-controls,
	.featured .clusters {
		grid-column: 1;
		align-self: start;
	}

	.featured .story {
		grid-column: 2;
		grid-row: 2 / span 3;
		margin: 0;
		padding-left: 1.25rem;
		border-left: 1px solid var(--border);
	}

	.story-label {
		margin: 0;
		color: var(--text);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.story .rank-reason {
		margin-top: 0.35rem;
	}

	.signal-label {
		margin-top: 0.75rem;
	}

	@media (max-width: 720px) {
		.discovery-repo-card.featured {
			display: block;
		}

		.card-head {
			grid-template-columns: 1fr;
		}

		.score-box {
			width: fit-content;
		}

		.featured .story {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.discovery-repo-card,
		.discovery-repo-card:hover,
		.discovery-repo-card:active {
			transform: none;
		}
	}
</style>
