import { describe, expect, it } from 'vitest';
import {
	categorySearchQualifier,
	pickGapCategoryForHour
} from '$lib/server/category-discovery';

describe('category-discovery', () => {
	it('maps categories to search qualifiers', () => {
		expect(categorySearchQualifier('cli-tool')).toBe('topic:cli');
		expect(categorySearchQualifier('other')).toBeNull();
	});

	it('rotates gap categories by hour key', () => {
		const gaps = ['game', 'devops', 'data-ml'];
		const a = pickGapCategoryForHour('2026070112', gaps);
		const b = pickGapCategoryForHour('2026070113', gaps);
		expect(gaps).toContain(a);
		expect(gaps).toContain(b);
	});
});
