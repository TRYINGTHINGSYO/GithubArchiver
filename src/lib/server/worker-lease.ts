import { randomUUID } from 'node:crypto';
import { getDb } from './db/connection.js';

const DEFAULT_LEASE_MS = Number(process.env.WORKER_LEASE_MS ?? 90_000);
const HEARTBEAT_MS = Number(process.env.WORKER_LEASE_HEARTBEAT_MS ?? 30_000);

export interface WorkerLease {
	leaseName: string;
	ownerId: string;
	acquiredAt: string;
	expiresAt: string;
	heartbeatAt: string;
}

function nowIso(ms = Date.now()): string {
	return new Date(ms).toISOString();
}

export function acquireWorkerLease(
	leaseName: string,
	opts: { ownerId?: string; ttlMs?: number } = {}
): WorkerLease | null {
	const db = getDb();
	const ownerId = opts.ownerId ?? `${process.pid}-${randomUUID().slice(0, 8)}`;
	const ttlMs = opts.ttlMs ?? DEFAULT_LEASE_MS;
	const now = Date.now();
	const acquiredAt = nowIso(now);
	const expiresAt = nowIso(now + ttlMs);

	const existing = db.prepare('SELECT * FROM worker_leases WHERE lease_name = ?').get(leaseName) as
		| {
				owner_id: string;
				expires_at: string;
				acquired_at: string;
				heartbeat_at: string;
		  }
		| undefined;

	if (existing && Date.parse(existing.expires_at) > now && existing.owner_id !== ownerId) {
		return null;
	}

	db.prepare(
		`INSERT INTO worker_leases (lease_name, owner_id, acquired_at, expires_at, heartbeat_at, detail_json)
		 VALUES (?, ?, ?, ?, ?, '{}')
		 ON CONFLICT(lease_name) DO UPDATE SET
		   owner_id = excluded.owner_id,
		   acquired_at = excluded.acquired_at,
		   expires_at = excluded.expires_at,
		   heartbeat_at = excluded.heartbeat_at
		 WHERE worker_leases.expires_at <= ? OR worker_leases.owner_id = ?`
	).run(leaseName, ownerId, acquiredAt, expiresAt, acquiredAt, acquiredAt, ownerId);

	const row = db.prepare('SELECT * FROM worker_leases WHERE lease_name = ?').get(leaseName) as
		| {
				owner_id: string;
				acquired_at: string;
				expires_at: string;
				heartbeat_at: string;
		  }
		| undefined;

	if (!row || row.owner_id !== ownerId) return null;
	return {
		leaseName,
		ownerId: row.owner_id,
		acquiredAt: row.acquired_at,
		expiresAt: row.expires_at,
		heartbeatAt: row.heartbeat_at
	};
}

export function heartbeatWorkerLease(leaseName: string, ownerId: string, ttlMs = DEFAULT_LEASE_MS): boolean {
	const db = getDb();
	const now = Date.now();
	const result = db
		.prepare(
			`UPDATE worker_leases
			 SET heartbeat_at = ?, expires_at = ?
			 WHERE lease_name = ? AND owner_id = ?`
		)
		.run(nowIso(now), nowIso(now + ttlMs), leaseName, ownerId);
	return result.changes > 0;
}

export function releaseWorkerLease(leaseName: string, ownerId: string): void {
	const db = getDb();
	db.prepare('DELETE FROM worker_leases WHERE lease_name = ? AND owner_id = ?').run(leaseName, ownerId);
}

export function startLeaseHeartbeat(leaseName: string, ownerId: string): () => void {
	const timer = setInterval(() => {
		heartbeatWorkerLease(leaseName, ownerId);
	}, HEARTBEAT_MS);
	if (typeof timer === 'object' && 'unref' in timer) timer.unref();
	return () => clearInterval(timer);
}
