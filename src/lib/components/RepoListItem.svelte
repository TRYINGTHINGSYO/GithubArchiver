<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import CollectionControls from '$lib/components/CollectionControls.svelte';
	import { repoDetailPath } from '$lib/repo-nav';
	import { formatDateShort, formatStarCount, timeAgo } from '$lib/utils';

	export interface RepoListItemData {
		id: number;
		owner: string;
		name: string;
		full_name: string;
		created_at: string;
		first_seen_at: string;
		description?: string | null;
		language?: string | null;
		stars?: number | null;
		forks?: number | null;
		license?: string | null;
		topics?: string[];
		summary?: string | null;
		category?: string | null;
		search_snippet?: string | null;
		match_reason?: 'semantic' | 'lexical' | 'hybrid' | 'quality' | null;
		deleted_at?: string | null;
		enriched_at?: string | null;
		is_favorite?: boolean;
		favorited_at?: string | null;
		archive_badges?: {
			preserved: boolean;
			readmeSaved: boolean;
			sourceSaved: boolean;
			storyReady: boolean;
			deletedButSaved: boolean;
			metadataOnly?: boolean;
		};
	}

	let { repo, isAdmin = false }: { repo: RepoListItemData; isAdmin?: boolean } = $props();
	let protectionPending = $state(false);
	let archiveProtected = $state(false);
	const topicChips = $derived((repo.topics ?? []).slice(0, 4));

	const detailHref = $derived(repoDetailPath(repo.owner, repo.name));
	const archiveSummary = $derived(
		repo.archive_badges?.metadataOnly
			? 'Metadata preserved; archive storage disabled'
			: repo.archive_badges?.sourceSaved
			? 'Source evidence saved locally'
			: repo.archive_badges?.readmeSaved
				? 'README evidence saved locally'
				: 'Awaiting preserved evidence'
	);
	const storySummary = $derived(
		repo.archive_badges?.storyReady
			? 'Archive story ready'
			: 'Story appears after snapshots and events'
	);

	$effect(() => {
		archiveProtected = Boolean(repo.is_favorite);
	});

	function evidenceHref(group: 'readme' | 'source' | 'timeline'): string {
		return `${detailHref}#evidence-${group}`;
	}

	async function toggleArchiveProtection() {
		protectionPending = true;
		try {
			const response = await fetch(`/api/repo/${repo.owner}/${repo.name}/actions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: archiveProtected ? 'unfavorite' : 'favorite' })
			});
			const body = (await response.json()) as { ok?: boolean; is_favorite?: boolean };
			if (response.ok && body.ok) {
				archiveProtected = Boolean(body.is_favorite);
				await invalidateAll();
			}
		} finally {
			protectionPending = false;
		}
	}
</script>

<li>
	<article class="repo-item">
		<a
			class="repo-item-main-link"
			href={detailHref}
			aria-label="Open intelligence for {repo.full_name}"
			data-sveltekit-preload-code="eager"
		></a>
		<div class="repo-card-head">
			<span class="repo-name">{repo.full_name}</span>
			<div class="repo-card-tools">
				<CollectionControls repoId={repo.id} />
				{#if isAdmin}
					<button
						type="button"
						class:protected={archiveProtected}
						onclick={toggleArchiveProtection}
						disabled={protectionPending}
						aria-pressed={archiveProtected}
						title={archiveProtected ? 'Protected during storage cleanup' : 'Protect this repo during storage cleanup'}
					>
						{archiveProtected ? 'Archive protected' : 'Protect archive'}
					</button>
				{/if}
				<span class="repo-time" title={repo.first_seen_at}>Seen {timeAgo(repo.first_seen_at)}</span>
			</div>
		</div>

		{#if repo.search_snippet}
			<p class="repo-summary">{@html repo.search_snippet}</p>
		{:else if repo.summary}
			<p class="repo-summary">{repo.summary}</p>
		{:else if repo.description}
			<p class="repo-summary">{repo.description}</p>
		{:else}
			<p class="repo-summary muted">No description yet — open it to fetch the full story from GitHub.</p>
		{/if}

		{#if repo.match_reason === 'semantic' || repo.match_reason === 'hybrid'}
			<p class="match-reason">Semantic match</p>
		{/if}

		{#if repo.category || topicChips.length}
			<div class="repo-tags" aria-label="Topics">
				{#if repo.category}<span class="topic-chip category">{repo.category}</span>{/if}
				{#each topicChips as topic}
					<span class="topic-chip">{topic}</span>
				{/each}
			</div>
		{/if}

		{#if repo.archive_badges?.metadataOnly || repo.archive_badges?.preserved || repo.archive_badges?.readmeSaved || repo.archive_badges?.sourceSaved || repo.archive_badges?.storyReady || repo.archive_badges?.deletedButSaved}
			<div class="archive-badges" aria-label="Archive badges">
				{#if repo.archive_badges.metadataOnly}<a class="archive-badge story" href={`${detailHref}#intelligence`}>Metadata only</a>{/if}
				{#if repo.archive_badges.deletedButSaved}<a class="archive-badge critical" href={evidenceHref('timeline')}>Deleted but saved</a>{/if}
				{#if repo.archive_badges.preserved}<a class="archive-badge saved" href={`${detailHref}#evidence`}>Preserved</a>{/if}
				{#if repo.archive_badges.readmeSaved}<a class="archive-badge" href={evidenceHref('readme')}>README saved</a>{/if}
				{#if repo.archive_badges.sourceSaved}<a class="archive-badge" href={evidenceHref('source')}>Source saved</a>{/if}
				{#if repo.archive_badges.storyReady}<a class="archive-badge story" href={`${detailHref}#archive-story`}>Story ready</a>{/if}
			</div>
		{/if}

		{#if repo.archive_badges}
			<div class="repo-intel" aria-label="Archive intelligence summary">
				<span>{archiveSummary}</span>
				<span>{storySummary}</span>
			</div>
		{/if}

		<div class="repo-meta" aria-label="Repository metadata">
			{#if repo.language}<span>{repo.language}</span>{/if}
			{#if repo.stars != null}<span title={`${repo.stars} stars`}>★ {formatStarCount(repo.stars)}</span>{/if}
			{#if repo.forks != null}<span>{formatStarCount(repo.forks)} forks</span>{/if}
			{#if repo.license}<span>{repo.license}</span>{/if}
			<span title={repo.created_at}>Created {formatDateShort(repo.created_at)}</span>
			{#if repo.deleted_at}<span class="badge deleted">deleted</span>{/if}
			{#if !repo.enriched_at}<span class="badge pending">details pending</span>{/if}
		</div>
	</article>
</li>

<style>
	.repo-item {
		position: relative;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			transform 0.15s ease;
	}

	.repo-item-main-link {
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: inherit;
	}

	.repo-item-main-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.repo-card-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: baseline;
	}

	.repo-card-tools {
		position: relative;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.45rem;
		align-items: center;
	}

	.repo-card-tools button,
	.repo-card-tools .protected {
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--bg-elevated);
		color: var(--text-muted);
		padding: 0.15rem 0.5rem;
		font: inherit;
		font-size: 0.75rem;
		line-height: 1.3;
	}

	.repo-card-tools button {
		cursor: pointer;
	}

	.repo-card-tools button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.repo-card-tools button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.repo-card-tools .protected {
		border-color: color-mix(in srgb, var(--green) 58%, var(--border));
		color: var(--green);
	}

	.repo-summary {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.92rem;
		line-height: 1.5;
	}

	.match-reason {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-muted);
		opacity: 0.9;
	}

	.muted {
		color: var(--text-muted);
	}

	.repo-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.topic-chip {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		font-size: 0.72rem;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-elevated, transparent) 80%, transparent);
	}

	.topic-chip.category {
		color: var(--text);
		border-color: color-mix(in srgb, var(--accent, #3b82f6) 40%, var(--border));
	}

	.archive-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.archive-badge {
		position: relative;
		z-index: 2;
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.12rem 0.5rem;
		color: var(--text-muted);
		font-size: 0.75rem;
		line-height: 1.35;
		text-decoration: none;
	}

	.archive-badge:hover {
		border-color: var(--accent);
		color: var(--accent);
		text-decoration: none;
	}

	.archive-badge.saved,
	.archive-badge.story {
		border-color: color-mix(in srgb, var(--green) 58%, var(--border));
		color: var(--green);
	}

	.archive-badge.critical {
		border-color: color-mix(in srgb, var(--orange) 70%, var(--border));
		color: var(--orange);
	}

	.repo-intel {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		color: var(--text-muted);
		font-size: 0.82rem;
	}

	.repo-intel span {
		border-left: 2px solid var(--border-strong);
		padding-left: 0.5rem;
	}

	@media (max-width: 640px) {
		.repo-card-head {
			display: grid;
			gap: 0.25rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.repo-item,
		.repo-item:hover {
			transform: none;
		}
	}
</style>
