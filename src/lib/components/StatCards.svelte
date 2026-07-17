<script lang="ts">
	let {
		totalRepos,
		discovered24h,
		archived24h,
		healthy
	}: {
		totalRepos: number;
		discovered24h: number;
		archived24h: number;
		healthy: boolean;
	} = $props();
</script>

<div class="stat-cards">
	<div class="stat-card">
		<span class="stat-label">Repositories</span>
		<strong class="stat-value">{totalRepos.toLocaleString()}</strong>
		<span class="stat-hint">archived locally</span>
	</div>
	<div class="stat-card">
		<span class="stat-label">Today</span>
		<strong class="stat-value">{archived24h.toLocaleString()}</strong>
		<span class="stat-hint">archived in 24h</span>
	</div>
	<div class="stat-card">
		<span class="stat-label">Watching</span>
		<strong class="stat-value live">{discovered24h.toLocaleString()}</strong>
		<span class="stat-hint">discovered in 24h</span>
	</div>
	<div class="stat-card" class:healthy class:warn={!healthy}>
		<span class="stat-label">API status</span>
		<strong class="stat-value">{healthy ? 'Healthy' : 'Check admin'}</strong>
		<span class="stat-hint">{healthy ? 'Live ingestion' : 'See /admin'}</span>
	</div>
</div>

<style>
	.stat-cards {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.stat-card {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.stat-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	.stat-value {
		font-size: 1.35rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.stat-value.live {
		color: var(--green);
	}

	.stat-hint {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.stat-card.healthy .stat-value {
		color: var(--green);
	}

	.stat-card.warn .stat-value {
		color: var(--orange);
	}

	@media (max-width: 820px) {
		.stat-cards {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
