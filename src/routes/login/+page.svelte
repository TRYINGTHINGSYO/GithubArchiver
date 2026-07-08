<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Admin Login - GithubArchive+</title>
</svelte:head>

<section class="login-panel" aria-labelledby="login-title">
	<div>
		<p class="eyebrow">Admin</p>
		<h1 id="login-title">Sign in to manage the archive</h1>
		<p>Public browsing stays open. Admin login unlocks archive controls and global favorites.</p>
	</div>

	<form method="POST">
		<input type="hidden" name="next" value={data.next} />
		<label>
			<span>Password</span>
			<input name="password" type="password" autocomplete="current-password" required />
		</label>
		{#if form?.error}
			<p class="form-error">{form.error}</p>
		{/if}
		<button type="submit">Login</button>
	</form>
</section>

<style>
	.login-panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(280px, 420px);
		gap: 1.5rem;
		align-items: start;
		max-width: 920px;
		margin: 3rem auto;
	}

	.login-panel h1 {
		margin: 0.2rem 0 0.7rem;
		font-size: clamp(2rem, 5vw, 3.6rem);
		line-height: 1;
	}

	.login-panel p {
		color: var(--text-muted);
	}

	form {
		display: grid;
		gap: 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-elevated);
		padding: 1rem;
		box-shadow: var(--shadow-soft);
	}

	label {
		display: grid;
		gap: 0.3rem;
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 700;
	}

	input {
		width: 100%;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--text);
		padding: 0.55rem 0.65rem;
		font: inherit;
	}

	button {
		border: 0;
		border-radius: 6px;
		background: var(--accent);
		color: var(--bg);
		padding: 0.62rem 0.8rem;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	.form-error {
		margin: 0;
		color: var(--red);
		font-size: 0.88rem;
	}

	@media (max-width: 720px) {
		.login-panel {
			grid-template-columns: 1fr;
			margin-top: 1.5rem;
		}
	}
</style>
