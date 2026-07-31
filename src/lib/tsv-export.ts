const FORMULA_PREFIXES = new Set(['=', '+', '-', '@']);

export interface RepoTsvExportRow {
	full_name: string;
	github_url: string;
	download_zip_url?: string | null;
}

export function sanitizeTsvCell(value: string | number | null | undefined): string {
	const text = String(value ?? '')
		.replace(/\t/g, ' ')
		.replace(/\r?\n/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (text && FORMULA_PREFIXES.has(text[0] ?? '')) {
		return `'${text}`;
	}

	return text;
}

export function buildRepoPageTsv(repos: RepoTsvExportRow[]): string {
	const rows = [
		['full_name', 'github_url', 'zip_download_url'],
		...repos.map((repo) => [repo.full_name, repo.github_url, repo.download_zip_url ?? ''])
	];

	return `${rows.map((row) => row.map(sanitizeTsvCell).join('\t')).join('\n')}\n`;
}
