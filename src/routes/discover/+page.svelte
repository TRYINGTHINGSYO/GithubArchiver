<script lang="ts">
	import DiscoveryRepoCard from '$lib/components/DiscoveryRepoCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const nav = [
		{ href: '/discover/emerging', label: 'Emerging topics' },
		{ href: '/discover/fastest-growing', label: 'Fastest-growing clusters' },
		{ href: '/discover/projects-to-watch', label: 'Projects to Watch' },
		{ href: '/discover/deleted-gems', label: 'Deleted but preserved' }
	];
</script>

<svelte:head>
	<title>Discover — GithubArchive+</title>
</svelte:head>

<section class="discover-hero">
	<p class="eyebrow">Discovery engine</p>
	<h1>What GitHub is building now</h1>
	<p>
		Explore growth patterns, high-signal repositories, and deleted projects with preserved evidence.
		Every ranking is backed by cluster analytics, Interesting Scores, and Archive Story facts.
	</p>
	<nav class="preset-nav" aria-label="Discovery presets">
		{#each nav as item}
			<a href={item.href}>{item.label}</a>
		{/each}
	</nav>
</section>

<section class="section-block">
	<div class="section-head">
		<div>
			<p class="eyebrow">Automatic detection</p>
			<h2>Emerging topics</h2>
		</div>
		<a href="/discover/emerging">Review candidates</a>
	</div>
	<div class="cluster-grid">
		{#each data.discovery.emergingTopics as topic}
			<article class="cluster-card">
				<a class="cluster-title" href="/discover/emerging/{topic.key}">{topic.label}</a>
				<p>
					{topic.current_count.toLocaleString()} repos this period from
					{topic.distinct_owner_count.toLocaleString()} owners.
				</p>
				<div class="metric-row">
					<span><strong>{Math.round(topic.emerging_score)}</strong> emerging score</span>
					<span><strong>{topic.previous_count.toLocaleString()}</strong> previous</span>
					<span><strong>{topic.average_interesting_score ?? '—'}</strong> avg score</span>
				</div>
				<div class="chips">
					<span>{topic.candidate_type}</span>
					<span>{topic.status}</span>
				</div>
			</article>
		{:else}
			<p class="empty">No emerging-topic candidates yet. Run <code>npm run detect:emerging</code>.</p>
		{/each}
	</div>
</section>

<section class="section-block">
	<div class="section-head">
		<div>
			<p class="eyebrow">Clusters</p>
			<h2>Fastest-growing clusters</h2>
		</div>
		<a href="/discover/fastest-growing">View all</a>
	</div>
	<div class="cluster-grid">
		{#each data.discovery.fastestGrowing as cluster}
			<article class="cluster-card">
				<a class="cluster-title" href="/discover/fastest-growing?cluster={cluster.slug}">{cluster.name}</a>
				<p>{cluster.description}</p>
				<div class="metric-row">
					<span><strong>{cluster.currentWeekCount.toLocaleString()}</strong> this week</span>
					<span><strong>{Math.round(cluster.growthPercent)}%</strong> growth</span>
					<span><strong>{cluster.avgInterestingScore ?? '—'}</strong> avg score</span>
				</div>
				{#if cluster.topLanguages.length}
					<div class="chips">
						{#each cluster.topLanguages.slice(0, 4) as language}
							<span>{language.language}</span>
						{/each}
					</div>
				{/if}
			</article>
		{:else}
			<p class="empty">No clusters meet the growth guardrails yet.</p>
		{/each}
	</div>
</section>

<section class="section-block">
	<div class="section-head">
		<div>
			<p class="eyebrow">Quality plus momentum</p>
			<h2>Projects to Watch</h2>
		</div>
		<a href="/discover/projects-to-watch">View all</a>
	</div>
	<div class="repo-grid">
		{#each data.discovery.projectsToWatch as repo}
			<DiscoveryRepoCard {repo} />
		{:else}
			<p class="empty">No repositories meet the Projects to Watch thresholds yet.</p>
		{/each}
	</div>
</section>

<section class="section-block">
	<div class="section-head">
		<div>
			<p class="eyebrow">Preservation</p>
			<h2>Deleted but preserved</h2>
		</div>
		<a href="/discover/deleted-gems">View all</a>
	</div>
	<div class="repo-grid">
		{#each data.discovery.deletedGems as repo}
			<DiscoveryRepoCard repo={repo} />
		{:else}
			<p class="empty">No deleted repositories meet the quality threshold yet.</p>
		{/each}
	</div>
</section>

<section class="section-block" id="unusual">
	<div class="section-head">
		<div>
			<p class="eyebrow">Unusual finds</p>
			<h2>High-score repos with incomplete signals</h2>
		</div>
	</div>
	<div class="repo-grid">
		{#each data.discovery.unusualFinds as repo}
			<DiscoveryRepoCard {repo} />
		{:else}
			<p class="empty">No unusual finds yet.</p>
		{/each}
	</div>
</section>

<section class="section-block" id="clusters">
	<div class="section-head">
		<div>
			<p class="eyebrow">Browse</p>
			<h2>All clusters</h2>
		</div>
		<a href="/api/clusters">API</a>
	</div>
	<div class="browse-grid">
		{#each data.discovery.clusters as cluster}
			<a href="/discover/projects-to-watch?cluster={cluster.slug}">
				<strong>{cluster.name}</strong>
				<span>{cluster.repo_count.toLocaleString()} repos</span>
			</a>
		{/each}
	</div>
</section>

<style>
	.discover-hero,
	.section-block {
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--bg-elevated);
		padding: clamp(1rem, 3vw, 2rem);
		margin-bottom: 1rem;
	}

	.discover-hero h1,
	.section-head h2 {
		margin: 0;
	}

	.discover-hero p {
		max-width: 52rem;
		color: var(--text-muted);
		line-height: 1.6;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.preset-nav,
	.chips,
	.metric-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.preset-nav a,
	.section-head a,
	.browse-grid a {
		color: inherit;
		text-decoration: none;
	}

	.preset-nav a {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.55rem 0.8rem;
		background: var(--bg);
	}

	.section-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: end;
		margin-bottom: 1rem;
	}

	.section-head a {
		color: var(--accent);
		font-weight: 600;
	}

	.cluster-grid,
	.repo-grid,
	.browse-grid {
		display: grid;
		gap: 1rem;
	}

	.cluster-grid {
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	}

	.repo-grid {
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	}

	.browse-grid {
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	}

	.cluster-card,
	.browse-grid a {
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 1rem;
		background: var(--bg);
	}

	.cluster-title {
		color: var(--text);
		font-weight: 800;
		text-decoration: none;
	}

	.cluster-card p {
		color: var(--text-muted);
		line-height: 1.5;
	}

	.metric-row span,
	.chips span {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.25rem 0.55rem;
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.browse-grid a {
		display: grid;
		gap: 0.25rem;
	}

	.browse-grid span,
	.empty {
		color: var(--text-muted);
	}
</style>
