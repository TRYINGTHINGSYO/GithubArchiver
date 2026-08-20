/**
 * Discovery queries for the READ-ONLY production-snapshot gate.
 * Includes the synthetic suite plus additional queries without assumed gold hits.
 */
import { EVAL_QUERIES } from './semantic-prod-readiness-corpus.js';

export type SnapshotQuery = {
	id: string;
	query: string;
	category:
		| 'capability'
		| 'vague'
		| 'exact'
		| 'paraphrase'
		| 'ambiguous'
		| 'niche'
		| 'local-first'
		| 're'
		| 'networking'
		| 'voice'
		| 'self-hosted'
		| 'devtools'
		| 'gaming'
		| 'download'
		| 'database'
		| 'security'
		| 'github-archive';
	notes?: string;
};

const EXTRA: SnapshotQuery[] = [
	{
		id: 'cap-offline-speech',
		query: 'software that turns microphone audio into text without the cloud',
		category: 'capability'
	},
	{
		id: 'vague-keep-machines-healthy',
		query: 'something to keep an eye on my servers',
		category: 'vague'
	},
	{
		id: 'exact-pe-header',
		query: 'PE header parser COFF optional header',
		category: 'exact'
	},
	{
		id: 'para-local-notes',
		query: 'notes app that stores markdown files on disk and syncs later',
		category: 'paraphrase'
	},
	{
		id: 'amb-python-bot',
		query: 'python bot',
		category: 'ambiguous'
	},
	{
		id: 'niche-gerber-viewer',
		query: 'open source Gerber PCB viewer',
		category: 'niche'
	},
	{
		id: 'local-password-vault',
		query: 'self hosted password manager',
		category: 'local-first'
	},
	{
		id: 're-ghidra-like',
		query: 'open source binary decompiler',
		category: 're'
	},
	{
		id: 'net-wireguard-ui',
		query: 'web UI for WireGuard peers',
		category: 'networking'
	},
	{
		id: 'voice-discord-tts',
		query: 'text to speech bot for Discord voice channels',
		category: 'voice'
	},
	{
		id: 'selfhost-photo-library',
		query: 'self-hosted photo library with face recognition',
		category: 'self-hosted'
	},
	{
		id: 'dev-tui-git',
		query: 'terminal UI for git branches and staging',
		category: 'devtools'
	},
	{
		id: 'game-mc-economy',
		query: 'Minecraft plugin that tracks player shops and currency',
		category: 'gaming'
	},
	{
		id: 'dl-aria-frontend',
		query: 'desktop download manager with torrent support',
		category: 'download'
	},
	{
		id: 'db-schema-migrate',
		query: 'database migration tool for postgres',
		category: 'database'
	},
	{
		id: 'sec-secrets-scan',
		query: 'scan git history for leaked API keys',
		category: 'security'
	},
	{
		id: 'gh-org-mirror',
		query: 'mirror an entire GitHub organization locally',
		category: 'github-archive'
	},
	{
		id: 'cap-rss-reader',
		query: 'feed reader I can host myself',
		category: 'capability'
	},
	{
		id: 'vague-organize-photos',
		query: 'help me organize my pictures on my own computer',
		category: 'vague'
	},
	{
		id: 'exact-sqlite-fts5',
		query: 'sqlite FTS5 virtual table wrapper',
		category: 'exact'
	},
	{
		id: 'para-k8s-light',
		query: 'lightweight kubernetes for a few containers without full kubernetes',
		category: 'paraphrase'
	},
	{
		id: 'amb-monitor',
		query: 'monitoring',
		category: 'ambiguous'
	},
	{
		id: 'niche-csv-etl',
		query: 'load CSV files into a database with schema inference',
		category: 'niche'
	},
	{
		id: 'local-llm-runner',
		query: 'run a large language model offline on a laptop',
		category: 'local-first'
	},
	{
		id: 're-import-table',
		query: 'inspect PE import address table',
		category: 're'
	},
	{
		id: 'net-snmp-poller',
		query: 'SNMP network device poller dashboard',
		category: 'networking'
	},
	{
		id: 'voice-wake-word',
		query: 'offline wake word detection library',
		category: 'voice'
	},
	{
		id: 'selfhost-uptime',
		query: 'uptime checker I can self-host',
		category: 'self-hosted'
	},
	{
		id: 'dev-dep-graph',
		query: 'visualize package dependencies across a monorepo',
		category: 'devtools'
	},
	{
		id: 'game-mc-map',
		query: 'Minecraft world map renderer',
		category: 'gaming'
	},
	{
		id: 'dl-bulk-http',
		query: 'download many HTTP files with resume support',
		category: 'download'
	},
	{
		id: 'db-connection-pool',
		query: 'postgres connection pooler',
		category: 'database'
	},
	{
		id: 'sec-static-analysis',
		query: 'static analysis for finding vulnerabilities in Go',
		category: 'security'
	},
	{
		id: 'gh-backup-releases',
		query: 'backup GitHub releases and assets',
		category: 'github-archive'
	},
	{
		id: 'cap-term-file-manager',
		query: 'file manager that runs in the terminal',
		category: 'capability'
	},
	{
		id: 'vague-clean-disk',
		query: 'find large files eating disk space',
		category: 'vague'
	},
	{
		id: 'exact-turborepo-cache',
		query: 'remote build cache for turborepo',
		category: 'exact'
	},
	{
		id: 'para-windows-exe-info',
		query: 'tool that explains what a Windows executable does',
		category: 'paraphrase'
	},
	{
		id: 'amb-assistant',
		query: 'assistant',
		category: 'ambiguous'
	},
	{
		id: 'niche-helm-diff',
		query: 'diff helm releases before apply',
		category: 'niche'
	},
	{
		id: 'local-sync-files',
		query: 'sync folders between machines without cloud storage',
		category: 'local-first'
	},
	{
		id: 're-string-extract',
		query: 'extract readable strings from binaries',
		category: 're'
	},
	{
		id: 'net-packet-capture-ui',
		query: 'web UI for packet capture analysis',
		category: 'networking'
	},
	{
		id: 'voice-speech-synth',
		query: 'local text to speech engine',
		category: 'voice'
	},
	{
		id: 'selfhost-git',
		query: 'self-hosted git forge',
		category: 'self-hosted'
	},
	{
		id: 'dev-api-mock',
		query: 'mock HTTP APIs for local development',
		category: 'devtools'
	},
	{
		id: 'game-discord-game-bot',
		query: 'Discord bot for game server status',
		category: 'gaming'
	},
	{
		id: 'dl-youtube-audio',
		query: 'download audio from video sites',
		category: 'download'
	},
	{
		id: 'db-sqlite-browser',
		query: 'GUI to browse sqlite databases',
		category: 'database'
	},
	{
		id: 'sec-password-hash',
		query: 'argon2 password hashing library',
		category: 'security'
	},
	{
		id: 'gh-starred-export',
		query: 'export starred GitHub repositories',
		category: 'github-archive'
	},
	{
		id: 'cap-static-site',
		query: 'generate a website from markdown files',
		category: 'capability'
	},
	{
		id: 'vague-learn-codebase',
		query: 'help me understand an unfamiliar codebase',
		category: 'vague'
	},
	{
		id: 'exact-wasm-runtime',
		query: 'WebAssembly runtime in Rust',
		category: 'exact'
	},
	{
		id: 'para-infra-dashboard',
		query: 'dashboard that shows CPU memory and disk for hosts',
		category: 'paraphrase'
	}
];

export const SNAPSHOT_QUERIES: SnapshotQuery[] = [
	...EVAL_QUERIES.map(
		(q): SnapshotQuery => ({
			id: `suite-${q.id}`,
			query: q.query,
			category: 'capability',
			notes: q.notes
		})
	),
	...EXTRA
];
