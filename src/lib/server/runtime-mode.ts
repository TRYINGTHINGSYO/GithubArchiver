export function isMetadataOnlyMode(): boolean {
	const archiveEnabled = process.env.ENABLE_ARTIFACT_ARCHIVE?.trim().toLowerCase();
	if (archiveEnabled === '1' || archiveEnabled === 'true' || archiveEnabled === 'yes' || archiveEnabled === 'on') {
		return false;
	}

	return true;
}
