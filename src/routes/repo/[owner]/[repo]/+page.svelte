<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { formatBytes, formatDateShort, shortSha, timeAgo } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let actionRunning = $state<string | null>(null);
	let actionMessage = $state<{ type: 'ok' | 'error'; text: string } | null>(null);
	let readmeVisible = $state(false);
	let readmeHost = $state<HTMLElement | null>(null);
	let sourceAnalysis = $state<PageData['sourceAnalysis']>(null);
	let fileQuery = $state('');
	let liveNotice = $state<string | null>(null);
	let changedSections = $state<string[]>([]);
	let latestRepoEventCursor = $state(new Date().toISOString());
	let liveNoticeTimer: ReturnType<typeof setTimeout> | null = null;
	const seenRepoEventKeys = new Set<string>();

	interface RepoEventApiItem {
		event_type: string;
		event_time: string;
		label?: string;
	}

	const visibleFiles = $derived(
		sourceAnalysis?.files
			.filter((file) => file.path.toLowerCase().includes(fileQuery.toLowerCase()))
			.slice(0, 80) ?? []
	);
	const latestReadmeId = $derived(data.latestReadme?.id);
	const lastActivity = $derived(data.repo.pushed_at ?? data.repo.updated_at ?? data.repo.created_at);
	const keyFacts = $derived([
		{ label: 'Stars', value: data.repo.stars?.toLocaleString() ?? 'Unknown' },
		{ label: 'Language', value: data.repo.language ?? 'Unknown' },
		{ label: 'License', value: data.repo.license ?? 'Unknown' },
		{ label: 'Last activity', value: lastActivity ? timeAgo(lastActivity) : 'Unknown' }
	]);

	$effect(() => {
		if (!sourceAnalysis && data.sourceAnalysis) sourceAnalysis = data.sourceAnalysis;
	});

	onMount(() => {
		let observer: IntersectionObserver | null = null;
		if (readmeHost) {
			observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((entry) => entry.isIntersecting)) {
						readmeVisible = true;
						observer?.disconnect();
					}
				},
				{ rootMargin: '320px' }
			);
			observer.observe(readmeHost);
		}

		const liveInterval = window.setInterval(() => {
			void pollRepoEvents();
		}, 20_000);

		return () => {
			observer?.disconnect();
			window.clearInterval(liveInterval);
			if (liveNoticeTimer) window.clearTimeout(liveNoticeTimer);
		};
	});

	function dateLabel(value: string | null | undefined): string {
		return value ? formatDateShort(value) : 'Unknown';
	}

	async function runRepoAction(action: 'archive' | 'refresh' | 'reanalyze-source') {
		actionRunning = action;
		actionMessage = null;
		try {
			const response = await fetch(`/api/repo/${data.repo.owner}/${data.repo.name}/actions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action })
			});
			const body = (await response.json()) as {
				ok?: boolean;
				message?: string;
				error?: string;
				analysis?: typeof data.sourceAnalysis;
			};
			if (!response.ok || !body.ok) {
				actionMessage = { type: 'error', text: body.error ?? `Action failed: ${action}` };
				return;
			}
			if (body.analysis) sourceAnalysis = body.analysis;
			actionMessage = { type: 'ok', text: body.message ?? `Action complete: ${action}` };
			if (action !== 'reanalyze-source') await invalidateAll();
		} catch (err) {
			actionMessage = { type: 'error', text: err instanceof Error ? err.message : String(err) };
		} finally {
			actionRunning = null;
		}
	}

	function analyzeOnOpen(event: Event) {
		const detail = event.currentTarget as HTMLDetailsElement;
		if (detail.open && data.latestSource && !sourceAnalysis && !actionRunning) {
			void runRepoAction('reanalyze-source');
		}
	}

	async function pollRepoEvents() {
		try {
			const response = await fetch(
				`/api/events?repo_id=${data.repo.id}&since=${encodeURIComponent(latestRepoEventCursor)}&limit=20`
			);
			if (!response.ok) return;
			const body = (await response.json()) as { events?: RepoEventApiItem[] };
			const freshEvents = (body.events ?? [])
				.filter((event) => Number.isFinite(new Date(event.event_time).getTime()))
				.filter((event) => {
					const key = `${event.event_time}:${event.event_type}`;
					if (seenRepoEventKeys.has(key)) return false;
					seenRepoEventKeys.add(key);
					return true;
				});
			if (!freshEvents.length) return;

			const newest = freshEvents
				.map((event) => event.event_time)
				.sort()
				.at(-1);
			if (newest) latestRepoEventCursor = newest;

			changedSections = [...new Set(freshEvents.map((event) => sectionForEvent(event.event_type)))];
			liveNotice = freshEvents.length === 1
				? `${freshEvents[0].label ?? 'Repository updated'} moments ago`
				: `${freshEvents.length} repository updates moments ago`;

			if (liveNoticeTimer) window.clearTimeout(liveNoticeTimer);
			liveNoticeTimer = window.setTimeout(() => {
				liveNotice = null;
				changedSections = [];
			}, 9000);
		} catch {
			// Polling should never interrupt reading the repo page.
		}
	}

	function sectionForEvent(eventType: string): string {
		if (eventType === 'readme_changed') return 'readme';
		if (eventType === 'snapshot_created') return 'archive';
		if (eventType === 'release_detected') return 'releases';
		if (eventType === 'metrics_updated') return 'signal';
		if (eventType === 'metadata_updated' || eventType === 'renamed') return 'hero';
		if (eventType === 'archived' || eventType === 'unarchived' || eventType === 'deleted') return 'signal';
		return 'hero';
	}

	function hasSectionUpdate(section: string): boolean {
		return changedSections.includes(section);
	}
</script>

<svelte:head>
	<title>{data.repo.full_name} - GithubArchive+</title>
</svelte:head>

<div class="action-bar">
	<button type="button" onclick={() => runRepoAction('archive')} disabled={Boolean(actionRunning)}>
		{actionRunning === 'archive' ? 'Archiving' : 'Archive'}
	</button>
	<button type="button" onclick={() => runRepoAction('refresh')} disabled={Boolean(actionRunning)}>
		{actionRunning === 'refresh' ? 'Refreshing' : 'Refresh'}
	</button>
	<button type="button" onclick={() => runRepoAction('reanalyze-source')} disabled={Boolean(actionRunning || !data.latestSource)}>
		{actionRunning === 'reanalyze-source' ? 'Analyzing' : 'Re-analyze'}
	</button>
	<a href={data.repo.github_url} target="_blank" rel="noopener noreferrer">View GitHub</a>
	<a href="/repo/{data.repo.owner}/{data.repo.name}/timeline">Timeline</a>
</div>

{#if actionMessage}
	<p class:action-ok={actionMessage.type === 'ok'} class:action-error={actionMessage.type === 'error'} class="action-message">
		{actionMessage.text}
	</p>
{/if}

{#if liveNotice}
	<p class="live-notice">{liveNotice}</p>
{/if}

<article class="repo-story">
	<header class="hero" class:soft-update={hasSectionUpdate('hero')}>
		<img class="owner-avatar" src={data.repo.owner_avatar_url} alt="{data.repo.owner} avatar" loading="eager" />
		<div class="hero-copy">
			<div class="eyebrow">
				<span>{data.repo.owner}</span>
				{#if data.repo.owner_type}<span>{data.repo.owner_type}</span>{/if}
				<span>{data.repo.visibility}</span>
				{#if data.repo.github_archived}<span class="warn">GitHub archived</span>{/if}
				{#if data.repo.deleted_at}<span class="warn">Deleted</span>{/if}
			</div>
			<h1 class="mono">{data.repo.name}</h1>
			<p class="definition">{data.summary.definition}</p>
			<div class="meta-line">
				<span class="mono">{data.repo.full_name}</span>
				<span>Created {dateLabel(data.repo.created_at)}</span>
				<span>Seen {dateLabel(data.repo.first_seen_at)}</span>
				{#if data.repo.enriched_at}<span>Enriched {dateLabel(data.repo.enriched_at)}</span>{/if}
			</div>
			{#if data.repo.homepage}
				<a class="homepage" href={data.repo.homepage} target="_blank" rel="noopener noreferrer">{data.repo.homepage}</a>
			{/if}
		</div>
	</header>

	{#if data.truthNotices.length}
		<div class="truth-notices">
			{#each data.truthNotices as notice}
				<p>{notice.message}</p>
			{/each}
		</div>
	{/if}

	<section class="explanation" aria-label="Plain language project explanation">
		<p>{data.summary.definition}</p>
		<p>{data.summary.use_case}</p>
		<p>{data.summary.stack_guess}</p>
		<p>{data.summary.maturity_signal}</p>
	</section>

	<section class="key-facts" aria-label="Key repository facts">
		{#each keyFacts as fact}
			<div>
				<span>{fact.label}</span>
				<strong>{fact.value}</strong>
			</div>
		{/each}
	</section>

	<section class="signal-card" class:soft-update={hasSectionUpdate('signal')} title={data.projectSignal.explanation}>
		<div class="signal-meter" style={`--score: ${data.projectSignal.score}%`}>
			<strong>{data.projectSignal.score}</strong>
			<span>Project Signal</span>
		</div>
		<div>
			<h2>{data.projectSignal.label}</h2>
			<p>{data.projectSignal.explanation}</p>
			<div class="signal-breakdown">
				{#each Object.entries(data.projectSignal.breakdown) as [label, value]}
					<span>{label}: {value}</span>
				{/each}
			</div>
		</div>
	</section>

	{#if data.repo.topics.length || data.technologies.length || data.links.length}
		<section class="context-strip">
			{#each data.repo.topics.slice(0, 8) as topic}
				<span>{topic}</span>
			{/each}
			{#each data.technologies.slice(0, 6) as tech}
				<span>{tech.name}</span>
			{/each}
			{#each data.links.slice(0, 3) as link}
				<a href={link.url} target="_blank" rel="noopener noreferrer">{link.type}</a>
			{/each}
		</section>
	{/if}

	{#if data.latestReadme && data.readmeHtml}
		<section class="readme-section" class:soft-update={hasSectionUpdate('readme')} bind:this={readmeHost}>
			<div class="section-title-row">
				<h2>README</h2>
				<p>Archived {timeAgo(data.latestReadme.archived_at)} · {formatBytes(data.latestReadme.file_size)}</p>
			</div>
			{#if readmeVisible}
				<div class="readme-content">{@html data.readmeHtml}</div>
			{:else}
				<div class="readme-shell">README will render when it scrolls into view.</div>
			{/if}
			{#if data.readmeSnapshots.length > 1}
				<div class="inline-history">
					{#each data.readmeSnapshots.slice(1, 5) as snap}
						{#if latestReadmeId}
							<a href="/repo/{data.repo.owner}/{data.repo.name}/compare-readme?from={snap.id}&to={latestReadmeId}">
								Compare {timeAgo(snap.archived_at)}
							</a>
						{/if}
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	{#if data.latestSource}
		<details class="fold" class:soft-update={hasSectionUpdate('archive')} ontoggle={analyzeOnOpen}>
			<summary>
				<span>Source structure</span>
				<small>{data.latestSource.file_exists ? `${formatBytes(data.latestSource.file_size)} archived source` : 'source snapshot missing'}</small>
			</summary>
			{#if actionRunning === 'reanalyze-source'}
				<p class="muted">Analyzing source snapshot...</p>
			{:else if sourceAnalysis?.available}
				<div class="source-grid">
					<div>
						<p class="muted">{sourceAnalysis.file_count.toLocaleString()} files · {sourceAnalysis.folder_count.toLocaleString()} folders · {formatBytes(sourceAnalysis.total_bytes)}</p>
						<input class="filter-input" bind:value={fileQuery} placeholder="Search archived file names" />
						<div class="file-list">
							{#each visibleFiles as file}
								<div><span class="mono">{file.path}</span><small>{formatBytes(file.size)}</small></div>
							{/each}
						</div>
					</div>
					<div>
						{#each sourceAnalysis.language_breakdown as item}
							<div class="bar-row">
								<span>{item.language}</span>
								<div><i style={`width: ${item.percent}%`}></i></div>
								<small>{item.percent}%</small>
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<p class="muted">{sourceAnalysis?.error ?? 'Open this section to analyze the latest source snapshot.'}</p>
			{/if}
		</details>
	{/if}

	{#if data.releases.length}
		<details class="fold" class:soft-update={hasSectionUpdate('releases')} open={data.releases.length <= 2}>
			<summary>
				<span>Releases</span>
				<small>{data.releases.length} release/tag record(s)</small>
			</summary>
			<div class="release-list">
				{#each data.releases.slice(0, 5) as release}
					<article>
						<strong>{release.name || release.tag}</strong>
						<span class="mono">{release.tag}</span>
						<small>{release.published_at ? timeAgo(release.published_at) : `seen ${timeAgo(release.first_seen_at)}`}</small>
					</article>
				{/each}
			</div>
		</details>
	{/if}

	<details class="fold" class:soft-update={hasSectionUpdate('archive')}>
		<summary>
			<span>Archive timeline</span>
			<small>{data.localArchive.total_snapshots.toLocaleString()} snapshots · {formatBytes(data.localArchive.total_bytes)}</small>
		</summary>
		<ul class="timeline-list">
			{#each data.mergedTimeline.slice(0, 18) as item}
				<li class="timeline-item">
					<span class="timeline-time">{timeAgo(item.time)}</span>
					<span class="timeline-label">{item.label}</span>
					<span class="timeline-detail">{item.detail ?? item.type}</span>
				</li>
			{/each}
		</ul>
		{#if data.snapshots.length}
			<div class="snapshot-row">
				{#each data.snapshots.slice(0, 8) as snap}
					<a href={snap.download_url} class:missing={!snap.file_exists}>
						{snap.snapshot_type} #{snap.id} · {shortSha(snap.sha256, 8)}
					</a>
				{/each}
			</div>
		{/if}
	</details>

	{#if data.related.length}
		<section class="related">
			<div class="section-title-row">
				<h2>Related projects</h2>
				<p>Top local matches</p>
			</div>
			<div class="related-list">
				{#each data.related.slice(0, 5) as repo}
					<a href="/repo/{repo.owner}/{repo.name}">
						<strong class="mono">{repo.full_name}</strong>
						<span>{repo.language ?? 'Unknown language'}</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</article>

<p class="back-link"><a href="/">Back to feed</a></p>

<style>
	.action-bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.6rem 0;
		margin: -0.5rem 0 1rem;
		background: color-mix(in srgb, var(--bg) 92%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--border);
	}

	.action-bar button,
	.action-bar a {
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-elevated);
		color: var(--accent);
		padding: 0.45rem 0.7rem;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}

	.action-bar button:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.action-message {
		margin: 0 0 1rem;
		font-size: 0.9rem;
	}

	.live-notice {
		margin: 0 0 1rem;
		border: 1px solid color-mix(in srgb, var(--green) 45%, var(--border));
		border-radius: 8px;
		padding: 0.65rem 0.8rem;
		background: color-mix(in srgb, var(--green) 12%, var(--bg-elevated));
		color: var(--text);
		font-size: 0.9rem;
	}

	.action-ok {
		color: var(--green);
	}

	.action-error {
		color: var(--red);
	}

	.repo-story {
		display: grid;
		gap: 1.25rem;
	}

	.soft-update {
		animation: soft-live-pulse 2.4s ease-out;
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--green) 42%, transparent);
	}

	@keyframes soft-live-pulse {
		0% {
			background: color-mix(in srgb, var(--green) 16%, var(--bg-elevated));
		}
		100% {
			background: transparent;
		}
	}

	.hero {
		display: grid;
		grid-template-columns: 86px minmax(0, 1fr);
		gap: 1rem;
		padding-bottom: 1.25rem;
		border-bottom: 1px solid var(--border);
	}

	.owner-avatar {
		width: 86px;
		height: 86px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
	}

	.eyebrow,
	.meta-line,
	.context-strip,
	.signal-breakdown,
	.inline-history,
	.snapshot-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.85rem;
		align-items: center;
	}

	.eyebrow,
	.meta-line {
		color: var(--text-muted);
		font-size: 0.86rem;
	}

	.eyebrow span,
	.context-strip span,
	.context-strip a {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.12rem 0.5rem;
	}

	.eyebrow .warn {
		color: var(--orange);
		border-color: var(--orange);
	}

	h1 {
		margin: 0.25rem 0;
		font-size: clamp(2rem, 5vw, 3.4rem);
		line-height: 1;
		overflow-wrap: anywhere;
	}

	.definition {
		margin: 0.6rem 0;
		font-size: 1.05rem;
		color: var(--text);
		max-width: 76ch;
	}

	.homepage {
		display: inline-block;
		margin-top: 0.6rem;
		overflow-wrap: anywhere;
	}

	.truth-notices {
		border-left: 3px solid var(--orange);
		padding: 0.35rem 0 0.35rem 0.8rem;
		color: var(--text-muted);
	}

	.truth-notices p {
		margin: 0.25rem 0;
	}

	.explanation {
		display: grid;
		gap: 0.45rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
	}

	.explanation p {
		margin: 0;
	}

	.key-facts {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.key-facts div,
	.signal-card,
	.fold,
	.related {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-elevated);
	}

	.key-facts div {
		padding: 0.8rem;
	}

	.key-facts span,
	.signal-card p,
	.signal-breakdown,
	.section-title-row p,
	.muted,
	.release-list small,
	.related-list span {
		color: var(--text-muted);
	}

	.key-facts strong {
		display: block;
		margin-top: 0.2rem;
		font-size: 1.05rem;
	}

	.signal-card {
		display: grid;
		grid-template-columns: 108px minmax(0, 1fr);
		gap: 1rem;
		align-items: center;
		padding: 1rem;
	}

	.signal-meter {
		width: 96px;
		height: 96px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: conic-gradient(var(--green) var(--score), var(--bg-hover) 0);
		position: relative;
	}

	.signal-meter::before {
		content: '';
		position: absolute;
		inset: 9px;
		border-radius: 50%;
		background: var(--bg-elevated);
	}

	.signal-meter strong,
	.signal-meter span {
		position: relative;
		line-height: 1;
	}

	.signal-meter strong {
		font-size: 1.5rem;
	}

	.signal-meter span {
		font-size: 0.66rem;
		color: var(--text-muted);
		margin-top: 1.9rem;
	}

	.signal-card h2 {
		margin: 0;
	}

	.signal-card p {
		margin: 0.35rem 0;
	}

	.signal-breakdown {
		font-size: 0.84rem;
	}

	.context-strip {
		font-size: 0.85rem;
	}

	.readme-section {
		content-visibility: auto;
		contain-intrinsic-size: 900px;
	}

	.section-title-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: baseline;
		margin-bottom: 0.75rem;
	}

	.section-title-row h2 {
		margin: 0;
	}

	.section-title-row p {
		margin: 0;
		font-size: 0.9rem;
	}

	.readme-shell {
		border: 1px dashed var(--border);
		border-radius: 8px;
		padding: 2rem;
		color: var(--text-muted);
		background: var(--bg-elevated);
	}

	.inline-history,
	.snapshot-row {
		margin-top: 0.75rem;
		font-size: 0.9rem;
	}

	.fold {
		content-visibility: auto;
		contain-intrinsic-size: 320px;
	}

	.fold summary {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		cursor: pointer;
	}

	.fold summary span {
		font-weight: 700;
	}

	.fold summary small {
		color: var(--text-muted);
	}

	.fold[open] {
		padding-bottom: 1rem;
	}

	.fold > :not(summary) {
		margin-left: 1rem;
		margin-right: 1rem;
	}

	.source-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(240px, 0.8fr);
		gap: 1rem;
	}

	.file-list {
		max-height: 340px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 8px;
		margin-top: 0.75rem;
	}

	.file-list div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.45rem 0.65rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.86rem;
		overflow-wrap: anywhere;
	}

	.bar-row {
		display: grid;
		grid-template-columns: 110px 1fr 48px;
		gap: 0.65rem;
		align-items: center;
		margin-bottom: 0.55rem;
		font-size: 0.9rem;
	}

	.bar-row div {
		height: 8px;
		border-radius: 999px;
		background: var(--bg-hover);
		overflow: hidden;
	}

	.bar-row i {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.release-list,
	.related-list {
		display: grid;
		gap: 0.6rem;
	}

	.release-list article,
	.related-list a {
		display: grid;
		gap: 0.2rem;
		border-top: 1px solid var(--border);
		padding-top: 0.65rem;
	}

	.timeline-list {
		margin-top: 0.5rem;
	}

	.snapshot-row a.missing {
		opacity: 0.55;
	}

	.related {
		padding: 1rem;
	}

	.back-link {
		margin-top: 2rem;
	}

	.readme-content {
		content-visibility: auto;
		contain-intrinsic-size: 800px;
	}

	.readme-content :global(img) {
		max-width: 100%;
		height: auto;
	}

	.readme-content :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 1rem 0;
	}

	.readme-content :global(th),
	.readme-content :global(td) {
		border: 1px solid var(--border);
		padding: 0.45rem 0.6rem;
	}

	.readme-content :global(input[type='checkbox']) {
		margin-right: 0.4rem;
	}

	@media (max-width: 820px) {
		.action-bar {
			position: static;
		}

		.action-bar button,
		.action-bar a {
			flex: 1 1 calc(50% - 0.5rem);
			text-align: center;
		}

		.hero,
		.signal-card,
		.source-grid {
			grid-template-columns: 1fr;
		}

		.key-facts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.owner-avatar {
			width: 72px;
			height: 72px;
		}

		.fold summary,
		.section-title-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.timeline-item {
			grid-template-columns: 1fr;
		}
	}
</style>
