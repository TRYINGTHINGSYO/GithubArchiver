<script lang="ts">
	import { page } from '$app/stores';

	const tabs = [
		{ href: '/admin', label: 'Control' },
		{ href: '/admin/jobs', label: 'Job history' },
		{ href: '/admin/doctor', label: 'Health' },
		{ href: '/admin/storage', label: 'Storage' }
	];

	let { children } = $props();
</script>

<nav class="admin-tabs">
	{#each tabs as tab}
		<a
			href={tab.href}
			class:active={$page.url.pathname === tab.href || ($page.url.pathname === '/admin/status' && tab.href === '/admin')}
		>
			{tab.label}
		</a>
	{/each}
</nav>

{@render children()}

<style>
	.admin-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 1.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
	}

	.admin-tabs a {
		padding: 0.45rem 0.85rem;
		border-radius: 6px;
		font-size: 0.9rem;
		color: var(--text-muted);
		text-decoration: none;
		border: 1px solid transparent;
	}

	.admin-tabs a:hover {
		color: var(--text);
		background: var(--bg-elevated);
	}

	.admin-tabs a.active {
		color: var(--text);
		background: var(--bg-elevated);
		border-color: var(--border);
		font-weight: 600;
	}
</style>
