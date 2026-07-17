<script lang="ts">
	import { onMount } from 'svelte';
	import type { DaemonActivity } from '$lib/server/daemon-activity';

	const POLL_MS = 12_000;

	let { initial }: { initial: DaemonActivity } = $props();

	let latestActivity = $state<DaemonActivity | null>(null);
	let error = $state(false);

	const activity = $derived(latestActivity ?? initial);
	const isActive = $derived(activity.action !== 'idle' && activity.action !== 'rate_limited');
	const isRateLimited = $derived(activity.action === 'rate_limited');

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
		<span class="label">What I'm doing</span>
		<span class="message">{activity.message}</span>
		{#if activity.progress && (activity.action === 'enrich' || activity.enrichment?.remaining > 0)}
			<span class="counts">
				{activity.progress.enrichedTotal.toLocaleString()} done ·
				{activity.progress.remaining.toLocaleString()} left
			</span>
		{/if}
	</div>
{:else}
	<div class="activity-bar error" role="status" aria-live="polite">
		<span class="indicator" aria-hidden="true"></span>
		<span class="label">What I'm doing</span>
		<span class="message">Status unavailable</span>
	</div>
{/if}

<style>
	.activity-bar {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.4rem 1.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg-elevated);
		font-size: 0.78rem;
		color: var(--text-muted);
		min-height: 2rem;
	}

	.label {
		font-weight: 600;
		color: var(--text);
		white-space: nowrap;
	}

	.message {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.counts {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		font-weight: 600;
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
			padding: 0.4rem 1rem;
		}

		.label {
			display: none;
		}
	}
</style>
