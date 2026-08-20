import { createHash } from 'node:crypto';
import { SEMANTIC_DOCUMENT_VERSION } from './constants.js';

export function semanticFingerprint(opts: {
	entityKey: string;
	document: string;
	embeddingModel: string;
	documentVersion?: number;
}): string {
	const version = opts.documentVersion ?? SEMANTIC_DOCUMENT_VERSION;
	const payload = [
		String(version),
		opts.entityKey,
		opts.document,
		opts.embeddingModel
	].join('\n');
	return createHash('sha256').update(payload, 'utf8').digest('hex');
}
