import { describe, expect, it } from 'vitest';
import { getClusterDefinition } from '$lib/server/cluster-registry';
import { clusterRepo, matchCluster } from '$lib/server/cluster-repo';
import { classifyRepo } from '$lib/server/classify-repo';
import {
	detectIncompleteSignals,
	filterEligibleClusterBadges,
	formatIncompleteSignalExplanation,
	isHomepageIntelligenceEligible
} from '$lib/server/discovery';

describe('computer vision cluster contamination', () => {
	const cv = () => getClusterDefinition('cv-computer-vision')!;

	it('rejects CrewAI, LangGraph, text-to-SQL, and generic AI-agent repositories', () => {
		const rejects = [
			{
				name: 'crewai-team-templates',
				description: 'CrewAI multi-agent team templates',
				topics: ['crewai', 'ai-agent'],
				readmeExcerpt: 'Build agent workflows with CrewAI.'
			},
			{
				name: 'langgraph-agent-flows',
				description: 'LangGraph agent orchestration flows',
				topics: ['langgraph', 'langchain'],
				readmeExcerpt: 'LLM orchestration with LangGraph.'
			},
			{
				name: 'text-to-sql-agent',
				description: 'Text-to-SQL agent for databases',
				topics: ['ai-agent', 'text-to-sql'],
				readmeExcerpt: 'An AI agent that turns natural language into SQL.'
			},
			{
				name: 'generic-ai-agent',
				description: 'A generic AI agent framework',
				topics: ['ai', 'agent'],
				readmeExcerpt: 'Multi-agent orchestration toolkit.'
			}
		];

		for (const sample of rejects) {
			const result = matchCluster(cv(), {
				owner: 'acme',
				name: sample.name,
				full_name: `acme/${sample.name}`,
				description: sample.description,
				language: 'Python',
				topics: sample.topics,
				category: 'ai-project',
				readmeExcerpt: sample.readmeExcerpt,
				filePaths: ['notebooks/demo.ipynb', 'main.py']
			});
			expect(result, sample.name).toBeNull();
		}
	});

	it('does not match Python-only or notebook-only repositories', () => {
		expect(
			matchCluster(cv(), {
				owner: 'acme',
				name: 'ml-notebooks',
				full_name: 'acme/ml-notebooks',
				description: 'Assorted ML experiments',
				language: 'Python',
				topics: ['ai', 'machine-learning'],
				category: 'ai-project',
				readmeExcerpt: 'Deep learning models and agents.',
				filePaths: ['train.ipynb']
			})
		).toBeNull();
	});

	it('accepts OpenCV / object-detection / segmentation repositories', () => {
		const accepts = [
			{
				name: 'opencv-demo',
				description: 'Computer vision demos with OpenCV',
				topics: ['opencv', 'computer-vision'],
				readmeExcerpt: 'Object detection and image processing examples.'
			},
			{
				name: 'yolo-detector',
				description: 'YOLO object-detection pipeline',
				topics: ['yolo', 'object-detection'],
				readmeExcerpt: 'Bounding-box detection with Ultralytics YOLO.'
			},
			{
				name: 'seg-net',
				description: 'Semantic segmentation for medical images',
				topics: ['image-segmentation'],
				readmeExcerpt: 'Instance segmentation using a vision transformer.'
			}
		];

		for (const sample of accepts) {
			const result = matchCluster(cv(), {
				owner: 'vision',
				name: sample.name,
				full_name: `vision/${sample.name}`,
				description: sample.description,
				language: 'Python',
				topics: sample.topics,
				category: 'data-science',
				readmeExcerpt: sample.readmeExcerpt
			});
			expect(result, sample.name).not.toBeNull();
			expect(result!.slug).toBe('cv-computer-vision');
		}
	});
});

