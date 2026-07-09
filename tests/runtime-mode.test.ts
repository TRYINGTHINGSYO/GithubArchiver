import { afterEach, describe, expect, it } from 'vitest';
import { isMetadataOnlyMode } from '$lib/server/runtime-mode';

describe('runtime mode', () => {
	afterEach(() => {
		delete process.env.METADATA_ONLY;
		delete process.env.ENABLE_ARTIFACT_ARCHIVE;
	});

	it('defaults to metadata-only mode', () => {
		delete process.env.METADATA_ONLY;
		delete process.env.ENABLE_ARTIFACT_ARCHIVE;
		expect(isMetadataOnlyMode()).toBe(true);
	});

	it('allows artifact archive storage only with explicit opt-in', () => {
		process.env.ENABLE_ARTIFACT_ARCHIVE = '1';
		expect(isMetadataOnlyMode()).toBe(false);
	});

	it('still honors explicit metadata-only flags', () => {
		process.env.METADATA_ONLY = '1';
		expect(isMetadataOnlyMode()).toBe(true);
	});

	it('does not let METADATA_ONLY=0 enable artifact storage by itself', () => {
		process.env.METADATA_ONLY = '0';
		expect(isMetadataOnlyMode()).toBe(true);
	});
});
