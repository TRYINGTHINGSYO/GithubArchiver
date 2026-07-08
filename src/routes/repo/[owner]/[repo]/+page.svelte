<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { formatCategoryLabel } from '$lib/category-labels';
	import FileBrowser from '$lib/components/FileBrowser.svelte';
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
		{ label: 'Category', value: formatCategoryLabel(data.repo.category) ?? 'Unknown' },
		{ label: 'Last activity', value: lastActivity ? timeAgo(lastActivity) : 'Unknown' }
	]);

	const categoryLabel = $derived(formatCategoryLabel(data.repo.category));

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

	async function runRepoAction(action: 'archive' | 'refresh' | 'reanalyze-source' | 'favorite' | 'unfavorite') {
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
	{#if data.isAdmin}
		{#if data.metadataOnly}
			<button type="button" disabled title="Archive storage is disabled in metadata-only mode">
				Archive storage disabled
			</button>
		{:else}
			<button type="button" onclick={() => runRepoAction('archive')} disabled={Boolean(actionRunning)}>
				{actionRunning === 'archive' ? 'Archiving' : 'Archive'}
			</button>
		{/if}
		<button type="button" onclick={() => runRepoAction('refresh')} disabled={Boolean(actionRunning)}>
			{actionRunning === 'refresh' ? 'Refreshing' : 'Refresh'}
		</button>
		<button type="button" onclick={() => runRepoAction('reanalyze-source')} disabled={Boolean(actionRunning || !data.latestSource)}>
			{actionRunning === 'reanalyze-source' ? 'Analyzing' : 'Re-analyze'}
		</button>
		<button
			type="button"
			class:favorited={data.repo.is_favorite}
			onclick={() => runRepoAction(data.repo.is_favorite ? 'unfavorite' : 'favorite')}
			disabled={Boolean(actionRunning)}
		>
			{actionRunning === 'favorite' || actionRunning === 'unfavorite'
				? 'Saving favorite'
				: data.repo.is_favorite
					? 'Favorited'
					: 'Favorite'}
		</button>
	{/if}
	<a href={data.repo.github_url} target="_blank" rel="noopener noreferrer">View GitHub</a>
	<a href="/repo/{data.repo.owner}/{data.repo.name}/timeline">Timeline</a>
	{#if data.downloadZipUrl}
		<a class="download-zip" href={data.downloadZipUrl} download>Download ZIP</a>
	{/if}
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
			{#if data.repo.summary && data.repo.summary !== data.repo.description}
				<p class="archive-summary">Archive summary: {data.repo.summary}</p>
			{/if}
			<div class="meta-line">
				<span class="mono">{data.repo.full_name}</span>
				{#if categoryLabel}
					<span class="category-pill" title="Classified {data.repo.classified_at ? timeAgo(data.repo.classified_at) : 'recently'}">
						{categoryLabel}
						{#if data.repo.category_confidence != null}
							· {Math.round(data.repo.category_confidence * 100)}%
						{/if}
					</span>
				{/if}
				<span>Created {dateLabel(data.repo.created_at)}</span>
				<span>Seen {dateLabel(data.repo.first_seen_at)}</span>
				{#if data.repo.enriched_at}<span>Enriched {dateLabel(data.repo.enriched_at)}</span>{/if}
			</div>
			{#if data.repo.homepage}
				<a class="homepage" href={data.repo.homepage} target="_blank" rel="noopener noreferrer">{data.repo.homepage}</a>
			{/if}
		</div>
	</header>

	<nav class="repo-section-nav" aria-label="Repository page sections">
		<a href="#intelligence">Intelligence</a>
		<a href="#archive-story">Archive Story</a>
		<a href="#evidence">Evidence Explorer</a>
		<a href="#readme">README</a>
		<a href="#source">Source</a>
		<a href="#timeline">Timeline</a>
	</nav>

	{#if data.truthNotices.length}
		<div class="truth-notices">
			{#each data.truthNotices as notice}
				<p>{notice.message}</p>
			{/each}
		</div>
	{/if}

	<section class="intelligence-report" id="intelligence" aria-label="Repository Intelligence Report">
		<div class="report-head">
			<div>
				<p class="report-kicker">Repository Intelligence</p>
				<h2>What this archive understands</h2>
			</div>
			<span class="status-pill">{data.intelligenceReport.currentStatus}</span>
		</div>

		<div class="report-grid">
			<div class="report-answer">
				<span>What is this?</span>
				<p>{data.intelligenceReport.identity}</p>
			</div>
			<div class="report-answer">
				<span>Who is it for?</span>
				<p>{data.intelligenceReport.purpose}</p>
			</div>
			<div class="report-answer wide">
				<span>Why archive it?</span>
				<p>{data.intelligenceReport.whyArchive}</p>
			</div>
		</div>

		<div class="score-row">
			<div class="score-panel" id="archive-score">
				<div class="score-ring" style={`--score: ${data.intelligenceReport.archiveScore.score}%`}>
					<strong>{data.intelligenceReport.archiveScore.score}</strong>
					<span>Archive Score</span>
				</div>
				<div>
					<h3>{data.intelligenceReport.archiveScore.label}</h3>
					<ul>
						{#each data.intelligenceReport.archiveScore.reasons.slice(0, 4) as reason}
							<li>{reason}</li>
						{/each}
					</ul>
					<details class="score-details">
						<summary>Explain this score</summary>
						{#each data.intelligenceReport.archiveScore.factors as factor}
							<div class="factor-row">
								<span>{factor.label}</span>
								<strong>{factor.earned}/{factor.weight}</strong>
								<small>{factor.detail}</small>
								<a href={factor.evidenceTarget}>Inspect evidence</a>
							</div>
						{/each}
					</details>
				</div>
			</div>

			<div class="score-panel recoverability" id="recoverability">
				<div class="score-ring" style={`--score: ${data.intelligenceReport.recoverability.overall}%`}>
					<strong>{data.intelligenceReport.recoverability.overall}%</strong>
					<span>Recoverability</span>
				</div>
				<div class="recoverability-list">
					<h3>If GitHub disappeared today</h3>
					{#each data.intelligenceReport.recoverability.items as item}
						<div class="recoverability-row">
							<span>{item.label}</span>
							<div><i style={`width: ${item.score}%`}></i></div>
							<strong>{item.score}%</strong>
							<small>{item.detail} · <a href={item.evidenceTarget}>Show proof</a></small>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<div class="evidence-explorer" id="evidence" aria-labelledby="evidence-title">
			<div class="evidence-head">
				<div>
					<p class="report-kicker">Evidence Explorer</p>
					<h3 id="evidence-title">Show me the proof</h3>
				</div>
				<span>{data.intelligenceReport.evidenceReferences.length.toLocaleString()} references</span>
			</div>

			<div class="evidence-grid" aria-label="Preserved evidence summary">
			{#each data.intelligenceReport.evidence as item}
				<div class:missing={item.status === 'missing'} class:partial={item.status === 'partial'} class:disabled={item.status === 'disabled'}>
					<span>{item.label}</span>
					<strong>{item.value}</strong>
					<small>{item.detail}</small>
					<a href={item.evidenceTarget}>Show proof</a>
				</div>
			{/each}
			</div>

			<div class="evidence-groups">
				{#each data.intelligenceReport.evidenceGroups as group}
					<details class="evidence-group" id={`evidence-${group.category}`} open={group.references.length > 0}>
						<summary>
							<span>{group.title}</span>
							<small>{group.summary}</small>
						</summary>
						{#if group.references.length}
							<ul>
								{#each group.references as reference}
									<li>
										<div>
											<strong>{reference.title}</strong>
											{#if reference.timestamp}
												<time datetime={reference.timestamp}>{dateLabel(reference.timestamp)}</time>
											{/if}
											{#if reference.description}<p>{reference.description}</p>{/if}
											<small>{reference.confidence === 'direct' ? 'Direct evidence' : 'Derived from preserved evidence'}</small>
										</div>
										<a href={reference.target}>Open</a>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="empty-evidence">{group.emptyText}</p>
						{/if}
					</details>
				{/each}
			</div>
		</div>

		<div class="story-summary" id="archive-story">
			<h3>Archive Story</h3>
			<div class="story-timeline">
				{#each data.intelligenceReport.storyTimeline as step}
					<div class:saved={step.tone === 'saved'} class:warning={step.tone === 'warning'}>
						<span class="story-dot"></span>
						<div>
							<strong>{step.label}</strong>
							<time datetime={step.date}>{dateLabel(step.date)}</time>
							<p>{step.detail}</p>
							<a class="evidence-link" href={step.evidenceTarget}>Evidence</a>
						</div>
					</div>
				{/each}
			</div>
			<div class="story-takeaway">
				{#each data.intelligenceReport.storyTakeaway as sentence}
					<p>{sentence}</p>
				{/each}
			</div>
		</div>
	</section>

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

	<section id="signal" class="signal-card" class:soft-update={hasSectionUpdate('signal')} title={data.projectSignal.explanation}>
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
		<section class="readme-section" id="readme" class:soft-update={hasSectionUpdate('readme')} bind:this={readmeHost}>
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

	<section id="source" class="source-browser-section">
		<FileBrowser
			owner={data.repo.owner}
			name={data.repo.name}
			hasSource={Boolean(data.latestSource?.file_exists)}
			archiveStorageDisabled={data.metadataOnly}
			onArchive={data.metadataOnly || !data.isAdmin ? undefined : () => runRepoAction('archive')}
		/>
	</section>

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
		<details id="releases" class="fold" class:soft-update={hasSectionUpdate('releases')} open={data.releases.length <= 2}>
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

	<details class="fold" id="timeline" class:soft-update={hasSectionUpdate('archive')}>
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
		cursor: not-allowed;
	}

	.action-bar .download-zip {
		font-weight: 600;
	}

	.action-bar .favorited {
		border-color: color-mix(in srgb, var(--green) 60%, var(--border));
		color: var(--green);
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
		gap: 1.5rem;
	}

	.repo-section-nav {
		position: sticky;
		top: 66px;
		z-index: 15;
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		padding: 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--bg) 92%, transparent);
		backdrop-filter: blur(14px);
	}

	.repo-section-nav a {
		border-radius: 999px;
		padding: 0.28rem 0.62rem;
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 700;
	}

	.repo-section-nav a:hover {
		background: var(--bg-hover);
		color: var(--text);
		text-decoration: none;
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
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: linear-gradient(135deg, color-mix(in srgb, var(--bg-elevated) 92%, transparent), var(--bg-subtle));
		box-shadow: var(--shadow-soft);
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

	.archive-summary {
		margin: 0 0 0.6rem;
		font-size: 0.92rem;
		color: var(--text-muted);
		max-width: 76ch;
	}

	.category-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.12rem 0.55rem;
		border-radius: 999px;
		border: 1px solid var(--purple);
		color: var(--purple);
		font-size: 0.78rem;
		font-weight: 500;
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

	.intelligence-report {
		display: grid;
		gap: 1.1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-elevated);
		padding: 1.1rem;
		box-shadow: var(--shadow-soft);
	}

	.report-head,
	.score-row,
	.score-panel,
	.recoverability-row,
	.factor-row {
		display: grid;
		gap: 0.75rem;
	}

	.report-head {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.75rem;
	}

	.report-kicker {
		margin: 0 0 0.2rem;
		color: var(--green);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.report-head h2,
	.score-panel h3,
	.story-summary h3 {
		margin: 0;
	}

	.status-pill {
		border: 1px solid var(--accent);
		border-radius: 999px;
		padding: 0.2rem 0.65rem;
		color: var(--accent);
		font-size: 0.82rem;
		white-space: nowrap;
	}

	.report-head {
		order: 1;
	}

	.report-grid {
		order: 2;
	}

	.score-row {
		order: 3;
	}

	.story-summary {
		order: 4;
	}

	.evidence-explorer {
		order: 5;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		padding: 1rem;
	}

	.evidence-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
		margin-bottom: 0.85rem;
	}

	.evidence-head h3 {
		margin: 0;
	}

	.evidence-head > span {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.2rem 0.6rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.evidence-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.report-answer,
	.evidence-grid div {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		padding: 0.8rem;
	}

	.report-answer.wide {
		grid-column: 1 / -1;
	}

	.report-answer span,
	.evidence-grid span,
	.recoverability-row span,
	.factor-row span {
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.report-answer p,
	.score-panel ul {
		margin: 0.3rem 0 0;
	}

	.score-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.score-panel {
		grid-template-columns: 108px minmax(0, 1fr);
		align-items: start;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		padding: 0.9rem;
	}

	.score-ring {
		width: 96px;
		height: 96px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: conic-gradient(var(--green) var(--score), var(--bg-hover) 0);
		position: relative;
	}

	.score-ring::before {
		content: '';
		position: absolute;
		inset: 9px;
		border-radius: 50%;
		background: var(--bg);
	}

	.score-ring strong,
	.score-ring span {
		position: relative;
		line-height: 1;
	}

	.score-ring strong {
		font-size: 1.45rem;
	}

	.score-ring span {
		margin-top: 1.85rem;
		color: var(--text-muted);
		font-size: 0.62rem;
		text-align: center;
	}

	.score-panel ul {
		padding-left: 1.1rem;
		color: var(--text-muted);
		font-size: 0.86rem;
	}

	.score-details {
		margin-top: 0.6rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.factor-row {
		grid-template-columns: minmax(0, 1fr) auto;
		border-top: 1px solid var(--border);
		padding: 0.45rem 0;
	}

	.factor-row small {
		grid-column: 1 / -1;
		color: var(--text-muted);
	}

	.recoverability-list {
		display: grid;
		gap: 0.45rem;
	}

	.recoverability-row {
		grid-template-columns: 88px minmax(0, 1fr) 44px;
		align-items: center;
		gap: 0.45rem 0.65rem;
	}

	.recoverability-row div {
		height: 8px;
		border-radius: 999px;
		background: var(--bg-hover);
		overflow: hidden;
	}

	.recoverability-row i {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	.recoverability-row small {
		grid-column: 1 / -1;
		color: var(--text-muted);
		font-size: 0.76rem;
	}

	.evidence-grid strong {
		display: block;
		margin-top: 0.2rem;
	}

	.evidence-grid small {
		display: block;
		margin-top: 0.2rem;
		color: var(--text-muted);
	}

	.evidence-grid a,
	.evidence-link {
		display: inline-flex;
		margin-top: 0.45rem;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.evidence-grid .missing {
		border-color: color-mix(in srgb, var(--red) 55%, var(--border));
	}

	.evidence-grid .partial {
		border-color: color-mix(in srgb, var(--orange) 55%, var(--border));
	}

	.evidence-grid .disabled {
		opacity: 0.75;
		border-style: dashed;
	}

	.evidence-groups {
		display: grid;
		gap: 0.65rem;
		margin-top: 0.85rem;
	}

	.evidence-group {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
		scroll-margin-top: 120px;
	}

	.evidence-group summary {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 0.85rem;
		cursor: pointer;
	}

	.evidence-group summary span {
		font-weight: 800;
	}

	.evidence-group summary small {
		color: var(--text-muted);
	}

	.evidence-group ul {
		list-style: none;
		margin: 0;
		padding: 0 0.85rem 0.8rem;
		display: grid;
		gap: 0.55rem;
	}

	.evidence-group li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.65rem;
		align-items: start;
		border-top: 1px solid var(--border);
		padding-top: 0.6rem;
	}

	.evidence-group li p {
		margin: 0.15rem 0;
		color: var(--text-muted);
		font-size: 0.84rem;
	}

	.evidence-group time,
	.evidence-group li small,
	.empty-evidence {
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.evidence-group time {
		display: inline-block;
		margin-left: 0.4rem;
	}

	.empty-evidence {
		margin: 0;
		padding: 0 0.85rem 0.85rem;
	}

	.story-summary {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		padding: 1rem;
	}

	.story-timeline {
		display: grid;
		gap: 0;
		margin-top: 0.75rem;
	}

	.story-timeline > div {
		position: relative;
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr);
		gap: 0.7rem;
		padding-bottom: 0.9rem;
	}

	.story-timeline > div::before {
		content: '';
		position: absolute;
		top: 17px;
		bottom: 0;
		left: 7px;
		width: 1px;
		background: var(--border);
	}

	.story-timeline > div:last-child {
		padding-bottom: 0;
	}

	.story-timeline > div:last-child::before {
		display: none;
	}

	.story-dot {
		position: relative;
		z-index: 1;
		width: 15px;
		height: 15px;
		margin-top: 0.15rem;
		border-radius: 50%;
		border: 2px solid var(--accent);
		background: var(--bg);
	}

	.story-timeline .saved .story-dot {
		border-color: var(--green);
		background: color-mix(in srgb, var(--green) 28%, var(--bg));
	}

	.story-timeline .warning .story-dot {
		border-color: var(--orange);
		background: color-mix(in srgb, var(--orange) 28%, var(--bg));
	}

	.story-timeline strong {
		display: inline-block;
		margin-right: 0.45rem;
	}

	.story-timeline time {
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	.story-timeline p,
	.story-takeaway p {
		margin: 0.2rem 0 0;
		color: var(--text-muted);
	}

	.story-takeaway {
		margin-top: 0.85rem;
		border-left: 3px solid var(--green);
		padding: 0.2rem 0 0.2rem 0.8rem;
	}

	.explanation {
		display: grid;
		gap: 0.45rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
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
		border-radius: var(--radius);
		background: var(--bg-elevated);
	}

	.source-browser-section {
		scroll-margin-top: 110px;
	}

	#intelligence,
	#archive-story,
	#evidence,
	#readme,
	#source,
	#signal,
	#releases,
	#timeline {
		scroll-margin-top: 110px;
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
		.score-row,
		.score-panel,
		.source-grid {
			grid-template-columns: 1fr;
		}

		.report-head,
		.report-grid,
		.evidence-head,
		.evidence-grid {
			grid-template-columns: 1fr;
		}

		.status-pill {
			justify-self: start;
			white-space: normal;
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

