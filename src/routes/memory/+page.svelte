<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type View = 'timeline' | 'graph' | 'retrieval';

	let liveQuery = $state('');
	let liveBusy = $state(false);
	let liveError = $state('');
	let liveResult = $state<null | {
		elapsedMs: number;
		metrics: { candidates: number; expanded: number; ranked: number; returned: number; tokensUsed: number; budget: number | null };
		stages: { candidates: number; expanded: number; ranked: number; assembled: number };
		hits: Array<{ id: string; title: string; type: string; score: number; reasons: string[]; summary: string }>;
	}>(null);
	let stageReveal = $state(0);
	let replayIndex = $state(-1);
	let hoveredNode = $state<string | null>(null);

	$effect(() => {
		liveQuery = data.q;
		if (data.retrieval) {
			liveResult = {
				elapsedMs: data.retrieval.elapsedMs,
				metrics: data.retrieval.metrics,
				stages: data.retrieval.stages,
				hits: data.retrieval.hits
			};
			void animateStages();
		} else if (!data.q) {
			liveResult = null;
		}
	});

	const typeColor: Record<string, string> = {
		decision: 'var(--accent)',
		incident: 'var(--red)',
		migration: 'var(--orange)',
		feature: 'var(--green)',
		bugfix: 'var(--orange)',
		release: 'var(--purple)',
		'research': 'var(--text-muted)',
		'technical-debt': 'var(--orange)',
		performance: 'var(--green)',
		refactor: 'var(--accent)',
		test: 'var(--green)'
	};

	const dayGroups = $derived.by(() => {
		const map = new Map<string, typeof data.entries>();
		for (const e of data.entries) {
			const list = map.get(e.date) ?? [];
			list.push(e);
			map.set(e.date, list);
		}
		return [...map.entries()];
	});

	const graphLayout = $derived.by(() => layoutGraph(data.graph.nodes, data.graph.edges));

	function hrefFor(opts: { view?: View; id?: string | null; q?: string | null }) {
		const params = new URLSearchParams();
		const view = opts.view ?? (data.view as View);
		if (view !== 'timeline') params.set('view', view);
		const id = opts.id === undefined ? data.selected?.id : opts.id;
		if (id) params.set('id', id);
		const q = opts.q === undefined ? data.q : opts.q;
		if (q) params.set('q', q);
		const qs = params.toString();
		return qs ? `/memory?${qs}` : '/memory';
	}

	function selectEntry(id: string) {
		void goto(hrefFor({ id }), { keepFocus: true, noScroll: true });
	}

	function setView(view: View) {
		void goto(hrefFor({ view }), { keepFocus: true, noScroll: true });
	}

	async function animateStages() {
		stageReveal = 0;
		for (let i = 1; i <= 4; i++) {
			await new Promise((r) => setTimeout(r, 140));
			stageReveal = i;
		}
	}

	async function runLiveQuery(event?: Event) {
		event?.preventDefault();
		const q = liveQuery.trim();
		if (!q) return;
		liveBusy = true;
		liveError = '';
		stageReveal = 0;
		try {
			const res = await fetch(`/api/memory/query?q=${encodeURIComponent(q)}&budget=6000`);
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Query failed');
			liveResult = body;
			void goto(hrefFor({ view: 'retrieval', q, id: body.hits?.[0]?.id ?? null }), {
				keepFocus: true,
				noScroll: true
			});
			await animateStages();
		} catch (err) {
			liveError = err instanceof Error ? err.message : 'Query failed';
			liveResult = null;
		} finally {
			liveBusy = false;
		}
	}

	function startReplay() {
		if (!data.investigation.length) return;
		replayIndex = 0;
		const tick = () => {
			if (replayIndex < 0) return;
			if (replayIndex >= data.investigation.length - 1) return;
			replayIndex += 1;
			window.setTimeout(tick, 700);
		};
		window.setTimeout(tick, 700);
	}

	function layoutGraph(
		nodes: PageData['graph']['nodes'],
		edges: PageData['graph']['edges']
	) {
		const width = 920;
		const height = 520;
		const cx = width / 2;
		const cy = height / 2;
		const n = Math.max(nodes.length, 1);
		const positions = new Map<string, { x: number; y: number }>();

		// Seed by type rings
		const byType = new Map<string, typeof nodes>();
		for (const node of nodes) {
			const list = byType.get(node.type) ?? [];
			list.push(node);
			byType.set(node.type, list);
		}
		const rings = [...byType.keys()];
		rings.forEach((type, ringIdx) => {
			const ring = byType.get(type) ?? [];
			const radius = 70 + ringIdx * 55;
			ring.forEach((node, i) => {
				const angle = (i / Math.max(ring.length, 1)) * Math.PI * 2 - Math.PI / 2;
				positions.set(node.id, {
					x: cx + Math.cos(angle) * radius,
					y: cy + Math.sin(angle) * radius
				});
			});
		});

		// Light attraction along edges
		for (let iter = 0; iter < 40; iter++) {
			for (const e of edges) {
				const a = positions.get(e.from);
				const b = positions.get(e.to);
				if (!a || !b) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.hypot(dx, dy) || 1;
				const pull = (dist - 110) * 0.02;
				a.x += dx * pull * 0.5;
				a.y += dy * pull * 0.5;
				b.x -= dx * pull * 0.5;
				b.y -= dy * pull * 0.5;
			}
			for (const p of positions.values()) {
				p.x = Math.min(width - 40, Math.max(40, p.x));
				p.y = Math.min(height - 40, Math.max(40, p.y));
			}
		}

		return { width, height, positions, nodes, edges };
	}
