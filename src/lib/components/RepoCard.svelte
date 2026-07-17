<script lang="ts">
	import { buildInterestHints } from '$lib/interest-hints';
	import { formatCategoryLabel } from '$lib/category-labels';
	import { repoDetailPath } from '$lib/repo-nav';
	import { formatDateShort, formatStarDisplay, starTier, timeAgo } from '$lib/utils';

	export interface RepoCardData {
		owner: string;
		name: string;
		full_name: string;
		created_at: string;
		first_seen_at: string;
		description?: string | null;
		summary?: string | null;
		category?: string | null;
		language?: string | null;
		license?: string | null;
		stars?: number | null;
		topics?: string[];
		pushed_at?: string | null;
		updated_at?: string | null;
		last_checked_at?: string | null;
		enriched_at?: string | null;
		deleted_at?: string | null;
		enriched?: boolean;
		archived?: boolean;
		has_readme?: boolean;
		has_release?: boolean;
		moment_tag?: string;
		velocity?: 'up' | 'down' | 'flat';
		search_snippet?: string | null;
		download_zip_url?: string | null;
	}

	let { repo, showInterest = true }: { repo: RepoCardData; showInterest?: boolean } = $props();

	const tier = $derived(starTier(repo.stars));
	const hints = $derived(
		showInterest
			? buildInterestHints({
					moment_tag: repo.moment_tag,
					velocity: repo.velocity,
					stars: repo.stars,
					has_readme: repo.has_readme,
					has_release: repo.has_release,
					topics: repo.topics,
					deleted_at: repo.deleted_at
				})
			: []
	);

	const lastActivity = $derived(repo.last_checked_at ?? repo.updated_at ?? repo.pushed_at);
	const categoryLabel = $derived(formatCategoryLabel(repo.category));
	const blurb = $derived(repo.summary?.trim() || repo.description);
	const repoHref = $derived(repoDetailPath(repo.owner, repo.name));
</script>

<li class="repo-card">
	<a class="repo-card-main" href={repoHref} aria-label="View {repo.full_name}">
	<div class="repo-card-head">
		<span class="repo-name">{repo.full_name}</span>
		{#if repo.stars != null}
			<span class="star-rating" title="{formatStarDisplay(repo.stars)} stars">
				{#each Array(5) as _, i}
					<span class="star" class:filled={i < tier}>★</span>
				{/each}
				<span class="star-count">{formatStarDisplay(repo.stars)}</span>
			</span>
		{/if}
	</div>

	<div class="repo-facts">
		{#if repo.language}<span class="fact lang">{repo.language}</span>{/if}
		{#if categoryLabel}<span class="fact category">{categoryLabel}</span>{/if}
		{#if repo.license}<span class="fact">{repo.license}</span>{/if}
		<span class="fact muted" title={repo.created_at}>Created {timeAgo(repo.created_at)}</span>
		{#if lastActivity}
			<span class="fact muted" title={lastActivity}>Updated {timeAgo(lastActivity)}</span>
		{/if}
	</div>

	<div class="status-icons" aria-label="Repository status">
		{#if repo.enriched || repo.enriched_at}
			<span class="status-icon" title="Enriched">✓</span>
		{:else}
			<span class="status-icon pending" title="Awaiting enrichment">⏳</span>
		{/if}
		{#if repo.has_readme}
			<span class="status-icon" title="README archived">📖</span>
		{/if}
		{#if repo.archived}
			<span class="status-icon" title="Snapshot archived">📦</span>
		{/if}
		{#if repo.has_release}
			<span class="status-icon" title="Has releases">🚀</span>
		{/if}
		{#if repo.velocity === 'up'}
			<span class="status-icon up" title="Growing">📈</span>
		{/if}
		{#if repo.deleted_at}
			<span class="status-icon deleted" title="Deleted">⚠</span>
		{/if}
	</div>

	{#if repo.topics && repo.topics.length > 0}
		<div class="topic-row">
			{#each repo.topics.slice(0, 4) as topic}
				<span class="topic">{topic}</span>
			{/each}
		</div>
	{/if}

	{#if repo.search_snippet}
		<p class="search-snippet">{@html repo.search_snippet}</p>
	{:else if blurb}
		<p class="description">{blurb}</p>
	{/if}

	{#if hints.length > 0}
		<div class="interest">
			<span class="interest-label">Interesting because:</span>
			<ul>
				{#each hints as hint}
					<li>{hint}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="repo-foot muted">
		<span title={repo.first_seen_at}>First seen {timeAgo(repo.first_seen_at)}</span>
		{#if repo.moment_tag}<span class="moment">{repo.moment_tag}</span>{/if}
	</div>
	</a>

	<div class="repo-card-actions">
		{#if repo.download_zip_url}
			<a
				class="download-zip"
				href={repo.download_zip_url}
				download
			>
				Download ZIP
			</a>
		{/if}
	</div>

</li>

<style>
	.repo-card {
		border-bottom: 1px solid var(--border);
		padding: 1rem 0;
		list-style: none;
	}

	.repo-card:hover {
		background: var(--bg-hover);
		margin: 0 -0.5rem;
		padding-left: 0.5rem;
		padding-right: 0.5rem;
		border-radius: 8px;
	}

	.repo-card-main {
		display: block;
		color: inherit;
		text-decoration: none;
		min-width: 0;
	}

	.repo-card-main:hover {
		text-decoration: none;
	}

	.repo-card-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem 1rem;
		margin-bottom: 0.35rem;
		min-width: 0;
	}

	.repo-name {
		font-family: var(--font-mono);
		font-size: 1rem;
		font-weight: 700;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.star-rating {
		display: inline-flex;
		align-items: center;
		gap: 0.1rem;
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.star {
		color: var(--border);
	}

	.star.filled {
		color: var(--orange);
	}

	.star-count {
		margin-left: 0.35rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}

	.repo-facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.85rem;
		font-size: 0.85rem;
		margin-bottom: 0.45rem;
	}

	.fact.lang {
		color: var(--accent);
		font-weight: 500;
	}

	.fact.category {
		color: var(--purple);
		font-weight: 500;
	}

	.fact.muted,
	.muted {
		color: var(--text-muted);
	}

	.status-icons {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.45rem;
	}

	.status-icon {
		width: 1.65rem;
		height: 1.65rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 0.85rem;
		background: var(--bg-elevated);
		cursor: default;
	}

	.status-icon.pending {
		border-color: var(--orange);
	}

	.status-icon.up {
		border-color: var(--green);
	}

	.status-icon.deleted {
		border-color: var(--red);
	}

	.topic-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.45rem;
	}

	.topic {
		font-size: 0.75rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--text-muted);
	}

	.description,
	.search-snippet {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: 0 0 0.45rem;
		line-height: 1.45;
	}

	.search-snippet :global(mark) {
		background: var(--accent-dim);
		color: var(--accent);
		padding: 0 0.15rem;
		border-radius: 2px;
	}

	.interest {
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
		margin-bottom: 0.45rem;
		font-size: 0.82rem;
	}

	.interest-label {
		display: block;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 0.25rem;
	}

	.interest ul {
		margin: 0;
		padding-left: 1.1rem;
		color: var(--text-muted);
	}

	.interest li {
		margin: 0.1rem 0;
	}

	.repo-card-actions {
		margin-bottom: 0.45rem;
	}

	.download-zip {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.28rem 0.55rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
		background: var(--bg-elevated);
	}

	.download-zip:hover {
		background: var(--bg-hover);
		text-decoration: none;
	}

	.repo-foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.78rem;
	}

	.moment {
		color: var(--accent);
		text-transform: capitalize;
	}
</style>
