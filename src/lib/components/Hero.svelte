<script lang="ts">
	let { totalRepos, archived24h }: { totalRepos: number; archived24h: number } = $props();
</script>

<section class="hero">
	<h1 class="hero-title">GitHub<span>Archive+</span></h1>
	<p class="hero-stats">
		<strong>{totalRepos.toLocaleString()}</strong> repositories archived ·
		<strong>{archived24h.toLocaleString()}</strong> archived in the last 24h ·
		Watching GitHub in real time
	</p>
	<div class="hero-actions">
		<a href="/" class="hero-btn primary">Browse repositories</a>
		<a href="/birth-feed#live-stream" class="hero-btn">Live feed</a>
		<a href="/birth-feed" class="hero-btn">Birth feed</a>
	</div>
</section>

<style>
	.hero {
		text-align: center;
		padding: 2rem 1rem 2.25rem;
		margin-bottom: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg) 100%);
	}

	.hero-title {
		font-size: 2rem;
		font-weight: 800;
		margin: 0 0 0.75rem;
		letter-spacing: -0.02em;
	}

	.hero-title span {
		color: var(--accent);
	}

	.hero-stats {
		color: var(--text-muted);
		font-size: 1.05rem;
		margin: 0 0 1.25rem;
	}

	.hero-stats strong {
		color: var(--text);
		font-weight: 700;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		justify-content: center;
	}

	.hero-btn {
		padding: 0.55rem 1.1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		transition: border-color 0.15s, background 0.15s;
	}

	.hero-btn:hover {
		border-color: var(--accent);
		background: var(--accent-dim);
		text-decoration: none;
	}

	.hero-btn.primary {
		background: var(--accent-dim);
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