</script>

<svelte:head>
	<title>Memory — GithubArchive+</title>
</svelte:head>

<section class="memory-hero">
	<div class="hero-top">
		<div>
			<p class="eyebrow">Knowledge engine</p>
			<h1>Memory Center</h1>
			<p class="lede">
				Intelligence console over durable project knowledge — timeline, graph, and live retrieval.
				Not a chat log.
			</p>
		</div>
		<div class="engine-status" aria-label="Engine status">
			<span class="pulse" aria-hidden="true"></span>
			<span>Online</span>
			<span class="muted">{data.stats.entries} entries</span>
		</div>
	</div>

	<div class="stat-row" aria-label="Corpus statistics">
		<div class="stat"><span class="stat-label">Entries</span><strong>{data.stats.entries}</strong></div>
		<div class="stat"><span class="stat-label">Decisions</span><strong>{data.stats.decisions}</strong></div>
		<div class="stat"><span class="stat-label">Incidents</span><strong>{data.stats.incidents}</strong></div>
		<div class="stat"><span class="stat-label">Graph edges</span><strong>{data.stats.edges}</strong></div>
		<div class="stat"><span class="stat-label">Migrations</span><strong>{data.stats.migrations}</strong></div>
		<div class="stat"><span class="stat-label">Features</span><strong>{data.stats.features}</strong></div>
	</div>

	<form class="search-bar" onsubmit={runLiveQuery}>
		<label class="sr-only" for="memory-q">Search knowledge</label>
		<input
			id="memory-q"
			type="search"
			placeholder="Search knowledge — e.g. search fallback"
			bind:value={liveQuery}
			autocomplete="off"
		/>
		<button class="button" type="submit" disabled={liveBusy}>
			{liveBusy ? 'Retrieving…' : 'Query'}
		</button>
	</form>
	{#if liveError}
		<p class="error">{liveError}</p>
	{/if}

	<nav class="view-tabs" aria-label="Memory views">
		<button class:active={data.view === 'timeline'} onclick={() => setView('timeline')} type="button">
			Timeline
		</button>
		<button class:active={data.view === 'graph'} onclick={() => setView('graph')} type="button">
			Knowledge Graph
		</button>
		<button class:active={data.view === 'retrieval'} onclick={() => setView('retrieval')} type="button">
			Retrieval
		</button>
	</nav>
</section>

<div class="memory-shell" class:has-detail={Boolean(data.selected)}>
	<section class="memory-main" aria-live="polite">
		{#if data.view === 'timeline'}
			<div class="timeline">
				{#each dayGroups as [day, items], i}
					<div class="day-block" style={`--delay: ${i * 40}ms`}>
						<header class="day-head">
							<h2>{day}</h2>
							<span class="muted">{items.length} item{items.length === 1 ? '' : 's'}</span>
						</header>
						<ul>
							{#each items as entry}
								<li>
									<button
										type="button"
										class="entry-row"
										class:active={data.selected?.id === entry.id}
										onclick={() => selectEntry(entry.id)}
									>
										<span class="dot" style={`background:${typeColor[entry.type] ?? 'var(--accent)'}`}></span>
										<span class="entry-meta">
											<span class="type">{entry.type}</span>
											{#if entry.pr}<span class="pill">PR #{entry.pr}</span>{/if}
										</span>
										<span class="entry-title">{entry.title}</span>
										<span class="check" title={entry.status}>✓</span>
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{:else if data.view === 'graph'}
			<div class="graph-wrap">
				<svg
					viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
					role="img"
					aria-label="Knowledge graph"
					class="graph-svg"
				>
					{#each graphLayout.edges as edge}
						{@const a = graphLayout.positions.get(edge.from)}
						{@const b = graphLayout.positions.get(edge.to)}
						{#if a && b}
							<line
								x1={a.x}
								y1={a.y}
								x2={b.x}
								y2={b.y}
								class="edge"
								class:hot={hoveredNode === edge.from || hoveredNode === edge.to || data.selected?.id === edge.from || data.selected?.id === edge.to}
							/>
						{/if}
					{/each}
					{#each graphLayout.nodes as node}
						{@const p = graphLayout.positions.get(node.id)}
						{#if p}
							<g
								class="node"
								class:selected={data.selected?.id === node.id}
								transform={`translate(${p.x} ${p.y})`}
								onmouseenter={() => (hoveredNode = node.id)}
								onmouseleave={() => (hoveredNode = null)}
								onclick={() => selectEntry(node.id)}
								role="button"
								tabindex="0"
								onkeydown={(e) => e.key === 'Enter' && selectEntry(node.id)}
							>
								<circle r="10" fill={typeColor[node.type] ?? 'var(--accent)'} />
								<text y="28">{node.title.length > 28 ? `${node.title.slice(0, 26)}…` : node.title}</text>
							</g>
						{/if}
					{/each}
				</svg>
				<p class="muted graph-hint">Click a node to open its dossier. Edges are typed relationships.</p>
			</div>
		{:else}
			<div class="retrieval">
				<div class="pipeline" aria-label="Retrieval pipeline">
					{#each [
						{ key: 1, label: 'Candidate search', value: liveResult?.stages.candidates ?? data.retrieval?.stages.candidates ?? '—' },
						{ key: 2, label: 'Graph expansion', value: liveResult?.stages.expanded ?? data.retrieval?.stages.expanded ?? '—' },
						{ key: 3, label: 'Re-ranking', value: liveResult?.stages.ranked ?? data.retrieval?.stages.ranked ?? '—' },
						{ key: 4, label: 'Budget assembly', value: liveResult?.stages.assembled ?? data.retrieval?.stages.assembled ?? '—' }
					] as stage}
						<div class="stage" class:revealed={stageReveal >= stage.key || Boolean(liveResult || data.retrieval)}>
							<div class="stage-label">{stage.label}</div>
							<div class="bar"><span style={`width: ${stageReveal >= stage.key || liveResult || data.retrieval ? 100 : 8}%`}></span></div>
							<div class="stage-value">{stage.value}</div>
						</div>
					{/each}
				</div>

				{#if liveResult || data.retrieval}
					{@const result = liveResult ?? data.retrieval}
					{#if result}
						<p class="retrieval-meta">
							Returned {result.metrics.returned} · {result.metrics.tokensUsed.toLocaleString()} tokens
							{#if result.metrics.budget}
								/ {result.metrics.budget.toLocaleString()}
							{/if}
							· {result.elapsedMs}ms
						</p>
						<ul class="hit-list">
							{#each result.hits as hit, i}
								<li style={`--delay: ${i * 50}ms`}>
									<button type="button" class="hit" class:active={data.selected?.id === hit.id} onclick={() => selectEntry(hit.id)}>
										<span class="score">{Math.round(hit.score)}</span>
										<span>
											<span class="type">{hit.type}</span>
											<strong>{hit.title}</strong>
											<span class="muted summary">{hit.summary}</span>
											{#if hit.reasons?.length}
												<span class="reasons">{hit.reasons.slice(0, 3).join(' · ')}</span>
											{/if}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="muted empty-retrieval">Run a query to watch candidate search → expansion → re-rank → budget assembly.</p>
				{/if}
			</div>
		{/if}
	</section>

	{#if data.selected}
		<aside class="dossier" aria-label="Entry dossier">
			<header>
				<p class="eyebrow">{data.selected.type}</p>
				<h2>{data.selected.title}</h2>
				<div class="dossier-meta">
					<span>{data.selected.date}</span>
					<span class="pill">{data.selected.confidence}</span>
					<span class="pill">{data.selected.durability}</span>
					<span class="pill">{data.selected.status}</span>
					{#if data.selected.pr}<span class="pill">PR #{data.selected.pr}</span>{/if}
				</div>
			</header>

			{#if data.investigation.length > 1}
				<div class="replay">
					<div class="replay-head">
						<strong>Investigation path</strong>
						<button class="button-secondary" type="button" onclick={startReplay}>Replay</button>
					</div>
					<ol>
						{#each data.investigation as step, i}
							<li class:active={replayIndex === i || (replayIndex < 0 && step.id === data.selected?.id)}>
								<button type="button" onclick={() => selectEntry(step.id)}>
									<span class="when">{step.date}</span>
									<span class="type">{step.type}</span>
									<span>{step.title}</span>
									{#if step.via}<span class="muted via">{step.via}</span>{/if}
								</button>
							</li>
						{/each}
					</ol>
				</div>
			{/if}

			<div class="body markdown">
				{@html data.selected.html}
			</div>

			{#if data.selected.relationships.length}
				<div class="rels">
					<h3>Relationships</h3>
					<ul>
						{#each data.selected.relationships as rel}
							<li>
								<span class="type">{rel.type}</span>
								<button type="button" class="linkish" onclick={() => selectEntry(rel.id)}>{rel.id}</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<a class="close" href={hrefFor({ id: null })}>Close</a>
		</aside>
	{/if}
</div>

<style>
	.memory-hero {
		margin-bottom: 1.5rem;
		animation: rise 0.45s ease both;
	}

	.hero-top {
		display: flex;
		justify-content: space-between;
		gap: 1.5rem;
		align-items: flex-start;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0.15rem 0 0.5rem;
		font-size: clamp(1.8rem, 3vw, 2.4rem);
		letter-spacing: -0.03em;
	}

	.lede {
		max-width: 40rem;
		color: var(--text-muted);
		margin: 0;
	}

	.engine-status {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		border: 1px solid var(--border);
		background: var(--bg-elevated);
		border-radius: 999px;
		padding: 0.45rem 0.85rem;
		font-size: 0.85rem;
	}

	.pulse {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--green);
		box-shadow: 0 0 0 0 rgba(83, 211, 138, 0.55);
		animation: pulse 1.8s ease-out infinite;
	}

	.stat-row {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.65rem;
		margin: 1.25rem 0;
	}

	.stat {
		background: linear-gradient(180deg, rgba(102, 179, 255, 0.08), transparent 70%), var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.75rem 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.stat strong {
		font-size: 1.35rem;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	.search-bar {
		display: flex;
		gap: 0.65rem;
		margin-bottom: 1rem;
	}

	.search-bar input {
		flex: 1;
		background: var(--bg-elevated);
		border: 1px solid var(--border-strong);
		color: var(--text);
		border-radius: var(--radius);
		padding: 0.75rem 0.9rem;
		font: inherit;
	}

	.view-tabs {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.view-tabs button {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-muted);
		border-radius: 999px;
		padding: 0.4rem 0.9rem;
		cursor: pointer;
		font: inherit;
	}

	.view-tabs button.active {
		color: var(--text);
		border-color: var(--accent);
		background: var(--accent-dim);
	}

	.memory-shell {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.25rem;
		align-items: start;
	}

	.memory-shell.has-detail {
		grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.9fr);
	}

	.memory-main {
		min-width: 0;
	}

	.day-block {
		margin-bottom: 1.35rem;
		animation: rise 0.4s ease both;
		animation-delay: var(--delay);
	}

	.day-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.5rem;
	}

	.day-head h2 {
		margin: 0;
		font-size: 1rem;
	}

	.timeline ul,
	.hit-list,
	.rels ul,
	.replay ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.entry-row,
	.hit {
		width: 100%;
		text-align: left;
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		gap: 0.65rem;
		align-items: center;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.7rem 0.85rem;
		color: inherit;
		cursor: pointer;
		margin-bottom: 0.45rem;
		font: inherit;
		transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
	}

	.entry-row:hover,
	.hit:hover,
	.entry-row.active,
	.hit.active {
		border-color: var(--accent);
		background: var(--bg-hover);
		transform: translateX(2px);
	}

	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
	}

	.entry-meta,
	.dossier-meta {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.entry-title {
		font-weight: 600;
	}

	.check {
		color: var(--green);
		opacity: 0.85;
	}

	.type {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-muted);
	}

	.pill {
		font-size: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		color: var(--text-muted);
	}

	.graph-wrap {
		background: radial-gradient(circle at 30% 20%, rgba(102, 179, 255, 0.12), transparent 40%),
			var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		animation: rise 0.45s ease both;
	}

	.graph-svg {
		width: 100%;
		height: auto;
		display: block;
	}

	.edge {
		stroke: rgba(102, 179, 255, 0.22);
		stroke-width: 1.25;
		transition: stroke 0.2s ease, stroke-width 0.2s ease;
	}

	.edge.hot {
		stroke: rgba(102, 179, 255, 0.85);
		stroke-width: 2;
	}

	.node {
		cursor: pointer;
	}

	.node circle {
		stroke: rgba(11, 15, 20, 0.8);
		stroke-width: 2;
		transition: r 0.15s ease;
	}

	.node:hover circle,
	.node.selected circle {
		r: 13;
	}

	.node text {
		fill: var(--text-muted);
		font-size: 10px;
		text-anchor: middle;
		pointer-events: none;
	}

	.graph-hint {
		padding: 0 1rem 0.85rem;
		margin: 0;
		font-size: 0.85rem;
	}

	.pipeline {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.stage {
		opacity: 0.45;
		transition: opacity 0.25s ease;
	}

	.stage.revealed {
		opacity: 1;
	}

	.stage-label,
	.stage-value {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.bar {
		height: 0.45rem;
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 999px;
		overflow: hidden;
		margin: 0.25rem 0;
	}

	.bar span {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--accent), var(--green));
		transition: width 0.35s ease;
	}

	.hit {
		grid-template-columns: auto 1fr;
		align-items: start;
		animation: rise 0.35s ease both;
		animation-delay: var(--delay);
	}

	.score {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		color: var(--accent);
		min-width: 2rem;
	}

	.hit strong {
		display: block;
	}

	.summary,
	.reasons {
		display: block;
		font-size: 0.85rem;
		margin-top: 0.15rem;
	}

	.reasons {
		color: var(--text-muted);
		font-size: 0.75rem;
	}

	.dossier {
		position: sticky;
		top: 5rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.1rem 1.25rem;
		max-height: calc(100vh - 6rem);
		overflow: auto;
		animation: slide-in 0.35s ease both;
	}

	.dossier h2 {
		margin: 0.2rem 0 0.65rem;
		font-size: 1.25rem;
		letter-spacing: -0.02em;
	}

	.replay {
		margin: 1rem 0;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-subtle);
	}

	.replay-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.55rem;
	}

	.replay li button {
		width: 100%;
		text-align: left;
		background: transparent;
		border: 0;
		border-left: 2px solid var(--border);
		color: inherit;
		padding: 0.4rem 0.65rem;
		cursor: pointer;
		font: inherit;
		display: grid;
		gap: 0.1rem;
	}

	.replay li.active button {
		border-left-color: var(--accent);
		background: var(--accent-dim);
	}

	.when {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.body {
		margin-top: 1rem;
		font-size: 0.95rem;
	}

	.body :global(h1),
	.body :global(h2),
	.body :global(h3) {
		font-size: 1.05rem;
		margin: 1rem 0 0.4rem;
	}

	.body :global(p),
	.body :global(li) {
		color: var(--text-muted);
	}

	.body :global(code) {
		font-size: 0.85em;
	}

	.rels {
		margin-top: 1.25rem;
	}

	.rels h3 {
		margin: 0 0 0.45rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.rels li {
		display: flex;
		gap: 0.55rem;
		align-items: center;
		margin-bottom: 0.35rem;
	}

	.linkish {
		background: none;
		border: 0;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		padding: 0;
	}

	.close {
		display: inline-block;
		margin-top: 1rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.muted {
		color: var(--text-muted);
	}

	.error {
		color: var(--red);
	}

	.empty-retrieval {
		padding: 1.5rem;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateX(12px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(83, 211, 138, 0.5);
		}
		70% {
			box-shadow: 0 0 0 10px rgba(83, 211, 138, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(83, 211, 138, 0);
		}
	}

	@media (max-width: 900px) {
		.stat-row {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.memory-shell.has-detail {
			grid-template-columns: 1fr;
		}

		.dossier {
			position: static;
			max-height: none;
		}

		.entry-row {
			grid-template-columns: auto 1fr auto;
		}

		.entry-meta {
			display: none;
		}
	}
</style>
