<script lang="ts">
	import DiscoveryRepoCard from '$lib/components/DiscoveryRepoCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Projects to Watch — GithubArchive+</title>
</svelte:head>

<section class="preset-page">
	<a class="back" href="/discover">Back to Discover</a>
	<h1>Projects to Watch</h1>
	<p>
		High-signal repositories from clusters growing at least 25%, with Interesting Score 55 or
		higher. Low-signal repositories, coursework, and templates are excluded by default.
	</p>
</section>

<div class="repo-grid">
	{#each data.repos as repo}
		<DiscoveryRepoCard {repo} />
	{:else}
		<p class="empty">No repositories meet the Projects to Watch thresholds yet.</p>
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
