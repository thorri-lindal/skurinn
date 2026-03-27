// IndexedDB schema and session types for the recorder

import type { AircraftJson } from '../input/types.js';
import type { DBSchema } from 'idb';

export interface RecordedSession {
	id: string;
	name: string;
	startedAt: number;    // ms epoch
	endedAt?: number;
	eventCount: number;
	aircraftSeen: number; // unique ICAOs
}

// One snapshot per poll tick — the full aircraft list at time t
export interface SessionEvent {
	sessionId: string;
	t: number;            // ms from session start
	aircraft: AircraftJson[];
}

// Coverage point — one entry per received position
export interface CoveragePoint {
	lat: number;
	lon: number;
}

export interface WorkbenchDB extends DBSchema {
	sessions: {
		key: string;
		value: RecordedSession;
	};
	events: {
		key: [string, number];
		value: SessionEvent;
		indexes: { 'by-session': string };
	};
	coverage: {
		key: number;
		value: CoveragePoint;
		autoIncrement: true;
	};
}
