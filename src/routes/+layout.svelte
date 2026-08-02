<script lang="ts">
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import '../app.css';
	import ActivityStatusBar from '$lib/components/ActivityStatusBar.svelte';
	import LeftNav from '$lib/components/LeftNav.svelte';
	import RightRail from '$lib/components/RightRail.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { activateModalDrawer, type ModalDrawerLifecycle } from '$lib/modal-drawer';
	import { onDestroy, onMount, tick } from 'svelte';

	let { children, data } = $props();
	let navigationStartedAt = 0;
	let showNavigationProgress = $state(false);
	let navigationProgressTimer: ReturnType<typeof setTimeout> | null = null;
	let leftCollapsed = $state(false);
	let rightCollapsed = $state(false);
	let mobileNavOpen = $state(false);
	let mobileNavTrigger: HTMLButtonElement;
	let mobileNavDrawer: HTMLElement;
	let mobileDrawerLifecycle: ModalDrawerLifecycle | null = null;
	let restoreMobileNavFocusAfterNavigation = false;

	async function openMobileNav() {
		if (mobileNavOpen) return;
		mobileNavOpen = true;
		await tick();
		if (!mobileNavOpen || !mobileNavDrawer || !mobileNavTrigger) return;
		mobileDrawerLifecycle?.deactivate({ restoreFocus: false });
		mobileDrawerLifecycle = activateModalDrawer({
			drawer: mobileNavDrawer,
			trigger: mobileNavTrigger,
			onRequestClose: closeMobileNav
		});
	}

	function closeMobileNav(restoreFocus = true) {
		if (!mobileNavOpen && !mobileDrawerLifecycle) return;
		mobileNavOpen = false;
		mobileDrawerLifecycle?.deactivate({ restoreFocus: false });
		mobileDrawerLifecycle = null;
		if (restoreFocus) {
			void tick().then(() => {
				if (!mobileNavOpen && mobileNavTrigger?.isConnected) mobileNavTrigger.focus();
			});
		}
	}

	function toggleMobileNav() {
		if (mobileNavOpen) closeMobileNav();
		else void openMobileNav();
	}

	function isMobileActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		if (href === '/websites/random') return path === href;
		if (href === '/websites') return path.startsWith('/websites') && path !== '/websites/random';
		return path === href || path.startsWith(`${href}/`);
	}

	onMount(() => {
		try {
			leftCollapsed = localStorage.getItem('gha-left-collapsed') === '1';
			rightCollapsed = localStorage.getItem('gha-right-collapsed') === '1';
		} catch {
			/* ignore */
		}
	});

	onDestroy(() => {
		closeMobileNav(false);
		if (navigationProgressTimer) clearTimeout(navigationProgressTimer);
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
		if (mobileNavOpen) {
			restoreMobileNavFocusAfterNavigation = true;
			closeMobileNav(false);
		}
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
		if (restoreMobileNavFocusAfterNavigation) {
			restoreMobileNavFocusAfterNavigation = false;
			void tick().then(() => {
				if (mobileNavTrigger?.isConnected) mobileNavTrigger.focus();
			});
		}
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
				bind:this={mobileNavTrigger}
				type="button"
				class="mobile-nav-btn"
				aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
				aria-expanded={mobileNavOpen}
				aria-controls="mobile-navigation-drawer"
				onclick={toggleMobileNav}
			>
				{mobileNavOpen ? 'Close' : 'Menu'}
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
			{#if data.user}
				<span class="admin-link" title={data.user.email ?? undefined}>
					{data.user.githubLogin ? `@${data.user.githubLogin}` : (data.user.name ?? 'Account')}
				</span>
				{#if data.isAdmin}<a href="/admin" class="admin-link">Admin</a>{/if}
				<a href="/logout" class="admin-link">Logout</a>
			{:else}
				<a href="/login" class="admin-link">Login</a>
			{/if}
			<ThemeToggle />
		</nav>
	</div>
	{#if data.activity}
		<ActivityStatusBar initial={data.activity} />
	{/if}
</header>

{#if mobileNavOpen}
	<button
		type="button"
		class="mobile-nav-backdrop"
		aria-label="Close navigation"
		onclick={() => closeMobileNav()}
	></button>
{/if}

<div
	class="app-shell"
	class:left-collapsed={leftCollapsed}
	class:right-collapsed={rightCollapsed}
>
	<aside
		bind:this={mobileNavDrawer}
		id="mobile-navigation-drawer"
		class="shell-pane shell-left shell-rail-card"
		class:open-mobile={mobileNavOpen}
		role={mobileNavOpen ? 'dialog' : undefined}
		aria-modal={mobileNavOpen ? 'true' : undefined}
		aria-label={mobileNavOpen ? 'Navigation' : undefined}
		tabindex="-1"
	>
		<div class="mobile-drawer-header">
			<strong>Navigation</strong>
			<button type="button" onclick={() => closeMobileNav()}>Close</button>
		</div>
		<button
			type="button"
			class="shell-collapse-btn desktop-only"
			aria-label={leftCollapsed ? 'Expand navigation' : 'Collapse navigation'}
			title={leftCollapsed ? 'Expand navigation' : 'Collapse navigation'}
			onclick={() => {
				leftCollapsed = !leftCollapsed;
				persistRails();
			}}
		>
			<span class="shell-collapse-glyph" aria-hidden="true">{leftCollapsed ? '›' : '‹'}</span>
			{#if !leftCollapsed}<span>Hide navigation</span>{/if}
		</button>
		{#if !leftCollapsed || mobileNavOpen}
			<LeftNav isAdmin={data.isAdmin} />
			<div class="mobile-drawer-actions">
				{#if data.user}
					<a href="/logout">Log out</a>
				{:else}
					<a href="/login">Log in</a>
				{/if}
				<ThemeToggle />
			</div>
		{/if}
	</aside>

	<main class="shell-center">
		{@render children()}
	</main>

	<aside class="shell-pane shell-right shell-rail-card">
		<button
			type="button"
			class="shell-collapse-btn desktop-only"
			aria-label={rightCollapsed ? 'Expand intelligence rail' : 'Collapse intelligence rail'}
			title={rightCollapsed ? 'Expand intelligence rail' : 'Collapse intelligence rail'}
			onclick={() => {
				rightCollapsed = !rightCollapsed;
				persistRails();
			}}
		>
			{#if !rightCollapsed}<span>Hide insights</span>{/if}
			<span class="shell-collapse-glyph" aria-hidden="true">{rightCollapsed ? '‹' : '›'}</span>
		</button>
		{#if !rightCollapsed}
			<RightRail trendingRepos={railRepos} trendingWebsites={railWebsites} />
		{/if}
	</aside>
</div>

<nav class="mobile-tabbar" aria-label="Primary mobile navigation">
	<a href="/" class:active={isMobileActive('/')} aria-current={isMobileActive('/') ? 'page' : undefined}>Home</a>
	<a href="/discover" class:active={isMobileActive('/discover')} aria-current={isMobileActive('/discover') ? 'page' : undefined}>Discover</a>
	<a href="/websites" class:active={isMobileActive('/websites')} aria-current={isMobileActive('/websites') ? 'page' : undefined}>Websites</a>
	<a href="/websites/random" class:active={isMobileActive('/websites/random')} aria-current={isMobileActive('/websites/random') ? 'page' : undefined}>Random</a>
	<a href="/favorites" class:active={isMobileActive('/favorites')} aria-current={isMobileActive('/favorites') ? 'page' : undefined}>Saved</a>
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
		min-block-size: 2.75rem;
		min-inline-size: 2.75rem;
	}

	.mobile-drawer-header,
	.mobile-drawer-actions {
		display: none;
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

		.mobile-drawer-header,
		.mobile-drawer-actions {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 0.75rem;
		}

		.mobile-drawer-header {
			position: sticky;
			top: -0.75rem;
			z-index: 1;
			margin: -0.75rem -0.75rem 0.75rem;
			padding: 0.8rem 0.85rem;
			border-bottom: 1px solid var(--border);
			background: var(--bg-elevated);
		}

		.mobile-drawer-header button,
		.mobile-drawer-actions a {
			min-block-size: 2.75rem;
			min-inline-size: 2.75rem;
			border: 1px solid var(--border);
			border-radius: 9px;
			background: var(--bg-subtle);
			color: var(--text);
			padding: 0.45rem 0.75rem;
			font: inherit;
			text-decoration: none;
			cursor: pointer;
		}

		.mobile-drawer-actions {
			position: sticky;
			bottom: -0.75rem;
			margin: 0.5rem -0.75rem -0.75rem;
			padding: 0.75rem;
			border-top: 1px solid var(--border);
			background: var(--bg-elevated);
		}

		#mobile-navigation-drawer :global(.left-nav a),
		#mobile-navigation-drawer :global(.section-toggle),
		.mobile-drawer-actions :global(.theme-toggle) {
			display: flex;
			align-items: center;
			min-block-size: 2.75rem;
			min-inline-size: 2.75rem;
		}

		#mobile-navigation-drawer :global(.random-cta) {
			justify-content: center;
		}
	}
</style>
