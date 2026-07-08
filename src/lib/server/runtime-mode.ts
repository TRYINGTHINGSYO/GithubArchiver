export function isMetadataOnlyMode(): boolean {
	const value = process.env.METADATA_ONLY?.trim().toLowerCase();
	return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}
