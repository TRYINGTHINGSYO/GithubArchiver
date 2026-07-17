<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function growthLabel(current: number, previous: number, suppressedReason: string | null): string {
		if (suppressedReason) return 'growth unavailable (windows not comparable)';
		if (previous === 0) return current > 0 ? 'new this period' : 'no growth';
		return `${Math.round(((current - previous) / previous) * 100)}% growth`;
	}
</script>

<svelte:head>
	<title>Emerging topics — GithubArchive+</title>
</svelte:head>

<section class="preset-page">
	<a class="back" href="/discover">Back to Discover</a>
	<h1>Emerging topics</h1>
	<p>
		Deterministic trend mining across GitHub topics, repository-name tokens, and description
		phrases. Candidates require at least 10 repositories, 3 normal/high-signal repositories, and
		5 distinct owners.
	</p>
	<p class="hint">Run <code>npm run detect:emerging</code> to refresh these results.</p>
</section>

{#if data.provenance?.comparisonMode === 'matched-hours'}
	<section class="comparison-note" aria-label="Detection comparison methodology">
		<strong>{data.provenance.comparisonLabel}</strong>
		<p>
			Based on the same UTC hour offsets across all seven days in consecutive weeks. This is
			not a full-week estimate.
		</p>
	</section>
{/if}

{#if !data.readiness.emergingDetectionReady}
	<section class="readiness" aria-live="polite">
		<h2>Emerging-topic detection is not yet statistically ready</h2>
		<p>
			{data.readiness.currentWindowEnrichedRepos.toLocaleString()} repositories are enriched,
			while 250 are required for the selected period
			({data.readiness.windowStart.slice(0, 10)} → {data.readiness.windowEnd.slice(0, 10)}).
		</p>
		<ul>
			{#each data.readiness.readinessReasons as reason}
				<li>{reason}</li>
			{/each}
		</ul>
		<p class="hint">
			Backlog: {data.readiness.enrichmentBacklog.toLocaleString()} ·
			Auth: {data.readiness.hasGitHubAuth ? 'token configured' : 'no token'} ·
			Check <code>npm run status:enrichment</code>
		</p>
	</section>
{/if}

<div class="topic-grid">
	{#each data.topics as topic}
		<a class="topic-card" href="/discover/emerging/{topic.key}">
			<div class="topic-head">
				<div>
					<span class="type">{topic.candidate_type}</span>
					<h2>{topic.label}</h2>
				</div>
				<span class="status">{topic.status}</span>
			</div>
			<div class="metrics">
				<span><strong>{topic.current_count.toLocaleString()}</strong> this period</span>
				<span><strong>{topic.previous_count.toLocaleString()}</strong> previous</span>
				<span><strong>{topic.distinct_owner_count.toLocaleString()}</strong> owners</span>
				<span><strong>{topic.average_interesting_score ?? '—'}</strong> avg score</span>
				<span><strong>{Math.round(topic.emerging_score)}</strong> emerging score</span>
			</div>
			<p>
				{#if data.provenance?.comparisonMode === 'matched-hours' && topic.prevalence_lift_percent != null}
					{topic.prevalence_lift_percent}% prevalence lift
				{:else}
					{growthLabel(topic.current_count, topic.previous_count, topic.growth_suppressed_reason)}
				{/if}
				from a {topic.candidate_type} candidate.
			</p>
		</a>
	{:else}
		<p class="empty">
			{#if data.readiness.emergingDetectionReady}
				No emerging topics have been detected yet for this period.
			{:else}
				No emerging topics yet — enrich more recent repositories first.
			{/if}
		</p>
	{/each}
</div>

<style>
	.preset-page,
	.topic-card,
	.readiness,
	.comparison-note {
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--bg-elevated);
		padding: clamp(1rem, 3vw, 2rem);
		margin-bottom: 1rem;
	}

	.readiness {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
	}

	.comparison-note {
		border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
	}

	.comparison-note p {
		margin-bottom: 0;
	}

	.back,
	.topic-card {
		color: inherit;
		text-decoration: none;
	}

	.back {
		color: var(--accent);
		font-weight: 700;
	}

	h1,
	h2 {
		margin: 0.4rem 0;
	}

	p,
	.empty,
	.hint,
	li {
		color: var(--text-muted);
		line-height: 1.55;
	}

	code {
		font-family: var(--font-mono);
		color: var(--text);
	}

	.topic-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1rem;
	}

	.topic-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.type,
	.status,
	.metrics span {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.25rem 0.55rem;
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.type {
		color: var(--accent);
	}

	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1rem 0;
	}
</style>
