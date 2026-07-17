<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatCategoryLabel, formatSignalTierLabel } from '$lib/category-labels';
	import { repoDetailPath } from '$lib/repo-nav';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let savingStatus = $state(false);
	let reviewReason = $state('valid-trend');
	let mergeTarget = $state('');

	const topic = $derived(data.detail.topic);
	const evidence = $derived(data.detail.evidence);
	const history = $derived(data.detail.history);

	const REVIEW_REASONS = [
		'valid-trend',
		'generic-term',
		'alias-duplicate',
		'curated-cluster-overlap',
		'coursework-flood',
		'template-flood',
		'single-event',
		'insufficient-quality',
		'other'
	];

	function growthText(current: number, previous: number, suppressedReason?: string | null): string {
		if (suppressedReason) {
			return 'growth comparison unavailable because the two windows were not ingested comparably';
		}
		if (previous === 0 && current > 0) return 'after none were recorded in the previous period';
		if (previous === 0) return 'with no previous-period baseline';
		const pct = Math.round(((current - previous) / previous) * 100);
		return `${pct}% growth over the previous period`;
	}

	async function postReview(body: Record<string, unknown>) {
		if (savingStatus) return;
		savingStatus = true;
		try {
			await fetch(`/api/discovery/emerging/${topic.key}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			await invalidateAll();
		} finally {
			savingStatus = false;
		}
	}

	function setStatus(status: string) {
		return postReview({ action: 'set-status', status, reason: reviewReason });
	}

	function excludeTerm() {
		return postReview({ action: 'exclude', reason: reviewReason });
	}

	function mergeInto() {
		if (!mergeTarget.trim()) return;
		return postReview({ action: 'merge', canonicalKey: mergeTarget.trim() });
	}
</script>

<svelte:head>
	<title>{topic.label} — Emerging topic — GithubArchive+</title>
</svelte:head>

<section class="topic-hero">
	<a class="back" href="/discover/emerging">Back to emerging topics</a>
	<div class="hero-head">
		<div>
			<p class="eyebrow">{topic.candidate_type} candidate</p>
			<h1>{topic.label}</h1>
		</div>
		<div class="score-box">
			<strong>{Math.round(topic.emerging_score)}</strong>
			<span>Emerging score</span>
		</div>
	</div>
	<p>
		{topic.current_count.toLocaleString()} repositories from {topic.distinct_owner_count.toLocaleString()}
		owners were created in this period, compared with {topic.previous_count.toLocaleString()} previously,
		{#if data.provenance?.comparisonMode === 'matched-hours' && evidence.prevalence?.liftPercent != null}
			{evidence.prevalence.liftPercent}% prevalence lift in the matched sample
		{:else}
			{growthText(topic.current_count, topic.previous_count, evidence.growthSuppressedReason)}
		{/if}. Average Interesting Score:
		{topic.average_interesting_score ?? '—'}.
	</p>
	{#if data.provenance?.comparisonMode === 'matched-hours'}
		<p class="comparison-note">
			<strong>{data.provenance.comparisonLabel}</strong> — based on the same UTC hour offsets
			across consecutive weeks. This is not a full-week estimate.
		</p>
	{/if}
	<div class="status-actions" aria-label="Review status">
		<span>Status: {topic.status}{topic.review_reason ? ` (${topic.review_reason})` : ''}</span>
		<label class="reason-picker">
			Reason
			<select bind:value={reviewReason}>
				{#each REVIEW_REASONS as reason}
					<option value={reason}>{reason}</option>
				{/each}
			</select>
		</label>
		<button disabled={savingStatus} onclick={() => setStatus('reviewing')}>Reviewing</button>
		<button disabled={savingStatus} onclick={() => setStatus('promoted')}>Promoted</button>
		<button disabled={savingStatus} onclick={() => setStatus('dismissed')}>Dismiss</button>
		<button disabled={savingStatus} onclick={excludeTerm}>Exclude term</button>
	</div>
	<div class="status-actions merge-row" aria-label="Merge into another candidate">
		<input
			type="text"
			placeholder="canonical key, e.g. claude-code"
			bind:value={mergeTarget}
		/>
		<button disabled={savingStatus || !mergeTarget.trim()} onclick={mergeInto}>Merge into</button>
	</div>
</section>

{#if history}
	<section class="panel">
		<h2>Historical context</h2>
		<div class="metrics">
			<span>Current {history.currentCount}</span>
			<span>Previous {history.previousCount}</span>
			<span>4-week avg {history.fourWeekAverage}</span>
			<span>All-time {history.allTimeCount}</span>
			<span>First seen {history.firstSeenAt.slice(0, 10)}</span>
			<span>Growth streak {history.consecutiveGrowthPeriods}</span>
		</div>
		<p>
			{#if history.allTimeCount - history.currentCount - history.previousCount === 0}
				This term has never appeared in the archive before these two periods, which supports a genuinely new topic.
			{:else if history.fourWeekAverage > 0 && history.currentCount > history.fourWeekAverage * 2}
				Current volume is more than double the four-week average, suggesting acceleration rather than a steady baseline.
			{:else}
				This term has appeared before; compare the four-week average and first-seen date before treating it as new.
			{/if}
		</p>
	</section>
{/if}

<section class="panel">
	<h2>Why it was detected</h2>
	<div class="metrics">
		<span>Momentum {evidence.scoreBreakdown.momentum ?? 'n/a'}</span>
		<span>Novelty {evidence.scoreBreakdown.novelty}</span>
		<span>Quality {evidence.scoreBreakdown.quality}</span>
		<span>Owner diversity {evidence.scoreBreakdown.ownerDiversity}</span>
		<span>Category diversity {evidence.scoreBreakdown.categoryDiversity}</span>
		<span>Penalties {evidence.scoreBreakdown.penalties}</span>
	</div>
	<p>
		Low-signal ratio {(evidence.ratios.lowSignal * 100).toFixed(0)}%, largest-owner share
		{(evidence.ratios.singleOwnerShare * 100).toFixed(0)}%, duplicate-name ratio
		{(evidence.ratios.duplicateName * 100).toFixed(0)}%.
	</p>
	{#if evidence.sources && Object.keys(evidence.sources).length > 0}
		<p>
			Sources: {Object.entries(evidence.sources)
				.map(([type, count]) => `${type} ${count}`)
				.join(', ')}{Object.keys(evidence.aliasHits ?? {}).length > 0
				? `. Merged aliases: ${Object.keys(evidence.aliasHits).join(', ')}.`
				: '.'}
		</p>
	{/if}
</section>

<section class="panel">
	<h2>Example repositories</h2>
	<div class="repo-list">
		{#each data.detail.repositories as repo}
			<article class="repo-row">
				<a class="repo-name" href={repoDetailPath(repo.owner, repo.name)}>{repo.full_name}</a>
				<p>{repo.description ?? repo.summary ?? 'No description captured.'}</p>
				<div class="metrics">
					{#if repo.language}<span>{repo.language}</span>{/if}
					{#if repo.category}<span>{formatCategoryLabel(repo.category)}</span>{/if}
					{#if repo.signal_tier}<span>{formatSignalTierLabel(repo.signal_tier)}</span>{/if}
					{#if repo.interesting_score != null}<span>Score {repo.interesting_score}</span>{/if}
					{#if repo.stars != null}<span>{repo.stars} stars</span>{/if}
					{#if repo.has_source}<span>Source preserved</span>{:else if repo.has_readme}<span>README preserved</span>{:else if repo.has_any_archive}<span>Partially recoverable</span>{/if}
				</div>
			</article>
		{/each}
	</div>
</section>

<style>
	.topic-hero,
	.panel {
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

	.hero-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1rem;
		align-items: start;
		margin-top: 0.75rem;
	}

	.eyebrow {
		margin: 0;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	h1,
	h2 {
		margin: 0.35rem 0;
	}

	p {
		color: var(--text-muted);
		line-height: 1.55;
	}

	.score-box {
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 0.8rem 1rem;
		text-align: center;
	}

	.score-box strong {
		display: block;
		font-family: var(--font-mono);
		font-size: 1.6rem;
	}

	.score-box span,
	.metrics span,
	.status-actions span {
		color: var(--text-muted);
	}

	.status-actions,
	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	button,
	.metrics span,
	select,
	input {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.35rem 0.65rem;
		background: var(--bg);
		color: var(--text);
	}

	.reason-picker {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.merge-row {
		margin-top: 0.6rem;
	}

	.merge-row input {
		min-width: 240px;
		font-family: var(--font-mono);
	}

	button {
		cursor: pointer;
	}

	.repo-list {
		display: grid;
		gap: 0.85rem;
	}

	.repo-row {
		border-top: 1px solid var(--border);
		padding-top: 0.85rem;
	}

	.repo-name {
		color: var(--text);
		font-family: var(--font-mono);
		font-weight: 700;
		text-decoration: none;
	}

	@media (max-width: 640px) {
		.hero-head {
			grid-template-columns: 1fr;
		}

		.score-box {
			width: fit-content;
		}
	}
</style>
