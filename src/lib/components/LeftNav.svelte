<script lang="ts">
	import { page } from '$app/stores';
	import { NAV_SECTIONS } from '$lib/nav';
	import { onMount } from 'svelte';

	let { isAdmin = false }: { isAdmin?: boolean } = $props();

	const STORAGE_KEY = 'gha-nav-collapsed';
	let collapsed = $state<Record<string, boolean>>({});

	onMount(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) collapsed = JSON.parse(raw) as Record<string, boolean>;
		} catch {
			collapsed = {};
		}
	});

	function toggle(id: string) {
		collapsed = { ...collapsed, [id]: !collapsed[id] };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
	}

	function isActive(href: string): boolean {
		const path = $page.url.pathname;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(href.split('?')[0] + '/');
	}

	const sections = $derived(
		NAV_SECTIONS.filter((section) => section.id !== 'admin' || isAdmin)
	);
</script>

<nav class="left-nav" aria-label="Discovery">
	<a class="random-cta" href="/websites/random">Random Website</a>

	{#each sections as section}
		<div class="nav-section">
			<button
				type="button"
				class="section-toggle"
				aria-expanded={!collapsed[section.id]}
				onclick={() => toggle(section.id)}
			>
				<span>{section.title}</span>
				<span class="chevron" aria-hidden="true">{collapsed[section.id] ? '+' : '−'}</span>
			</button>
			{#if !collapsed[section.id]}
				<ul>
					{#each section.links as link}
						<li>
							<a
								href={link.href}
								class:active={isActive(link.href)}
								class:web={link.accent === 'web'}
								class:admin={link.accent === 'admin'}
								data-sveltekit-preload-code="hover"
							>
								{link.label}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/each}
</nav>

<style>
	.left-nav {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 0.25rem 0.15rem 2rem;
	}

	.random-cta {
		display: block;
		text-align: center;
		padding: 0.72rem 0.85rem;
		border-radius: 10px;
		background: color-mix(in srgb, var(--web-accent) 12%, var(--bg-subtle));
		border: 1px solid color-mix(in srgb, var(--web-accent) 38%, var(--border));
		color: var(--text);
		font-weight: 700;
		letter-spacing: 0;
		text-decoration: none;
	}

	.random-cta:hover {
		text-decoration: none;
		filter: brightness(1.08);
	}

	.section-toggle {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.4rem 0.25rem;
		cursor: pointer;
	}

	.chevron {
		font-family: var(--font-mono);
		opacity: 0.7;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 0.35rem;
	}

	a {
		display: block;
		padding: 0.42rem 0.5rem;
		border-radius: 8px;
		color: var(--text-muted);
		font-size: 0.94rem;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	a:hover {
		background: var(--bg-hover);
		color: var(--text);
		text-decoration: none;
	}

	a.active {
		background: var(--accent-dim);
		color: var(--text);
	}

	a.web.active {
		background: color-mix(in srgb, var(--web-accent) 18%, transparent);
	}
</style>
