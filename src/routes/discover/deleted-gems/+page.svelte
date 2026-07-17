<script lang="ts">
	import DiscoveryRepoCard from '$lib/components/DiscoveryRepoCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Deleted but preserved — GithubArchive+</title>
</svelte:head>

<section class="preset-page">
	<a class="back" href="/discover">Back to Discover</a>
	<h1>Deleted but preserved</h1>
	<p>
		Deleted repositories ranked by Interesting Score, preserved README/source evidence, stars and
		forks before deletion, cluster rarity, recoverability, and description quality.
	</p>
</section>

<div class="repo-grid">
	{#each data.repos as repo}
		<DiscoveryRepoCard {repo} />
	{:else}
		<p class="empty">No deleted repositories meet the quality threshold yet.</p>
	{/each}
</div>

<style>
	.preset-page {
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

	h1 {
		margin: 0.4rem 0;
	}

	p,
	.empty {
		color: var(--text-muted);
		line-height: 1.55;
	}

	.repo-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1rem;
	}
</style>
