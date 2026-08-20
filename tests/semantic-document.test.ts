import { describe, expect, it } from 'vitest';
import {
	buildRepositorySemanticDocument,
	buildSemanticDocument,
	sanitizeSemanticText
} from '$lib/server/semantic/document';
import { semanticFingerprint } from '$lib/server/semantic/fingerprint';
import { SEMANTIC_DOCUMENT_VERSION } from '$lib/server/semantic/constants';

describe('semantic document', () => {
	it('is deterministic for the same input', () => {
		const input = {
			entityType: 'repository' as const,
			entityKey: '42',
			name: 'Motrix',
			fullName: 'agalwood/Motrix',
			description: 'A full-featured download manager',
			language: 'JavaScript',
			topics: ['download-manager', 'bittorrent'],
			category: 'networking',
			readmeText: '# Motrix\n\nDownload large files faster.\n\n## Install\n\nnpm install'
		};
		expect(buildSemanticDocument(input)).toBe(buildSemanticDocument(input));
	});

	it('strips badges and truncates noisy readme content', () => {
		const doc = buildSemanticDocument({
			entityType: 'repository',
			entityKey: '1',
			name: 'tool',
			readmeText: [
				'![badge](http://example.com/badge.svg)',
				'Useful network utility',
				'```',
				'giant code block '.repeat(200),
				'```',
				'License MIT copyright 2020'
			].join('\n')
		});
		expect(doc).toContain('Useful network utility');
		expect(doc).not.toContain('example.com/badge');
		expect(doc.length).toBeLessThan(4500);
	});

	it('includes topics and classification', () => {
		const doc = buildRepositorySemanticDocument({
			id: 9,
			full_name: 'acme/widget',
			description: 'Local voice assistant',
			topics: ['voice', 'assistant'],
			category: 'developer-tools',
			language: 'Python'
		});
		expect(doc).toContain('Topics: voice, assistant');
		expect(doc).toContain('Classification: developer-tools');
		expect(doc).toContain(`semantic_document_version: ${SEMANTIC_DOCUMENT_VERSION}`);
	});

	it('sanitizes missing fields safely', () => {
		expect(sanitizeSemanticText(null)).toBe('');
		expect(
			buildSemanticDocument({
				entityType: 'website',
				entityKey: 'example.com',
				pageTitle: 'Example'
			})
		).toContain('entity_type: website');
	});
});

describe('semantic fingerprint', () => {
	it('changes when the document changes', () => {
		const a = semanticFingerprint({
			entityKey: '1',
			document: 'alpha',
			embeddingModel: 'hashing-v1'
		});
		const b = semanticFingerprint({
			entityKey: '1',
			document: 'beta',
			embeddingModel: 'hashing-v1'
		});
		expect(a).not.toBe(b);
	});

	it('changes when the embedding model changes', () => {
		const a = semanticFingerprint({
			entityKey: '1',
			document: 'same',
			embeddingModel: 'hashing-v1'
		});
		const b = semanticFingerprint({
			entityKey: '1',
			document: 'same',
			embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2'
		});
		expect(a).not.toBe(b);
	});
});
