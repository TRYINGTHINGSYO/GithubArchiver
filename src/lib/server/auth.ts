import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

export const ADMIN_COOKIE = 'gha_admin';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function adminPassword(): string {
	return process.env.ADMIN_PASSWORD || 'GitHub';
}

function sessionSecret(): string {
	return process.env.ADMIN_SESSION_SECRET || adminPassword();
}

function sign(payload: string): string {
	return createHmac('sha256', sessionSecret()).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyAdminPassword(password: string): boolean {
	return safeEqual(password, adminPassword());
}

export function createAdminSessionValue(): string {
	const payload = `admin:${Date.now()}`;
	return `${payload}.${sign(payload)}`;
}

export function verifyAdminSessionValue(value: string | undefined): boolean {
	if (!value) return false;
	const separator = value.lastIndexOf('.');
	if (separator <= 0) return false;
	const payload = value.slice(0, separator);
	const signature = value.slice(separator + 1);
	if (!payload.startsWith('admin:')) return false;
	const issuedAt = Number(payload.slice('admin:'.length));
	if (!Number.isFinite(issuedAt)) return false;
	if (Date.now() - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return false;
	return safeEqual(signature, sign(payload));
}

export function setAdminSessionCookie(cookies: Cookies): void {
	cookies.set(ADMIN_COOKIE, createAdminSessionValue(), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		maxAge: SESSION_MAX_AGE_SECONDS
	});
}

export function clearAdminSessionCookie(cookies: Cookies): void {
	cookies.delete(ADMIN_COOKIE, { path: '/' });
}
