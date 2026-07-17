export type EventColorCategory = 'green' | 'blue' | 'orange' | 'purple' | 'red' | 'muted';

export interface EventDisplay {
	icon: string;
	label: string;
	color: EventColorCategory;
}

const DISPLAY: Record<string, EventDisplay> = {
	first_seen: { icon: '✨', label: 'New repository', color: 'green' },
	readme_changed: { icon: '📝', label: 'README updated', color: 'blue' },
	snapshot_created: { icon: '📦', label: 'Snapshot archived', color: 'blue' },
	archived: { icon: '📦', label: 'Archived on GitHub', color: 'blue' },
	unarchived: { icon: '📦', label: 'Unarchived on GitHub', color: 'blue' },
	metadata_updated: { icon: '🏷', label: 'Metadata updated', color: 'orange' },
	metrics_updated: { icon: '⭐', label: 'Stars increased', color: 'orange' },
	default_branch_updated: { icon: '🔄', label: 'Default branch updated', color: 'orange' },
	license_changed: { icon: '🏷', label: 'License changed', color: 'orange' },
	topics_changed: { icon: '🏷', label: 'Topics changed', color: 'orange' },
	release_detected: { icon: '🚀', label: 'Release published', color: 'purple' },
	renamed: { icon: '🔄', label: 'Repository renamed', color: 'muted' },
	deleted: { icon: '⚠', label: 'Deleted', color: 'red' },
	enrichment_failed: { icon: '⚠', label: 'Enrichment failed', color: 'red' }
};

export function eventDisplay(eventType: string): EventDisplay {
	return DISPLAY[eventType] ?? { icon: '•', label: eventType.replaceAll('_', ' '), color: 'muted' };
}
