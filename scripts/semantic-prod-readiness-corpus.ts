/**
 * Curated gold fixtures + discovery queries for production-readiness eval.
 * Relevant descriptions intentionally avoid copying the query's primary words
 * where noted (meaning-based retrieval).
 */
export type GoldRepo = {
	owner: string;
	name: string;
	description: string;
	language: string;
	topics: string[];
	category: string;
	stars: number;
	cluster?: string;
	/** Mark for archived/readme/release filter tests */
	hasReadme?: boolean;
	hasRelease?: boolean;
	archived?: boolean;
};

export type EvalQuery = {
	id: string;
	query: string;
	/** full_name values that are clearly relevant */
	relevant: string[];
	notes?: string;
};

export const EVAL_QUERIES: EvalQuery[] = [
	{
		id: 'offline-voice',
		query: 'local voice assistant that works offline',
		relevant: ['voice/wake-word-local', 'voice/offline-speech-kit'],
		notes: 'meaning: no "assistant" in one relevant desc'
	},
	{
		id: 'windows-analyzer',
		query: 'Windows program/executable analyzer',
		relevant: ['win/pe-inspector', 'win/binary-explain'],
		notes: 'meaning-based'
	},
	{
		id: 'download-manager',
		query: 'torrent and normal download manager',
		relevant: ['dl/motrix-like', 'dl/aria-desktop']
	},
	{
		id: 'net-monitor',
		query: 'self-hosted network monitoring',
		relevant: ['ops/infra-dashboard', 'ops/host-pulse'],
		notes: 'meaning: keep an eye on machines'
	},
	{
		id: 'mc-economy',
		query: 'Minecraft server economy tracker',
		relevant: ['mc/vault-ledger', 'mc/shop-stats']
	},
	{
		id: 'gh-backup',
		query: 'GitHub backup/archive utility',
		relevant: ['archive/gh-mirror', 'archive/repo-vault']
	},
	{
		id: 'local-notes',
		query: 'local-first note application',
		relevant: ['notes/ink-local', 'notes/markdown-vault']
	},
	{
		id: 'term-fm',
		query: 'terminal file manager',
		relevant: ['cli/ranger-like', 'cli/yazi-twin']
	},
	{
		id: 'pe-re',
		query: 'reverse engineering PE tool',
		relevant: ['win/pe-inspector', 're/importscope']
	},
	{
		id: 'dep-viz',
		query: 'software dependency visualizer',
		relevant: ['dev/dep-graph', 'dev/module-map']
	},
	{
		id: 'ssg',
		query: 'static site generator',
		relevant: ['web/tiny-ssg', 'web/md-site-kit']
	},
	{
		id: 'photo-manager',
		query: 'self-hosted photo manager',
		relevant: ['media/photoprism-lite', 'media/gallery-home']
	},
	{
		id: 'discord-voice',
		query: 'Discord voice bot',
		relevant: ['voice/whisper-discord-bot', 'voice/discord-tts'],
		notes: 'talks back in a voice channel'
	},
	{
		id: 'db-migrate',
		query: 'database migration tool',
		relevant: ['db/schema-evolve', 'db/flyway-lite']
	},
	{
		id: 'pcap',
		query: 'network packet analyzer',
		relevant: ['net/pcap-viewer', 'net/wire-glance']
	},
	{
		id: 'meaning-voice-channel',
		query: 'program that talks back to people in a voice channel',
		relevant: ['voice/whisper-discord-bot', 'voice/discord-tts'],
		notes: 'strong meaning query'
	},
	{
		id: 'meaning-windows-does',
		query: 'figure out what a Windows program does',
		relevant: ['win/pe-inspector', 'win/binary-explain'],
		notes: 'strong meaning query'
	},
	{
		id: 'meaning-network-eye',
		query: 'keep an eye on machines on my network',
		relevant: ['ops/infra-dashboard', 'ops/host-pulse'],
		notes: 'strong meaning query'
	},
	{
		id: 'container-orch',
		query: 'lightweight container orchestration',
		relevant: ['ops/k3s-helper', 'ops/compose-fleet']
	},
	{
		id: 'password-mgr',
		query: 'self-hosted password manager',
		relevant: ['sec/vaultwarden-tools', 'sec/pass-server']
	},
	{
		id: 'ci-cache',
		query: 'CI build cache for monorepos',
		relevant: ['dev/turbo-cache-proxy', 'dev/remote-cache']
	},
	{
		id: 'llm-local',
		query: 'run language models locally on CPU',
		relevant: ['ai/llamacpp-ui', 'ai/local-infer']
	},
	{
		id: 'rss-reader',
		query: 'self-hosted RSS feed reader',
		relevant: ['web/miniflux-tools', 'web/feed-nest']
	},
	{
		id: 'git-tui',
		query: 'terminal git client with diff review',
		relevant: ['cli/lazy-git-twin', 'cli/tig-plus']
	},
	{
		id: 'csv-etl',
		query: 'transform messy CSV into a clean database',
		relevant: ['data/csv-normalize', 'data/sheet-to-sql'],
		notes: 'meaning-based ETL'
	}
];

