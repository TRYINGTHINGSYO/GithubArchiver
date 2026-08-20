#!/usr/bin/env tsx
import './load-env.js';
import { closeDb, getDb } from '../src/lib/server/db/connection.js';
import { getSemanticConfig, isSemanticSearchEnabled } from '../src/lib/server/semantic/config.js';
import {
	countSemanticByStatus,
	countSemanticIndexedCurrent,
	markSemanticStaleForModelOrVersion
} from '../src/lib/server/semantic/index-state.js';
import {
	enqueueMissingRepositories,
	runSemanticIndexCycle
} from '../src/lib/server/workers/semantic-index.js';
import {
	semanticWorkerHealth,
	semanticWorkerRebuild,
	semanticWorkerSync
} from '../src/lib/server/semantic/client.js';

function argFlag(name: string): boolean {
	return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
	const idx = process.argv.indexOf(name);
	if (idx < 0) return undefined;
	return process.argv[idx + 1];
}

async function main() {
	const rebuild = argFlag('--rebuild') || process.argv[1]?.includes('semantic-rebuild');
	const force = argFlag('--force') || rebuild;
	const dryRun = argFlag('--dry-run');
	const missingOnly = argFlag('--missing-only');
	const changedOnly = argFlag('--changed-only');
	const limit = Number(argValue('--limit') ?? 50_000);
	const batchSize = Number(argValue('--batch-size') ?? getSemanticConfig().batchSize);
	const repoId = argValue('--repo-id');

	getDb();
	const config = getSemanticConfig();

	if (!isSemanticSearchEnabled() && !dryRun) {
		console.error('SEMANTIC_SEARCH_ENABLED is off. Set it to 1 to index.');
		process.exitCode = 1;
		return;
	}

	console.log(
		`Semantic index · model=${config.embeddingModel} dim=${config.dimensions} bits=${config.vectorBits}`
	);

	const health = await semanticWorkerHealth();
	if (!health?.ok && !dryRun) {
		console.error('Semantic worker is not healthy. Start services/semantic-worker/server.py');
		process.exitCode = 1;
		return;
	}

	if (rebuild && !dryRun) {
		console.log('Rebuilding empty TurboVec index…');
		await semanticWorkerRebuild();
		markSemanticStaleForModelOrVersion({
			embeddingModel: config.embeddingModel,
			documentVersion: config.documentVersion,
			dimensions: config.dimensions,
			vectorBits: config.vectorBits
		});
	}

	if (repoId) {
		const row = getDb()
			.prepare('SELECT * FROM repos WHERE id = ?')
			.get(Number(repoId));
		if (!row) {
			console.error(`repo ${repoId} not found`);
			process.exitCode = 1;
			return;
		}
		const { enqueueRepositoryForSemanticIndex } = await import(
			'../src/lib/server/workers/semantic-index.js'
		);
		enqueueRepositoryForSemanticIndex(row as never);
	} else if (!changedOnly) {
		const queued = enqueueMissingRepositories(Math.max(1, Math.floor(limit)));
		console.log(`Queued/updated pending rows: ${queued}`);
	}

	if (missingOnly) {
		// enqueueMissingRepositories already skipped current fingerprints
	}

	let indexedTotal = 0;
	let failedTotal = 0;
	let cycles = 0;
	const started = Date.now();

	while (indexedTotal + failedTotal < limit) {
		const result = await runSemanticIndexCycle({
			batchSize: Math.max(1, Math.floor(batchSize)),
			force,
			dryRun
		});
		cycles += 1;
		if (result.skipped) {
			console.log(`Stopped: ${result.reason}`);
			break;
		}
		if (dryRun) {
			console.log(`Dry run eligible in batch: ${result.eligible}`);
			break;
		}
		indexedTotal += result.indexed;
		failedTotal += result.failed;
		const counts = countSemanticByStatus();
		const current = countSemanticIndexedCurrent();
		const elapsed = (Date.now() - started) / 1000;
		const rate = elapsed > 0 ? indexedTotal / elapsed : 0;
		console.log(
			`Cycle ${cycles}: indexed=+${result.indexed} failed=+${result.failed} removed=${result.removed} · ` +
				`Indexed current: ${current} · pending=${counts.pending ?? 0} stale=${counts.stale ?? 0} failed=${counts.failed ?? 0} · ` +
				`Rate: ${rate.toFixed(1)}/s`
		);
		if (result.attempted === 0) break;
	}

	if (!dryRun) {
		await semanticWorkerSync();
	}

	const counts = countSemanticByStatus();
	console.log('Done.', {
		indexedTotal,
		failedTotal,
		counts,
		indexedCurrent: countSemanticIndexedCurrent()
	});
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => closeDb());
