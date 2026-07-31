export interface PromptArgument {
	name: string;
	description: string;
	required?: boolean;
}

export interface PromptDefinition {
	name: string;
	description: string;
	arguments?: PromptArgument[];
}

export interface PromptMessage {
	role: 'user' | 'assistant';
	content: { type: 'text'; text: string };
}

const PROMPTS: PromptDefinition[] = [
	{
		name: 'review_feature_before_implementation',
		description:
			'Check whether a proposed GithubArchive+ feature already exists before planning implementation.',
		arguments: [
			{
				name: 'proposal',
				description: 'Short description of the feature or change you want to build.',
				required: true
			}
		]
	},
	{
		name: 'review_pr',
		description: 'Review the current workspace/PR against the feature registry, decisions, and tests.',
		arguments: [
			{
				name: 'focus',
				description: 'Optional focus area (emerging topics, search, enrichment, etc.).',
				required: false
			}
		]
	},
	{
		name: 'find_duplicate_functionality',
		description: 'Search the product registry and source for existing capabilities that overlap a proposal.',
		arguments: [
			{
				name: 'query',
				description: 'Capability or problem statement to search for.',
				required: true
			}
		]
	},
	{
		name: 'analyze_navigation',
		description: 'Inspect public routes and navigation for missing links, orphans, and dead destinations.'
	},
	{
		name: 'find_performance_bottlenecks',
		description: 'Review available performance evidence and recommend measurement-first next steps.'
	},
	{
		name: 'audit_data_quality',
		description: 'Audit archive data quality and call out stale, missing, or suspicious intelligence.'
	},
	{
		name: 'review_emerging_topic_detection',
		description:
			'Review emerging-topic detection versioning, evidence grouping, and stale-result handling.'
	},
	{
		name: 'plan_architecture_changes',
		description: 'Plan an architecture change using the decision journal and evidence-first philosophy.',
		arguments: [
			{
				name: 'goal',
				description: 'Architecture goal or constraint you want to introduce.',
				required: true
			}
		]
	},
	{
		name: 'review_workspace',
		description:
			'Review the entire GithubArchive+ workspace for registry drift, missing tests/docs/decisions, and regressions.'
	}
];

export class GithubArchivePrompts {
	list(): PromptDefinition[] {
		return PROMPTS;
	}

	get(
		name: string,
		args: Record<string, string> = {}
	): { description: string; messages: PromptMessage[] } {
		const prompt = PROMPTS.find((entry) => entry.name === name);
		if (!prompt) throw new Error(`Unknown GithubArchive+ prompt: ${name}`);
		return {
			description: prompt.description,
			messages: [
				{
					role: 'user',
					content: {
						type: 'text',
						text: renderPrompt(name, args)
					}
				}
			]
		};
	}
}

function renderPrompt(name: string, args: Record<string, string>): string {
	switch (name) {
		case 'review_feature_before_implementation':
			return [
				'Before planning implementation, use GithubArchive+ MCP tools.',
				'Call get_project_state, then validate_proposed_change and search_existing_capabilities.',
				`Proposal: ${args.proposal ?? '(missing proposal)'}`,
				'Return facts, inferences, and recommendations.',
				'If the capability already exists, do not recommend rebuilding it.'
			].join('\n');
		case 'review_pr':
			return [
				'Review the current GithubArchive+ workspace/PR.',
				'Call review_workspace first.',
				args.focus ? `Focus area: ${args.focus}` : 'Cover product, routes, tests, and registry drift.',
				'Separate facts, inferences, and recommendations.'
			].join('\n');
		case 'find_duplicate_functionality':
			return [
				'Search for duplicate or overlapping functionality.',
				`Query: ${args.query ?? '(missing query)'}`,
				'Use search_existing_capabilities and validate_proposed_change.',
				'Cite feature registry IDs, decisions, source, and tests.'
			].join('\n');
		case 'analyze_navigation':
			return [
				'Analyze GithubArchive+ navigation and public routes.',
				'Use inspect_navigation, list_routes, and analyze_site with focus=navigation.',
				'Report missing nav links, orphaned public routes, and dead destinations.'
			].join('\n');
		case 'find_performance_bottlenecks':
			return [
				'Investigate GithubArchive+ performance bottlenecks with measurement-first discipline.',
				'Use get_performance_report, get_system_health, and analyze_site.',
				'Do not recommend concurrency or architecture changes without evidence.'
			].join('\n');
		case 'audit_data_quality':
			return [
				'Audit GithubArchive+ archive data quality.',
				'Use get_data_quality_report, get_archive_summary, and query_duplicate_families.',
				'Separate facts, inferences, and recommendations.'
			].join('\n');
		case 'review_emerging_topic_detection':
			return [
				'Review emerging-topic detection.',
				'Use list_detection_runs, compare_detection_versions, explain_topic_detection when a topic is known,',
				'and search_existing_capabilities for evidence dedupe / stale filtering.',
				'Confirm detection version 2 behavior and do not recommend rebuilding shipped capabilities.'
			].join('\n');
		case 'plan_architecture_changes':
			return [
				'Plan an architecture change for GithubArchive+.',
				`Goal: ${args.goal ?? '(missing goal)'}`,
				'Read githubarchive://architecture/philosophy and relevant decision-journal resources.',
				'Use search_product_decisions and validate_proposed_change before proposing new work.'
			].join('\n');
		case 'review_workspace':
			return [
				'Review the entire GithubArchive+ workspace.',
				'Call review_workspace and summarize modified features, missing registry/test/decision updates,',
				'architecture concerns, potential regressions, and recommended follow-up.'
			].join('\n');
		default:
			return promptFallback(name, args);
	}
}

function promptFallback(name: string, args: Record<string, string>): string {
	return `Run the GithubArchive+ MCP workflow "${name}" with args ${JSON.stringify(args)}.`;
}
