<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { timeAgo } from '$lib/utils';

	let { data } = $props();
	let rating = $state(data.userRating?.rating ?? 0);
	let review = $state(data.userRating?.review ?? '');
	let busy = $state(false);
	let message = $state('');

	$effect(() => {
		rating = data.userRating?.rating ?? 0;
		review = data.userRating?.review ?? '';
	});

	async function toggleFavorite() {
		busy = true;
		message = '';
		try {
			const favorited = data.membership?.favorites;
			const res = await fetch(
				`/api/websites/${encodeURIComponent(data.site.registrable_domain)}/favorite`,
				{ method: favorited ? 'DELETE' : 'PUT' }
			);
			const json = await res.json();
			if (!res.ok) throw new Error(json.message ?? json.error ?? res.statusText);
			message = favorited ? 'Removed from favorites' : 'Favorited website';
			await invalidateAll();
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function saveRating() {
		if (rating < 1 || rating > 5) {
			message = 'Choose 1–5 stars';
			return;
		}
		busy = true;
		message = '';
		try {
			const res = await fetch(`/api/websites/${encodeURIComponent(data.site.registrable_domain)}/rating`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rating, review: review.trim() || null })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			message = 'Rating saved';
			await invalidateAll();
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function clearRating() {
		busy = true;
		try {
			const res = await fetch(`/api/websites/${encodeURIComponent(data.site.registrable_domain)}/rating`, {
				method: 'DELETE'
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			rating = 0;
			review = '';
			message = 'Rating removed';
			await invalidateAll();
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{data.site.registrable_domain} — Websites — GithubArchive+</title>
</svelte:head>

<article class="website-detail">
	<header class="hero">
		<p class="eyebrow">Website</p>
		<h1>{data.site.registrable_domain}</h1>
		{#if data.site.page_title}
			<p class="title">{data.site.page_title}</p>
		{/if}
		<div class="stats">
			<span>{data.aggregate.average?.toFixed(1) ?? '—'} avg</span>
			<span>{data.aggregate.count} ratings</span>
			<span>Confidence {data.aggregate.confidenceAverage?.toFixed(1) ?? '—'}</span>
			<span class="status">{data.site.verify_status}</span>
			{#if data.site.http_status}<span>HTTP {data.site.http_status}</span>{/if}
		</div>
		<div class="actions">
			{#if data.visitHref}
				<a class="button" href={data.visitHref} target="_blank" rel="noopener noreferrer"
					>Visit Website</a
				>
			{:else}
				<span class="button-secondary" aria-disabled="true">Visit unavailable</span>
			{/if}
			<button type="button" class="button-secondary" disabled={busy} onclick={toggleFavorite}>
				{data.membership?.favorites ? 'Unfavorite' : 'Favorite'}
			</button>
			<a class="button-secondary" href="/websites/random">Next Random Website</a>
			<a class="button-ghost" href="/websites">All websites</a>
		</div>
	</header>

	<section class="panel">
		<h2>Your rating</h2>
		<p class="hint">One active rating per visitor. Updating replaces your previous score.</p>
		<div class="stars">
			{#each [1, 2, 3, 4, 5] as value}
				<button
					type="button"
					class:active={rating >= value}
					onclick={() => (rating = value)}
					aria-label={`${value} stars`}
				>
					★
				</button>
			{/each}
		</div>
		<textarea bind:value={review} rows="3" placeholder="Optional short review"></textarea>
		<div class="actions">
			<button type="button" class="button" disabled={busy} onclick={saveRating}>Save rating</button>
			{#if data.userRating}
				<button type="button" class="button-ghost" disabled={busy} onclick={clearRating}
					>Remove</button
				>
			{/if}
		</div>
		{#if message}<p class="hint">{message}</p>{/if}
	</section>

	<section class="panel">
		<h2>Source repositories</h2>
		{#if data.sourceRepos.length === 0}
			<p class="hint">No homepage-linked repositories matched yet.</p>
		{:else}
			<ul>
				{#each data.sourceRepos as repo}
					<li>
						<a href={`/repo/${repo.full_name}`}>{repo.full_name}</a>
						<span class="hint">★{repo.stars ?? 0} · {repo.language ?? 'n/a'}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="panel">
		<h2>Verification</h2>
		<ul class="meta-list">
			<li>First seen {timeAgo(data.site.first_seen_at)}</li>
			<li>Last verified {data.site.verified_at ? timeAgo(data.site.verified_at) : '—'}</li>
			<li>CT source: {data.site.source_ct ? 'yes' : 'no'}</li>
			<li>Zone source: {data.site.source_zone ? 'yes' : 'no'}</li>
			<li>Views: {data.site.view_count ?? 0}</li>
		</ul>
	</section>

	{#if data.reviews.length > 0}
		<section class="panel">
			<h2>Recent reviews</h2>
			<ul>
				{#each data.reviews as item}
					<li>
						<strong>{item.rating}★</strong>
						<span class="hint">{item.review}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</article>

<style>
	.website-detail {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.hero,
	.panel {
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--bg-elevated);
		padding: 1.1rem 1.2rem;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.72rem;
		color: var(--text-muted);
		margin: 0 0 0.35rem;
	}

	h1 {
		margin: 0;
		word-break: break-all;
	}

	.title {
		color: var(--text-muted);
	}

	.stats,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
		margin-top: 0.75rem;
	}

	.stats span,
	.hint,
	.meta-list {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.status {
		color: var(--green);
	}

	.stars button {
		border: 0;
		background: transparent;
		color: var(--border-strong);
		font-size: 1.4rem;
		cursor: pointer;
	}

	.stars button.active {
		color: var(--orange);
	}

	textarea {
		width: 100%;
		margin-top: 0.6rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-subtle);
		color: var(--text);
		padding: 0.65rem;
		font: inherit;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li {
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
</style>
