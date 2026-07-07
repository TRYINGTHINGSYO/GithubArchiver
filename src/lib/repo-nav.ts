import { goto } from '$app/navigation';

export function repoDetailPath(owner: string, name: string): string {
	return `/repo/${owner}/${name}`;
}

export function navigateToRepo(owner: string, name: string): void {
	void goto(repoDetailPath(owner, name));
}

export function isNestedInteractiveTarget(target: EventTarget | null): boolean {
	return Boolean((target as Element | null)?.closest?.('a, button'));
}

export function handleRepoCardClick(
	event: MouseEvent,
	owner: string,
	name: string
): void {
	if (isNestedInteractiveTarget(event.target)) return;
	navigateToRepo(owner, name);
}

export function handleRepoCardKeydown(
	event: KeyboardEvent,
	owner: string,
	name: string
): void {
	if (event.key !== 'Enter' && event.key !== ' ') return;
	event.preventDefault();
	navigateToRepo(owner, name);
}

export function stopCardNavigation(event: Event): void {
	event.stopPropagation();
}
