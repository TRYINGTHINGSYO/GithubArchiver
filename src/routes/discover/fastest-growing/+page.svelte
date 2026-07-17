<script lang="ts">
	import DiscoveryRepoCard from '$lib/components/DiscoveryRepoCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Fastest-growing clusters — GithubArchive+</title>
</svelte:head>

<section class="preset-page">
	<a class="back" href="/discover">Back to Discover</a>
	<h1>Fastest-growing clusters</h1>
	<p>
		Clusters must have at least 20 repositories in the current period and at least 5 in the
		previous period. Tiny jumps are filtered out.
	</p>
</section>

<div class="cluster-list">
	{#each data.clusters as cluster}
		<section class="cluster-panel">
			<div class="cluster-head">
				<div>
					<h2>{cluster.name}</h2>
					<p>{cluster.description}</p>
				</div>
				<div class="growth">
					<strong>{Math.round(cluster.growthPercent)}%</strong>
					<span>growth</span>
				</div>
			</div>
			<div class="metrics">
				<span>{cluster.currentWeekCount.toLocaleString()} repos this week</span>
				<span>{cluster.previousWeekCount.toLocaleString()} previous week</span>
				<span>{cluster.avgInterestingScore ?? '—'} avg score</span>
				{#each cluster.topLanguages.slice(0, 4) as language}
					<span>{language.language}</span>
				{/each}
			</div>
			<p class="reason">{cluster.rankingReason}</p>
			<div class="repo-grid">
				{#each cluster.topRepos as repo}
					<DiscoveryRepoCard {repo} />
				{/each}
			</div>
		</section>
	{:else}
		<p class="empty">No clusters meet the growth guardrails yet.</p>
	{/each}
</div>

<style>
	.preset-page,
	.cluster-panel {
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--bg-elevated);
		padding: clamp(1rem, 3vw, 2rem);
		margin-bottom: 1rem;
	}

	.back {
		color: var(--accent);
		font-weight: 700;
		text-decoration: none;
	}

	h1,
	h2 {
		margin: 0.4rem 0;
	}

	p,
	.reason,
	.empty {
		color: var(--text-muted);
		line-height: 1.55;
	}

	.cluster-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1rem;
		align-items: start;
	}

	.growth {
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 0.7rem 0.9rem;
		text-align: center;
	}

	.growth strong {
		display: block;
		font-family: var(--font-mono);
		font-size: 1.5rem;
	}

	.growth span,
	.metrics span {
		color: var(--text-muted);
	}

	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1rem 0;
	}

	.metrics span {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.25rem 0.55rem;
		font-size: 0.8rem;
	}

	.repo-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}

	@media (max-width: 640px) {
		.cluster-head {
			grid-template-columns: 1fr;
		}

		.growth {
			width: fit-content;
		}
	}
</style>
