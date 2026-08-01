<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { timeAgo } from '$lib/utils';

	let { data } = $props();
	let rating = $state(data.userRating?.rating ?? 0);
	let busy = $state(false);
	let message = $state('');

	$effect(() => {
		rating = data.userRating?.rating ?? 0;
	});

	function nextHref(overrides: Record<string, string | null> = {}) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const [key, value] of Object.entries(overrides)) {
			if (value == null) params.delete(key);
			else params.set(key, value);
		}
		const qs = params.toString();
		return qs ? `/websites/random?${qs}` : '/websites/random';
	}

	async function saveRating(value = rating) {
		if (!data.site || value < 1) return;
		busy = true;
		message = '';
		try {
			const res = await fetch(
				`/api/websites/${encodeURIComponent(data.site.registrable_domain)}/rating`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ rating: value })
				}
			);
			const json = await res.json();
			if (!res.ok) throw new Error(json.message ?? json.error ?? res.statusText);
			rating = value;
			message = 'Rated';
			await invalidateAll();
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function toggleFavorite() {
		if (!data.site) return;
		busy = true;
		try {
			const favorited = data.membership?.favorites;
			const res = await fetch(
				`/api/websites/${encodeURIComponent(data.site.registrable_domain)}/favorite`,
				{ method: favorited ? 'DELETE' : 'PUT' }
			);
			const json = await res.json();
			if (!res.ok) throw new Error(json.message ?? json.error ?? res.statusText);
			message = favorited ? 'Removed from favorites' : 'Favorited';
			await invalidateAll();
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function skipAndHide() {
		if (!data.site) {
			await goto(nextHref());
			return;
		}
		busy = true;
		try {
			await fetch(`/api/websites/${encodeURIComponent(data.site.registrable_domain)}/hide`, {
				method: 'PUT'
			});
			await goto(nextHref());
		} finally {
			busy = false;
		}
	}

	function onKeydown(event: KeyboardEvent) {
		const tag = (event.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		const key = event.key.toLowerCase();
		if (key === 'n') {
			event.preventDefault();
			void goto(nextHref());
		} else if (key === 's') {
			event.preventDefault();
			void skipAndHide();
		} else if (key === 'f') {
			event.preventDefault();
			void toggleFavorite();
		} else if (key === 'v' && data.visitHref) {
			event.preventDefault();
			window.open(data.visitHref, '_blank', 'noopener,noreferrer');
		} else if (key === 'r') {
			event.preventDefault();
			const next = rating >= 5 ? 1 : rating + 1 || 3;
			rating = next;
			void saveRating(next);
		} else if (key === 'c') {
			event.preventDefault();
			void goto('/favorites');
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
	<title>Random Website — GithubArchive+</title>
</svelte:head>

<section class="random-page">
	<header class="page-header">
		<p class="eyebrow">Website discovery</p>
		<h1>Random Website</h1>
		<p class="lede">
			Explicit visit only — nothing opens until you choose. Shortcuts:
			<kbd>N</kbd> next · <kbd>S</kbd> skip/hide · <kbd>F</kbd> favorite · <kbd>V</kbd> visit ·
			<kbd>R</kbd> rate · <kbd>C</kbd> collections
		</p>
		<form class="filters" method="GET" action="/websites/random">
			<label>
				Min quality
				<input
					type="number"
					name="min_quality"
					min="0"
					max="100"
					step="1"
					value={data.filters.minQuality ?? ''}
					placeholder="Any"
				/>
			</label>
			<label class="check">
				<input type="checkbox" name="working" value="1" checked={data.filters.workingOnly} />
				Working only
			</label>
			<label class="check">
				<input
					type="checkbox"
					name="mode"
					value="random"
					checked={data.filters.completelyRandom}
				/>
				Completely random
			</label>
			<button type="submit" class="button-secondary">Apply filters</button>
		</form>
	</header>

	{#if !data.site}
		<div class="empty panel">
			<p>No eligible live websites matched these filters (or all were recently shown/hidden).</p>
			<a class="button" href="/websites/random?mode=random">Try completely random</a>
			<a class="button-ghost" href="/websites">Browse all websites</a>
		</div>
	{:else}
		<article class="hero panel">
			<div class="preview" aria-hidden="true">
				<span class="preview-mark">{data.site.registrable_domain.slice(0, 1).toUpperCase()}</span>
				<p>Preview placeholder — screenshots arrive in a later phase</p>
			</div>
			<div class="copy">
				<p class="eyebrow">Live website</p>
				<h2>{data.site.registrable_domain}</h2>
				{#if data.site.page_title}
					<p class="title">{data.site.page_title}</p>
				{/if}
				<p class="why">{data.whyInteresting}</p>
				<div class="stats">
					<span>{data.aggregate?.average?.toFixed(1) ?? '—'} avg</span>
					<span>{data.aggregate?.count ?? 0} ratings</span>
					<span>Your rating: {data.userRating?.rating ?? '—'}</span>
					<span class="status">{data.site.verify_status}</span>
					{#if data.site.verified_at}
						<span>Verified {timeAgo(data.site.verified_at)}</span>
					{/if}
				</div>
				<div class="actions">
					{#if data.visitHref}
						<a class="button" href={data.visitHref} target="_blank" rel="noopener noreferrer"
							>Visit Website</a
						>
					{/if}
					<button type="button" class="button-secondary" disabled={busy} onclick={toggleFavorite}>
						{data.membership?.favorites ? 'Unfavorite' : 'Favorite'}
					</button>
					<a class="button-secondary" href={nextHref()}>Next Random Website</a>
					<button type="button" class="button-ghost" disabled={busy} onclick={skipAndHide}
						>Skip</button
					>
					<a
						class="button-ghost"
						href={`/websites/${encodeURIComponent(data.site.registrable_domain)}`}>Details</a
					>
				</div>
				{#if message}<p class="hint">{message}</p>{/if}
			</div>
		</article>

		<section class="panel">
			<h3>Rate this website</h3>
			<div class="stars">
				{#each [1, 2, 3, 4, 5] as value}
					<button
						type="button"
						class:active={rating >= value}
						onclick={() => {
							rating = value;
							void saveRating(value);
						}}
						aria-label={`${value} stars`}
						disabled={busy}
					>
						★
					</button>
				{/each}
			</div>
		</section>

		<section class="panel">
			<h3>Source repositories</h3>
			{#if data.sourceRepos.length === 0}
				<p class="hint">No homepage-linked repositories matched yet.</p>
			{:else}
				<ul>
					{#each data.sourceRepos as repo}
						<li>
							<a href={`/repo/${repo.full_name}`}>{repo.full_name}</a>
							<span class="hint">★{repo.stars ?? 0}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</section>

<style>
	.random-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding-bottom: 2rem;
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
		font-size: clamp(1.8rem, 3vw, 2.4rem);
	}

	.lede,
	.hint,
	.why,
	.title {
		color: var(--text-muted);
	}

	kbd {
		font-family: var(--font-mono, ui-monospace, monospace);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.05rem 0.35rem;
		background: var(--bg-subtle);
		font-size: 0.85em;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
		margin-top: 0.85rem;
	}

	.filters label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.filters label.check {
		flex-direction: row;
		align-items: center;
		padding-bottom: 0.35rem;
	}

	.filters input[type='number'] {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-subtle);
		color: var(--text);
		padding: 0.4rem 0.55rem;
		width: 7rem;
	}

	.panel {
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--bg-elevated);
		padding: 1.1rem 1.2rem;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr);
		gap: 1.25rem;
	}

	.preview {
		min-height: 220px;
		border-radius: 14px;
		border: 1px dashed color-mix(in srgb, var(--web-accent) 40%, var(--border));
		background:
			radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--web-accent) 22%, transparent), transparent 55%),
			var(--bg-subtle);
		display: grid;
		place-content: center;
		text-align: center;
		gap: 0.5rem;
		color: var(--text-muted);
		padding: 1rem;
	}

	.preview-mark {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 12px;
		display: grid;
		place-items: center;
		margin: 0 auto;
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--text);
		background: color-mix(in srgb, var(--web-accent) 25%, var(--bg-elevated));
	}

	h2 {
		margin: 0;
		word-break: break-all;
	}

	.stats,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		align-items: center;
		margin-top: 0.75rem;
	}

	.stats span {
		font-size: 0.88rem;
		color: var(--text-muted);
	}

	.status {
		color: var(--green);
	}

	.stars button {
		border: 0;
		background: transparent;
		color: var(--border-strong);
		font-size: 1.5rem;
		cursor: pointer;
	}

	.stars button.active {
		color: var(--orange);
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--border);
	}

	.empty {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
	}

	@media (max-width: 900px) {
		.hero {
			grid-template-columns: 1fr;
		}
	}
</style>
