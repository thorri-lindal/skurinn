// Session recorder — saves aircraft snapshots to IndexedDB
// and manages the list of saved sessions.

import type { AircraftJson } from '../input/types.js';
import type { RecordedSession, SessionEvent } from './types.js';
import { getDB } from './db.js';

// ── Active recording state ─────────────────────────────────────────────────

let _sessionId: string | null = null;
let _startedAt = 0;
let _eventCount = 0;
let _icaoSeen = new Set<string>();

function generateId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Start a new recording session. Returns the session ID.
export async function startRecording(name?: string): Promise<string> {
	const db = await getDB();
	const id = generateId();
	const now = Date.now();
	const session: RecordedSession = {
		id,
		name: name ?? new Date(now).toLocaleString(),
		startedAt: now,
		eventCount: 0,
		aircraftSeen: 0,
	};
	await db.put('sessions', session);
	_sessionId = id;
	_startedAt = now;
	_eventCount = 0;
	_icaoSeen = new Set();
	return id;
}

// Record one snapshot tick.
export async function recordSnapshot(aircraft: AircraftJson[]): Promise<void> {
	if (!_sessionId) return;
	const db = await getDB();
	const t = Date.now() - _startedAt;
	const event: SessionEvent = { sessionId: _sessionId, t, aircraft };
	await db.put('events', event);
	_eventCount++;
	for (const a of aircraft) _icaoSeen.add(a.hex.toUpperCase());
	// Update session metadata every 10 events
	if (_eventCount % 10 === 0) {
		const session = await db.get('sessions', _sessionId);
		if (session) {
			session.eventCount = _eventCount;
			session.aircraftSeen = _icaoSeen.size;
			await db.put('sessions', session);
		}
	}
}

// Stop recording and finalise the session record.
export async function stopRecording(): Promise<void> {
	if (!_sessionId) return;
	const db = await getDB();
	const session = await db.get('sessions', _sessionId);
	if (session) {
		session.endedAt = Date.now();
		session.eventCount = _eventCount;
		session.aircraftSeen = _icaoSeen.size;
		await db.put('sessions', session);
	}
	_sessionId = null;
}

export function isRecording(): boolean {
	return _sessionId !== null;
}

export function currentSessionId(): string | null {
	return _sessionId;
}

// ── Session management ─────────────────────────────────────────────────────

export async function listSessions(): Promise<RecordedSession[]> {
	const db = await getDB();
	const all = await db.getAll('sessions');
	return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteSession(id: string): Promise<void> {
	const db = await getDB();
	await db.delete('sessions', id);
	// Delete all events for this session
	const tx = db.transaction('events', 'readwrite');
	const idx = tx.store.index('by-session');
	let cursor = await idx.openCursor(IDBKeyRange.only(id));
	while (cursor) {
		await cursor.delete();
		cursor = await cursor.continue();
	}
	await tx.done;
}

// Load all events for a session, sorted by t
export async function loadSessionEvents(sessionId: string): Promise<SessionEvent[]> {
	const db = await getDB();
	const all = await db.getAllFromIndex('events', 'by-session', sessionId);
	return all.sort((a, b) => a.t - b.t);
}

// Export a session as a JSON blob (for file download)
export async function exportSession(sessionId: string): Promise<Blob> {
	const db = await getDB();
	const session = await db.get('sessions', sessionId);
	const events = await loadSessionEvents(sessionId);
	const data = { session, events };
	return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

// Import a session from a JSON blob
export async function importSession(blob: Blob): Promise<string> {
	const text = await blob.text();
	const data = JSON.parse(text) as { session: RecordedSession; events: SessionEvent[] };
	const db = await getDB();
	// Assign a new ID to avoid collisions
	const newId = generateId();
	const session: RecordedSession = { ...data.session, id: newId };
	await db.put('sessions', session);
	const tx = db.transaction('events', 'readwrite');
	for (const ev of data.events) {
		await tx.store.put({ ...ev, sessionId: newId });
	}
	await tx.done;
	return newId;
}