export const GOLD_REPOS: GoldRepo[] = [
	{
		owner: 'voice',
		name: 'wake-word-local',
		description: 'On-device wake word detection with offline speech recognition',
		language: 'Python',
		topics: ['speech', 'offline', 'wake-word'],
		category: 'developer-tools',
		stars: 420,
		cluster: 'developer-tools'
	},
	{
		owner: 'voice',
		name: 'offline-speech-kit',
		description: 'Bundle of local STT/TTS models for privacy-preserving voice UIs',
		language: 'Python',
		topics: ['stt', 'tts', 'local-first'],
		category: 'developer-tools',
		stars: 310
	},
	{
		owner: 'voice',
		name: 'whisper-discord-bot',
		description: 'Discord bot using Whisper speech recognition and TTS',
		language: 'Python',
		topics: ['discord', 'whisper', 'tts'],
		category: 'developer-tools',
		stars: 880
	},
	{
		owner: 'voice',
		name: 'discord-tts',
		description: 'Join Discord channels and speak replies with neural TTS',
		language: 'TypeScript',
		topics: ['discord', 'tts'],
		category: 'developer-tools',
		stars: 210
	},
	{
		owner: 'win',
		name: 'pe-inspector',
		description: 'PE executable inspection and import analysis',
		language: 'Rust',
		topics: ['pe', 'imports', 'windows'],
		category: 'developer-tools',
		stars: 640,
		cluster: 'security'
	},
	{
		owner: 'win',
		name: 'binary-explain',
		description: 'Explains Windows binaries section by section for analysts',
		language: 'C++',
		topics: ['windows', 'binaries', 'analysis'],
		category: 'developer-tools',
		stars: 190
	},
	{
		owner: 're',
		name: 'importscope',
		description: 'Maps PE import tables to likely program behaviors',
		language: 'Rust',
		topics: ['reverse-engineering', 'pe'],
		category: 'developer-tools',
		stars: 155
	},
	{
		owner: 'dl',
		name: 'motrix-like',
		description: 'Desktop downloader with BitTorrent and HTTP/FTP queues',
		language: 'JavaScript',
		topics: ['download-manager', 'bittorrent'],
		category: 'networking',
		stars: 5200
	},
	{
		owner: 'dl',
		name: 'aria-desktop',
		description: 'GUI wrapper around aria2 for large file downloads and magnets',
		language: 'TypeScript',
		topics: ['aria2', 'downloads'],
		category: 'networking',
		stars: 980
	},
	{
		owner: 'ops',
		name: 'infra-dashboard',
		description: 'self-hosted infrastructure monitoring dashboard',
		language: 'Go',
		topics: ['monitoring', 'self-hosted', 'ops'],
		category: 'networking',
		stars: 1400,
		cluster: 'ops'
	},
	{
		owner: 'ops',
		name: 'host-pulse',
		description: 'Agent that watches uptime and metrics for LAN hosts',
		language: 'Go',
		topics: ['uptime', 'metrics', 'lan'],
		category: 'networking',
		stars: 260
	},
	{
		owner: 'ops',
		name: 'k3s-helper',
		description: 'Tiny helpers for running k3s clusters on homelab boxes',
		language: 'Go',
		topics: ['k3s', 'kubernetes', 'homelab'],
		category: 'devops',
		stars: 330
	},
	{
		owner: 'ops',
		name: 'compose-fleet',
		description: 'Orchestrate many docker-compose stacks from one control plane',
		language: 'Python',
		topics: ['docker-compose', 'fleet'],
		category: 'devops',
		stars: 410
	},
	{
		owner: 'mc',
		name: 'vault-ledger',
		description: 'Tracks player balances and shops on Minecraft servers',
		language: 'Java',
		topics: ['minecraft', 'economy'],
		category: 'games',
		stars: 720
	},
	{
		owner: 'mc',
		name: 'shop-stats',
		description: 'Chest shop analytics plugin for Paper servers',
		language: 'Java',
		topics: ['minecraft', 'paper', 'economy'],
		category: 'games',
		stars: 180
	},
	{
		owner: 'archive',
		name: 'gh-mirror',
		description: 'Mirrors GitHub repositories for offline archival',
		language: 'Go',
		topics: ['github', 'mirror', 'backup'],
		category: 'developer-tools',
		stars: 1100,
		hasReadme: true,
		archived: true
	},
	{
		owner: 'archive',
		name: 'repo-vault',
		description: 'Periodic snapshotting of orgs into cold storage archives',
		language: 'Python',
		topics: ['github', 'archive', 'backup'],
		category: 'developer-tools',
		stars: 290,
		hasRelease: true
	},
	{
		owner: 'notes',
		name: 'ink-local',
		description: 'Offline markdown notes with CRDT sync when you choose',
		language: 'TypeScript',
		topics: ['notes', 'local-first', 'crdt'],
		category: 'productivity',
		stars: 860
	},
	{
		owner: 'notes',
		name: 'markdown-vault',
		description: 'Plain-folder note taking without cloud lock-in',
		language: 'Rust',
		topics: ['markdown', 'notes'],
		category: 'productivity',
		stars: 440
	},
	{
		owner: 'cli',
		name: 'ranger-like',
		description: 'Vim-inspired terminal file browser with previews',
		language: 'Python',
		topics: ['tui', 'files'],
		category: 'developer-tools',
		stars: 2100
	},
	{
		owner: 'cli',
		name: 'yazi-twin',
		description: 'Fast async terminal file manager written in Rust',
		language: 'Rust',
		topics: ['tui', 'file-manager'],
		category: 'developer-tools',
		stars: 1500
	},
	{
		owner: 'cli',
		name: 'lazy-git-twin',
		description: 'Keyboard-driven git TUI focused on reviewing diffs',
		language: 'Go',
		topics: ['git', 'tui'],
		category: 'developer-tools',
		stars: 3200
	},
	{
		owner: 'cli',
		name: 'tig-plus',
		description: 'ncurses git history viewer with side-by-side patches',
		language: 'C',
		topics: ['git', 'diff'],
		category: 'developer-tools',
		stars: 670
	},
	{
		owner: 'dev',
		name: 'dep-graph',
		description: 'Interactive graphs of package dependencies across languages',
		language: 'TypeScript',
		topics: ['dependencies', 'visualization'],
		category: 'developer-tools',
		stars: 910
	},
	{
		owner: 'dev',
		name: 'module-map',
		description: 'Draws import graphs for monorepos',
		language: 'Rust',
		topics: ['imports', 'graph'],
		category: 'developer-tools',
		stars: 240
	},
	{
		owner: 'dev',
		name: 'turbo-cache-proxy',
		description: 'Shared remote cache for Turborepo and Nx CI jobs',
		language: 'Go',
		topics: ['ci', 'cache', 'monorepo'],
		category: 'devops',
		stars: 380
	},
	{
		owner: 'dev',
		name: 'remote-cache',
		description: 'S3-backed build artifact cache for large monorepos',
		language: 'TypeScript',
		topics: ['ci', 'cache'],
		category: 'devops',
		stars: 160
	},
	{
		owner: 'web',
		name: 'tiny-ssg',
		description: 'Minimal static site generator for markdown blogs',
		language: 'JavaScript',
		topics: ['ssg', 'markdown'],
		category: 'web',
		stars: 1200
	},
	{
		owner: 'web',
		name: 'md-site-kit',
		description: 'Compile markdown into a static HTML site with themes',
		language: 'Go',
		topics: ['static-site', 'markdown'],
		category: 'web',
		stars: 450
	},
	{
		owner: 'web',
		name: 'miniflux-tools',
		description: 'Helpers and themes for a self-hosted feed reader',
		language: 'Go',
		topics: ['rss', 'self-hosted'],
		category: 'web',
		stars: 220
	},
	{
		owner: 'web',
		name: 'feed-nest',
		description: 'Personal RSS aggregator you host yourself',
		language: 'Python',
		topics: ['rss', 'feeds'],
		category: 'web',
		stars: 175
	},
	{
		owner: 'media',
		name: 'photoprism-lite',
		description: 'Self-hosted photo library with face clustering',
		language: 'Go',
		topics: ['photos', 'self-hosted'],
		category: 'media',
		stars: 2400
	},
	{
		owner: 'media',
		name: 'gallery-home',
		description: 'Private family photo manager running on a NAS',
		language: 'TypeScript',
		topics: ['photos', 'nas'],
		category: 'media',
		stars: 310
	},
	{
		owner: 'db',
		name: 'schema-evolve',
		description: 'Versioned SQL migrations with rollback plans',
		language: 'Go',
		topics: ['migrations', 'sql'],
		category: 'databases',
		stars: 780
	},
	{
		owner: 'db',
		name: 'flyway-lite',
		description: 'Lightweight database schema migration runner',
		language: 'Java',
		topics: ['flyway', 'migrations'],
		category: 'databases',
		stars: 340
	},
	{
		owner: 'net',
		name: 'pcap-viewer',
		description: 'Browse PCAP captures with protocol decoding',
		language: 'C++',
		topics: ['pcap', 'networking'],
		category: 'networking',
		stars: 560
	},
	{
		owner: 'net',
		name: 'wire-glance',
		description: 'Terminal UI for inspecting packet captures',
		language: 'Rust',
		topics: ['packets', 'tui'],
		category: 'networking',
		stars: 290
	},
	{
		owner: 'sec',
		name: 'vaultwarden-tools',
		description: 'Ops tooling around a self-hosted Bitwarden-compatible server',
		language: 'Rust',
		topics: ['passwords', 'self-hosted'],
		category: 'security',
		stars: 410
	},
	{
		owner: 'sec',
		name: 'pass-server',
		description: 'Host your own encrypted credential store',
		language: 'Go',
		topics: ['passwords', 'vault'],
		category: 'security',
		stars: 230
	},
	{
		owner: 'ai',
		name: 'llamacpp-ui',
		description: 'Desktop UI for llama.cpp local inference on CPU/GPU',
		language: 'TypeScript',
		topics: ['llm', 'local', 'llama.cpp'],
		category: 'ai',
		stars: 1900
	},
	{
		owner: 'ai',
		name: 'local-infer',
		description: 'Run GGUF models on laptops without a cloud GPU',
		language: 'Python',
		topics: ['gguf', 'cpu', 'llm'],
		category: 'ai',
		stars: 620
	},
	{
		owner: 'data',
		name: 'csv-normalize',
		description: 'Cleans inconsistent CSV columns before loading into Postgres',
		language: 'Python',
		topics: ['csv', 'etl'],
		category: 'data',
		stars: 280
	},
	{
		owner: 'data',
		name: 'sheet-to-sql',
		description: 'Turn spreadsheet exports into typed relational tables',
		language: 'TypeScript',
		topics: ['etl', 'sql'],
		category: 'data',
		stars: 195
	}
];

