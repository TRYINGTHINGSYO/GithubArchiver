<script lang="ts">
	import DiscoveryRepoCard from '$lib/components/DiscoveryRepoCard.svelte';
	import StatusStory from '$lib/components/StatusStory.svelte';
	import WebsiteCard from '$lib/components/WebsiteCard.svelte';
	import { clusterGrowthAnalysisHref, homepageClusterTitleHref } from '$lib/cluster-links';
	import { timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const enrich = $derived(data.enrichmentProgress);
	const enrichOps = $derived(data.enrichmentOps);
	/** Corpus-wide, not queue-relative: a drained claimable queue must not read as 100% coverage. */
	const enrichPercent = $derived.by(() => {
		const total = data.readiness.totalRepos;
		if (total <= 0) return 0;
		return Math.round((data.readiness.enrichedRepos / total) * 1000) / 10;
	});
	const enrichCurrentActivity = $derived.by(() => {
		if (enrich.currentRepo) return `Enriching ${enrich.currentRepo}`;
		if ((enrichOps.claimableBacklog ?? enrich.remaining) > 0) {
			return 'Building repository intelligence (continuous queue)...';
		}
		return 'Enrichment caught up — ready for new discoveries.';
	});
	const etaClaimableLabel = $derived.by(() => {
		const minutes = enrichOps.etaClaimableMinutes;
		if (minutes == null) {
			return enrichOps.claimableBacklog === 0 ? 'caught up' : null;
		}
		if (minutes < 60) return `~${minutes} min`;
		if (minutes < 60 * 24) return `~${Math.round(minutes / 60)} hours`;
		return `~${Math.round(minutes / (60 * 24))} days`;
	});

	const browseLinks = [
		{ href: '/discover', label: 'All discoveries', why: 'Landing for every intelligence lane' },
		{ href: '/discover#clusters', label: 'All clusters', why: 'Browse thematic repository groups' },
		{ href: '/search?sort=interesting_score', label: 'Categories & scores', why: 'Open scored repository search' },
		{ href: '/discover/emerging', label: 'Emerging topics', why: 'Matched-hour trend candidates' },
		{ href: '/discover/projects-to-watch', label: 'Projects to watch', why: 'Quality plus cluster momentum' },
		{ href: '/discover#unusual', label: 'Classification review queue', why: 'High score with missing evidence' },
		{ href: '/discover/deleted-gems', label: 'Deleted projects', why: 'Preservation and recoverability' },
		{ href: '/search', label: 'Full repository search', why: 'Query the indexed corpus' }
	];

	const featuredRepo = $derived(data.featuredRepo);
	const archiveDelayLabel = $derived.by(() => {
		if (data.archiveHourBacklog <= 0) return 'Up to date';
		if (data.archiveHourBacklog === 1) return '1 hour';
		if (data.archiveHourBacklog < 24) return `${data.archiveHourBacklog} hours`;
		return `${Math.round(data.archiveHourBacklog / 24)} days`;
	});
	const systemHealthLabel = $derived.by(() => {
		if (data.searchFallbackActive || data.archiveHourBacklog >= 24) return 'Catching up';
		if ((enrichOps.claimableBacklog ?? enrich.remaining) > 0) return 'Analyzing';
		return 'Up to date';
	});
	const latestOpportunity = $derived(
		featuredRepo
			? `${featuredRepo.full_name} (${Math.round(featuredRepo.interesting_score ?? 0)})`
			: 'Pending'
	);

	const heroMetrics = $derived([
		{
			label: 'Analyzed',
			value: data.snapshot.enriched,
			detail: `${data.snapshot.analyzedCoveragePercent}% coverage`
		},
		{
			label: 'Discovered',
			value: data.discoveryStatus.repositoriesDiscovered,
			detail: data.discoveryStatus.lastIngestionAt
				? `Updated ${timeAgo(data.discoveryStatus.lastIngestionAt)}`
				: 'Discovery worker pending'
		},
		{
			label: 'Emerging topics',
			value: data.snapshot.emergingActive,
			detail: 'Evidence-gated'
		},
		{
			label: 'Live websites',
			value: data.snapshot.liveWebsites,
			detail: 'Verified destinations'
		}
	]);

	const publicSnapshotMetrics = $derived([
		{
			label: 'Growing categories',
			value: data.clusters.items.length,
			detail: 'Quality-weighted growth lanes'
		},
		{
			label: 'Highest-confidence opportunity',
			value: latestOpportunity,
			detail: featuredRepo ? 'Top surfaced repository right now' : 'No repository has cleared the threshold yet'
		},
		{
			label: 'Archive freshness',
			value: systemHealthLabel,
			detail: `Archive delay: ${archiveDelayLabel}`
		}
	]);

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

	function emergingConfidence(topic: {
		current_count: number;
		previous_count: number;
		distinct_owner_count: number;
		emerging_score: number;
	}): 'High' | 'Medium' | 'Experimental' {
		if (
			topic.distinct_owner_count >= 10 &&
			topic.current_count >= 25 &&
			topic.previous_count > 0 &&
			topic.emerging_score >= 75
		) {
			return 'High';
		}
		if (topic.distinct_owner_count >= 5 && topic.current_count >= 10 && topic.emerging_score >= 55) {
			return 'Medium';
		}
		return 'Experimental';
	}
</script>

<svelte:head>
	<title>GithubArchive+ — Repository intelligence & website discovery</title>
	<meta
		name="description"
		content="Discover GitHub repositories and the random websites connected to them — intelligence, archive depth, and community curation."
	/>
</svelte:head>

<section class="hero" aria-labelledby="hero-heading">
	<div class="hero-main">
		<div class="hero-copy">
			<p class="eyebrow">Live GitHub intelligence</p>
			<h1 id="hero-heading">Find the repositories worth watching.</h1>
			<p class="hero-lede">
				GithubArchive+ turns the live GitHub firehose into ranked repositories, emerging topics,
				and verified websites you can act on.
			</p>
			<div class="hero-actions">
				<a class="btn primary" href="/discover">Explore discoveries</a>
				<a class="btn" href="/search">Search repositories</a>
			</div>
		</div>
		<div class="hero-kpis" aria-label="Live discovery metrics">
			<p class="kpi-label"><span></span> Live index</p>
			<div class="hero-signal-grid">
				{#each heroMetrics as metric}
					<article class="hero-signal">
						<strong>{typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}</strong>
						<span>{metric.label}</span>
						<small>{metric.detail}</small>
					</article>
				{/each}
			</div>
		</div>
	</div>
	{#if featuredRepo}
		<aside class="hero-preview" aria-label="Repository intelligence preview">
			<div class="preview-heading">
				<div>
					<p class="eyebrow">Repository to watch</p>
					<p class="preview-caption">A live opportunity surfaced from the current archive.</p>
				</div>
				<a class="preview-link" href="/discover/projects-to-watch">View watchlist <span aria-hidden="true">→</span></a>
			</div>
			<DiscoveryRepoCard repo={featuredRepo} variant="featured" />
		</aside>
	{/if}
</section>

<section class="section-block snapshot" aria-labelledby="snapshot-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Discovery signals</p>
			<h2 id="snapshot-heading">Signals worth following</h2>
			<p class="section-why">
				Public signals summarize discovery value. Detailed pipeline counters stay in operations
				where they belong.
			</p>
		</div>
	</div>
	<div class="metric-grid">
		{#each publicSnapshotMetrics as metric}
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
			<p class="eyebrow">System health</p>
			<h2 id="enrich-heading">{systemHealthLabel}</h2>
			<p class="section-why">
				The public homepage shows readiness first. Throughput, queue, and timing details are still
				available below for operators.
			</p>
		</div>
	</div>
	<div class="enrich-panel">
		<div class="health-grid" aria-label="Public system health">
			<article class="health-tile">
				<span class="metric-value">{systemHealthLabel}</span>
				<span class="metric-label">Status</span>
			</article>
			<article class="health-tile">
				<span class="metric-value">{archiveDelayLabel}</span>
				<span class="metric-label">Archive delay</span>
			</article>
			<article class="health-tile">
				<span class="metric-value">{enrichPercent}%</span>
				<span class="metric-label">Understanding coverage</span>
			</article>
		</div>
		<details class="ops-details">
			<summary>Operations details</summary>
		<StatusStory
			currentActivity={enrichCurrentActivity}
			currentActivityHref={enrich.currentRepo ? `/repo/${enrich.currentRepo}` : null}
			enriched={enrich.enrichedTotal}
			thisRun={enrich.completed}
			waiting={enrichOps.totalUnenriched ?? enrich.remaining}
			coveragePercent={enrichPercent}
			latestArchiveHour={data.latestArchiveHour}
			archiveBacklog={data.archiveHourBacklog}
			searchFallbackActive={data.searchFallbackActive}
			workerLastRanLabel={data.discoveryStatus.lastIngestionAt
				? timeAgo(data.discoveryStatus.lastIngestionAt)
				: 'pending'}
			enrichLastRanLabel={enrich.updatedAt ? timeAgo(enrich.updatedAt) : null}
			runningJobLabel={data.runningWorkJob
				? `${data.runningWorkJob.jobType} · ${data.runningWorkJob.ageLabel}${
						data.runningWorkJob.runningCount > 1
							? ` (${data.runningWorkJob.runningCount} running)`
							: ''
					}`
				: null}
			runningJobStale={data.runningWorkJob?.stale ?? false}
			throughputPerMin={enrichOps.throughputPerMin}
			enrichedLastHour={enrichOps.enrichedLastHour}
			avgSecondsPerRepo={enrichOps.avgSecondsPerRepo}
			concurrency={enrichOps.concurrency}
			claimableWaiting={enrichOps.claimableBacklog}
			deferredWaiting={enrichOps.deferredBacklog}
			etaClaimableLabel={etaClaimableLabel}
			stageTimings={enrichOps.stageTimings}
			stagePercentiles={enrichOps.stagePercentiles}
		/>
		</details>
		<div class="enrich-bar" role="progressbar" aria-valuenow={enrichPercent} aria-valuemin="0" aria-valuemax="100">
			<span style={`width: ${Math.min(100, enrichPercent)}%`}></span>
		</div>
	</div>
</section>

<section class="section-block" aria-labelledby="websites-new-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Website discovery</p>
			<h2 id="websites-new-heading">New verified websites</h2>
			<p class="section-why">
				Live domains from the website pipeline — equal weight with repository intelligence.
			</p>
		</div>
		<a href="/websites/random">Random Website</a>
	</div>
	{#if data.websites.newLive.length === 0}
		<p class="empty">No verified-live websites yet. Discovery runs in the background.</p>
	{:else}
		<div class="website-grid homepage-websites">
			{#each data.websites.newLive as site (site.registrable_domain)}
				<WebsiteCard {site} density="compact" />
			{/each}
		</div>
	{/if}
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
						<span class={`confidence-chip ${emergingConfidence(topic).toLowerCase()}`}>
							{emergingConfidence(topic)}
						</span>
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
					Ranked by quality-weighted growth with previous/current counts, absolute lift, Interesting
					Score, and volume guardrails
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
				<a class="cluster-title" href={homepageClusterTitleHref(cluster)}>
					{cluster.name}
				</a>
				{#if cluster.description}<p>{cluster.description}</p>{/if}
				<div class="chips">
					<span>
						<strong>{cluster.repoCount.toLocaleString()}</strong>
						{#if data.clusters.mode === 'growth'}this week{:else}repos{/if}
					</span>
					{#if cluster.growthPercent != null}
						<span><strong>{cluster.secondaryCount.toLocaleString()}</strong> previous</span>
						<span>
							<strong>{Math.max(0, cluster.repoCount - cluster.secondaryCount).toLocaleString()}</strong>
							lift
						</span>
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
				{#if cluster.isVerifiedGrowth}
					<p class="evidence">
						<a href={clusterGrowthAnalysisHref(cluster.slug)}>View growth analysis</a>
					</p>
				{/if}
			</article>
		{:else}
			<p class="empty">
				{#if data.snapshot.indexed === 0}
					No repositories have been analyzed yet. Cluster cards appear only from live database
					memberships after ingestion and clustering.
				{:else if data.snapshot.activeClusters === 0}
					{data.snapshot.indexed.toLocaleString()}
					{data.snapshot.indexed === 1 ? 'repository is' : 'repositories are'} indexed, but
					clustering has not yet completed. Predefined category definitions are not shown as cards.
				{:else if data.enrichmentProgress.remaining > 0}
					Clusters will appear as enrichment assigns repositories. {data.enrichmentProgress.enrichedTotal.toLocaleString()}
					enriched so far; {data.enrichmentProgress.remaining.toLocaleString()} still waiting.
				{:else}
					No clusters meet quality thresholds yet. Additional categories will appear as repositories
					are classified.
				{/if}
			</p>
		{/each}
	</div>
</section>

<section class="section-block" aria-labelledby="watch-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Projects to watch</p>
			<h2 id="watch-heading">High-signal repos in growing clusters</h2>
			<p class="section-why">
				Opportunity Signal combines quality, novelty, momentum, and evidence. Cards include score,
				tier, clusters, Archive Story preview, and the reason surfaced.
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

<section class="section-block" aria-labelledby="websites-rated-heading">
	<div class="section-head">
		<div>
			<p class="eyebrow">Community curation</p>
			<h2 id="websites-rated-heading">Highest-rated websites</h2>
			<p class="section-why">
				Confidence-aware ratings — one active score per visitor per domain.
			</p>
		</div>
		<a href="/websites">All websites</a>
	</div>
	{#if data.websites.highestRated.length === 0}
		<p class="empty">No ratings yet. Open Random Website and be the first to score a find.</p>
	{:else}
		<div class="website-grid homepage-websites">
			{#each data.websites.highestRated as site (site.registrable_domain)}
				<WebsiteCard {site} density="compact" />
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
			<p class="eyebrow">Classification review</p>
			<h2 id="unusual-heading">High score, incomplete signals</h2>
			<p class="section-why">
				Review candidates with strong Interesting Scores but missing, weak, or conflicting evidence.
				These are classification gaps, not public unusual discoveries.
			</p>
		</div>
	</div>
	<div class="repo-grid">
		{#each data.discovery.unusualFinds as repo}
			<DiscoveryRepoCard {repo} />
		{:else}
			<p class="empty">No classification review candidates right now.</p>
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
	<form class="search-form" method="get" action="/search">
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
		margin-bottom: 1.5rem;
	}

	.hero {
		position: relative;
		overflow: hidden;
		padding: clamp(1.5rem, 3vw, 2.5rem);
		border: 1px solid var(--border);
		border-radius: 18px;
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent 42%),
			var(--bg-elevated);
		box-shadow: 0 20px 55px rgba(0, 0, 0, 0.14);
	}

	.hero-main {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(270px, 0.85fr);
		gap: clamp(1.25rem, 2.2vw, 2.25rem);
		align-items: end;
	}

	.hero-copy {
		min-width: 0;
	}

	.hero-preview {
		min-width: 0;
		margin-top: clamp(1.5rem, 3vw, 2.25rem);
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}

	.preview-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.85rem;
	}

	.preview-caption {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.92rem;
		line-height: 1.5;
	}

	.preview-link {
		flex: 0 0 auto;
		color: var(--text);
		font-size: 0.88rem;
		font-weight: 700;
		text-decoration: none;
	}

	.preview-link:hover {
		color: var(--accent);
		text-decoration: none;
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
		max-width: 15ch;
		font-size: clamp(2.35rem, 3.3vw, 3.4rem);
		line-height: 1.02;
		letter-spacing: -0.045em;
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
		max-width: 39rem;
		margin: 1.1rem 0 1.4rem;
		font-size: clamp(1rem, 1.3vw, 1.12rem);
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
		min-height: 2.75rem;
		padding: 0.72rem 1rem;
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
		background: var(--accent);
		border-color: var(--accent);
		color: #06111c;
	}

	.hero-kpis {
		border-left: 1px solid var(--border);
		padding-left: clamp(1.25rem, 2vw, 2rem);
	}

	.kpi-label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.75rem;
		color: var(--text-muted);
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.kpi-label span {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: var(--green);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 14%, transparent);
	}

	.hero-signal-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.65rem;
	}

	.hero-signal {
		min-width: 0;
		border-top: 1px solid var(--border-strong);
		padding: 0.72rem 0 0.25rem;
	}

	.hero-signal strong,
	.hero-signal span,
	.hero-signal small {
		display: block;
	}

	.hero-signal strong {
		font-family: var(--font-mono);
		font-size: clamp(1.15rem, 1.7vw, 1.5rem);
		line-height: 1.2;
	}

	.hero-signal span {
		margin-top: 0.2rem;
		font-size: 0.85rem;
		font-weight: 700;
	}

	.hero-signal small {
		margin-top: 0.15rem;
		color: var(--text-muted);
		font-size: 0.75rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.section-block {
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--bg-elevated);
		padding: clamp(1.15rem, 2.4vw, 1.65rem);
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.08);
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
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
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
		background: var(--bg-subtle);
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
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr));
	}

	.repo-grid {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
	}

	.browse-grid {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
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

	.health-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.85rem;
	}

	.health-tile {
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--bg);
		padding: 1rem;
	}

	.ops-details {
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--bg);
		padding: 0.9rem 1rem;
	}

	.ops-details summary {
		cursor: pointer;
		color: var(--accent);
		font-weight: 700;
	}

	.ops-details > :global(:not(summary)) {
		margin-top: 0.85rem;
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

	.confidence-chip {
		font-weight: 700;
	}

	.confidence-chip.high {
		border-color: color-mix(in srgb, var(--green) 50%, var(--border));
		color: var(--green);
	}

	.confidence-chip.medium {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
		color: var(--accent);
	}

	.confidence-chip.experimental {
		border-color: color-mix(in srgb, var(--orange) 50%, var(--border));
		color: var(--orange);
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
		.hero-main {
			grid-template-columns: 1fr;
			align-items: start;
		}

		.hero {
			padding: 1.15rem;
			border-radius: 14px;
		}

		.hero-kpis {
			border-top: 1px solid var(--border);
			border-left: 0;
			padding-top: 1.25rem;
			padding-left: 0;
		}

		.section-head {
			flex-direction: column;
			align-items: start;
		}

		.hero h1 {
			max-width: none;
			font-size: clamp(2rem, 10vw, 2.8rem);
		}

		.hero-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.hero-actions .btn {
			width: 100%;
		}

		.hero-signal-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.preview-heading {
			align-items: start;
			flex-direction: column;
		}

		.metric-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.section-block {
			padding: 0.9rem;
		}

		.repo-grid,
		.cluster-grid,
		.browse-grid,
		.homepage-websites {
			display: flex;
			overflow-x: auto;
			overflow-y: hidden;
			scroll-snap-type: x mandatory;
			scroll-padding-inline: 0.1rem;
			overscroll-behavior-inline: contain;
			padding: 0.1rem 0 0.65rem;
			scrollbar-width: thin;
		}

		.repo-grid > :global(*),
		.cluster-grid > :global(*),
		.homepage-websites > :global(*),
		.browse-grid > a {
			flex: 0 0 min(82vw, 20rem);
			scroll-snap-align: start;
		}
	}

	@media (max-width: 360px) {
		.metric-grid,
		.hero-signal-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
