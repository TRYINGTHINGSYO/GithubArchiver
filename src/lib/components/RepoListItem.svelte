<script lang="ts">
	import { repoDetailPath } from '$lib/repo-nav';
	import { formatDateShort, timeAgo } from '$lib/utils';

	export interface RepoListItemData {
		owner: string;
		name: string;
		full_name: string;
		created_at: string;
		first_seen_at: string;
		description?: string | null;
		language?: string | null;
		stars?: number | null;
		search_snippet?: string | null;
		deleted_at?: string | null;
		enriched_at?: string | null;
		archive_badges?: {
			preserved: boolean;
			readmeSaved: boolean;
			sourceSaved: boolean;
			storyReady: boolean;
			deletedButSaved: boolean;
		};
	}

	let { repo }: { repo: RepoListItemData } = $props();
</script>

<li>
	<a class="repo-item" href={repoDetailPath(repo.owner, repo.name)}>
		<div class="repo-dates">
			<span class="repo-time" title={repo.first_seen_at}>
				First seen by archive: {timeAgo(repo.first_seen_at)}
			</span>
			<span class="repo-time muted" title={repo.created_at}>
				GitHub created: {timeAgo(repo.created_at)} ({formatDateShort(repo.created_at)})
			</span>
		</div>
		<span class="repo-name">{repo.full_name}</span>
		{#if repo.archive_badges?.preserved || repo.archive_badges?.readmeSaved || repo.archive_badges?.sourceSaved || repo.archive_badges?.storyReady || repo.archive_badges?.deletedButSaved}
			<div class="archive-badges" aria-label="Archive badges">
				{#if repo.archive_badges.deletedButSaved}<span class="archive-badge critical">Deleted but saved</span>{/if}
				{#if repo.archive_badges.preserved}<span class="archive-badge saved">Preserved</span>{/if}
				{#if repo.archive_badges.readmeSaved}<span class="archive-badge">README saved</span>{/if}
				{#if repo.archive_badges.sourceSaved}<span class="archive-badge">Source saved</span>{/if}
				{#if repo.archive_badges.storyReady}<span class="archive-badge story">Story ready</span>{/if}
			</div>
		{/if}
		<div class="repo-meta">
			{#if repo.language}<span>{repo.language}</span>{/if}
			{#if repo.stars !== null}<span>★ {repo.stars}</span>{/if}
			{#if repo.search_snippet}
				<span class="search-snippet">{@html repo.search_snippet}</span>
			{:else if repo.description}
				<span>{repo.description}</span>
			{/if}
			{#if repo.deleted_at}<span class="badge deleted">deleted</span>{/if}
			{#if !repo.enriched_at}<span class="badge pending">not enriched</span>{/if}
		</div>
	</a>
</li>

<style>
	.archive-badges {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.15rem;
	}

	.archive-badge {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.08rem 0.45rem;
		color: var(--text-muted);
		font-size: 0.74rem;
		line-height: 1.35;
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
</style>
