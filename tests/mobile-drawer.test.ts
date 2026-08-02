import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { activateModalDrawer } from '$lib/modal-drawer';

class FakeElement {
	tabIndex = 0;
	isConnected = true;
	children: FakeElement[] = [];

	constructor(
		private readonly documentRef: FakeDocument,
		readonly name: string,
		private readonly attributes = new Map<string, string>()
	) {}

	focus() {
		this.documentRef.activeElement = this;
	}

	querySelectorAll() {
		return this.children;
	}

	contains(value: unknown) {
		return value === this || this.children.includes(value as FakeElement);
	}

	hasAttribute(name: string) {
		return this.attributes.has(name);
	}

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}
}

class FakeDocument {
	activeElement: FakeElement | null = null;
	body = { style: { overflow: 'auto' } };
	documentElement = { style: { overflow: 'clip' } };
	listeners = new Set<(event: KeyboardEvent) => void>();

	addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
		this.listeners.add(listener as (event: KeyboardEvent) => void);
	}

	removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
		this.listeners.delete(listener as (event: KeyboardEvent) => void);
	}

	dispatch(event: KeyboardEvent) {
		for (const listener of this.listeners) listener(event);
	}
}

function keyboardEvent(key: string, shiftKey = false) {
	return {
		key,
		shiftKey,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn()
	} as unknown as KeyboardEvent;
}

function fixture() {
	const documentRef = new FakeDocument();
	const trigger = new FakeElement(documentRef, 'trigger');
	const drawer = new FakeElement(documentRef, 'drawer');
	const first = new FakeElement(documentRef, 'first');
	const middle = new FakeElement(documentRef, 'middle');
	const last = new FakeElement(documentRef, 'last');
	drawer.children = [first, middle, last];
	trigger.focus();
	return { documentRef, trigger, drawer, first, middle, last };
}

describe('mobile modal drawer lifecycle', () => {
	it('moves focus into the drawer and locks background scrolling', () => {
		const state = fixture();
		const lifecycle = activateModalDrawer({
			drawer: state.drawer as unknown as HTMLElement,
			trigger: state.trigger as unknown as HTMLElement,
			onRequestClose: vi.fn(),
			documentRef: state.documentRef as unknown as Document
		});

		expect(state.documentRef.activeElement).toBe(state.first);
		expect(state.documentRef.body.style.overflow).toBe('hidden');
		expect(state.documentRef.documentElement.style.overflow).toBe('hidden');
		expect(state.documentRef.listeners.size).toBe(1);
		lifecycle.deactivate();
	});

	it('wraps Tab and Shift+Tab at the drawer boundaries', () => {
		const state = fixture();
		const lifecycle = activateModalDrawer({
			drawer: state.drawer as unknown as HTMLElement,
			trigger: state.trigger as unknown as HTMLElement,
			onRequestClose: vi.fn(),
			documentRef: state.documentRef as unknown as Document
		});

		state.last.focus();
		const tab = keyboardEvent('Tab');
		state.documentRef.dispatch(tab);
		expect(tab.preventDefault).toHaveBeenCalledOnce();
		expect(state.documentRef.activeElement).toBe(state.first);

		const shiftTab = keyboardEvent('Tab', true);
		state.documentRef.dispatch(shiftTab);
		expect(shiftTab.preventDefault).toHaveBeenCalledOnce();
		expect(state.documentRef.activeElement).toBe(state.last);
		lifecycle.deactivate();
	});

	it('requests close on Escape and restores focus and scroll state on close', () => {
		const state = fixture();
		const onRequestClose = vi.fn();
		const lifecycle = activateModalDrawer({
			drawer: state.drawer as unknown as HTMLElement,
			trigger: state.trigger as unknown as HTMLElement,
			onRequestClose,
			documentRef: state.documentRef as unknown as Document
		});

		const escape = keyboardEvent('Escape');
		state.documentRef.dispatch(escape);
		expect(onRequestClose).toHaveBeenCalledOnce();
		expect(escape.preventDefault).toHaveBeenCalledOnce();

		lifecycle.deactivate();
		expect(state.documentRef.activeElement).toBe(state.trigger);
		expect(state.documentRef.body.style.overflow).toBe('auto');
		expect(state.documentRef.documentElement.style.overflow).toBe('clip');
		expect(state.documentRef.listeners.size).toBe(0);
	});

	it('cleans up without restoring focus when the layout unmounts', () => {
		const state = fixture();
		const lifecycle = activateModalDrawer({
			drawer: state.drawer as unknown as HTMLElement,
			trigger: state.trigger as unknown as HTMLElement,
			onRequestClose: vi.fn(),
			documentRef: state.documentRef as unknown as Document
		});

		lifecycle.deactivate({ restoreFocus: false });
		expect(state.documentRef.activeElement).toBe(state.first);
		expect(state.documentRef.body.style.overflow).toBe('auto');
		expect(state.documentRef.documentElement.style.overflow).toBe('clip');
		expect(state.documentRef.listeners.size).toBe(0);
	});

	it('routes every layout close path through the shared lifecycle', () => {
		const layout = readFileSync(resolve('src/routes/+layout.svelte'), 'utf8');
		expect(layout).toMatch(/beforeNavigate\([\s\S]*?closeMobileNav\(false\)/);
		expect(layout).toMatch(/afterNavigate\([\s\S]*?restoreMobileNavFocusAfterNavigation/);
		expect(layout).toMatch(/aria-label="Close navigation"[\s\S]*?closeMobileNav\(\)/);
		expect(layout).toMatch(/>Close<\/button>/);
		expect(layout).toMatch(/onDestroy\([\s\S]*?closeMobileNav\(false\)/);
	});
});
