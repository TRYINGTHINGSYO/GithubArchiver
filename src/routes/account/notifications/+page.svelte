<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// svelte-ignore state_referenced_locally
	let enabled = $state(data.preference.enabled);
	// svelte-ignore state_referenced_locally
	let minimumScore = $state(data.preference.minimumScore);
	// svelte-ignore state_referenced_locally
	let interestCount = $state(data.interestCount);
	let saving = $state(false);
	let message = $state<string | null>(null);
	let failed = $state(false);

	async function save() {
		saving = true;
		message = null;
		failed = false;
		try {
			const response = await fetch('/api/me/email-preferences', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ enabled, minimumScore })
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				preference?: { enabled: boolean; minimumScore: number };
				interestCount?: number;
			};
			if (!response.ok || !body.preference) {
				throw new Error(body.error ?? 'Unable to update email preferences.');
			}
			enabled = body.preference.enabled;
			minimumScore = body.preference.minimumScore;
			if (typeof body.interestCount === 'number') interestCount = body.interestCount;
			message = enabled ? 'Personalized discovery emails are on.' : 'Email alerts are off.';
		} catch (error) {
			failed = true;
			message = error instanceof Error ? error.message : 'Unable to update email preferences.';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Email notifications · GithubArchive+</title></svelte:head>

<section class="notification-settings">
	<header>
		<p class="eyebrow">Your account</p>
		<h1>Personalized discovery emails</h1>
		<p class="lede">
			Get a concise digest when GithubArchive+ finds new repositories related to projects you save.
		</p>
	</header>

	<div class="settings-card">
		<div class="setting-row">
			<div>
				<h2>New matches</h2>
				<p>
					Sent to <strong>{data.email ?? 'no email supplied by GitHub'}</strong>. Emails are
					deduplicated, so the same repository is never recommended twice.
				</p>
			</div>
			<label class="switch">
				<input
					type="checkbox"
					bind:checked={enabled}
					disabled={!enabled && (!data.email || !data.deliveryConfigured)}
				/>
				<span>{enabled ? 'On' : 'Off'}</span>
			</label>
		</div>

		<label class="score-setting">
			<span>Minimum repository quality</span>
			<select bind:value={minimumScore}>
				<option value={45}>Broad · more discoveries</option>
				<option value={55}>Balanced</option>
				<option value={65}>Selective · strongest signals</option>
				<option value={75}>Exceptional only</option>
			</select>
		</label>

		<div class="interest-summary">
			<strong>{interestCount} saved {interestCount === 1 ? 'repository' : 'repositories'}</strong>
			<p>
				Recommendations learn from shared languages, topics, and discovery categories. Save
				repositories with the star or Watch Later controls to improve matches.
			</p>
		</div>

		{#if !data.deliveryConfigured}
			<p class="notice warning">Email delivery has not been configured by the site administrator yet.</p>
		{:else if !data.email}
			<p class="notice warning">GitHub did not provide an email address. Reconnect after allowing email access.</p>
		{/if}

		<div class="actions">
			<button
				type="button"
				onclick={save}
				disabled={saving || (enabled && (!data.email || !data.deliveryConfigured))}
			>
				{saving ? 'Saving…' : 'Save preferences'}
			</button>
			<a href="/favorites">Review saved projects</a>
		</div>
		{#if message}<p class:failed class="notice" role="status">{message}</p>{/if}
	</div>
</section>

<style>
	.notification-settings {
		max-width: 760px;
		margin: 0 auto 3rem;
	}

	header {
		margin-bottom: 1.25rem;
	}

	.eyebrow {
		margin: 0 0 0.45rem;
		color: var(--accent);
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 5vw, 3.2rem);
		line-height: 1;
	}

	.lede {
		max-width: 650px;
		margin: 0.8rem 0 0;
		color: var(--text-muted);
		font-size: 1.02rem;
		line-height: 1.65;
	}

	.settings-card {
		display: grid;
		gap: 1.15rem;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--bg-elevated);
	}

	.setting-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	h2,
	.setting-row p,
	.interest-summary p {
		margin: 0;
	}

	h2 {
		font-size: 1.2rem;
	}

	.setting-row p,
	.interest-summary p {
		margin-top: 0.35rem;
		color: var(--text-muted);
		line-height: 1.55;
	}

	.switch {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2.5rem;
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-weight: 750;
	}

	.switch input {
		width: 1.1rem;
		height: 1.1rem;
		accent-color: var(--accent);
	}

	.score-setting {
		display: grid;
		gap: 0.45rem;
		font-weight: 700;
	}

	select {
		width: 100%;
		min-height: 2.75rem;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--bg-subtle);
		color: var(--text);
		padding: 0.5rem 0.65rem;
		font: inherit;
	}

	.interest-summary {
		padding: 0.9rem 1rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-subtle);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		flex-wrap: wrap;
	}

	.actions button,
	.actions a {
		min-height: 2.75rem;
		border-radius: 9px;
		padding: 0.65rem 0.9rem;
		font: inherit;
		font-weight: 750;
	}

	.actions button {
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--accent-contrast, #07111f);
		cursor: pointer;
	}

	.actions button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.actions a {
		border: 1px solid var(--border);
		color: var(--text);
		text-decoration: none;
	}

	.notice {
		margin: 0;
		color: var(--green);
	}

	.notice.warning,
	.notice.failed {
		color: var(--orange);
	}

	@media (max-width: 560px) {
		.setting-row {
			align-items: stretch;
			flex-direction: column;
		}

		.switch {
			align-self: flex-start;
		}
	}
</style>
