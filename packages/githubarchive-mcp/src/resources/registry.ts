import type { McpConfig } from '../config.js';
import { AppDatabaseService } from '../services/app-database.js';
import { DecisionJournalService } from '../services/decision-journal.js';
import { FeatureRegistryService } from '../services/feature-registry.js';
import { GitService } from '../services/git-service.js';
import { RouteInspectorService } from '../services/route-inspector.js';
import { SourceIndexService } from '../services/source-index.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface McpResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export class GithubArchiveResources {
	private readonly features: FeatureRegistryService;
	private readonly decisions: DecisionJournalService;
	private readonly git: GitService;
	private readonly source: SourceIndexService;
	private readonly routes: RouteInspectorService;
	private readonly db: AppDatabaseService;

	constructor(private readonly config: McpConfig) {
		this.features = new FeatureRegistryService(config.repoRoot);
		this.decisions = new DecisionJournalService(config.repoRoot);
		this.git = new GitService(config.repoRoot);
		this.source = new SourceIndexService(config.repoRoot);
		this.routes = new RouteInspectorService(config.repoRoot, this.source, this.features);
		this.db = new AppDatabaseService(config.databasePath);
	}

	list(): McpResource[] {
		const decisions = this.decisions.list();
		return [
			{
				uri: 'githubarchive://architecture/philosophy',
				name: 'Product Architecture',
				description: 'Governing evidence-first architecture philosophy for GithubArchive+.',
				mimeType: 'text/markdown'
			},
			{
				uri: 'githubarchive://product/features',
				name: 'Feature Registry',
				description: 'Machine-readable inventory of implemented product capabilities.',
				mimeType: 'application/json'
			},
			{
				uri: 'githubarchive://product/decisions',
				name: 'Decision Journal',
				description: 'Index of product decision journal entries.',
				mimeType: 'application/json'
			},
			{
				uri: 'githubarchive://schema/source',
				name: 'Database Schema',
				description: 'Application schema migration source.',
				mimeType: 'text/typescript'
			},
			{
				uri: 'githubarchive://project/state',
				name: 'Current Project State',
				description: 'Compact source/deployment/database/algorithm snapshot.',
				mimeType: 'application/json'
			},
			{
				uri: 'githubarchive://detection/versions',
				name: 'Detection Versions',
				description: 'Active intelligence/detection versions from the feature registry.',
				mimeType: 'application/json'
			},
			{
				uri: 'githubarchive://routes/manifest',
				name: 'Route Manifest',
				description: 'Public/admin/API route inventory with navigation and test signals.',
				mimeType: 'application/json'
			},
			...decisions.map((decision) => ({
				uri: `githubarchive://product/decisions/${decision.id}`,
				name: decision.title,
				description: 'Product decision journal entry.',
				mimeType: 'text/markdown'
			}))
		];
	}

	read(uri: string): { uri: string; mimeType: string; text: string } {
		if (uri === 'githubarchive://architecture/philosophy') {
			return this.readFile(
				uri,
				'text/markdown',
				resolve(this.config.repoRoot, 'docs', 'ARCHITECTURE_PHILOSOPHY.md')
			);
		}
		if (uri === 'githubarchive://product/features') {
			return this.readFile(
				uri,
				'application/json',
				resolve(this.config.repoRoot, 'docs', 'product', 'features.json')
			);
		}
		if (uri === 'githubarchive://schema/source') {
			return this.readFile(
				uri,
				'text/typescript',
				resolve(this.config.repoRoot, 'src', 'lib', 'server', 'db', 'schema.ts')
			);
		}
		if (uri === 'githubarchive://product/decisions') {
			return this.json(uri, {
				decisions: this.decisions.list().map((decision) => ({
					id: decision.id,
					title: decision.title,
					path: decision.path
				}))
			});
		}
		if (uri === 'githubarchive://project/state') {
			const archive = this.safe(() => this.db.getArchiveSummary());
			return this.json(uri, {
				source: {
					commit: this.git.currentCommitFull(),
					shortCommit: this.git.currentCommit(),
					dirty: this.git.isDirty()
				},
				deployment: {
					commit: process.env.GITHUBARCHIVE_DEPLOYED_COMMIT ?? null,
					status: process.env.GITHUBARCHIVE_DEPLOYMENT_STATUS ?? 'unknown',
					productionUrl: this.config.productionBaseUrl
				},
				database: {
					asOf: this.db.state().cutoff,
					available: this.db.state().available,
					repositories: (archive as { totalRepositories?: number } | null)?.totalRepositories ?? null,
					enriched: (archive as { enrichedRepositories?: number } | null)?.enrichedRepositories ?? null
				},
				algorithms: {
					emergingDetectionVersion: this.features.get('emerging-topics')?.detection_version ?? null
				}
			});
		}
		if (uri === 'githubarchive://detection/versions') {
			const features = this.features
				.list()
				.filter((feature) => feature.detection_version != null)
				.map((feature) => ({
					id: feature.id,
					name: feature.name,
					detection_version: feature.detection_version,
					status: feature.status
				}));
			return this.json(uri, {
				active: {
					emergingTopics: this.features.get('emerging-topics')?.detection_version ?? null
				},
				features
			});
		}
		if (uri === 'githubarchive://routes/manifest') {
			return this.json(uri, { routes: this.routes.listRoutes() });
		}
		const match = uri.match(/^githubarchive:\/\/product\/decisions\/(.+)$/);
		if (match) {
			return this.readFile(
				uri,
				'text/markdown',
				join(this.config.repoRoot, 'docs', 'product', 'decisions', `${match[1]}.md`)
			);
		}
		throw new Error(`Unknown GithubArchive+ resource: ${uri}`);
	}

	private readFile(uri: string, mimeType: string, path: string): { uri: string; mimeType: string; text: string } {
		return { uri, mimeType, text: readFileSync(path, 'utf8') };
	}

	private json(uri: string, value: unknown): { uri: string; mimeType: string; text: string } {
		return { uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) };
	}

	private safe<T>(fn: () => T): T | null {
		try {
			return fn();
		} catch {
			return null;
		}
	}
}
