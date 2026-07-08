<script lang="ts">
	import { formatBytes } from '$lib/utils';

	interface FileTreeNode {
		name: string;
		path: string;
		type: 'file' | 'directory';
		size?: number;
		children?: FileTreeNode[];
	}

	interface FileContent {
		path: string;
		binary: boolean;
		language: string | null;
		size: number;
		content?: string;
		truncated?: boolean;
		message?: string;
	}

	let {
		owner,
		name,
		hasSource,
		archiveStorageDisabled = false,
		onArchive
	}: {
		owner: string;
		name: string;
		hasSource: boolean;
		archiveStorageDisabled?: boolean;
		onArchive?: () => void;
	} = $props();

	let loading = $state(false);
	let tree = $state<FileTreeNode[]>([]);
	let fileCount = $state(0);
	let treeError = $state<string | null>(null);
	let expanded = $state<Record<string, boolean>>({});
	let selectedPath = $state<string | null>(null);
	let fileContent = $state<FileContent | null>(null);
	let contentLoading = $state(false);
	let contentError = $state<string | null>(null);
	let loaded = $state(false);

	async function loadTree() {
		if (!hasSource || loaded) return;
		loading = true;
		treeError = null;
		try {
			const response = await fetch(`/api/repo/${owner}/${name}/files`);
			const body = (await response.json()) as {
				available?: boolean;
				tree?: FileTreeNode[];
				file_count?: number;
				error?: string;
			};
			if (!response.ok || !body.available) {
				treeError = body.error ?? 'Could not load archived files.';
				tree = [];
				return;
			}
			tree = body.tree ?? [];
			fileCount = body.file_count ?? 0;
			loaded = true;
		} catch (err) {
			treeError = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	async function selectFile(path: string) {
		selectedPath = path;
		contentLoading = true;
		contentError = null;
		fileContent = null;
		try {
			const response = await fetch(
				`/api/repo/${owner}/${name}/files/content?path=${encodeURIComponent(path)}`
			);
			const body = (await response.json()) as FileContent & { error?: string };
			if (!response.ok) {
				contentError = body.error ?? 'Could not load file.';
				return;
			}
			fileContent = body;
		} catch (err) {
			contentError = err instanceof Error ? err.message : String(err);
		} finally {
			contentLoading = false;
		}
	}

	function toggleDir(path: string) {
		expanded[path] = !expanded[path];
	}
</script>

{#if archiveStorageDisabled}
	<section class="browse-files empty disabled">
		<h2>Browse Files</h2>
		<p class="empty-lead">Source archive storage is disabled in metadata-only mode.</p>
		<p class="muted">Repository metadata, metrics, events, and intelligence continue to update without downloading source tarballs.</p>
	</section>
{:else if !hasSource}
	<section class="browse-files empty">
		<h2>Browse Files</h2>
		<p class="empty-lead">Files not yet saved — click <strong>Archive</strong> to download and store this repository locally.</p>
		{#if onArchive}
			<button type="button" class="archive-cta" onclick={onArchive}>Archive now</button>
		{/if}
		<p class="muted">Once archived, you can browse every file here even if GitHub deletes the repo.</p>
	</section>
{:else}
	<section class="browse-files" class:soft-open={loaded}>
		<div class="section-title-row">
			<h2>Browse Files</h2>
			<p>{fileCount > 0 ? `${fileCount.toLocaleString()} files in local archive` : 'From saved source snapshot'}</p>
		</div>

		{#if !loaded && !loading}
			<button type="button" class="load-tree" onclick={loadTree}>Load file tree</button>
		{/if}

		{#if loading}
			<p class="muted">Reading archived source…</p>
		{:else if treeError}
			<p class="error-text">{treeError}</p>
		{:else if tree.length}
			<div class="browser-layout">
				<div class="tree-panel" role="tree" aria-label="Archived files">
					{#each tree as node (node.path)}
						{@render treeNode(node, 0)}
					{/each}
				</div>
				<div class="content-panel">
					{#if contentLoading}
						<p class="muted">Loading file…</p>
					{:else if contentError}
						<p class="error-text">{contentError}</p>
					{:else if fileContent?.binary}
						<p class="muted">{fileContent.message}</p>
						<p class="mono path-label">{fileContent.path} · {formatBytes(fileContent.size)}</p>
					{:else if fileContent?.content != null}
						<div class="file-head">
							<span class="mono path-label">{fileContent.path}</span>
							<small>{formatBytes(fileContent.size)}</small>
						</div>
						{#if fileContent.message}
							<p class="muted">{fileContent.message}</p>
						{/if}
						<pre class={fileContent.language ?? 'language-plaintext'}><code>{fileContent.content}</code></pre>
					{:else}
						<p class="muted">Select a file to view its contents.</p>
					{/if}
				</div>
			</div>
		{/if}
	</section>
{/if}

{#snippet treeNode(node: FileTreeNode, depth: number)}
	<div class="tree-node" style={`--depth: ${depth}`}>
		{#if node.type === 'directory'}
			<button type="button" class="tree-dir" onclick={() => toggleDir(node.path)} aria-expanded={expanded[node.path] ?? depth < 1}>
				<span class="chevron">{(expanded[node.path] ?? depth < 1) ? '▾' : '▸'}</span>
				<span>{node.name}/</span>
			</button>
			{#if expanded[node.path] ?? depth < 1}
				<div class="tree-children">
					{#each node.children ?? [] as child (child.path)}
						{@render treeNode(child, depth + 1)}
					{/each}
				</div>
			{/if}
		{:else}
			<button
				type="button"
				class="tree-file"
				class:selected={selectedPath === node.path}
				onclick={() => selectFile(node.path)}
			>
				<span>{node.name}</span>
				{#if node.size != null}<small>{formatBytes(node.size)}</small>{/if}
			</button>
		{/if}
	</div>
{/snippet}

<style>
	.browse-files {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1rem 1.1rem;
		margin: 1.25rem 0;
		background: var(--bg-elevated);
	}

	.browse-files.empty {
		border-color: var(--orange);
		background: color-mix(in srgb, var(--orange) 8%, var(--bg-elevated));
	}

	.browse-files.disabled {
		border-color: var(--border);
		background: var(--bg-elevated);
	}

	.empty-lead {
		margin: 0.5rem 0 0.75rem;
	}

	.archive-cta {
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--bg);
		border-radius: 6px;
		padding: 0.5rem 0.85rem;
		font-weight: 600;
		cursor: pointer;
		margin-bottom: 0.5rem;
	}

	.section-title-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.35rem 1rem;
		margin-bottom: 0.75rem;
	}

	.section-title-row h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	.section-title-row p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.load-tree {
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--accent);
		border-radius: 6px;
		padding: 0.45rem 0.75rem;
		cursor: pointer;
		font-weight: 600;
	}

	.browser-layout {
		display: grid;
		grid-template-columns: minmax(220px, 34%) 1fr;
		gap: 0.75rem;
		min-height: 320px;
	}

	.tree-panel {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		padding: 0.35rem;
		overflow: auto;
		max-height: 480px;
		font-size: 0.82rem;
	}

	.content-panel {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		padding: 0.65rem;
		overflow: auto;
		max-height: 480px;
	}

	.tree-node {
		padding-left: calc(var(--depth) * 0.65rem);
	}

	.tree-dir,
	.tree-file {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		border: none;
		background: transparent;
		color: inherit;
		text-align: left;
		padding: 0.2rem 0.35rem;
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}

	.tree-dir:hover,
	.tree-file:hover {
		background: var(--bg-hover);
	}

	.tree-file.selected {
		background: var(--accent-dim);
		color: var(--accent);
	}

	.chevron {
		width: 0.85rem;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.tree-file small {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.file-head {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.path-label {
		font-size: 0.8rem;
		word-break: break-all;
	}

	pre {
		margin: 0;
		padding: 0.65rem;
		border-radius: 6px;
		background: color-mix(in srgb, var(--bg-elevated) 80%, var(--bg));
		overflow: auto;
		font-size: 0.78rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.error-text {
		color: var(--red);
	}

	.muted {
		color: var(--text-muted);
	}

	@media (max-width: 820px) {
		.browser-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
