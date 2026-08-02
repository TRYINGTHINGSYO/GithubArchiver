<script lang="ts">
	import SavedRepositoriesPage from '$lib/components/SavedRepositoriesPage.svelte';
	import WebsiteCard from '$lib/components/WebsiteCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<SavedRepositoriesPage
	title="Favorites"
	description="Repositories and websites are favorited independently — starring a repo never favorites its website."
	emptyMessage="Use the star control on any repository card or repository page to add a favorite repository."
	repositories={data.repositories}
	isAdmin={data.isAdmin}
/>

<section class="website-favorites">
	<header>
		<h2>Favorite websites</h2>
		<p>Website favorites live in the same system collection without linking repository membership.</p>
	</header>
	{#if data.websites.length === 0}
		<p class="empty">No favorite websites yet. Favorite from a website detail or Random Website page.</p>
	{:else}
		<div class="website-grid">
			{#each data.websites as site (site.registrable_domain)}
				<WebsiteCard
					site={{
						registrable_domain: site.registrable_domain,
						source_ct: 0,
						source_zone: 0,
						first_seen_at: site.collection_created_at,
						verified_at: site.verified_at,
						http_status: null,
						final_url: null,
						page_title: site.page_title,
						verify_status: site.verify_status as 'live',
						rating_avg: site.rating_avg,
						rating_count: site.rating_count
					}}
					density="comfortable"
				/>
			{/each}
		</div>
	{/if}
</section>

<style>
	.website-favorites {
		margin: 1.5rem 0 2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	header h2 {
		margin: 0 0 0.35rem;
	}

	header p,
	.empty {
		color: var(--text-muted);
		margin: 0 0 1rem;
	}
</style>
