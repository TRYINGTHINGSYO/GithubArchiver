<script lang="ts">
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { navigating } from '$app/state';
	import '../app.css';
	import ActivityStatusBar from '$lib/components/ActivityStatusBar.svelte';
	import LeftNav from '$lib/components/LeftNav.svelte';
	import RightRail from '$lib/components/RightRail.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { onMount } from 'svelte';

	let { children, data } = $props();
	let navigationStartedAt = 0;
	let showNavigationProgress = $state(false);
	let navigationProgressTimer: ReturnType<typeof setTimeout> | null = null;
	let leftCollapsed = $state(false);
	let rightCollapsed = $state(false);
	let mobileNavOpen = $state(false);

	onMount(() => {
		try {
			leftCollapsed = localStorage.getItem('gha-left-collapsed') === '1';
			rightCollapsed = localStorage.getItem('gha-right-collapsed') === '1';
		} catch {
			/* ignore */
		}
	});

	function persistRails() {
		localStorage.setItem('gha-left-collapsed', leftCollapsed ? '1' : '0');
		localStorage.setItem('gha-right-collapsed', rightCollapsed ? '1' : '0');
	}

	beforeNavigate(({ to }) => {
		if (!to) return;
		navigationStartedAt = performance.now();
		performance.mark('gha:navigation-start');
		if (navigationProgressTimer) clearTimeout(navigationProgressTimer);
		navigationProgressTimer = setTimeout(() => {
			showNavigationProgress = true;
		}, 100);
		mobileNavOpen = false;
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

	const railRepos = $derived(
		(data.railRepos ?? []).map((repo) => ({
			full_name: repo.full_name,
			score: repo.interesting_score
		}))
	);
	const railWebsites = $derived(
		(data.railWebsites ?? []).map((site) => ({
			domain: site.registrable_domain,
			title: site.page_title,
			rating: site.rating_avg ?? null
		}))
	);
</script>

{#if navigating.to && showNavigationProgress}
	<div class="navigation-progress" aria-label="Loading page"></div>
{/if}

<header class="site-header">
	<div class="container header-bar">
		<div class="brand-cluster">
			<button
				type="button"
				class="mobile-nav-btn"
				aria-label="Open navigation"
				onclick={() => (mobileNavOpen = !mobileNavOpen)}
			>
				Menu
			</button>
			<a href="/" class="logo" data-sveltekit-preload-code="eager"
				>Github<span>Archive+</span></a
			>
		</div>
		<p class="nav-tagline desktop-only">Repository intelligence · Website discovery</p>
		<nav class="desktop-nav" aria-label="Primary shortcuts">
			<a href="/discover" class="admin-link">Discover</a>
			<a href="/websites" class="admin-link">Websites</a>
			<a href="/websites/random" class="admin-link">Random</a>
			<a href="/search" class="admin-link">Search</a>
			<a href="/favorites" class="admin-link">Saved</a>
			{#if data.isAdmin}
				<a href="/admin" class="admin-link">Admin</a>
				<a href="/logout" class="admin-link">Logout</a>
			{:else}
				<a href="/login" class="admin-link">Login</a>
			{/if}
			<ThemeToggle />
		</nav>
	</div>
</header>

{#if data.activity}
	<ActivityStatusBar initial={data.activity} />
{/if}

<div
	class="app-shell"
	class:left-collapsed={leftCollapsed}
	class:right-collapsed={rightCollapsed}
>
	<aside class="shell-pane shell-left shell-rail-card" class:open-mobile={mobileNavOpen}>
		<button
			type="button"
			class="shell-collapse-btn desktop-only"
			onclick={() => {
				leftCollapsed = !leftCollapsed;
				persistRails();
			}}
		>
			{leftCollapsed ? 'Show nav' : 'Collapse nav'}
		</button>
		{#if !leftCollapsed || mobileNavOpen}
			<LeftNav isAdmin={data.isAdmin} />
		{/if}
	</aside>

	<main class="shell-center">
		{@render children()}
	</main>

	<aside class="shell-pane shell-right shell-rail-card">
		<button
			type="button"
			class="shell-collapse-btn desktop-only"
			onclick={() => {
				rightCollapsed = !rightCollapsed;
				persistRails();
			}}
		>
			{rightCollapsed ? 'Show rail' : 'Collapse rail'}
		</button>
		{#if !rightCollapsed}
			<RightRail trendingRepos={railRepos} trendingWebsites={railWebsites} />
		{/if}
	</aside>
</div>

<nav class="mobile-tabbar" aria-label="Primary mobile navigation">
	<a href="/">Home</a>
	<a href="/discover">Discover</a>
	<a href="/websites">Websites</a>
	<a href="/websites/random">Random</a>
	<a href="/favorites">Saved</a>
	{#if data.isAdmin}
		<a href="/admin">Admin</a>
	{:else}
		<a href="/login">Login</a>
	{/if}
</nav>

<style>
	.brand-cluster {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}

	.mobile-nav-btn {
		display: none;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-muted);
		border-radius: 8px;
		padding: 0.3rem 0.55rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.desktop-only {
		display: inline-flex;
	}

	@media (max-width: 1100px) {
		.mobile-nav-btn {
			display: inline-flex;
		}

		.desktop-only {
			display: none;
		}
	}
</style>
