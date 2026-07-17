<script lang="ts">
	import DiscoveryRepoCard from '$lib/components/DiscoveryRepoCard.svelte';
	import RepoListItem from '$lib/components/RepoListItem.svelte';
	import { timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const enrich = $derived(data.enrichmentProgress);
	const enrichPercent = $derived.by(() => {
		const total = enrich.enrichedTotal + enrich.remaining;
		if (total <= 0) return 100;
		return Math.round((enrich.enrichedTotal / total) * 1000) / 10;
	});
	const enrichPercentLabel = $derived(
		Number.isInteger(enrichPercent) ? String(enrichPercent) : enrichPercent.toFixed(1)
	);

	const browseLinks = [
		{ href: '/discover', label: 'All discoveries', why: 'Landing for every intelligence lane' },
		{ href: '/discover#clusters', label: 'All clusters', why: 'Browse thematic repository groups' },
		{ href: '/?sort=interesting_score', label: 'Categories & scores', why: 'Open scored repository search' },
		{ href: '/discover/emerging', label: 'Emerging topics', why: 'Matched-hour trend candidates' },
		{ href: '/discover/projects-to-watch', label: 'Projects to watch', why: 'Quality plus cluster momentum' },
		{ href: '/discover#unusual', label: 'Unusual finds', why: 'High score, incomplete signals' },
		{ href: '/discover/deleted-gems', label: 'Deleted projects', why: 'Preservation and recoverability' },
		{ href: '/#repository-search', label: 'Full repository search', why: 'Query the indexed corpus' }
	];

	const snapshotMetrics = $derived([
		{ label: 'Indexed', value: data.snapshot.indexed, detail: 'Repositories in the archive index' },
		{
			label: 'Analyzed coverage',
			value: `${data.snapshot.enriched.toLocaleString()} / ${data.snapshot.indexed.toLocaleString()}`,
			detail: `${data.snapshot.analyzedCoveragePercent}% enriched — not all indexed repos are fully analyzed`
		},
		{ label: 'Classified', value: data.snapshot.classified, detail: 'Category assignment applied' },
		{ label: 'Clustered', value: data.snapshot.clustered, detail: 'Assigned to thematic clusters' },
		{
			label: 'Archive Stories',
			value: data.snapshot.stories,
			detail: 'Evidence-backed narratives generated'
		},
		{
			label: 'Active clusters',
			value: data.snapshot.activeClusters,
			detail: 'Curated clusters with at least one repository'
		}
	]);

	const featuredRepo = $derived(data.featuredRepo);
	const scoredSignalCount = $derived(data.snapshot.highSignal);
	const emergingActiveCount = $derived(data.snapshot.emergingActive);

	const comparisonKind = $derived.by(() => {
		if (!data.provenance) return 'unknown' as const;
		if (data.provenance.comparisonMode === 'matched-hours') return 'matched-hours' as const;
		if (data.provenance.comparisonMode === 'absolute') return 'absolute' as const;
		if (data.provenance.growthSuppressedReason) return 'suppressed' as const;
		return 'other' as const;
	});

	const emergingIsValidatedZero = $derived(
		data.discovery.emergingTopics.length === 0 && data.provenance != null
	);
</script>

<svelte:head>
	<title>GithubArchive+ — Repository intelligence</title>
	<meta
		name="description"
		content="Classify, cluster, score, and contextualize GitHub repositories with evidence-backed discovery."
	/>
</svelte:head>

<section class="hero" aria-labelledby="hero-heading">
	<div class="hero-copy">
		<p class="eyebrow">GithubArchive+</p>
		<h1 id="hero-heading">Understand what GitHub is building—not just what was uploaded.</h1>
		<p class="hero-lede">
			GithubArchive+ classifies repositories, groups them into clusters, scores interestingness,
			writes Archive Stories from evidence, and surfaces emerging themes with provenance—not raw
			upload counters.
		</p>
		<div class="hero-actions">
			<a class="btn primary" href="/discover">Explore discoveries</a>
			<a class="btn" href="/discover/emerging">Browse emerging topics</a>
			<a class="btn" href="/#repository-search">Search repositories</a>
		</div>
	</div>
	{#if featuredRepo}
		<aside class="hero-preview" aria-label="Repository intelligence preview">
			<p class="eyebrow">Live intelligence</p>
			<p class="preview-caption">
				A real repository already classified, scored, and explained — not a marketing mock.
			</p>
			<DiscoveryRepoCard repo={featuredRepo} />
		</aside>
	{/if}
</section>

{#if data.searching}
	<section class="section-block" aria-labelledby="results-heading" id="repository-feed">
		<div class="section-head">
			<div>
				<p class="eyebrow">Search results</p>
				<h2 id="results-heading">{data.total.toLocaleString()} repositories</h2>
				<p class="section-why">
					Secondary corpus search. Intelligence lanes stay below for context.
				</p>
			</div>
			<a href="/">Back to intelligence home</a>
		</div>
		{#if data.repos.length > 0}
			<ul class="search-results">
				{#each data.repos as repo}
					<li><RepoListItem {repo} isAdmin={data.isAdmin} /></li>
				{/each}
			</ul>
			{#if data.totalPages > 1}
				<p class="evidence">
					Page {data.page} of {data.totalPages}. Refine with
					<a href="/#repository-search">search</a> or open the
					<a href="/birth-feed">Birth Feed</a>.
				</p>
			{/if}
		{:else}
			<p class="empty">No repositories matched this query.</p>
		{/if}
	</section>
{/if}

<section class="section-block snapshot" aria-labelledby="snapshot-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Intelligence snapshot</p>
			<h2 id="snapshot-heading">What the system already knows</h2>
			<p class="section-why">
				These counts measure understanding coverage—not GitHub’s star charts or zero-value
				artifact counters when storage is disabled.
			</p>
		</div>
	</div>
	<div class="metric-grid">
		{#each snapshotMetrics as metric}
			<article class="metric-tile">
				<span class="metric-value">
					{typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
				</span>
				<span class="metric-label">{metric.label}</span>
				<span class="metric-detail">{metric.detail}</span>
			</article>
		{/each}
	</div>
	{#if data.archivePulse.metadataOnly}
		<p class="preservation-note">
			Repository understanding is active. Full source preservation is currently disabled.
			<a href="/admin/storage">System health</a>
		</p>
	{/if}
</section>

<section class="section-block enrich-progress" aria-labelledby="enrich-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Live enrichment</p>
			<h2 id="enrich-heading">Voting repositories into the archive</h2>
			<p class="section-why">
				High-value repositories are enriched first (urgent/high tiers). Discovery continues while the
				long-tail archive is processed progressively — a large backlog does not pause ingestion.
			</p>
		</div>
	</div>
	<div class="enrich-panel">
		<div class="enrich-counts">
			<div>
				<span class="metric-value">{enrich.enrichedTotal.toLocaleString()}</span>
				<span class="metric-label">Enriched</span>
			</div>
			<div>
				<span class="metric-value">{enrich.remaining.toLocaleString()}</span>
				<span class="metric-label">Waiting</span>
			</div>
			<div>
				<span class="metric-value">{enrich.completed.toLocaleString()}</span>
				<span class="metric-label">This run</span>
			</div>
			<div>
				<span class="metric-value">{enrichPercentLabel}%</span>
				<span class="metric-label">Coverage</span>
			</div>
		</div>
		<div class="enrich-bar" role="progressbar" aria-valuenow={enrichPercent} aria-valuemin="0" aria-valuemax="100">
			<span style={`width: ${Math.min(100, enrichPercent)}%`}></span>
		</div>
		{#if enrich.currentRepo}
			<p class="enrich-current">
				Now enriching
				<a href={`/repo/${enrich.currentRepo}`}>{enrich.currentRepo}</a>
			</p>
		{:else if enrich.remaining > 0}
			<p class="enrich-current">
				{enrich.remaining.toLocaleString()} repositories queued — enrichment continues automatically.
			</p>
		{:else}
			<p class="enrich-current">
				Backlog clear for currently eligible tiers. Long-tail deferred repos enrich on a slower
				cadence while discovery continues.
			</p>
		{/if}
	</div>
</section>

<section class="section-block" aria-labelledby="emerging-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Emerging topics</p>
			<h2 id="emerging-heading">What is rising in the latest valid run</h2>
			<p class="section-why">
				Shown only when a detection run exists. Absolute gates still require ≥10 repos, ≥5 owners,
				and ≥3 high-signal matches. Active candidates right now:
				<strong>{emergingActiveCount.toLocaleString()}</strong>.
			</p>
		</div>
		<a href="/discover/emerging">Open emerging</a>
	</div>

	{#if data.provenance}
		<div class="provenance-banner" data-kind={comparisonKind}>
			{#if comparisonKind === 'matched-hours'}
				<strong>{data.provenance.comparisonLabel ?? 'Matched-hour comparison'}</strong>
				<p>
					Same UTC hour offsets across consecutive weeks—not a full-week estimate.
					{#if data.provenance.current.datasetId && data.provenance.previous.datasetId}
						Datasets #{data.provenance.previous.datasetId} → #{data.provenance.current.datasetId}.
					{/if}
				</p>
			{:else if comparisonKind === 'absolute'}
				<strong>Absolute-density-only analysis</strong>
				<p>
					Windows are not momentum-comparable. Growth and prevalence lift stay suppressed
					{#if data.provenance.growthSuppressedReason}
						({data.provenance.growthSuppressedReason})
					{/if}.
				</p>
			{:else}
				<strong>Detection provenance</strong>
				<p>
					{data.provenance.comparisonLabel ?? 'Latest detection run'}
					{#if data.provenance.growthSuppressedReason}
						— {data.provenance.growthSuppressedReason}
					{/if}
				</p>
			{/if}
		</div>
	{:else}
		<p class="empty">
			{#if data.discoveryStatus.repositoriesDiscovered > 0}
				Analyzing {data.discoveryStatus.repositoriesDiscovered.toLocaleString()} repositories for
				emerging topics.
				{#if data.discoveryStatus.lastEmergingAnalysisAt}
					Last analysis completed {timeAgo(data.discoveryStatus.lastEmergingAnalysisAt)}.
				{:else}
					First analysis is scheduled by the discovery worker.
				{/if}
			{:else}
				Discovery worker is indexing repositories. Emerging-topic analysis will begin once ingestion
				produces comparable windows.
			{/if}
		</p>
	{/if}

	{#if data.discovery.emergingTopics.length > 0}
		<div class="cluster-grid">
			{#each data.discovery.emergingTopics as topic}
				<article class="cluster-card">
					<a class="cluster-title" href="/discover/emerging/{topic.key}">{topic.label}</a>
					<p>
						{topic.current_count.toLocaleString()} repos this period from
						{topic.distinct_owner_count.toLocaleString()} owners.
					</p>
					<div class="chips">
						<span><strong>{Math.round(topic.emerging_score)}</strong> score</span>
						<span>{topic.candidate_type}</span>
						<span>{topic.status}</span>
					</div>
					<p class="evidence">
						Evidence: Interesting avg {topic.average_interesting_score ?? '—'}; previous period
						{topic.previous_count.toLocaleString()}.
					</p>
				</article>
			{/each}
		</div>
	{:else if emergingIsValidatedZero}
		<div class="validated-zero">
			<strong>No emerging topics met the evidence requirements in the latest analysis.</strong>
			<p>
				Matched comparison produced no accepted candidates after review exclusions. Guardrails
				rejected generic README language and broad project-name tokens rather than manufacturing
				trends.
			</p>
			{#if data.nearMisses.length > 0}
				<p class="watch-label">Watched near-misses (not promoted):</p>
				<div class="cluster-grid">
					{#each data.nearMisses as miss}
						<article class="cluster-card muted">
							<strong>{miss.label}</strong>
							<p>
								{miss.currentCount} current / {miss.previousCount} previous ·
								{miss.distinctOwnerCount} owners · {miss.highSignalCount} high-signal
							</p>
							<p class="evidence">Rejected: {miss.rejectedBecause}</p>
						</article>
					{/each}
				</div>
			{:else}
				<p class="evidence">
					Watch list across future matched periods: <code>claude-code</code>, <code>tracker</code>.
				</p>
			{/if}
		</div>
	{/if}
</section>

<section class="section-block" aria-labelledby="clusters-heading" id="clusters">
	<div class="section-head">
		<div>
			<p class="eyebrow">Clusters</p>
			<h2 id="clusters-heading">
				{#if data.clusters.mode === 'growth'}
					Fastest-growing clusters
				{:else}
					Most active high-quality clusters
				{/if}
			</h2>
			<p class="section-why">
				{#if data.clusters.mode === 'growth'}
					Ranked by week-over-week growth with Interesting Score and volume guardrails
					(<code>/api/discovery/fastest-growing</code>).
				{:else}
					Momentum guardrails were not met, so this section shows recent activity and quality
					instead of implying growth.
				{/if}
			</p>
		</div>
		<a href="/discover/fastest-growing">View clusters</a>
	</div>
	<div class="cluster-grid">
		{#each data.clusters.items as cluster}
			<article class="cluster-card">
				<a class="cluster-title" href="/discover/projects-to-watch?cluster={cluster.slug}">
					{cluster.name}
				</a>
				{#if cluster.description}<p>{cluster.description}</p>{/if}
				<div class="chips">
					<span>
						<strong>{cluster.repoCount.toLocaleString()}</strong>
						{#if data.clusters.mode === 'growth'}this week{:else}repos{/if}
					</span>
					{#if cluster.growthPercent != null}
						<span><strong>{Math.round(cluster.growthPercent)}%</strong> growth</span>
					{:else}
						<span><strong>{cluster.secondaryCount.toLocaleString()}</strong> new 7d</span>
					{/if}
					<span><strong>{cluster.avgInterestingScore ?? '—'}</strong> avg score</span>
				</div>
				{#if cluster.topLanguages.length}
					<div class="chips">
						{#each cluster.topLanguages.slice(0, 4) as language}
							<span>{language.language}</span>
						{/each}
					</div>
				{/if}
				{#if cluster.topRepos.length}
					<ul class="example-repos">
						{#each cluster.topRepos.slice(0, 3) as repo}
							<li><a href="/repo/{repo.owner}/{repo.name}">{repo.full_name}</a></li>
						{/each}
					</ul>
				{/if}
				<p class="evidence">{cluster.rankingReason}</p>
			</article>
		{:else}
			<p class="empty">
				{#if data.enrichmentProgress.remaining > 0}
					Clusters will appear as enrichment assigns repositories. {data.enrichmentProgress.enrichedTotal.toLocaleString()}
					enriched so far; {data.enrichmentProgress.remaining.toLocaleString()} still waiting.
				{:else}
					No clusters meet quality thresholds yet. Additional categories will appear as repositories
					are classified.
				{/if}
			</p>
		{/each}
	</div>
	{#if data.clusters.items.length === 0 && data.discovery.clusters.some((cluster) => cluster.repo_count > 0)}
		<p class="evidence">Additional categories will appear as repositories are classified.</p>
	{/if}
</section>

<section class="section-block" aria-labelledby="watch-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Projects to watch</p>
			<h2 id="watch-heading">High-signal repos in growing clusters</h2>
			<p class="section-why">
				Uses <code>/api/discovery/projects-to-watch</code>. Cards include score, tier, clusters,
				Archive Story preview, and ranking evidence.
			</p>
		</div>
		<a href="/discover/projects-to-watch">View all</a>
	</div>
	<div class="repo-grid">
		{#each data.discovery.projectsToWatch as repo}
			<DiscoveryRepoCard {repo} />
		{:else}
			<p class="empty">
				{#if data.enrichmentProgress.remaining > 0}
					Projects to Watch fills after repositories are enriched and clustered. Enrichment is
					running now.
				{:else}
					No repositories meet Projects to Watch thresholds yet—cluster momentum and Interesting
					Score floors still apply.
				{/if}
			</p>
		{/each}
	</div>
</section>

<section class="section-block" aria-labelledby="deleted-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Preservation</p>
			<h2 id="deleted-heading">Deleted but preserved</h2>
			<p class="section-why">
				Uses <code>/api/discovery/deleted-gems</code>. Preservation state is shown per repository.
			</p>
		</div>
		<a href="/discover/deleted-gems">View all</a>
	</div>
	{#if data.archivePulse.metadataOnly && data.discovery.deletedGems.length === 0}
		<div class="disabled-feature">
			<strong>Artifact preservation is disabled</strong>
			<p>
				Metadata-only mode means README/source archives are not stored, so this lane stays quiet
				instead of advertising giant zero counters. Indexed metadata and Archive Stories can still
				explain what a deleted repository was.
			</p>
		</div>
	{:else}
		<div class="repo-grid">
			{#each data.discovery.deletedGems as repo}
				<DiscoveryRepoCard {repo} />
			{:else}
				<p class="empty">No deleted repositories currently clear the quality + recoverability bar.</p>
			{/each}
		</div>
	{/if}
</section>

<section class="section-block" aria-labelledby="high-signal-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">New high-signal repositories</p>
			<h2 id="high-signal-heading">Interesting Score first—not star mirrors</h2>
			<p class="section-why">
				Normal/high signal only, sorted by Interesting Score and recency. Replaces the primary
				100+ star feed. Currently
				<strong>{scoredSignalCount.toLocaleString()}</strong> scored normal/high-signal repositories
				in the index.
			</p>
		</div>
		<a href="/birth-feed">Raw birth feed</a>
	</div>
	<div class="repo-grid">
		{#each data.highSignalRepos as repo}
			<DiscoveryRepoCard {repo} />
		{:else}
			<p class="empty">No normal/high-signal repositories are scored yet.</p>
		{/each}
	</div>
</section>

<section class="section-block" aria-labelledby="unusual-heading" id="unusual">
	<div class="section-head">
		<div>
			<p class="eyebrow">Unusual finds</p>
			<h2 id="unusual-heading">High score, incomplete signals</h2>
			<p class="section-why">
				Repositories with strong Interesting Scores that still lack clear category, language, or
				topic trails.
			</p>
		</div>
	</div>
	<div class="repo-grid">
		{#each data.discovery.unusualFinds as repo}
			<DiscoveryRepoCard {repo} />
		{:else}
			<p class="empty">No unusual finds right now.</p>
		{/each}
	</div>
</section>

<section class="section-block" aria-labelledby="browse-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Browse intelligence</p>
			<h2 id="browse-heading">Where to go next</h2>
			<p class="section-why">Each entry points at an existing discovery surface—no duplicate rankings.</p>
		</div>
	</div>
	<div class="browse-grid">
		{#each browseLinks as link}
			<a href={link.href}>
				<strong>{link.label}</strong>
				<span>{link.why}</span>
			</a>
		{/each}
	</div>
</section>

<section class="section-block search-panel" aria-labelledby="search-heading" id="repository-search">
	<div class="section-head">
		<div>
			<p class="eyebrow">Repository search</p>
			<h2 id="search-heading">Query the indexed corpus</h2>
			<p class="section-why">Secondary to discovery—kept for operators who need full-text lookup.</p>
		</div>
		<a href="/birth-feed">Birth Feed</a>
	</div>
	<form class="search-form" method="get" action="/">
		<label class="sr-only" for="home-q">Search repositories</label>
		<input id="home-q" name="q" type="search" placeholder="owner, name, topic, or phrase" />
		<button type="submit" class="btn primary">Search</button>
	</form>
	<p class="evidence">
		Advanced filters and the complete feed live on query results and
		<a href="/birth-feed">Birth Feed</a>.
	</p>
</section>

<style>
	.hero,
	.section-block {
		margin-bottom: 1.25rem;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
		gap: clamp(1.25rem, 3vw, 2.5rem);
		align-items: start;
		padding: clamp(1.5rem, 4vw, 3rem) 0 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.hero-copy {
		min-width: 0;
	}

	.hero-preview {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--bg-elevated);
		padding: 1rem;
	}

	.preview-caption {
		margin: 0 0 0.85rem;
		color: var(--text-muted);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.eyebrow {
		margin: 0 0 0.4rem;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.hero h1 {
		margin: 0;
		max-width: 18ch;
		font-size: clamp(1.7rem, 4.2vw, 2.85rem);
		line-height: 1.12;
		letter-spacing: -0.02em;
	}

	.hero-lede,
	.section-why,
	.evidence,
	.empty,
	.preservation-note,
	.validated-zero p,
	.disabled-feature p,
	.cluster-card p {
		color: var(--text-muted);
		line-height: 1.6;
	}

	.hero-lede {
		max-width: 42rem;
		margin: 1rem 0 1.35rem;
		font-size: 1.05rem;
	}

	.hero-actions,
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.7rem 1rem;
		background: var(--bg-elevated);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}

	.btn:hover {
		border-color: var(--accent);
		text-decoration: none;
	}

	.btn.primary {
		background: color-mix(in srgb, var(--accent) 22%, var(--bg-elevated));
		border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
		color: var(--text);
	}

	.section-block {
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--bg-elevated);
		padding: clamp(1rem, 3vw, 1.75rem);
	}

	.section-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: end;
		margin-bottom: 1rem;
	}

	.section-head h2 {
		margin: 0;
		font-size: clamp(1.2rem, 2.4vw, 1.55rem);
	}

	.section-head a {
		color: var(--accent);
		font-weight: 600;
		white-space: nowrap;
	}

	.section-why {
		margin: 0.45rem 0 0;
		max-width: 48rem;
	}

	.metric-grid,
	.cluster-grid,
	.repo-grid,
	.browse-grid {
		display: grid;
		gap: 0.85rem;
	}

	.metric-grid {
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	}

	.metric-value {
		display: block;
		font-size: clamp(1.05rem, 2.4vw, 1.45rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}

	.metric-tile,
	.cluster-card,
	.browse-grid a,
	.provenance-banner,
	.validated-zero,
	.disabled-feature {
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--bg);
		padding: 1rem;
	}

	.metric-label {
		display: block;
		margin-top: 0.2rem;
		font-weight: 700;
	}

	.metric-detail {
		display: block;
		margin-top: 0.35rem;
		color: var(--text-muted);
		font-size: 0.82rem;
		line-height: 1.45;
	}

	.preservation-note {
		margin: 1rem 0 0;
		font-size: 0.92rem;
	}

	.cluster-grid {
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	}

	.repo-grid {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
	}

	.browse-grid {
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	}

	.cluster-title {
		color: var(--text);
		font-weight: 800;
		text-decoration: none;
	}

	.cluster-title:hover {
		color: var(--accent);
	}

	.chips span {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.25rem 0.55rem;
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.example-repos {
		margin: 0.75rem 0 0;
		padding-left: 1.1rem;
		color: var(--text-muted);
	}

	.example-repos a {
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}

	.evidence {
		margin: 0.75rem 0 0;
		font-size: 0.88rem;
	}

	.provenance-banner[data-kind='matched-hours'] {
		border-color: color-mix(in srgb, var(--green) 40%, var(--border));
		margin-bottom: 1rem;
	}

	.provenance-banner[data-kind='absolute'],
	.provenance-banner[data-kind='suppressed'] {
		border-color: color-mix(in srgb, var(--orange) 45%, var(--border));
		margin-bottom: 1rem;
	}

	.validated-zero,
	.disabled-feature {
		border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
	}

	.watch-label {
		margin: 1rem 0 0.65rem;
		font-weight: 700;
		color: var(--text);
	}

	.cluster-card.muted {
		opacity: 0.95;
	}

	.browse-grid a {
		display: grid;
		gap: 0.3rem;
		color: inherit;
		text-decoration: none;
	}

	.browse-grid a:hover {
		border-color: var(--accent);
		text-decoration: none;
	}

	.browse-grid span {
		color: var(--text-muted);
		font-size: 0.86rem;
		line-height: 1.45;
	}

	.enrich-panel {
		display: grid;
		gap: 1rem;
	}

	.enrich-counts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.75rem;
	}

	.enrich-counts > div {
		display: grid;
		gap: 0.2rem;
	}

	.enrich-bar {
		height: 0.55rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border) 80%, var(--bg));
		overflow: hidden;
	}

	.enrich-bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.enrich-current {
		margin: 0;
		color: var(--text-muted);
	}

	.enrich-current a {
		color: var(--text);
		font-weight: 700;
	}

	.search-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.search-form input {
		flex: 1 1 16rem;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg);
		color: var(--text);
		padding: 0.75rem 0.9rem;
	}

	.search-results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	@media (max-width: 900px) {
		.hero {
			grid-template-columns: 1fr;
			padding-top: 1rem;
		}

		.section-head {
			flex-direction: column;
			align-items: start;
		}

		.hero h1 {
			max-width: none;
			font-size: clamp(1.55rem, 8vw, 2rem);
		}

		.hero-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.hero-actions .btn {
			width: 100%;
		}

		.metric-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.section-block {
			padding: 0.9rem;
		}

		.repo-grid,
		.cluster-grid,
		.browse-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 360px) {
		.metric-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
