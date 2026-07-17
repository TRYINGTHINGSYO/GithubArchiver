<script lang="ts">
	const discoverySections = [
		{ emoji: '🔥', label: 'Exploding today', href: '/birth-feed?sort=stars' },
		{ emoji: '⭐', label: 'Fastest growing', href: '/birth-feed?sort=stars' },
		{ emoji: '🆕', label: 'Just created', href: '/?feed=newest' },
		{ emoji: '🤖', label: 'AI repositories', href: '/?q=ai' },
		{ emoji: '🚀', label: 'First releases', href: '/?feed=recently_released' },
		{ emoji: '📈', label: 'Biggest movers', href: '/birth-feed?sort=stars' },
		{ emoji: '📦', label: 'Recently archived', href: '/?feed=recently_archived' },
		{ emoji: '⚠', label: 'Recently deleted', href: '/?deleted_only=1' }
	];
</script>

<section class="discovery" aria-label="Discovery feeds">
	<h2 class="discovery-title">Discover what's happening on GitHub</h2>
	<div class="discovery-grid">
		{#each discoverySections as section}
			<a href={section.href} class="discovery-card">
				<span class="discovery-emoji">{section.emoji}</span>
				<span class="discovery-label">{section.label}</span>
			</a>
		{/each}
	</div>
</section>

<style>
	.discovery {
		margin-bottom: 2rem;
	}

	.discovery-title {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		margin: 0 0 0.85rem;
		font-weight: 600;
	}

	.discovery-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.65rem;
	}

	.discovery-card {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
		color: var(--text);
		text-decoration: none;
		font-size: 0.88rem;
		font-weight: 500;
		transition: border-color 0.15s, background 0.15s;
	}

	.discovery-card:hover {
		border-color: var(--accent);
		background: var(--accent-dim);
		text-decoration: none;
	}

	.discovery-emoji {
		font-size: 1.1rem;
	}

	@media (max-width: 900px) {
		.discovery-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
