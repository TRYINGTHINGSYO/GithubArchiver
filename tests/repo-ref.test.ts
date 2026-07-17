import { describe, expect, it } from 'vitest';
import { parseGithubRepoRef } from '../src/lib/repo-ref';

describe('parseGithubRepoRef', () => {
	it('parses owner/name and GitHub URLs', () => {
		expect(parseGithubRepoRef('vercel/next.js')).toEqual({ owner: 'vercel', name: 'next.js' });
		expect(parseGithubRepoRef('https://github.com/vercel/next.js')).toEqual({
			owner: 'vercel',
			name: 'next.js'
		});
		expect(parseGithubRepoRef('https://github.com/vercel/next.js.git')).toEqual({
			owner: 'vercel',
			name: 'next.js'
		});
		expect(parseGithubRepoRef('github.com/acme/widget')).toEqual({
			owner: 'acme',
			name: 'widget'
		});
	});

	it('rejects invalid input', () => {
		expect(parseGithubRepoRef('')).toBeNull();
		expect(parseGithubRepoRef('onlyowner')).toBeNull();
		expect(parseGithubRepoRef('https://gitlab.com/acme/widget')).toBeNull();
	});
});
