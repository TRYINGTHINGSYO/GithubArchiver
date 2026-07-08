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
