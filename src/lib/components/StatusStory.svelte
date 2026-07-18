<script lang="ts">
	/**
	 * Shared operator-facing status hierarchy:
	 * Current activity → Progress → Discovery
	 */
	let {
		currentActivity,
		currentActivityHref = null,
		enriched,
		thisRun,
		waiting,
		coveragePercent = null,
		latestArchiveHour = null,
		archiveBacklog = null,
		searchFallbackActive = null,
		workerLastRanLabel = null,
		enrichLastRanLabel = null,
		throughputPerMin = null,
		enrichedLastHour = null,
		avgSecondsPerRepo = null,
		concurrency = null,
		claimableWaiting = null,
		deferredWaiting = null,
		etaClaimableLabel = null,
		stageTimings = null,
		compact = false
	}: {
		currentActivity: string;
		currentActivityHref?: string | null;
		enriched: number;
		thisRun: number;
		waiting: number;
		coveragePercent?: number | null;
		latestArchiveHour?: string | null;
		archiveBacklog?: number | null;
		searchFallbackActive?: boolean | null;
		workerLastRanLabel?: string | null;
		enrichLastRanLabel?: string | null;
		throughputPerMin?: number | null;
		enrichedLastHour?: number | null;
		avgSecondsPerRepo?: number | null;
		concurrency?: number | null;
		claimableWaiting?: number | null;
		deferredWaiting?: number | null;
		etaClaimableLabel?: string | null;
		stageTimings?: {
			metadataMs: number;
			classificationMs: number;
			readmeMs: number;
			storyMs: number;
			dbWriteMs: number;
			totalMs: number;
		} | null;
		compact?: boolean;
	} = $props();

	const showThroughput =
		throughputPerMin != null ||
		enrichedLastHour != null ||
		avgSecondsPerRepo != null ||
		concurrency != null ||
		claimableWaiting != null ||
		deferredWaiting != null ||
		etaClaimableLabel != null ||
		enrichLastRanLabel != null ||
		stageTimings != null;

	function stageLine(label: string, ms: number): string {
		const value = `${Math.round(ms).toLocaleString()} ms`;
		return `${label.padEnd(18)} ${value.padStart(10)}`;
	}
</script>

<div class="status-story" class:compact>
	<section class="status-block" aria-label="Current activity">
		<h3>Current activity</h3>
		<p class="status-activity">
			{#if currentActivityHref}
				<a href={currentActivityHref}>{currentActivity}</a>
			{:else}
				{currentActivity}
			{/if}
		</p>
	</section>

	<section class="status-block" aria-label="Progress">
		<h3>Progress</h3>
		<dl class="status-metrics">
			<div>
				<dt>Enriched</dt>
				<dd>{enriched.toLocaleString()}</dd>
			</div>
			{#if thisRun > 0}
				<div>
					<dt>This run</dt>
					<dd>{thisRun.toLocaleString()}</dd>
				</div>
			{/if}
			<div>
				<dt>Waiting</dt>
				<dd>{waiting.toLocaleString()}</dd>
			</div>
			{#if coveragePercent != null}
				<div>
					<dt>Coverage</dt>
					<dd>{coveragePercent}%</dd>
				</div>
			{/if}
		</dl>
	</section>

	{#if showThroughput}
		<section class="status-block" aria-label="Enrichment throughput">
			<h3>Throughput</h3>
			<dl class="status-metrics">
				{#if throughputPerMin != null}
					<div>
						<dt>Repos / minute</dt>
						<dd>{throughputPerMin.toLocaleString()}</dd>
					</div>
				{/if}
				{#if enrichedLastHour != null}
					<div>
						<dt>Enriched last hour</dt>
						<dd>{enrichedLastHour.toLocaleString()}</dd>
					</div>
				{/if}
				{#if avgSecondsPerRepo != null}
					<div>
						<dt>Avg seconds / repo</dt>
						<dd>{avgSecondsPerRepo}</dd>
					</div>
				{/if}
				{#if concurrency != null}
					<div>
						<dt>Worker concurrency</dt>
						<dd>{concurrency}</dd>
					</div>
				{/if}
				{#if claimableWaiting != null}
					<div>
						<dt>Claimable queue</dt>
						<dd>{claimableWaiting.toLocaleString()}</dd>
					</div>
				{/if}
				{#if deferredWaiting != null}
					<div>
						<dt>Deferred (metadata-only)</dt>
						<dd>{deferredWaiting.toLocaleString()}</dd>
					</div>
				{/if}
				{#if etaClaimableLabel}
					<div>
						<dt>Est. claimable backlog</dt>
						<dd>{etaClaimableLabel}</dd>
					</div>
				{/if}
				{#if enrichLastRanLabel}
					<div>
						<dt>Enrichment last ran</dt>
						<dd>{enrichLastRanLabel}</dd>
					</div>
				{/if}
			</dl>
			{#if stageTimings}
				<pre class="stage-timings" aria-label="Time spent per repository">{`Time spent per repository

${stageLine('Metadata fetch:', stageTimings.metadataMs)}
${stageLine('Classification:', stageTimings.classificationMs)}
${stageLine('README:', stageTimings.readmeMs)}
${stageLine('Story generation:', stageTimings.storyMs)}
${stageLine('DB write:', stageTimings.dbWriteMs)}
${stageLine('Total:', stageTimings.totalMs)}`}</pre>
			{/if}
		</section>
	{/if}

	{#if latestArchiveHour != null || archiveBacklog != null || searchFallbackActive != null || workerLastRanLabel}
		<section class="status-block" aria-label="Discovery">
			<h3>Discovery</h3>
			<dl class="status-metrics">
				{#if latestArchiveHour != null}
					<div>
						<dt>Latest completed archive hour</dt>
						<dd class="mono">{latestArchiveHour || 'pending'}</dd>
					</div>
				{/if}
				{#if archiveBacklog != null}
					<div>
						<dt>Archive backlog</dt>
						<dd>{archiveBacklog.toLocaleString()} hours</dd>
					</div>
				{/if}
				{#if workerLastRanLabel}
					<div>
						<dt>Worker last ran</dt>
						<dd>{workerLastRanLabel}</dd>
					</div>
				{/if}
				{#if searchFallbackActive != null}
					<div>
						<dt>Search fallback</dt>
						<dd>{searchFallbackActive ? 'Yes' : 'No'}</dd>
					</div>
				{/if}
			</dl>
		</section>
	{/if}
</div>

<style>
	.status-story {
		display: grid;
		gap: 1.25rem;
	}

	.status-story.compact {
		gap: 0.85rem;
	}

	.status-block h3 {
		margin: 0 0 0.45rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.status-activity {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--text);
		line-height: 1.35;
	}

	.status-activity a {
		color: inherit;
	}

	.status-metrics {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.65rem 1rem;
		margin: 0;
	}

	.status-metrics > div {
		display: grid;
		gap: 0.15rem;
	}

	.status-metrics dt {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.status-metrics dd {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.92rem;
	}

	.stage-timings {
		margin: 0.85rem 0 0;
		padding: 0.75rem 0.85rem;
		border-radius: 0.4rem;
		background: color-mix(in srgb, var(--text-muted) 10%, transparent);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--text);
		white-space: pre;
		overflow-x: auto;
	}
</style>
