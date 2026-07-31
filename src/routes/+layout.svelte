<script lang="ts">
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { navigating } from '$app/state';
	import '../app.css';
	import ActivityStatusBar from '$lib/components/ActivityStatusBar.svelte';

	let { children, data } = $props();
	let navigationStartedAt = 0;
	let showNavigationProgress = $state(false);
	let navigationProgressTimer: ReturnType<typeof setTimeout> | null = null;

	beforeNavigate(({ to }) => {
		if (!to) return;
		navigationStartedAt = performance.now();
		performance.mark('gha:navigation-start');
		if (navigationProgressTimer) clearTimeout(navigationProgressTimer);
		navigationProgressTimer = setTimeout(() => {
			showNavigationProgress = true;
		}, 100);
	});

	afterNavigate(({ to }) => {
		if (navigationProgressTimer) {
			clearTimeout(navigationProgressTimer);
			navigationProgressTimer = null;
		}
		showNavigationProgress = false;
		if (to && navigationStartedAt > 0) {
			performance.mark('gha:navigation-rendered');
			performance.measure('gha:navigation', 'gha:navigation-start', 'gha:navigation-rendered');
		}
		navigationStartedAt = 0;
	});
</script>

{#if navigating.to && showNavigationProgress}
	<div class="navigation-progress" aria-label="Loading page"></div>
{/if}

<header class="site-header">
	<div class="container header-bar">
		<a href="/" class="logo" data-sveltekit-preload-code="eager">Github<span>Archive+</span></a>
		<nav class="desktop-nav" aria-label="Primary">
			<span class="nav-tagline">Evidence-first repository intelligence</span>
			<a href="/discover" class="admin-link" data-sveltekit-preload-code="eager">Discover</a>
			<a href="/discover/emerging" class="admin-link" data-sveltekit-preload-code="eager">Emerging</a>
			<a href="/discover/fastest-growing" class="admin-link" data-sveltekit-preload-code="eager">Clusters</a>
			<a href="/birth-feed" class="admin-link">Birth Feed</a>
			<a href="/websites" class="admin-link">Websites</a>
			<a href="/search" class="admin-link" data-sveltekit-preload-code="eager">Search</a>
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
	<a href="/search">Search</a>
	{#if data.isAdmin}
		<a href="/admin">Admin</a>
	{:else}
		<a href="/login">Login</a>
	{/if}
</nav>
