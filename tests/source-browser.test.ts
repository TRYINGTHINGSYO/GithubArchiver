import { describe, expect, it } from 'vitest';
import { buildFileTree } from '../src/lib/server/source-browser';

describe('buildFileTree', () => {
	it('nests files under folders', () => {
		const tree = buildFileTree(
			[
				{ path: 'src/index.ts', name: 'index.ts', extension: '.ts', size: 10, type: 'file' },
				{ path: 'README.md', name: 'README.md', extension: '.md', size: 5, type: 'file' }
			],
			['src']
		);
		expect(tree).toHaveLength(2);
		const src = tree.find((n) => n.name === 'src');
		expect(src?.type).toBe('directory');
		expect(src?.children?.[0]?.path).toBe('src/index.ts');
	});
});
