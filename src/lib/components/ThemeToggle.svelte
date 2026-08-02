<script lang="ts">
	import { applyTheme, readStoredTheme, storeTheme, type ThemeMode } from '$lib/theme';
	import { onMount } from 'svelte';

	let mode = $state<ThemeMode>('system');

	onMount(() => {
		mode = readStoredTheme();
		applyTheme(mode);
		const mq = window.matchMedia('(prefers-color-scheme: light)');
		const onChange = () => {
			if (mode === 'system') applyTheme('system');
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	function cycle() {
		const order: ThemeMode[] = ['system', 'light', 'dark'];
		mode = order[(order.indexOf(mode) + 1) % order.length];
		storeTheme(mode);
		applyTheme(mode);
	}
</script>

<button type="button" class="theme-toggle" onclick={cycle} aria-label={`Theme: ${mode}`}>
	{mode === 'system' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark'}
</button>

<style>
	.theme-toggle {
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text-muted);
		border-radius: 999px;
		padding: 0.25rem 0.65rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.theme-toggle:hover {
		color: var(--text);
		border-color: var(--border-strong);
	}
</style>
