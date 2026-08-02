export function safeAuthCallbackPath(
	value: string | null | undefined,
	fallback = '/'
): string {
	if (!value || !value.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
	try {
		const base = new URL('http://auth.local');
		const target = new URL(value, base);
		if (target.origin !== base.origin) return fallback;
		return `${target.pathname}${target.search}${target.hash}`;
	} catch {
		return fallback;
	}
}
