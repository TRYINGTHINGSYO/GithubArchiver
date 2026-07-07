import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	handleRepoCardClick,
	handleRepoCardKeydown,
	repoDetailPath,
	stopCardNavigation
} from '../src/lib/repo-nav';

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

import { goto } from '$app/navigation';

describe('repo-nav', () => {
	beforeEach(() => {
		vi.mocked(goto).mockClear();
	});

	it('builds repo detail paths', () => {
		expect(repoDetailPath('octocat', 'hello')).toBe('/repo/octocat/hello');
	});

	it('navigates on card click for non-interactive targets', () => {
		handleRepoCardClick({ target: {} } as MouseEvent, 'octocat', 'hello');
		expect(goto).toHaveBeenCalledWith('/repo/octocat/hello');
	});

	it('navigates on Enter and Space', () => {
		const preventDefault = vi.fn();
		handleRepoCardKeydown({ key: 'Tab', preventDefault } as unknown as KeyboardEvent, 'a', 'b');
		expect(goto).not.toHaveBeenCalled();

		handleRepoCardKeydown({ key: ' ', preventDefault } as unknown as KeyboardEvent, 'x', 'y');
		expect(preventDefault).toHaveBeenCalled();
		expect(goto).toHaveBeenCalledWith('/repo/x/y');
	});

	it('stops card navigation propagation', () => {
		const stopPropagation = vi.fn();
		stopCardNavigation({ stopPropagation } as unknown as Event);
		expect(stopPropagation).toHaveBeenCalled();
	});
});
