<script lang="ts">
	import '../app.css';
	import ActivityStatusBar from '$lib/components/ActivityStatusBar.svelte';

	let { children, data } = $props();
</script>

<header class="site-header">
	<div class="container header-bar">
		<a href="/" class="logo">Github<span>Archive+</span></a>
		<nav class="desktop-nav" aria-label="Primary">
			<span class="nav-tagline">Evidence-first repository intelligence</span>
			<a href="/discover" class="admin-link">Discover</a>
			<a href="/discover/emerging" class="admin-link">Emerging</a>
			<a href="/discover/fastest-growing" class="admin-link">Clusters</a>
			<a href="/birth-feed" class="admin-link">Birth Feed</a>
			<a href="/memory" class="admin-link">Memory</a>
			<a href="/#repository-search" class="admin-link">Search</a>
			{#if data.isAdmin}
				<a href="/admin" class="admin-link">Admin</a>
				<a href="/logout" class="admin-link">Logout</a>
			{:else}
				<a href="/login" class="admin-link">Login</a>
			{/if}
		</nav>
	</div>
</header>

{#if data.activity}
	<ActivityStatusBar initial={data.activity} />
{/if}

<main class="container">
	{@render children()}
</main>

<nav class="mobile-tabbar" aria-label="Primary mobile navigation">
	<a href="/">Home</a>
	<a href="/discover">Discover</a>
	<a href="/memory">Memory</a>
	{#if data.isAdmin}
		<a href="/admin">Admin</a>
	{:else}
		<a href="/login">Login</a>
	{/if}
</nav>
