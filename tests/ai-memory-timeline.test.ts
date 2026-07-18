import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('ai memory timeline', () => {
	it('keeps generated indexes in sync with structured entries', () => {
		const out = execFileSync(
			process.execPath,
			['--import', 'tsx', 'scripts/ai-memory-timeline.ts', '--check'],
			{ encoding: 'utf8', cwd: process.cwd() }
		);
		expect(out).toMatch(/ok: \d+ entries/);
	});
});
