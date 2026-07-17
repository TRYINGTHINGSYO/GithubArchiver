import { describe, expect, it } from 'vitest';
import { getClusterDefinition } from '$lib/server/cluster-registry';
import { clusterRepo, matchCluster } from '$lib/server/cluster-repo';

describe('cluster-repo', () => {
	it('matches MCP servers from topics and name', () => {
		const def = getClusterDefinition('mcp-servers');
		expect(def).toBeDefined();

		const result = matchCluster(def!, {
			owner: 'acme',
			name: 'tools-mcp-server',
			full_name: 'acme/tools-mcp-server',
			description: 'A Model Context Protocol server',
			language: 'TypeScript',
			topics: ['mcp', 'ai'],
			category: 'ai-project',
			readmeExcerpt: '# MCP Server\n\nImplements the Model Context Protocol.'
		});

		expect(result).not.toBeNull();
		expect(result!.slug).toBe('mcp-servers');
		expect(result!.confidence).toBeGreaterThanOrEqual(0.45);
		expect(result!.evidence.scoreBreakdown.topics).toBeGreaterThan(0);
	});

	it('matches GitHub Classroom assignments', () => {
		const matches = clusterRepo({
			owner: 'student',
			name: 'assignment-2',
			full_name: 'student/assignment-2',
			description: 'CS101 homework',
			language: 'Python',
			topics: ['github-classroom'],
			category: 'school-assignment'
		});

		expect(matches.some((match) => match.slug === 'github-classroom-assignments')).toBe(true);
	});

	it('allows multiple cluster memberships', () => {
		const matches = clusterRepo({
			owner: 'acme',
			name: 'ai-chat-mcp',
			full_name: 'acme/ai-chat-mcp',
			description: 'An MCP-powered chat application with RAG',
			language: 'TypeScript',
			topics: ['mcp', 'rag', 'chat-app', 'ai-agent'],
			category: 'ai-project',
			readmeExcerpt: 'Model Context Protocol server with retrieval-augmented chat.'
		});

		const slugs = matches.map((match) => match.slug);
		expect(slugs).toContain('mcp-servers');
		expect(slugs.length).toBeGreaterThan(1);
	});

	it('rejects category mismatches when categories are restricted', () => {
		const def = getClusterDefinition('github-classroom-assignments');
		const result = matchCluster(def!, {
			owner: 'acme',
			name: 'widget',
			full_name: 'acme/widget',
			description: 'A library',
			language: 'Rust',
			topics: ['github-classroom'],
			category: 'library'
		});

		expect(result).toBeNull();
	});

	it('matches discord bots', () => {
		const matches = clusterRepo({
			owner: 'dev',
			name: 'mod-bot',
			full_name: 'dev/mod-bot',
			description: 'Discord moderation bot built with discord.js',
			language: 'JavaScript',
			topics: ['discord-bot'],
			category: 'product'
		});

		expect(matches.some((match) => match.slug === 'discord-bots')).toBe(true);
	});
});
