const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

export interface ModalDrawerLifecycle {
	deactivate(options?: { restoreFocus?: boolean }): void;
}

export interface ModalDrawerOptions {
	drawer: HTMLElement;
	trigger: HTMLElement;
	onRequestClose: () => void;
	documentRef?: Document;
}

function canReceiveFocus(value: unknown): value is HTMLElement {
	return Boolean(value && typeof (value as HTMLElement).focus === 'function');
}

function focusableElements(drawer: HTMLElement): HTMLElement[] {
	return Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(element) =>
			element.tabIndex >= 0 &&
			!element.hasAttribute('disabled') &&
			element.getAttribute('aria-hidden') !== 'true'
	);
}

/**
 * Activate a small modal-drawer lifecycle without pulling in a dialog library.
 * The caller owns open state; this helper owns focus containment and scroll state.
 */
export function activateModalDrawer({
	drawer,
	trigger,
	onRequestClose,
	documentRef = document
}: ModalDrawerOptions): ModalDrawerLifecycle {
	const previousFocus = canReceiveFocus(documentRef.activeElement)
		? documentRef.activeElement
		: trigger;
	const previousBodyOverflow = documentRef.body.style.overflow;
	const previousDocumentOverflow = documentRef.documentElement.style.overflow;
	let active = true;

	documentRef.body.style.overflow = 'hidden';
	documentRef.documentElement.style.overflow = 'hidden';

	const initialFocus = focusableElements(drawer)[0] ?? drawer;
	initialFocus.focus();

	function onKeydown(event: KeyboardEvent) {
		if (!active) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onRequestClose();
			return;
		}
		if (event.key !== 'Tab') return;

		const focusable = focusableElements(drawer);
		if (focusable.length === 0) {
			event.preventDefault();
			drawer.focus();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const current = documentRef.activeElement;
		if (event.shiftKey && (current === first || !drawer.contains(current))) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && (current === last || !drawer.contains(current))) {
			event.preventDefault();
			first.focus();
		}
	}

	documentRef.addEventListener('keydown', onKeydown, true);

	return {
		deactivate({ restoreFocus = true } = {}) {
			if (!active) return;
			active = false;
			documentRef.removeEventListener('keydown', onKeydown, true);
			documentRef.body.style.overflow = previousBodyOverflow;
			documentRef.documentElement.style.overflow = previousDocumentOverflow;
			if (restoreFocus) {
				const target = previousFocus?.isConnected === false ? trigger : previousFocus;
				if (canReceiveFocus(target) && target.isConnected !== false) target.focus();
			}
		}
	};
}
