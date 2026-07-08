<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<header class="site-header">
	<div class="container">
		<a href="/" class="logo">Github<span>Archive+</span></a>
		<div class="stats-bar">
			<span>Evidence-first repository intelligence</span>
			<a href="/birth-feed" class="admin-link">Birth Feed</a>
			<a href="/admin" class="admin-link">Admin</a>
		</div>
	</div>
</header>

<main class="container">
	{@render children()}
</main>
