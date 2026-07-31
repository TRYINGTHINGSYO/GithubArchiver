import { describe, expect, it } from 'vitest';
import { buildRepoPageTsv, sanitizeTsvCell } from '$lib/tsv-export';

describe('TSV export', () => {
	it('sanitizes tabs, newlines, and spreadsheet formula prefixes', () => {
		expect(sanitizeTsvCell('owner/name\twith tab')).toBe('owner/name with tab');
		expect(sanitizeTsvCell('owner/name\nwith newline')).toBe('owner/name with newline');
		expect(sanitizeTsvCell('=cmd')).toBe("'=cmd");
		expect(sanitizeTsvCell('+cmd')).toBe("'+cmd");
		expect(sanitizeTsvCell('-cmd')).toBe("'-cmd");
		expect(sanitizeTsvCell('@cmd')).toBe("'@cmd");
	});

	it('exports exactly the current page rows with stable columns', () => {
		const tsv = buildRepoPageTsv([
			{
				full_name: 'acme/widgets',
				github_url: 'https://github.com/acme/widgets',
				download_zip_url: '/api/repo/acme/widgets/export?type=source'
			},
			{
				full_name: '=formula/repo',
				github_url: 'https://github.com/formula/repo',
				download_zip_url: null
			}
		]);

		expect(tsv).toBe(
			[
				'full_name\tgithub_url\tzip_download_url',
				'acme/widgets\thttps://github.com/acme/widgets\t/api/repo/acme/widgets/export?type=source',
				"'=formula/repo\thttps://github.com/formula/repo\t",
				''
			].join('\n')
		);
	});
});
