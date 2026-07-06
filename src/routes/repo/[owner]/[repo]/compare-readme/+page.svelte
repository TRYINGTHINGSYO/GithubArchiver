<script lang="ts">
	import { formatBytes, shortSha, timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Compare README — {data.repo.full_name}</title>
</svelte:head>

<article class="repo-detail">
	<header>
		<h1 class="mono">README comparison</h1>
		<p class="description">{data.repo.full_name}</p>
		<div class="meta-grid">
			<span>From: {timeAgo(data.from.archived_at)} ({formatBytes(data.from.file_size)})</span>
			<span>To: {timeAgo(data.to.archived_at)} ({formatBytes(data.to.file_size)})</span>
			<a href="/repo/{data.repo.owner}/{data.repo.name}">← Back to repo</a>
		</div>
	</header>

	<section class="detail-section">
		<h2 class="section-title">Line diff</h2>
		<pre class="diff-view">{#each data.diff as line}<span class="diff-{line.type}">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '} {line.text}
</span>{/each}</pre>
	</section>

	<section class="detail-section compare-columns">
		<div>
			<h2 class="section-title">From snapshot #{data.from.id}</h2>
			<p class="compare-meta mono">{shortSha(data.from.sha256)} · {timeAgo(data.from.archived_at)}</p>
			<div class="readme-content">{@html data.fromHtml}</div>
		</div>
		<div>
			<h2 class="section-title">To snapshot #{data.to.id}</h2>
			<p class="compare-meta mono">{shortSha(data.to.sha256)} · {timeAgo(data.to.archived_at)}</p>
			<div class="readme-content">{@html data.toHtml}</div>
		</div>
	</section>
</article>

<style>
	.diff-view {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 1rem;
		overflow-x: auto;
		font-size: 0.8rem;
		line-height: 1.45;
		max-height: 24rem;
	}

	.diff-add {
		color: var(--green);
		display: block;
	}

	.diff-remove {
		color: var(--red);
		display: block;
	}

	.diff-same {
		color: var(--text-muted);
		display: block;
	}

	.compare-columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
	}

	.compare-meta {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: -0.5rem 0 1rem;
	}

	@media (max-width: 900px) {
		.compare-columns {
			grid-template-columns: 1fr;
		}
	}
</style>
