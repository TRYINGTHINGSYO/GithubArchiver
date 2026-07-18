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
		compact?: boolean;
	} = $props();
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
						<dt>Backlog</dt>
						<dd>{archiveBacklog.toLocaleString()} hours</dd>
					</div>
				{/if}
				{#if searchFallbackActive != null}
					<div>
						<dt>Search fallback active</dt>
						<dd>{searchFallbackActive ? 'Yes' : 'No'}</dd>
					</div>
				{/if}
				{#if workerLastRanLabel}
					<div>
						<dt>Worker last ran</dt>
						<dd>{workerLastRanLabel}</dd>
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
</style>
