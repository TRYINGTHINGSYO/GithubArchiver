<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const report = $derived(data.report);

	let actionMsg = $state('');
	let actionError = $state(false);
	let actionLoading = $state(false);
	let reviewRepoId = $state('');
	let reviewOutcome = $state('needs-review');
	let reviewNotes = $state('');

	async function submitReview() {
		const repositoryId = Number(reviewRepoId);
		if (!Number.isFinite(repositoryId) || repositoryId <= 0) {
			actionError = true;
			actionMsg = 'Enter a valid repository id';
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
					notes: reviewNotes || null
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? res.statusText);
			actionMsg = `Saved review #${json.id}`;
			reviewNotes = '';
			await invalidateAll();
		} catch (err) {
			actionError = true;
			actionMsg = err instanceof Error ? err.message : String(err);
		} finally {
			actionLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Intelligence audit — GithubArchive+</title>
</svelte:head>

<h1>Intelligence audit</h1>
<p class="lead">
	Operator view of category/cluster quality. Mark outcomes so future rule tuning can use them.
	Generated {report.generatedAt}.
</p>

{#if actionMsg}
	<p class={actionError ? 'msg error' : 'msg ok'}>{actionMsg}</p>
{/if}

<section class="detail-section">
	<h2 class="section-title">Record a review</h2>
	<form
		class="review-form"
		onsubmit={(e) => {
			e.preventDefault();
			void submitReview();
		}}
	>
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
				<option value="generic-evidence">generic evidence</option>
				<option value="needs-review">needs review</option>
			</select>
		</label>
		<label class="notes">
			Notes
			<input bind:value={reviewNotes} placeholder="optional" />
		</label>
		<button type="submit" disabled={actionLoading}>{actionLoading ? 'Saving…' : 'Save review'}</button>
	</form>
</section>

<section class="detail-section">
	<h2 class="section-title">Category counts</h2>
	<ul class="count-list">
		{#each report.categoryCounts as row}
			<li><span class="mono">{row.category}</span> <strong>{row.count}</strong></li>
		{/each}
	</ul>
</section>

<section class="detail-section">
	<h2 class="section-title">Cluster counts</h2>
	<ul class="count-list">
		{#each report.clusterCounts as row}
			<li><span class="mono">{row.slug}</span> <strong>{row.count}</strong></li>
		{/each}
	</ul>
</section>

<section class="detail-section">
	<h2 class="section-title">Lowest-confidence category assignments</h2>
	<ul class="sample-list">
		{#each report.lowestConfidenceCategories as row}
			<li>
				<span class="mono">{row.full_name}</span>
				— {row.category}
				({row.category_confidence != null ? Math.round(row.category_confidence * 100) + '%' : '—'})
				{#if row.description}
					<p>{row.description}</p>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<section class="detail-section">
	<h2 class="section-title">Likely cluster false positives</h2>
	<ul class="sample-list">
		{#each report.likelyClusterFalsePositives as row}
			<li>
				<span class="mono">{row.full_name}</span>
				— {row.cluster_name}
				({Math.round(row.confidence * 100)}%)
				{#if row.description}
					<p>{row.description}</p>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<section class="detail-section">
	<h2 class="section-title">Multi-cluster conflicts</h2>
	<ul class="sample-list">
		{#each report.multiClusterConflicts as row}
			<li>
				<span class="mono">{row.full_name}</span>
				<p>{row.clusters.map((c) => `${c.name} ${Math.round(c.confidence * 100)}%`).join(' · ')}</p>
			</li>
		{/each}
	</ul>
</section>

<section class="detail-section">
	<h2 class="section-title">Generic evidence terms</h2>
	<ul class="count-list">
		{#each report.genericEvidenceTerms as row}
			<li><span class="mono">{row.term}</span> <strong>{row.count}</strong></li>
		{/each}
	</ul>
</section>

<section class="detail-section">
	<h2 class="section-title">Description vs category contradictions</h2>
	<ul class="sample-list">
		{#each report.descriptionContradictions as row}
			<li>
				<span class="mono">{row.full_name}</span>
				— assigned {row.category}
				<p>{row.reason}</p>
				{#if row.description}<p>{row.description}</p>{/if}
			</li>
		{/each}
	</ul>
</section>

<section class="detail-section">
	<h2 class="section-title">Recent reviews</h2>
	<ul class="sample-list">
		{#each report.recentReviews as row}
			<li>
				<span class="mono">{row.full_name}</span>
				— {row.outcome}
				{#if row.notes}<p>{row.notes}</p>{/if}
			</li>
		{/each}
		{#if report.recentReviews.length === 0}
			<li>No reviews yet.</li>
		{/if}
	</ul>
</section>

<style>
	.lead {
		color: var(--text-muted);
		max-width: 52rem;
		line-height: 1.5;
	}

	.msg {
		padding: 0.65rem 0.85rem;
		border-radius: 8px;
		margin: 1rem 0;
	}

	.msg.ok {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.msg.error {
		background: color-mix(in srgb, #d14 12%, transparent);
		color: #d14;
	}

	.review-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
	}

	.review-form label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.review-form .notes {
		flex: 1;
		min-width: 12rem;
	}

	.review-form input,
	.review-form select {
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--text);
	}

	.review-form button {
		padding: 0.5rem 0.9rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		color: var(--text);
		cursor: pointer;
	}

	.count-list,
	.sample-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.55rem;
	}

	.count-list li,
	.sample-list li {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.55rem 0.75rem;
		background: var(--bg-elevated);
	}

	.count-list {
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
	}

	.sample-list p {
		margin: 0.35rem 0 0;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.mono {
		font-family: var(--font-mono);
	}
</style>
