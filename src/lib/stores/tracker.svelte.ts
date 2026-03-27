// Reactive tracker state — Svelte 5 runes module.
// Import `trackerState` in any component to read reactive aircraft data.

import type { Aircraft } from '$lib/tracker/types.js';
import type { SBSMessage, AircraftJson, AdapterStatus } from '$lib/input/types.js';
import { updateTracker, pruneStale, getAircraftList } from '$lib/tracker/tracker.js';
import { AltitudeUnit } from '$lib/parser/types.js';
import { addCoveragePoint } from '$lib/recorder/coverage.js';
import { recordSnapshot, isRecording } from '$lib/recorder/recorder.js';

// ── State ──────────────────────────────────────────────────────────────────

const _map = new Map<string, Aircraft>();

export const trackerState = $state({
	/** Sorted list of all known aircraft (lastSeen desc). */
	aircraft: [] as Aircraft[],
	/** Total message count received this session. */
	messageCount: 0,
	/** ICAO of the selected aircraft (for detail panel). */
	selectedIcao: null as string | null,
	/** Whether a session is currently being recorded. */
	recording: false,
	/** Current adapter connection status. */
	adapterStatus: 'idle' as AdapterStatus,
	/** Human-readable status message. */
	statusMessage: 'Not connected',
});

// ── Mutations ──────────────────────────────────────────────────────────────

/** Apply a pre-parsed SBS message to the tracker. */
export function applySBS(msg: SBSMessage): void {
	trackerState.messageCount++;

	const now = msg.timestampMs;
	const existing = _map.get(msg.icao);
	const ac: Aircraft = existing
		? { ...existing, lastSeen: now, msgCount: existing.msgCount + 1 }
		: { icao: msg.icao, firstSeen: now, lastSeen: now, msgCount: 1 };

	if (msg.callsign) ac.callsign = msg.callsign.trim() || ac.callsign;
	if (msg.altitude !== undefined) ac.altBaro = msg.altitude;
	if (msg.groundSpeed !== undefined) ac.groundSpeed = msg.groundSpeed;
	if (msg.track !== undefined) ac.track = msg.track;
	if (msg.squawk) ac.squawk = msg.squawk;
	if (msg.verticalRate !== undefined) ac.verticalRate = msg.verticalRate;

	if (msg.lat !== undefined && msg.lon !== undefined) {
		ac.lat = msg.lat;
		ac.lon = msg.lon;
		ac.lastPosition = now;
	}

	_map.set(msg.icao, ac);
	trackerState.aircraft = getAircraftList(_map);
}

/** Apply a full aircraft.json payload to the tracker. */
export function applyAircraftJson(aircraft: AircraftJson[], serverNow: number): void {
	const now = Date.now();

	for (const a of aircraft) {
		const icao = a.hex.toUpperCase();
		const existing = _map.get(icao);

		trackerState.messageCount += a.messages ?? 0;

		// 'seen' is seconds since the aircraft was last heard
		const lastSeenMs = now - (a.seen ?? 0) * 1000;

		const ac: Aircraft = existing
			? { ...existing, lastSeen: lastSeenMs, msgCount: existing.msgCount + (a.messages ?? 0) }
			: { icao, firstSeen: now, lastSeen: lastSeenMs, msgCount: a.messages ?? 0 };

		const flight = a.flight?.trim();
		if (flight) ac.callsign = flight;

		if (a.alt_baro !== undefined && a.alt_baro !== 'ground') {
			ac.altBaro = a.alt_baro;
			ac.altBaroUnit = AltitudeUnit.Feet;
		}
		if (a.alt_geom !== undefined) ac.altGeom = a.alt_geom;
		if (a.gs !== undefined) ac.groundSpeed = a.gs;
		if (a.track !== undefined) ac.track = a.track;
		if (a.baro_rate !== undefined) ac.verticalRate = a.baro_rate;
		if (a.squawk) ac.squawk = a.squawk;
		if (a.nac_p !== undefined) ac.nacP = a.nac_p;
		if (a.sil !== undefined) ac.sil = a.sil;

		if (a.lat !== undefined && a.lon !== undefined) {
			ac.lat = a.lat;
			ac.lon = a.lon;
			const seenPosMs = now - (a.seen_pos ?? 0) * 1000;
			ac.lastPosition = seenPosMs;
			// Accumulate coverage point (fire-and-forget)
			addCoveragePoint(a.lat, a.lon);
		}

		if (a.category) {
			ac.categoryLetter = a.category[0];
			ac.categoryNumber = parseInt(a.category[1], 10) || 0;
		}

		_map.set(icao, ac);
	}

	// Prune aircraft that dump1090 is no longer reporting
	// (seen > 60s means dump1090 would drop them from its list)
	pruneStale(_map, now - 60_000);
	trackerState.aircraft = getAircraftList(_map);
	void serverNow; // used for clock sync in future

	// Record snapshot if active
	if (isRecording()) {
		recordSnapshot(aircraft).catch(() => {});
	}
	trackerState.recording = isRecording();
}

/** Remove aircraft that have not been heard for the stale timeout. */
export function prune(): void {
	pruneStale(_map);
	trackerState.aircraft = getAircraftList(_map);
}

/** Select/deselect an aircraft in the detail panel. */
export function selectAircraft(icao: string | null): void {
	trackerState.selectedIcao = icao;
}

/** Get the currently selected Aircraft record. */
export function getSelected(): Aircraft | undefined {
	if (!trackerState.selectedIcao) return undefined;
	return _map.get(trackerState.selectedIcao);
}

/** Update adapter status string. */
export function setAdapterStatus(status: AdapterStatus, msg?: string): void {
	trackerState.adapterStatus = status;
	trackerState.statusMessage = msg ?? statusLabel(status);
}

function statusLabel(s: AdapterStatus): string {
	switch (s) {
		case 'idle': return 'Not connected';
		case 'connecting': return 'Connecting…';
		case 'connected': return 'Connected';
		case 'error': return 'Connection error';
		case 'disconnected': return 'Disconnected';
	}
}
