<script lang="ts">
	import '../app.css';

	let { children, data } = $props();
</script>

<header class="site-header">
	<div class="container">
		<a href="/" class="logo">Github<span>Archive+</span></a>
		<div class="stats-bar">
			<span>Evidence-first repository intelligence</span>
			<a href="/birth-feed" class="admin-link">Birth Feed</a>
			{#if data.isAdmin}
				<a href="/admin" class="admin-link">Admin</a>
				<a href="/logout" class="admin-link">Logout</a>
			{:else}
				<a href="/login" class="admin-link">Login</a>
			{/if}
		</div>
	</div>
</header>

<main class="container">
	{@render children()}
</main>
