<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatCategoryLabel } from '$lib/category-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const report = $derived(data.report);

	type TabId =
		| 'overview'
		| 'categories'
		| 'clusters'
		| 'low-confidence'
		| 'false-positives'
		| 'conflicts'
		| 'contradictions'
		| 'owner-patterns'
		| 'evidence'
		| 'reviews';

	let tab = $state<TabId>('overview');
	let actionMsg = $state('');
	let actionError = $state(false);
	let actionLoading = $state(false);

	let reviewQuery = $state('');
	let reviewRepoId = $state('');
	let reviewOutcome = $state('needs-review');
	let reviewCategory = $state('');
	let reviewNotes = $state('');
	let queueIndex = $state(0);

	const queue = $derived(report.queue);
	const currentQueueItem = $derived(queue[queueIndex] ?? null);

	$effect(() => {
		if (currentQueueItem) {
			reviewRepoId = String(currentQueueItem.id);
			reviewQuery = currentQueueItem.full_name;
		}
	});

	async function submitReview() {
		const repositoryId = Number(reviewRepoId);
		if (!Number.isFinite(repositoryId) || repositoryId <= 0) {
			actionError = true;
			actionMsg = 'Enter a valid repository id or pick from the queue';
			return;
		}
		actionLoading = true;
		actionMsg = '';
		actionError = false;
		try {
			const res = await fetch('/api/admin/intelligence/review', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repositoryId,
					outcome: reviewOutcome,
					notes: reviewNotes || null,
					reviewedCategory: reviewCategory || null
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			actionMsg = `Saved review #${json.id}`;
			reviewNotes = '';
			if (queueIndex < queue.length - 1) queueIndex += 1;
			await invalidateAll();
		} catch (err) {
			actionError = true;
			actionMsg = err instanceof Error ? err.message : String(err);
		} finally {
			actionLoading = false;
		}
	}

	async function previewBulk(pattern: {
		owner: string;
		description_template: string;
		recommended_category: string | null;
	}) {
		actionLoading = true;
		actionError = false;
		try {
			const res = await fetch('/api/admin/intelligence/bulk', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'preview',
					owner: pattern.owner,
					descriptionTemplate: pattern.description_template,
					toCategory: pattern.recommended_category ?? 'generated-content'
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			const preview = json.preview;
			const ok = confirm(
				`Apply bulk reclassify?\n\nOwner: ${pattern.owner}\nAffected: ${preview.affectedCount}\nTo: ${preview.toCategory}\nSamples:\n${preview.sampleRepos
					.map((r: { full_name: string }) => `- ${r.full_name}`)
					.join('\n')}\n\nHuman overrides are preserved. This writes an audit log.`
			);
			if (!ok) {
				actionMsg = 'Bulk apply cancelled';
				return;
			}
			const applyRes = await fetch('/api/admin/intelligence/bulk', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'apply',
					owner: pattern.owner,
					descriptionTemplate: pattern.description_template,
					toCategory: pattern.recommended_category ?? 'generated-content'
				})
			});
			const applyJson = await applyRes.json();
			if (!applyRes.ok) throw new Error(applyJson.error ?? applyRes.statusText);
			actionMsg = `Bulk applied to ${applyJson.affected} repos (op #${applyJson.bulkOperationId})`;
			await invalidateAll();
		} catch (err) {
			actionError = true;
			actionMsg = err instanceof Error ? err.message : String(err);
		} finally {
			actionLoading = false;
		}
	}

	const tabs: { id: TabId; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'categories', label: 'Categories' },
		{ id: 'clusters', label: 'Clusters' },
		{ id: 'low-confidence', label: 'Low Confidence' },
		{ id: 'false-positives', label: 'False Positives' },
		{ id: 'conflicts', label: 'Conflicts' },
		{ id: 'contradictions', label: 'Contradictions' },
		{ id: 'owner-patterns', label: 'Owner Patterns' },
		{ id: 'evidence', label: 'Evidence Terms' },
		{ id: 'reviews', label: 'Reviews' }
	];
