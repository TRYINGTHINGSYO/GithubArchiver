import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

export const ADMIN_COOKIE = 'gha_admin';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const DEVELOPMENT_ADMIN_PASSWORD = 'GitHub';

function configuredValue(name: string): string | null {
	const value = process.env[name]?.trim();
	return value ? value : null;
}

function adminPassword(): string | null {
	return (
		configuredValue('ADMIN_PASSWORD') ??
		(process.env.NODE_ENV === 'production' ? null : DEVELOPMENT_ADMIN_PASSWORD)
	);
}

function sessionSecret(): string | null {
	return configuredValue('ADMIN_SESSION_SECRET') ?? adminPassword();
}

function sign(payload: string, secret: string): string {
	return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyAdminPassword(password: string): boolean {
	const expected = adminPassword();
	return expected !== null && safeEqual(password, expected);
}

export function isAdminAuthConfigured(): boolean {
	return adminPassword() !== null && sessionSecret() !== null;
}

export function createAdminSessionValue(): string {
	const secret = sessionSecret();
	if (!secret) {
		throw new Error('Admin authentication requires ADMIN_PASSWORD in production.');
	}
	const payload = `admin:${Date.now()}`;
	return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminSessionValue(value: string | undefined): boolean {
	if (!value) return false;
	const secret = sessionSecret();
	if (!secret) return false;
	const separator = value.lastIndexOf('.');
	if (separator <= 0) return false;
	const payload = value.slice(0, separator);
	const signature = value.slice(separator + 1);
	if (!payload.startsWith('admin:')) return false;
	const issuedAt = Number(payload.slice('admin:'.length));
	if (!Number.isFinite(issuedAt)) return false;
	if (Date.now() - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return false;
	return safeEqual(signature, sign(payload, secret));
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

export function safeAdminNextPath(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/admin';
	try {
		const base = new URL('http://admin.local');
		const target = new URL(value, base);
		if (target.origin !== base.origin) return '/admin';
		return `${target.pathname}${target.search}${target.hash}`;
	} catch {
		return '/admin';
	}
}
