let databaseReady = false;

export function isDatabaseReady(): boolean {
	return databaseReady;
}

export function markDatabaseReady(): void {
	databaseReady = true;
}

export function resetDatabaseReadyForTests(): void {
	databaseReady = false;
}

export function assertDatabaseReady(): void {
	if (!databaseReady) {
		throw new Error('Database migrations have not completed; refusing to start background work');
	}
}
