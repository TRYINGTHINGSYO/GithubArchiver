<script lang="ts">
	import { onMount } from 'svelte';

	let open = $state(false);
	let query = $state('');
	let loading = $state(false);
	let results = $state<{ full_name: string; owner: string; name: string; description: string | null }[]>([]);

	let inputEl = $state<HTMLInputElement | null>(null);

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const typing = target?.matches('input, textarea, select, [contenteditable="true"]');
			if (e.key === '/' && !typing) {
				e.preventDefault();
				open = true;
				requestAnimationFrame(() => inputEl?.focus());
			}
			if (e.key === 'Escape' && open) {
				open = false;
				query = '';
				results = [];
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function onInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => void search(), 200);
	}

	async function search() {
		const q = query.trim();
		if (!q) {
			results = [];
			return;
		}
		loading = true;
		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&per_page=12`);
			if (!res.ok) return;
			const body = (await res.json()) as {
				repos: { full_name: string; owner: string; name: string; description: string | null }[];
			};
			results = body.repos ?? [];
		} finally {
			loading = false;
		}
	}

	function close() {
		open = false;
		query = '';
		results = [];
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="palette-backdrop" onclick={close} role="presentation"></div>
	<div class="palette" role="dialog" aria-label="Search repositories">
		<input
			bind:this={inputEl}
			bind:value={query}
			oninput={onInput}
			class="palette-input"
			placeholder="Search repositories…"
			autocomplete="off"
		/>
		{#if loading}
			<p class="palette-meta">Searching…</p>
		{:else if query.trim() && results.length === 0}
			<p class="palette-meta">No results</p>
		{:else}
			<ul class="palette-results">
				{#each results as repo}
					<li>
						<a href="/repo/{repo.owner}/{repo.name}" onclick={close}>
							<strong class="mono">{repo.full_name}</strong>
							{#if repo.description}<span>{repo.description}</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="palette-hint">Press <kbd>Esc</kbd> to close</p>
	</div>
{/if}

<style>
	.palette-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 200;
	}

	.palette {
		position: fixed;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(560px, calc(100vw - 2rem));
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
		z-index: 201;
		padding: 0.75rem;
	}

	.palette-input {
		width: 100%;
		padding: 0.75rem 1rem;
		font-size: 1rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
	}

	.palette-results {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		max-height: 320px;
		overflow: auto;
	}

	.palette-results a {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.55rem 0.65rem;
		border-radius: 6px;
		color: inherit;
		text-decoration: none;
	}

	.palette-results a:hover {
		background: var(--bg-hover);
		text-decoration: none;
	}

	.palette-results span {
		font-size: 0.82rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.palette-meta,
	.palette-hint {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin: 0.5rem 0.25rem 0;
	}

	.palette-hint kbd {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		padding: 0.1rem 0.35rem;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
</style>
