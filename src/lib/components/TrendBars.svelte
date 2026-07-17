<script lang="ts">
	let {
		title,
		items
	}: {
		title: string;
		items: { label: string; value: number }[];
	} = $props();

	const max = $derived(Math.max(...items.map((i) => i.value), 1));
</script>

<div class="trend-bars">
	<h3 class="trend-bars-title">{title}</h3>
	{#if items.length === 0}
		<p class="muted">No data yet</p>
	{:else}
		<ul class="bars">
			{#each items as item}
				<li>
					<span class="bar-label">{item.label}</span>
					<div class="bar-track">
						<div class="bar-fill" style="width: {(item.value / max) * 100}%"></div>
					</div>
					<span class="bar-value">{item.value}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.trend-bars {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
		padding: 1rem;
	}

	.trend-bars-title {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		margin: 0 0 0.75rem;
		font-weight: 600;
	}

	.bars {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}

	.bars li {
		display: grid;
		grid-template-columns: 88px 1fr 2rem;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.85rem;
	}

	.bar-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}

	.bar-track {
		height: 0.55rem;
		background: var(--bg);
		border-radius: 4px;
		overflow: hidden;
		border: 1px solid var(--border);
	}

	.bar-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent-dim), var(--accent));
		border-radius: 3px;
		min-width: 2px;
	}

	.bar-value {
		text-align: right;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}

	.muted {
		color: var(--text-muted);
		font-size: 0.85rem;
		margin: 0;
	}
</style>
