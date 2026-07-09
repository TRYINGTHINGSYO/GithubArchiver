export type EvidenceCategory = 'readme' | 'source' | 'release' | 'timeline' | 'metric' | 'derived';

export type EvidenceConfidence = 'direct' | 'derived';

export interface EvidenceReference {
	id: string;
	category: EvidenceCategory;
	title: string;
	description?: string;
	confidence: EvidenceConfidence;
	target: string;
	timestamp?: string;
	artifactId?: string;
}

export type EvidenceArtifactType =
	| 'metadata_snapshot'
	| 'readme_snapshot'
	| 'source_snapshot'
	| 'release_record'
	| 'metric_observation'
	| 'timeline_event'
	| 'derived_fact';

export interface EvidenceArtifact {
	id: string;
	type: EvidenceArtifactType;
	category: EvidenceCategory;
	title: string;
	confidence: EvidenceConfidence;
	capturedAt: string;
	source: string;
	target?: string;
	sha256?: string;
	payload?: Record<string, unknown>;
}

export interface RepositoryDNA {
	id: string;
	repoId: number;
	version: string;
	generatedAt: string;
	evidenceIds: string[];
	languages: string[];
	frameworks: string[];
	manifests: string[];
	license: string | null;
	releases: string[];
	activity: Record<string, unknown>;
	fileStructure: Record<string, unknown>;
	documentation: Record<string, unknown>;
	dependencies: Record<string, unknown>;
	ciCd: string[];
	security: string[];
	traits: Record<string, unknown>;
}

export type IntelligenceResultType =
	| 'archive_score'
	| 'recoverability'
	| 'risk'
	| 'summary'
	| 'repository_memory'
	| 'repository_dna'
	| 'custom';

export interface IntelligenceResult<TValue = unknown> {
	id: string;
	type: IntelligenceResultType;
	algorithmVersion: string;
	evidenceIds: string[];
	dnaVersion: string;
	computedAt: string;
	value: TValue;
	confidence: number;
}

export type EvidenceGraphNodeKind = 'artifact' | 'derived_fact' | 'analysis_result' | 'conclusion' | 'explanation';

export interface EvidenceGraphNode {
	id: string;
	kind: EvidenceGraphNodeKind;
	title: string;
	description?: string;
	confidence?: EvidenceConfidence;
	target?: string;
}

export interface EvidenceGraphEdge {
	id: string;
	from: string;
	to: string;
	label: string;
}

export interface EvidenceGraph {
	resultId: string;
	nodes: EvidenceGraphNode[];
	edges: EvidenceGraphEdge[];
	generatedAt: string;
}

export interface EvidenceProducer {
	produce(): EvidenceArtifact[] | Promise<EvidenceArtifact[]>;
}

export interface AnalysisEngine<TValue = unknown> {
	analyze(dna: RepositoryDNA): IntelligenceResult<TValue> | Promise<IntelligenceResult<TValue>>;
}

export interface ExplanationProvider {
	explain(resultId: string): EvidenceGraph | Promise<EvidenceGraph>;
}

export interface EvidenceExplorerGroup {
	category: EvidenceCategory;
	title: string;
	summary: string;
	emptyText: string;
	references: EvidenceReference[];
}

export const EVIDENCE_GROUP_DEFINITIONS: Record<
	EvidenceCategory,
	{ title: string; noun: string; emptyText: string }
> = {
	readme: {
		title: 'README',
		noun: 'snapshot',
		emptyText: 'No README snapshots have been preserved yet.'
	},
	source: {
		title: 'Source',
		noun: 'archive',
		emptyText: 'No source archives have been preserved yet.'
	},
	release: {
		title: 'Releases',
		noun: 'record',
		emptyText: 'No release records have been captured yet.'
	},
	timeline: {
		title: 'Timeline',
		noun: 'event',
		emptyText: 'No timeline events have been reconstructed yet.'
	},
	metric: {
		title: 'Metrics',
		noun: 'observation',
		emptyText: 'No metric observations have been captured yet.'
	},
	derived: {
		title: 'Derived Intelligence',
		noun: 'report',
		emptyText: 'No deterministic intelligence reports are available yet.'
	}
};

export function evidenceGroupAnchor(category: EvidenceCategory): string {
	return `#evidence-${category}`;
}

export function groupEvidenceReferences(references: EvidenceReference[]): EvidenceExplorerGroup[] {
	return (Object.keys(EVIDENCE_GROUP_DEFINITIONS) as EvidenceCategory[]).map((category) => {
		const definition = EVIDENCE_GROUP_DEFINITIONS[category];
		const items = references.filter((reference) => reference.category === category);
		const noun = items.length === 1 ? definition.noun : `${definition.noun}s`;
		return {
			category,
			title: definition.title,
			summary: `${items.length.toLocaleString()} ${noun}`,
			emptyText: definition.emptyText,
			references: items
		};
	});
}