const NOISE_TEMPLATES: Array<{
	desc: (i: number) => string;
	language: string;
	topics: string[];
	category: string;
}> = [
	{
		desc: (i) => `Utility #${i} for formatting JSON logs in CI pipelines`,
		language: 'Go',
		topics: ['logging', 'ci'],
		category: 'devops'
	},
	{
		desc: (i) => `React component library sample ${i} with storybook docs`,
		language: 'TypeScript',
		topics: ['react', 'ui'],
		category: 'web'
	},
	{
		desc: (i) => `Homework solution ${i} for an algorithms course`,
		language: 'Python',
		topics: ['algorithms', 'education'],
		category: 'other'
	},
	{
		desc: (i) => `Sprite atlas packer demo ${i} for 2D games`,
		language: 'C++',
		topics: ['gamedev', 'sprites'],
		category: 'games'
	},
	{
		desc: (i) => `Recipe scaler ${i} for cooking blogs`,
		language: 'JavaScript',
		topics: ['cooking', 'recipes'],
		category: 'other'
	},
	{
		desc: (i) => `Kubernetes CRD example ${i} for operators`,
		language: 'Go',
		topics: ['kubernetes', 'crd'],
		category: 'devops'
	},
	{
		desc: (i) => `CSV charting widget ${i} for dashboards`,
		language: 'TypeScript',
		topics: ['charts', 'csv'],
		category: 'web'
	},
	{
		desc: (i) => `Arduino sketch ${i} blinking LEDs on a breadboard`,
		language: 'C',
		topics: ['arduino', 'hardware'],
		category: 'hardware'
	},
	{
		desc: (i) => `Photo gallery theme ${i} for static sites`,
		language: 'CSS',
		topics: ['photos', 'theme'],
		category: 'web'
	},
	{
		desc: (i) => `Benchmark harness ${i} for HTTP microservices`,
		language: 'Rust',
		topics: ['benchmark', 'http'],
		category: 'developer-tools'
	}
];

export function buildNoiseRepos(count: number): GoldRepo[] {
	const out: GoldRepo[] = [];
	for (let i = 0; i < count; i++) {
		const t = NOISE_TEMPLATES[i % NOISE_TEMPLATES.length]!;
		out.push({
			owner: `noise${i % 97}`,
			name: `pkg-${i}`,
			description: t.desc(i),
			language: t.language,
			topics: t.topics,
			category: t.category,
			stars: (i * 17) % 5000,
			hasReadme: i % 11 === 0,
			hasRelease: i % 23 === 0,
			cluster: i % 31 === 0 ? 'ops' : undefined
		});
	}
	return out;
}
