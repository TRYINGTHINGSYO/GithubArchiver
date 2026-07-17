import { execSync } from 'node:child_process';
import fs from 'node:fs';

const pagePath = 'src/routes/+page.svelte';
let content = execSync('git show HEAD:src/routes/+page.svelte', { encoding: 'utf8' });

const importLine = "import { timeAgo, formatDateShort } from '$lib/utils';";
const newImport =
	"import RepoListItem from '$lib/components/RepoListItem.svelte';\n\t" + importLine;
content = content.replace(importLine, newImport);

const oldBlock = `\t\t\t{#each data.repos as repo}
\t\t\t\t<li class="repo-item">
\t\t\t\t\t<div class="repo-dates">
\t\t\t\t\t\t<span class="repo-time" title={repo.first_seen_at}>
\t\t\t\t\t\t\tFirst seen by archive: {timeAgo(repo.first_seen_at)}
\t\t\t\t\t\t</span>
\t\t\t\t\t\t<span class="repo-time muted" title={repo.created_at}>
\t\t\t\t\t\t\tGitHub created: {timeAgo(repo.created_at)} ({formatDateShort(repo.created_at)})
\t\t\t\t\t\t</span>
\t\t\t\t\t</div>
\t\t\t\t\t<a class="repo-name" href="/repo/{repo.owner}/{repo.name}">{repo.full_name}</a>
\t\t\t\t\t<div class="repo-meta">
\t\t\t\t\t\t{#if repo.language}<span>{repo.language}</span>{/if}
\t\t\t\t\t\t{#if repo.stars !== null}<span>★ {repo.stars}</span>{/if}
\t\t\t\t\t\t{#if repo.search_snippet}
\t\t\t\t\t\t\t<span class="search-snippet">{@html repo.search_snippet}</span>
\t\t\t\t\t\t{:else if repo.description}
\t\t\t\t\t\t\t<span>{repo.description}</span>
\t\t\t\t\t\t{/if}
\t\t\t\t\t\t{#if repo.deleted_at}<span class="badge deleted">deleted</span>{/if}
\t\t\t\t\t\t{#if !repo.enriched_at}<span class="badge pending">not enriched</span>{/if}
\t\t\t\t\t</div>
\t\t\t\t</li>
\t\t\t{/each}`;

const newBlock = `\t\t\t{#each data.repos as repo}
\t\t\t\t<RepoListItem {repo} />
\t\t\t{/each}`;

if (!content.includes(oldBlock)) {
	console.error('production repo list block not found');
	process.exit(1);
}

content = content.replace(oldBlock, newBlock);
fs.writeFileSync(pagePath, content, 'utf8');
console.log('wired RepoListItem into production +page.svelte');
