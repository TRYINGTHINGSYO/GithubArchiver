<script lang="ts">
	import { timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function eventDetail(event: PageData['events'][number]): string | null {
		const p = event.payload;
		switch (event.event_type) {
			case 'renamed':
				return `${p.old_full_name} → ${p.new_full_name}`;
			case 'release_detected':
				return String(p.tag ?? p.name ?? '');
			case 'snapshot_created':
				return `${p.snapshot_type} · ${p.sha256 ? String(p.sha256).slice(0, 12) : ''}`;
			case 'readme_changed':
				return p.sha256 ? String(p.sha256).slice(0, 12) : null;
			case 'metadata_updated':
				return p.updated_at ? timeAgo(String(p.updated_at)) : null;
			case 'deleted':
				return String(p.full_name ?? '');
			default:
				return null;
		}
	}
</script>

<svelte:head>
	<title>{data.repo.full_name} Timeline — GithubArchive+</title>
</svelte:head>

<article class="repo-detail">
	<header>
		<h1 class="mono">{data.repo.full_name}</h1>
		<p class="description">Repository timeline — newest first</p>
		<div class="meta-grid">
			<a href="/repo/{data.repo.owner}/{data.repo.name}">← Repo detail</a>
			<a href="/">Home</a>
			{#if data.repo.deleted_at}
				<span class="badge deleted">deleted {timeAgo(data.repo.deleted_at)}</span>
			{/if}
		</div>
	</header>

	<section class="detail-section">
		<h2 class="section-title">Events</h2>
		{#if data.events.length === 0}
			<div class="empty-state"><p>No events recorded yet.</p></div>
		{:else}
			<ul class="timeline-list">
				{#each data.events as event}
					<li class="timeline-item">
						<span class="timeline-time">{timeAgo(event.event_time)}</span>
						<span class="timeline-label">{event.label}</span>
						{#if eventDetail(event)}
							<span class="timeline-detail mono">{eventDetail(event)}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if data.releases.length > 0}
		<section class="detail-section">
			<h2 class="section-title">Releases</h2>
			<ul class="timeline-list">
				{#each data.releases as release}
					<li class="timeline-item">
						<span class="timeline-time">
							{release.published_at ? timeAgo(release.published_at) : timeAgo(release.first_seen_at)}
						</span>
						<span class="timeline-label">{release.tag}</span>
						{#if release.name}<span class="timeline-detail">{release.name}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</article>
