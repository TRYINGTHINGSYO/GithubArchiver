<script lang="ts">
	const discoverySections = [
		{ label: 'Emerging topics', href: '/discover/emerging' },
		{ label: 'Fastest-growing clusters', href: '/discover/fastest-growing' },
		{ label: 'Projects to watch', href: '/discover/projects-to-watch' },
		{ label: 'Deleted but preserved', href: '/discover/deleted-gems' },
		{ label: 'Unusual finds', href: '/discover#unusual' },
		{ label: 'All discoveries', href: '/discover' },
		{ label: 'Birth Feed', href: '/birth-feed' },
		{ label: 'Repository search', href: '/#repository-search' }
	];
</script>

<section class="discovery" aria-label="Discovery feeds">
	<h2 class="discovery-title">Browse intelligence</h2>
	<div class="discovery-grid">
		{#each discoverySections as section}
			<a href={section.href} class="discovery-card">
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

	.discovery-label {
		font-size: 0.88rem;
	}

	@media (max-width: 900px) {
		.discovery-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
