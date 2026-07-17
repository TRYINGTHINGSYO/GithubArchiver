<script lang="ts">
	import { formatCategoryLabel, formatSignalTierLabel } from '$lib/category-labels';
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

	let { repo }: { repo: DiscoveryRepoCardData } = $props();

	const href = $derived(repoDetailPath(repo.owner, repo.name));
	const categoryLabel = $derived(formatCategoryLabel(repo.category));
	const signalLabel = $derived(formatSignalTierLabel(repo.signal_tier));
	const blurb = $derived(repo.summary || repo.description);
	const storyLine = $derived(repo.storyPreview?.split('. ').slice(0, 2).join('. '));
</script>

<article class="discovery-repo-card">
	<div class="card-head">
		<div>
			<a class="repo-name" href={href}>{repo.full_name}</a>
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

	{#if repo.clusters.length > 0}
		<div class="clusters" aria-label="Cluster matches">
			{#each repo.clusters as cluster}
				<a href="/discover/projects-to-watch?cluster={cluster.slug}" class="cluster-badge">
					{cluster.name}
					<span>{Math.round(cluster.confidence * 100)}%</span>
				</a>
			{/each}
		</div>
	{/if}

	{#if storyLine}
		<details class="story">
			<summary>Why this is here</summary>
			<p>{storyLine}</p>
			<p class="rank-reason">{repo.rankingReason}</p>
		</details>
	{:else}
		<p class="rank-reason">{repo.rankingReason}</p>
	{/if}
</article>

<style>
	.discovery-repo-card {
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		border-radius: 14px;
		padding: 1rem;
	}

	.card-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1rem;
		align-items: start;
	}

	.repo-name {
		color: var(--text);
		font-family: var(--font-mono);
		font-weight: 700;
		text-decoration: none;
		overflow-wrap: anywhere;
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
		gap: 0.5rem;
		margin-top: 0.75rem;
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

	.story summary {
		cursor: pointer;
		color: var(--text);
		font-weight: 600;
	}

	@media (max-width: 640px) {
		.card-head {
			grid-template-columns: 1fr;
		}

		.score-box {
			width: fit-content;
		}
	}
</style>
