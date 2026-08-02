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
				<span class="label">Live activity</span>
				<span class="message">{activity.message}</span>
				{#if showEnrichmentCounts && activity.progress}
					<span class="separator" aria-hidden="true">·</span>
					<span class="counts">{formatEnrichmentCounts(activity.progress)}</span>
				{/if}
			</span>
		</span>
	</div>
{:else}
	<div class="activity-bar error" role="status" aria-live="polite">
		<span class="indicator" aria-hidden="true"></span>
		<span class="stack">
			<span class="row">
				<span class="label">Live activity</span>
				<span class="message">Status unavailable</span>
			</span>
		</span>
	</div>
{/if}

<style>
	.activity-bar {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: min(var(--content-max), 100%);
		min-height: 2.35rem;
		margin: 0.55rem auto 0;
		padding: 0.4rem clamp(1rem, 2.5vw, 2.5rem);
		border-top: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg-subtle) 64%, transparent);
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
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}

	.label {
		flex-shrink: 0;
		padding-right: 0.65rem;
		border-right: 1px solid var(--border-strong);
		font-weight: 750;
		font-size: 0.68rem;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--accent);
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

	.message {
		flex: 1;
	}

	.counts {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.separator {
		color: var(--border-strong);
	}

	.indicator {
		width: 0.5rem;
		height: 0.5rem;
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
			margin-top: 0.45rem;
			padding: 0.38rem 1rem;
		}

		.label {
			display: none;
		}

		.separator,
		.counts {
			display: none;
		}
	}
</style>