describe('classification false positives', () => {
	it('does not classify Supabase-like database platforms as AI from incidental AI wording', () => {
		const result = classifyRepo({
			owner: 'supabase',
			name: 'supabase',
			full_name: 'supabase/supabase',
			description:
				'The open source Firebase alternative. Build AI applications with vector embeddings.',
			language: 'TypeScript',
			topics: ['supabase', 'postgres', 'firebase', 'ai'],
			stars: 70000,
			forks: 7000,
			owner_type: 'Organization',
			homepage: 'https://supabase.com',
			readmeExcerpt:
				'Supabase is an open source Firebase alternative. Start a Postgres database and build AI apps with vector search.'
		});

		expect(result.category).not.toBe('ai-project');
		expect(['product', 'framework', 'library']).toContain(result.category);
	});

	it('does not classify awesome-list repositories as personal websites', () => {
		const result = classifyRepo({
			owner: 'awesome-selfhosted',
			name: 'awesome-selfhosted',
			full_name: 'awesome-selfhosted/awesome-selfhosted',
			description: 'A list of Free Software network services and web applications which can be hosted on your own servers',
			language: null,
			topics: ['awesome', 'awesome-list', 'selfhosted'],
			stars: 200000,
			forks: 9000,
			readmeExcerpt:
				'# Awesome-Selfhosted\n\nA curated list of Free Software network services. Includes jekyll, hugo, gatsby and many others.'
		});

		expect(result.category).toBe('awesome-list');
		expect(result.category).not.toBe('personal-website');
	});
});

describe('unusual finds incomplete signals', () => {
	it('requires a real missing or conflicting signal and explains it', () => {
		const complete = detectIncompleteSignals({
			category: 'library',
			language: 'TypeScript',
			topics: '["sdk"]',
			category_confidence: 0.8,
			cluster_count: 1
		});
		expect(complete).toEqual([]);

		const incomplete = detectIncompleteSignals({
			category: 'library',
			language: 'TypeScript',
			topics: '["sdk"]',
			category_confidence: 0.8,
			cluster_count: 0
		});
		expect(incomplete).toContain('no-cluster-match');

		const explanation = formatIncompleteSignalExplanation(72, incomplete);
		expect(explanation).toContain('no cluster match');
		expect(explanation).not.toContain('lacks a clear category, language, or topic trail');
	});

	it('does not claim missing category/language/topics when they are present', () => {
		const signals = detectIncompleteSignals({
			category: 'product',
			language: 'Go',
			topics: '["cli"]',
			category_confidence: 0.4,
			cluster_count: 2
		});
		expect(signals).toEqual(['low-classification-confidence']);
		const explanation = formatIncompleteSignalExplanation(60, signals);
		expect(explanation).toContain('low classification confidence');
		expect(explanation).not.toMatch(/unknown category/);
		expect(explanation).not.toMatch(/missing language/);
		expect(explanation).not.toMatch(/no topics/);
	});
});

describe('homepage evidence eligibility', () => {
	it('requires enrichment, category, score, signal tier, and confidence', () => {
		expect(
			isHomepageIntelligenceEligible({
				enrichment_level: 1,
				category: 'ai-project',
				interesting_score: 70,
				signal_tier: 'high',
				category_confidence: 0.7
			})
		).toBe(true);

		expect(
			isHomepageIntelligenceEligible({
				enrichment_level: 0,
				category: 'ai-project',
				interesting_score: 70,
				signal_tier: 'high',
				category_confidence: 0.7
			})
		).toBe(false);

		expect(
			isHomepageIntelligenceEligible({
				enrichment_level: 1,
				category: 'unknown',
				interesting_score: 70,
				signal_tier: 'high',
				category_confidence: 0.7
			})
		).toBe(false);
	});

	it('hides cluster badges below the cluster-specific threshold', () => {
		const badges = filterEligibleClusterBadges([
			{ slug: 'cv-computer-vision', name: 'CV / Computer Vision', confidence: 0.42 },
			{ slug: 'ai-agents', name: 'AI Agents', confidence: 0.7 }
		]);
		expect(badges.map((b) => b.slug)).toEqual(['ai-agents']);
		expect(badges.every((b) => b.confidence >= 0.45)).toBe(true);
	});
});

describe('clusterRepo multi-match still works for non-CV', () => {
	it('still matches MCP servers', () => {
		const matches = clusterRepo({
			owner: 'acme',
			name: 'tools-mcp-server',
			full_name: 'acme/tools-mcp-server',
			description: 'A Model Context Protocol server',
			language: 'TypeScript',
			topics: ['mcp', 'ai'],
			category: 'ai-project',
			readmeExcerpt: '# MCP Server\n\nImplements the Model Context Protocol.'
		});
		expect(matches.some((match) => match.slug === 'mcp-servers')).toBe(true);
	});
});
