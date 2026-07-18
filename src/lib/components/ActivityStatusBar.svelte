<script lang="ts">
	import { onMount } from 'svelte';
	import type { DaemonActivity } from '$lib/server/daemon-activity';
	import { formatEnrichmentCounts } from '$lib/status-display';

	const POLL_MS = 12_000;

	let { initial }: { initial: DaemonActivity } = $props();

	let latestActivity = $state<DaemonActivity | null>(null);
	let error = $state(false);

	const activity = $derived(latestActivity ?? initial);
	const isActive = $derived(activity.action !== 'idle' && activity.action !== 'rate_limited');
	const isRateLimited = $derived(activity.action === 'rate_limited');
	const showEnrichmentCounts = $derived(
		Boolean(
			activity.progress && (activity.action === 'enrich' || (activity.enrichment?.remaining ?? 0) > 0)
		)
	);

	async function refresh() {
		try {
			const res = await fetch('/api/status/activity');
			if (!res.ok) throw new Error('status failed');
			latestActivity = await res.json();
			error = false;
		} catch {
			error = true;
		}
	}

	onMount(() => {
		void refresh();
		const id = setInterval(() => void refresh(), POLL_MS);
		return () => clearInterval(id);
	});
</script>

{#if !error}
	<div class="activity-bar" class:active={isActive} class:rate-limited={isRateLimited} role="status" aria-live="polite">
		<span class="indicator" aria-hidden="true"></span>
		<span class="stack">
			<span class="row">
				<span class="label">Current activity</span>
				<span class="message">{activity.message}</span>
			</span>
			{#if showEnrichmentCounts && activity.progress}
				<span class="row">
					<span class="label">Progress</span>
					<span class="counts">{formatEnrichmentCounts(activity.progress)}</span>
				</span>
			{/if}
		</span>
	</div>
{:else}
	<div class="activity-bar error" role="status" aria-live="polite">
		<span class="indicator" aria-hidden="true"></span>
		<span class="stack">
			<span class="row">
				<span class="label">Current activity</span>
				<span class="message">Status unavailable</span>
			</span>
		</span>
	</div>
{/if}

<style>
	.activity-bar {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.45rem 1.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg-elevated);
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.stack {
		display: grid;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		min-width: 0;
	}

	.label {
		flex-shrink: 0;
		min-width: 7.2rem;
		font-weight: 650;
		font-size: 0.7rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.message,
	.counts {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-weight: 600;
	}

	.counts {
		font-variant-numeric: tabular-nums;
	}

	.indicator {
		width: 0.5rem;
		height: 0.5rem;
		margin-top: 0.35rem;
		border-radius: 50%;
		background: var(--text-muted);
		flex-shrink: 0;
	}

	.activity-bar.active .indicator {
		background: var(--accent);
		animation: pulse 1.6s ease-in-out infinite;
	}

	.activity-bar.rate-limited .indicator {
		background: var(--orange);
	}

	.activity-bar.error .indicator {
		background: var(--orange);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.5;
			transform: scale(0.88);
		}
	}

	@media (max-width: 820px) {
		.activity-bar {
			padding: 0.45rem 1rem;
		}

		.label {
			min-width: 0;
		}
	}
</style>
