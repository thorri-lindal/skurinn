// Aircraft state type — the merged view of all messages from one ICAO address

import type { AltitudeUnit, CprPosition } from '../parser/types.js';

export interface CprFrame {
	latCpr: number;
	lonCpr: number;
	altitude?: number;
	altUnit?: AltitudeUnit;
	timestamp: number; // ms since epoch
}

export interface Aircraft {
	icao: string;

	// Identification
	callsign?: string;
	categoryLetter?: string;
	categoryNumber?: number;
	squawk?: string;
	flightStatus?: number;

	// Barometric position
	lat?: number;
	lon?: number;
	altBaro?: number;
	altBaroUnit?: AltitudeUnit;

	// Geometric altitude (GNSS)
	altGeom?: number;

	// Velocity
	groundSpeed?: number;  // kt
	track?: number;        // degrees true
	verticalRate?: number; // ft/min
	verticalRateSource?: 'baro' | 'gnss';

	// ADS-B quality / integrity
	version?: number;
	nicA?: number;
	nacP?: number;
	sil?: number;
	hrd?: number; // 0=magnetic north, 1=true north

	// CPR decoding state (last even/odd frame per aircraft)
	evenFrame?: CprFrame;
	oddFrame?: CprFrame;

	// Timing
	firstSeen: number;  // ms since epoch
	lastSeen: number;   // ms since epoch
	lastPosition?: number; // ms since epoch when position was last decoded
	msgCount: number;
}

// Max age (ms) for a CPR frame to be used in global decode
export const CPR_MAX_AGE_MS = 10_000;

// Age after which an aircraft is considered stale (10 minutes)
export const STALE_AGE_MS = 600_000;