</script>

<svelte:head>
	<title>Intelligence audit — GithubArchive+</title>
</svelte:head>

<section class="intel-audit">
	<header class="page-header">
		<p class="eyebrow">Operator decision interface</p>
		<h1>Intelligence audit</h1>
		<p class="lead">
			Actionable classification review — scoring {report.scoringVersion}. Generated
			{report.generatedAt}.
		</p>
	</header>

	<div class="summary-grid" aria-label="Audit summary">
		<article><strong>{report.summary.repositoriesAudited.toLocaleString()}</strong><span>Audited</span></article>
		<article><strong>{report.summary.unknownCount.toLocaleString()}</strong><span>Unknown</span></article>
		<article><strong>{report.summary.lowConfidenceCount.toLocaleString()}</strong><span>Low confidence</span></article>
		<article><strong>{report.summary.likelyFalsePositives}</strong><span>Likely FP</span></article>
		<article><strong>{report.summary.unresolvedConflicts}</strong><span>Conflicts</span></article>
		<article><strong>{report.summary.ownerPatternAlerts}</strong><span>Owner patterns</span></article>
		<article><strong>{report.summary.reviewsCompleted}</strong><span>Recent reviews</span></article>
	</div>

	{#if actionMsg}
		<p class={actionError ? 'msg error' : 'msg ok'}>{actionMsg}</p>
	{/if}

	<nav class="tabs" aria-label="Audit sections">
		{#each tabs as item}
			<button type="button" class:active={tab === item.id} onclick={() => (tab = item.id)}
				>{item.label}</button
			>
		{/each}
	</nav>

	{#if tab === 'overview'}
		<section class="panel review-panel">
			<h2>Guided review</h2>
			<p class="hint">
				Process the low-confidence queue. Corrected categories become human overrides and are
				preserved during recalculation.
			</p>
			{#if currentQueueItem}
				<div class="queue-card">
					<a href={`/repo/${currentQueueItem.full_name}`}>{currentQueueItem.full_name}</a>
					<p>{currentQueueItem.description ?? 'No description'}</p>
					<div class="meta">
						<span>{formatCategoryLabel(currentQueueItem.category)}</span>
						<span>{((currentQueueItem.category_confidence ?? 0) * 100).toFixed(0)}% · {currentQueueItem.band}</span>
						{#if currentQueueItem.strongest_evidence}
							<span>Evidence: {currentQueueItem.strongest_evidence}</span>
						{/if}
					</div>
					<div class="queue-nav">
						<button
							type="button"
							class="button-ghost"
							disabled={queueIndex <= 0}
							onclick={() => (queueIndex -= 1)}>Previous</button
						>
						<span>{queueIndex + 1} / {queue.length}</span>
						<button
							type="button"
							class="button-ghost"
							disabled={queueIndex >= queue.length - 1}
							onclick={() => (queueIndex += 1)}>Next</button
						>
					</div>
				</div>
			{:else}
				<p class="hint">Queue empty for this snapshot.</p>
			{/if}

			<form
				class="review-form"
				onsubmit={(e) => {
					e.preventDefault();
					void submitReview();
				}}
			>
				<label>
					Repository
					<input bind:value={reviewQuery} placeholder="owner/name or search cue" />
				</label>
				<label>
					Repository id
					<input bind:value={reviewRepoId} placeholder="12345" />
				</label>
				<label>
					Outcome
					<select bind:value={reviewOutcome}>
						<option value="correct">correct</option>
						<option value="incorrect-category">incorrect category</option>
						<option value="incorrect-cluster">incorrect cluster</option>
						<option value="missing-secondary-cluster">missing secondary cluster</option>
						<option value="low-value-generated">low-value / generated</option>
						<option value="spam">spam</option>
						<option value="uncertain">uncertain</option>
						<option value="needs-custom-rule">needs custom rule</option>
						<option value="needs-review">needs review</option>
					</select>
				</label>
				<label>
					Correct category (optional override)
					<input bind:value={reviewCategory} placeholder="bot | personal-website | …" />
				</label>
				<label class="notes">
					Notes
					<input bind:value={reviewNotes} placeholder="optional" />
				</label>
				<button type="submit" class="button" disabled={actionLoading}
					>{actionLoading ? 'Saving…' : 'Save review'}</button
				>
			</form>
		</section>
	{/if}

	{#if tab === 'categories'}
		<section class="panel">
			<h2>Category distribution</h2>
			<table>
				<thead><tr><th>Category</th><th>Count</th></tr></thead>
				<tbody>
					{#each report.categoryCounts as row}
						<tr>
							<td>{formatCategoryLabel(row.category) ?? row.category}</td>
							<td>{row.count.toLocaleString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if tab === 'clusters'}
		<section class="panel">
			<h2>Cluster distribution</h2>
			<table>
				<thead><tr><th>Cluster</th><th>Count</th></tr></thead>
				<tbody>
					{#each report.clusterCounts as row}
						<tr>
							<td>{row.name}</td>
							<td>{row.count.toLocaleString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if tab === 'low-confidence'}
		<section class="panel">
			<h2>Low confidence assignments</h2>
			<table>
				<thead>
					<tr>
						<th>Repository</th>
						<th>Category</th>
						<th>Confidence</th>
						<th>Evidence</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each report.lowestConfidenceCategories as row}
						<tr>
							<td>
								<a href={`/repo/${row.full_name}`}>{row.full_name}</a>
								<div class="sub">{row.description ?? ''}</div>
							</td>
							<td>{formatCategoryLabel(row.category)}</td>
							<td>{((row.category_confidence ?? 0) * 100).toFixed(0)}% · {row.band}</td>
							<td>{row.strongest_evidence ?? '—'}</td>
							<td>
								<button
									type="button"
									class="button-ghost"
									onclick={() => {
										reviewRepoId = String(row.id);
										reviewQuery = row.full_name;
										tab = 'overview';
									}}>Review</button
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if tab === 'false-positives'}
		<section class="panel">
			<h2>Likely cluster false positives</h2>
			<table>
				<thead>
					<tr><th>Repository</th><th>Cluster</th><th>Confidence</th><th>Why</th></tr>
				</thead>
				<tbody>
					{#each report.likelyClusterFalsePositives as row}
						<tr>
							<td><a href={`/repo/${row.full_name}`}>{row.full_name}</a></td>
							<td>{row.cluster_name}</td>
							<td>{(row.confidence * 100).toFixed(0)}%</td>
							<td class="sub">{row.explanation}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if tab === 'conflicts'}
		<section class="panel">
			<h2>Incompatible multi-cluster conflicts</h2>
			<p class="hint">Compatible secondary clusters (e.g. telegram-bots + ai-agents) are omitted.</p>
			{#each report.multiClusterConflicts as row}
				<article class="conflict-card">
					<a href={`/repo/${row.full_name}`}>{row.full_name}</a>
					<ul>
						{#each row.clusters as c}
							<li>{c.name} · {(c.confidence * 100).toFixed(0)}%</li>
						{/each}
					</ul>
					<p class="sub">
						Incompatible: {row.incompatiblePairs.map((p) => p.join(' vs ')).join('; ')}
					</p>
				</article>
			{/each}
		</section>
	{/if}

	{#if tab === 'contradictions'}
		<section class="panel">
			<h2>Description contradictions</h2>
			<table>
				<thead><tr><th>Repository</th><th>Assigned</th><th>Reason</th></tr></thead>
				<tbody>
					{#each report.descriptionContradictions as row}
						<tr>
							<td>
								<a href={`/repo/${row.full_name}`}>{row.full_name}</a>
								<div class="sub">{row.description}</div>
							</td>
							<td>{formatCategoryLabel(row.category)}</td>
							<td>{row.reason}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if tab === 'owner-patterns'}
		<section class="panel">
			<h2>Owner-level batch patterns</h2>
			<p class="hint">Bulk actions require confirmation and never overwrite human overrides.</p>
			{#each report.ownerPatterns as pattern}
				<article class="pattern-card">
					<header>
						<strong>{pattern.owner}</strong>
						<span>{pattern.matching_repos} repos</span>
					</header>
					<p class="mono">{pattern.description_template}</p>
					<p class="sub">
						Categories:
						{#each Object.entries(pattern.category_distribution) as [cat, count]}
							{formatCategoryLabel(cat)} {count}{' '}
						{/each}
					</p>
					<p class="sub">
						Recommend: {pattern.recommended_action}
						{#if pattern.recommended_category}
							→ {formatCategoryLabel(pattern.recommended_category)}
						{/if}
					</p>
					<ul>
						{#each pattern.sample_repos as name}
							<li><a href={`/repo/${name}`}>{name}</a></li>
						{/each}
					</ul>
					<button
						type="button"
						class="button-secondary"
						disabled={actionLoading}
						onclick={() => void previewBulk(pattern)}>Preview & apply bulk</button
					>
				</article>
			{/each}
		</section>
	{/if}

	{#if tab === 'evidence'}
		<section class="panel">
			<h2>Generic evidence terms</h2>
			<p class="hint">Standalone generic tokens should not dominate classification.</p>
			<table>
				<thead><tr><th>Term</th><th>Hits</th></tr></thead>
				<tbody>
					{#each report.genericEvidenceTerms as row}
						<tr><td class="mono">{row.term}</td><td>{row.count}</td></tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if tab === 'reviews'}
		<section class="panel">
			<h2>Recent reviews</h2>
			<table>
				<thead><tr><th>When</th><th>Repo</th><th>Outcome</th><th>Notes</th></tr></thead>
				<tbody>
					{#each report.recentReviews as row}
						<tr>
							<td>{row.reviewed_at}</td>
							<td><a href={`/repo/${row.full_name}`}>{row.full_name}</a></td>
							<td>{row.outcome}</td>
							<td>{row.notes ?? ''} {row.reviewed_category ? `→ ${row.reviewed_category}` : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}
</section>

<style>
	.intel-audit {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding-bottom: 2rem;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.72rem;
		color: var(--text-muted);
		margin: 0 0 0.35rem;
	}

	h1 {
		margin: 0;
	}

	.lead,
	.hint,
	.sub {
		color: var(--text-muted);
		font-size: 0.92rem;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
		gap: 0.55rem;
	}

	.summary-grid article {
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg-elevated);
		padding: 0.7rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.summary-grid strong {
		font-size: 1.2rem;
	}

	.summary-grid span {
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.tabs button {
		border: 1px solid var(--border);
		background: var(--bg-subtle);
		color: var(--text);
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		cursor: pointer;
		font: inherit;
		font-size: 0.85rem;
	}

	.tabs button.active {
		border-color: color-mix(in srgb, var(--accent, #3b82f6) 50%, var(--border));
		background: color-mix(in srgb, var(--accent, #3b82f6) 14%, var(--bg-elevated));
	}

	.panel,
	.queue-card,
	.conflict-card,
	.pattern-card {
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--bg-elevated);
		padding: 1rem 1.1rem;
	}

	.review-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.65rem;
		margin-top: 0.85rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	input,
	select {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-subtle);
		color: var(--text);
		padding: 0.45rem 0.55rem;
		font: inherit;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.45rem 0.35rem;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}

	.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.85rem;
	}

	.meta,
	.queue-nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		align-items: center;
		margin-top: 0.55rem;
	}

	.msg.ok {
		color: var(--green, #22c55e);
	}

	.msg.error {
		color: var(--red, #ef4444);
	}

	.pattern-card {
		margin-bottom: 0.75rem;
	}

	.pattern-card header {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
	}

	ul {
		margin: 0.4rem 0;
		padding-left: 1.1rem;
	}
</style>
