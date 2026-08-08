<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Admin Login - GithubArchive+</title>
	<meta
		name="description"
		content="Sign in to manage GithubArchive+ admin controls."
	/>
</svelte:head>

<main class="signin-shell">
	<section class="signin-card" aria-labelledby="signin-title">
		<p class="eyebrow">Admin</p>
		<h1 id="signin-title">Sign in to manage the archive</h1>
		<p class="summary">
			Public browsing stays open. Admin login unlocks archive controls. Account features still use
			GitHub when that provider is connected.
		</p>

		{#if data.authConfigured}
			<a
				class="github-link"
				href={`/auth/signin?callbackUrl=${encodeURIComponent(data.next)}`}
			>
				Continue with GitHub
			</a>
			<p class="divider"><span>or admin password</span></p>
		{:else}
			<div class="notice">
				<span class="notice-dot" aria-hidden="true"></span>
				<span>GitHub account sign-in is not configured on this deployment. Use the admin password.</span>
			</div>
		{/if}

		<form method="POST">
			<input type="hidden" name="next" value={data.next} />
			<label>
				<span>Admin password</span>
				<input name="password" type="password" autocomplete="current-password" required />
			</label>
			{#if form?.error}
				<p class="form-error">{form.error}</p>
			{/if}
			<button type="submit">Login</button>
		</form>

		<a class="back-link" href="/">Return to GithubArchive+</a>
	</section>
</main>

<style>
	.signin-shell {
		display: grid;
		min-height: min(72vh, 720px);
		place-items: center;
		padding: clamp(2rem, 8vw, 6rem) 1rem;
	}

	.signin-card {
		width: min(100%, 34rem);
		padding: clamp(1.5rem, 5vw, 2.5rem);
		border: 1px solid var(--line);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--panel) 94%, transparent);
		box-shadow: 0 1.5rem 4rem color-mix(in srgb, #000 24%, transparent);
	}

	.eyebrow {
		margin: 0 0 0.65rem;
		color: var(--accent);
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(2rem, 7vw, 3rem);
		line-height: 1.02;
		text-wrap: balance;
	}

	.summary {
		margin: 1rem 0 1.4rem;
		color: var(--muted);
		font-size: 1rem;
		line-height: 1.65;
	}

	.notice {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		margin-bottom: 1.25rem;
		padding: 0.85rem 0.95rem;
		border: 1px solid var(--line);
		border-radius: 0.7rem;
		background: color-mix(in srgb, var(--bg) 52%, transparent);
		color: var(--muted);
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.notice-dot {
		flex: 0 0 auto;
		width: 0.5rem;
		height: 0.5rem;
		margin-top: 0.34rem;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--accent) 14%, transparent);
	}

	.github-link,
	button,
	.back-link {
		display: inline-flex;
		min-height: 2.75rem;
		width: 100%;
		align-items: center;
		justify-content: center;
		padding: 0.65rem 1rem;
		border-radius: 0.65rem;
		font: inherit;
		font-weight: 800;
		text-decoration: none;
		cursor: pointer;
	}

	.github-link {
		border: 1px solid color-mix(in srgb, var(--accent) 52%, var(--line));
		background: color-mix(in srgb, var(--accent) 14%, var(--panel));
		color: var(--text);
	}

	.github-link:hover {
		background: color-mix(in srgb, var(--accent) 22%, var(--panel));
	}

	.divider {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 0.75rem;
		align-items: center;
		margin: 1.1rem 0;
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.divider::before,
	.divider::after {
		content: '';
		height: 1px;
		background: var(--line);
	}

	form {
		display: grid;
		gap: 0.85rem;
	}

	label {
		display: grid;
		gap: 0.3rem;
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 700;
	}

	input {
		width: 100%;
		border: 1px solid var(--line);
		border-radius: 0.55rem;
		background: var(--bg);
		color: var(--text);
		padding: 0.65rem 0.75rem;
		font: inherit;
	}

	button {
		border: 0;
		background: var(--accent);
		color: var(--bg);
	}

	.form-error {
		margin: 0;
		color: var(--red, #c44);
		font-size: 0.88rem;
	}

	.back-link {
		margin-top: 1rem;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--muted);
	}

	.back-link:hover {
		color: var(--text);
	}
</style>
