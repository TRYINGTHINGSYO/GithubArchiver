<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<header class="site-header">
	<div class="container">
		<a href="/" class="logo">Github<span>Archive+</span></a>
		<div class="stats-bar">
			<span>Preserving GitHub's interesting repos</span>
			<a href="/birth-feed" class="admin-link">Birth Feed</a>
			<a href="/admin/status" class="admin-link">Status</a>
			<a href="/admin/doctor" class="admin-link">Doctor</a>
			<a href="/admin/storage" class="admin-link">Storage</a>
		</div>
	</div>
</header>

<main class="container">
	{@render children()}
</main>
