export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'gha-theme';

export function readStoredTheme(): ThemeMode {
	if (typeof localStorage === 'undefined') return 'dark';
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
	return 'dark';
}

export function storeTheme(mode: ThemeMode): void {
	localStorage.setItem(STORAGE_KEY, mode);
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
	if (mode === 'light' || mode === 'dark') return mode;
	if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(mode: ThemeMode): 'light' | 'dark' {
	const resolved = resolveTheme(mode);
	document.documentElement.dataset.theme = resolved;
	document.documentElement.style.colorScheme = resolved;
	return resolved;
}
