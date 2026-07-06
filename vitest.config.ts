import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(root, 'src/lib'),
			'$ingest-core': path.resolve(root, 'scripts/lib/ingest-core.ts')
		}
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
		pool: 'forks',
		poolOptions: { forks: { singleFork: true } }
	}
});
