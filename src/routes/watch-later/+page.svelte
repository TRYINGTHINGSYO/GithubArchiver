<script lang="ts">
	import SavedRepositoriesPage from '$lib/components/SavedRepositoriesPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<SavedRepositoriesPage
	title="Watch Later"
	description="A lightweight queue for repositories you want to revisit."
	emptyMessage="Use the watch-later control on any repository card or repository page to build your queue."
	repositories={data.repositories}
	isAdmin={data.isAdmin}
/>
