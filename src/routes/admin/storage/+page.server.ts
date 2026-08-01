import { listCleanupPresets, previewLowValueCleanup } from '$lib/server/low-value-cleanup';
import { getStorageReport } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const report = getStorageReport();
	const cleanupPreview = previewLowValueCleanup({
		preset: 'balanced',
		sampleSize: 100
	});
	return {
		report,
		cleanupPresets: listCleanupPresets(),
		cleanupPreview
	};
};
