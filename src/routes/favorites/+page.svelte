<script lang="ts">
	import SavedRepositoriesPage from '$lib/components/SavedRepositoriesPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<SavedRepositoriesPage
	title="Favorites"
	description="A focused shortlist of repositories you want to keep close."
	emptyMessage="Use the star control on any repository card or repository page to add a favorite."
	repositories={data.repositories}
	isAdmin={data.isAdmin}
/>
