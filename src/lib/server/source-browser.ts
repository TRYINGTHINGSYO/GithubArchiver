import type { SourceFileEntry } from '$lib/server/source-archive';

export interface FileTreeNode {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size?: number;
	children?: FileTreeNode[];
}

export function buildFileTree(files: SourceFileEntry[], folders: string[]): FileTreeNode[] {
	const root: FileTreeNode[] = [];
	const dirMap = new Map<string, FileTreeNode>();

	function ensureDir(dirPath: string): FileTreeNode {
		const existing = dirMap.get(dirPath);
		if (existing) return existing;
		const parts = dirPath.split('/').filter(Boolean);
		const name = parts.at(-1) ?? dirPath;
		const node: FileTreeNode = {
			name,
			path: dirPath,
			type: 'directory',
			children: []
		};
		dirMap.set(dirPath, node);
		if (parts.length === 1) {
			root.push(node);
		} else {
			const parentPath = parts.slice(0, -1).join('/');
			const parent = ensureDir(parentPath);
			parent.children = parent.children ?? [];
			if (!parent.children.some((child) => child.path === dirPath)) {
				parent.children.push(node);
			}
		}
		return node;
	}

	for (const folder of folders) {
		if (folder) ensureDir(folder);
	}

	for (const file of files) {
		const parts = file.path.split('/').filter(Boolean);
		const fileName = parts.at(-1) ?? file.path;
		const parentPath = parts.slice(0, -1).join('/');
		const fileNode: FileTreeNode = {
			name: fileName,
			path: file.path,
			type: 'file',
			size: file.size
		};
		if (!parentPath) {
			root.push(fileNode);
			continue;
		}
		const parent = ensureDir(parentPath);
		parent.children = parent.children ?? [];
		parent.children.push(fileNode);
	}

	sortTree(root);
	return root;
}

function sortTree(nodes: FileTreeNode[]): void {
	nodes.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	for (const node of nodes) {
		if (node.children) sortTree(node.children);
	}
}

const LANG_CLASS: Record<string, string> = {
	'.ts': 'language-typescript',
	'.tsx': 'language-typescript',
	'.js': 'language-javascript',
	'.jsx': 'language-javascript',
	'.svelte': 'language-markup',
	'.vue': 'language-markup',
	'.html': 'language-markup',
	'.css': 'language-css',
	'.scss': 'language-css',
	'.json': 'language-json',
	'.md': 'language-markdown',
	'.py': 'language-python',
	'.go': 'language-go',
	'.rs': 'language-rust',
	'.java': 'language-java',
	'.sql': 'language-sql',
	'.sh': 'language-bash',
	'.yml': 'language-yaml',
	'.yaml': 'language-yaml'
};

export function languageClassForPath(path: string): string {
	const lower = path.toLowerCase();
	const idx = lower.lastIndexOf('.');
	if (idx < 0) return 'language-plaintext';
	return LANG_CLASS[lower.slice(idx)] ?? 'language-plaintext';
}
