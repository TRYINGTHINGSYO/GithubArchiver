<script lang="ts">
	import { eventDisplay } from '$lib/events-ui';
	import { timeAgoShort } from '$lib/utils';

	let {
		owner,
		name,
		full_name,
		event_type,
		event_time
	}: {
		owner: string;
		name: string;
		full_name: string;
		event_type: string;
		event_time: string;
	} = $props();

	const display = $derived(eventDisplay(event_type));
</script>

<a class="event-row event-{display.color}" href="/repo/{owner}/{name}">
	<span class="event-icon" aria-hidden="true">{display.icon}</span>
	<span class="event-body">
		<strong class="event-label">{display.label}</strong>
		<span class="event-repo mono">{full_name}</span>
	</span>
	<time class="event-time" datetime={event_time} title={event_time}>{timeAgoShort(event_time)}</time>
</a>

<style>
	.event-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.55rem 0.35rem;
		border-bottom: 1px solid var(--border);
		text-decoration: none;
		color: inherit;
		border-radius: 6px;
	}

	.event-row:hover {
		background: var(--bg-hover);
		text-decoration: none;
	}

	.event-icon {
		font-size: 1.15rem;
		width: 1.75rem;
		text-align: center;
	}

	.event-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.event-label {
		font-size: 0.9rem;
		font-weight: 600;
	}

	.event-repo {
		font-size: 0.85rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.event-time {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
		white-space: nowrap;
	}

	.event-green .event-label {
		color: var(--green);
	}

	.event-blue .event-label {
		color: var(--accent);
	}

	.event-orange .event-label {
		color: var(--orange);
	}

	.event-purple .event-label {
		color: var(--purple);
	}

	.event-red .event-label {
		color: var(--red);
	}

	.event-muted .event-label {
		color: var(--text-muted);
	}
</style>
