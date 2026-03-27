// Coverage accumulator — persists received positions to IndexedDB

import type { CoveragePoint } from './types.js';
import { getDB } from './db.js';

// In-memory buffer to batch writes
const _buffer: CoveragePoint[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

// Add a position to the in-memory buffer (flushed every 5 s)
export function addCoveragePoint(lat: number, lon: number): void {
	_buffer.push({ lat, lon });
	if (_flushTimer === null) {
		_flushTimer = setTimeout(() => flushCoverage(), 5000);
	}
}

async function flushCoverage(): Promise<void> {
	_flushTimer = null;
	if (_buffer.length === 0) return;
	const points = _buffer.splice(0);
	const db = await getDB();
	const tx = db.transaction('coverage', 'readwrite');
	for (const p of points) await tx.store.add(p);
	await tx.done;
}

// Load all stored coverage points
export async function loadCoveragePoints(): Promise<CoveragePoint[]> {
	const db = await getDB();
	return db.getAll('coverage');
}

// Clear all coverage data
export async function clearCoverage(): Promise<void> {
	const db = await getDB();
	await db.clear('coverage');
}
