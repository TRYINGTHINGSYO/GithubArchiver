import { marked } from 'marked';

marked.setOptions({
	gfm: true,
	breaks: true
});

function stripUnsafeHtml(html: string): string {
	return html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
		.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
		.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		.replace(/javascript:/gi, '');
}

export function renderMarkdownSafe(markdown: string): string {
	const raw = marked.parse(markdown, { async: false }) as string;
	return stripUnsafeHtml(raw);
}

export interface DiffLine {
	type: 'same' | 'add' | 'remove';
	text: string;
}

/** Simple line diff for README comparison. */
export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.split('\n');
	const b = after.split('\n');
	const result: DiffLine[] = [];
	const max = Math.max(a.length, b.length);

	for (let i = 0; i < max; i++) {
		const left = a[i];
		const right = b[i];
		if (left === right) {
			if (left !== undefined) result.push({ type: 'same', text: left });
		} else {
			if (left !== undefined) result.push({ type: 'remove', text: left });
			if (right !== undefined) result.push({ type: 'add', text: right });
		}
	}

	return result;
}
