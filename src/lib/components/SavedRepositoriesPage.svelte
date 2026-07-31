<script lang="ts">
	import RepoListItem from '$lib/components/RepoListItem.svelte';

	interface SavedRepository {
		id: number;
		owner: string;
		name: string;
		full_name: string;
		created_at: string;
		first_seen_at: string;
		description: string | null;
		summary: string | null;
		language: string | null;
		stars: number | null;
		forks: number | null;
		license: string | null;
		topics: string[];
		deleted_at: string | null;
		enriched_at: string | null;
		collection_created_at: string;
		is_favorite: boolean;
		favorited_at: string | null;
	}

	let {
		title,
		description,
		emptyMessage,
		repositories,
		isAdmin
	}: {
		title: string;
		description: string;
		emptyMessage: string;
		repositories: SavedRepository[];
		isAdmin: boolean;
	} = $props();
</script>

<svelte:head>
	<title>{title} - GithubArchive+</title>
</svelte:head>

<header class="saved-header">
	<p class="eyebrow">Your saved repositories</p>
	<h1>{title}</h1>
	<p>{description}</p>
	<nav aria-label="Saved repository views">
		<a href="/favorites" aria-current={title === 'Favorites' ? 'page' : undefined}>Favorites</a>
		<a href="/watch-later" aria-current={title === 'Watch Later' ? 'page' : undefined}>Watch Later</a>
	</nav>
</header>

{#if repositories.length > 0}
	<p class="count">{repositories.length.toLocaleString()} saved {repositories.length === 1 ? 'repository' : 'repositories'}</p>
	<ul class="repo-list saved-list">
		{#each repositories as repo (repo.id)}
			<RepoListItem {repo} {isAdmin} />
		{/each}
	</ul>
{:else}
	<section class="empty-state">
		<h2>Nothing saved here yet</h2>
		<p>{emptyMessage}</p>
		<a class="browse" href="/discover">Browse discovery</a>
	</section>
{/if}

<style>
	.saved-header {
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--bg-elevated);
		padding: clamp(1rem, 3vw, 2rem);
		margin-bottom: 1rem;
	}

	.eyebrow {
		margin: 0;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0.35rem 0;
	}

	.saved-header > p:not(.eyebrow),
	.count,
	.empty-state p {
		color: var(--text-muted);
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	nav a,
	.browse {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.4rem 0.75rem;
		color: var(--text-muted);
		text-decoration: none;
	}

	nav a[aria-current='page'],
	nav a:hover,
	.browse:hover {
		border-color: var(--accent);
		color: var(--accent);
		text-decoration: none;
	}

	.saved-list {
		padding: 0;
	}

	.saved-list :global(> li) {
		list-style: none;
		border-bottom: 1px solid var(--border);
		padding: 1rem 0;
	}

	.empty-state {
		border: 1px dashed var(--border-strong);
		border-radius: 12px;
		padding: 2rem;
		text-align: center;
	}
</style>
