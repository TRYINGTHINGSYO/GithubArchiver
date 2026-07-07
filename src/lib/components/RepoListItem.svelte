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
