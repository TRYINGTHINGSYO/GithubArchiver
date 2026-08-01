/** True when random-discovery shortcuts should be ignored (typing in a control). */
export function shouldIgnoreRandomShortcutTarget(target: EventTarget | null): boolean {
	if (!target || typeof target !== 'object') return false;
	const el = target as {
		tagName?: string;
		isContentEditable?: boolean;
		closest?: (selector: string) => unknown;
	};
	const tag = el.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.isContentEditable) return true;
	if (typeof el.closest === 'function') {
		return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
	}
	return false;
}
