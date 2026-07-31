<script lang="ts">
	import { onMount } from 'svelte';
	import {
		setCollectionMembership,
		subscribeCollectionMembership,
		type CollectionMembershipSnapshot,
		type SystemCollectionKind
	} from '$lib/collection-membership';

	let { repoId, full = false }: { repoId: number; full?: boolean } = $props();
	let membership = $state<CollectionMembershipSnapshot>({
		favorites: false,
		watch_later: false,
		hydrated: false,
		pending: []
	});
	let errorMessage = $state<string | null>(null);

	onMount(() => subscribeCollectionMembership(repoId, (next) => (membership = next)));

	async function toggle(kind: SystemCollectionKind): Promise<void> {
		errorMessage = null;
		try {
			await setCollectionMembership(repoId, kind, !membership[kind]);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to save repository.';
		}
	}
</script>

<div class="collection-controls" class:full aria-label="Save repository">
	<button
		type="button"
		class:active={membership.favorites}
		disabled={membership.pending.includes('favorites')}
		aria-pressed={membership.favorites}
		aria-label={membership.favorites ? 'Remove from Favorites' : 'Add to Favorites'}
		title={membership.favorites ? 'Remove from Favorites' : 'Add to Favorites'}
		onclick={() => toggle('favorites')}
	>
		<span aria-hidden="true">★</span>{#if full}<span>{membership.favorites ? 'Favorited' : 'Favorite'}</span>{/if}
	</button>
	<button
		type="button"
		class:active={membership.watch_later}
		disabled={membership.pending.includes('watch_later')}
		aria-pressed={membership.watch_later}
		aria-label={membership.watch_later ? 'Remove from Watch Later' : 'Add to Watch Later'}
		title={membership.watch_later ? 'Remove from Watch Later' : 'Add to Watch Later'}
		onclick={() => toggle('watch_later')}
	>
		<span aria-hidden="true">◷</span>{#if full}<span>{membership.watch_later ? 'Watching later' : 'Watch later'}</span>{/if}
	</button>
	{#if errorMessage}<span class="error" role="status">{errorMessage}</span>{/if}
</div>

<style>
	.collection-controls {
		position: relative;
		z-index: 3;
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 1.9rem;
		min-height: 1.9rem;
		justify-content: center;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.2rem 0.5rem;
		background: var(--bg-elevated);
		color: var(--text-muted);
		font: inherit;
		font-size: 0.75rem;
		line-height: 1.2;
		cursor: pointer;
	}

	button:hover,
	button.active {
		border-color: var(--accent);
		color: var(--accent);
	}

	button:first-child.active {
		border-color: color-mix(in srgb, var(--orange) 70%, var(--border));
		color: var(--orange);
	}

	button:disabled {
		opacity: 0.65;
		cursor: wait;
	}

	.full button {
		min-height: 2.1rem;
		padding: 0.4rem 0.7rem;
		border-radius: 6px;
		font-size: 0.85rem;
	}

	.error {
		color: var(--red);
		font-size: 0.75rem;
	}
</style>
