<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Sign in unavailable · GithubArchive+</title>
	<meta
		name="description"
		content="Account sign-in is temporarily unavailable on this GithubArchive+ deployment."
	/>
</svelte:head>

<main class="signin-shell">
	<section class="signin-card" aria-labelledby="signin-title">
		<div class="status-mark" aria-hidden="true">!</div>
		<p class="eyebrow">Account access</p>
		<h1 id="signin-title">Sign-in is not connected yet</h1>
		<p class="summary">
			GitHub sign-in is temporarily unavailable on this deployment. You can keep exploring and
			saving discoveries on this device in the meantime.
		</p>
		<div class="notice">
			<span class="notice-dot" aria-hidden="true"></span>
			<span>Email alerts will remain off until account sign-in and delivery are configured.</span>
		</div>
		<a class="back-link" href={data.returnPath}>Return to GithubArchive+</a>
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

	.status-mark {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		margin-bottom: 1.25rem;
		border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--line));
		border-radius: 50%;
		color: var(--accent);
		font-weight: 800;
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
		margin-bottom: 1.5rem;
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

	.back-link {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		justify-content: center;
		padding: 0.65rem 1rem;
		border: 1px solid color-mix(in srgb, var(--accent) 52%, var(--line));
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--accent) 14%, var(--panel));
		color: var(--text);
		font-weight: 800;
		text-decoration: none;
	}

	.back-link:hover {
		background: color-mix(in srgb, var(--accent) 22%, var(--panel));
	}
</style>
