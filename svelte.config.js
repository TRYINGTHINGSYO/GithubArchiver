import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		alias: {
			'$ingest-core': 'scripts/lib/ingest-core.ts'
		}
	}
};

export default config;
