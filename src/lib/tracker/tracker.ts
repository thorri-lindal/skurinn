// Aircraft tracker — merges Mode S messages into per-ICAO state
// Pure functions: update() takes (map, message) → new map entry

import type { ModeSMessage } from '../parser/types.js';
import { ADSBMessageType, CPRFormat } from '../parser/types.js';
import { cprGlobalDecode, cprLocalDecode } from '../parser/cpr.js';
import type { Aircraft, CprFrame } from './types.js';
import { CPR_MAX_AGE_MS, STALE_AGE_MS } from './types.js';

// Update tracker state with a new message.
// Returns the updated Aircraft record (or undefined if ICAO cannot be determined).
export function updateTracker(
	aircraft: Map<string, Aircraft>,
	msg: ModeSMessage,
	now: number = Date.now()
): Aircraft | undefined {
	if (!msg.icao) return undefined;

	const icao = msg.icao;
	const existing = aircraft.get(icao);

	const ac: Aircraft = existing
		? { ...existing, lastSeen: now, msgCount: existing.msgCount + 1 }
		: { icao, firstSeen: now, lastSeen: now, msgCount: 1 };

	// Merge DF-specific fields
	if (msg.altitude !== undefined) {
		ac.altBaro = msg.altitude;
		if (msg.altUnit) ac.altBaroUnit = msg.altUnit;
	}

	if (msg.squawk !== undefined) {
		ac.squawk = msg.squawk;
	}

	if (msg.flightStatus !== undefined) {
		ac.flightStatus = msg.flightStatus;
	}

	// ADS-B fields
	const adsb = msg.adsb;
	if (adsb) {
		switch (adsb.messageType) {
			case ADSBMessageType.AircraftIdentification: {
				const id = adsb.identification;
				if (id) {
					ac.callsign = id.callsign || ac.callsign;
					ac.categoryLetter = id.categoryLetter;
					ac.categoryNumber = id.categoryNumber;
				}
				break;
			}

			case ADSBMessageType.AirbornePositionBaro:
			case ADSBMessageType.AirbornePositionGNSS: {
				if (adsb.altitude !== undefined) {
					ac.altBaro = adsb.altitude;
					if (adsb.altUnit) ac.altBaroUnit = adsb.altUnit;
				}

				if (adsb.cprPosition) {
					const frame: CprFrame = {
						latCpr: adsb.cprPosition.latCpr,
						lonCpr: adsb.cprPosition.lonCpr,
						altitude: adsb.altitude,
						altUnit: adsb.altUnit,
						timestamp: now,
					};

					if (adsb.cprPosition.format === CPRFormat.Even) {
						ac.evenFrame = frame;
					} else {
						ac.oddFrame = frame;
					}

					// Attempt position decode
					const pos = decodePosition(ac, now);
					if (pos) {
						ac.lat = pos.lat;
						ac.lon = pos.lon;
						ac.lastPosition = now;
					}
				}
				break;
			}

			case ADSBMessageType.AirborneVelocity: {
				const vel = adsb.velocity;
				if (vel) {
					if (vel.groundSpeed !== undefined) ac.groundSpeed = vel.groundSpeed;
					if (vel.trackValid && vel.track !== undefined) ac.track = vel.track;
					if (vel.verticalRate !== undefined) ac.verticalRate = vel.verticalRate;
					if (vel.verticalRateSource) ac.verticalRateSource = vel.verticalRateSource;
				}
				break;
			}

			case ADSBMessageType.OperationalStatus: {
				const ops = adsb.operationalStatus;
				if (ops) {
					ac.version = ops.version;
					if (ops.nacPos !== undefined) ac.nacP = ops.nacPos;
					if (ops.sil !== undefined) ac.sil = ops.sil;
					if (ops.hrd !== undefined) ac.hrd = ops.hrd;
				}
				break;
			}

			case ADSBMessageType.AircraftStatus: {
				if (adsb.squawkFromStatus) ac.squawk = adsb.squawkFromStatus;
				break;
			}
		}
	}

	aircraft.set(icao, ac);
	return ac;
}

// Attempt to decode position from accumulated CPR frames
function decodePosition(
	ac: Aircraft,
	now: number
): { lat: number; lon: number } | null {
	const even = ac.evenFrame;
	const odd = ac.oddFrame;

	// Global decode: need both frames, both fresh, and odd frame must be more recent
	if (
		even && odd &&
		now - even.timestamp <= CPR_MAX_AGE_MS &&
		now - odd.timestamp <= CPR_MAX_AGE_MS
	) {
		const recentFrame = even.timestamp >= odd.timestamp ? CPRFormat.Even : CPRFormat.Odd;
		const pos = cprGlobalDecode(
			even.latCpr, even.lonCpr,
			odd.latCpr, odd.lonCpr,
			recentFrame
		);
		if (pos) return pos;
	}

	// Local decode: use last known position as reference (if recent enough)
	if (ac.lat !== undefined && ac.lon !== undefined && ac.lastPosition) {
		const ageMs = now - ac.lastPosition;
		// Use local decode only if last position is fresh (within 3 minutes)
		if (ageMs <= 180_000) {
			const frame = even && odd
				? (even.timestamp >= odd.timestamp ? even : odd)
				: (even ?? odd);

			if (frame) {
				const format = frame === even ? CPRFormat.Even : CPRFormat.Odd;
				const pos = cprLocalDecode(
					frame.latCpr, frame.lonCpr,
					format,
					ac.lat, ac.lon
				);
				if (pos) return pos;
			}
		}
	}

	return null;
}

// Remove aircraft that have not been seen for STALE_AGE_MS
export function pruneStale(
	aircraft: Map<string, Aircraft>,
	now: number = Date.now()
): void {
	for (const [icao, ac] of aircraft) {
		if (now - ac.lastSeen > STALE_AGE_MS) {
			aircraft.delete(icao);
		}
	}
}

// Return all aircraft as an array, sorted by lastSeen descending
export function getAircraftList(aircraft: Map<string, Aircraft>): Aircraft[] {
	return Array.from(aircraft.values()).sort((a, b) => b.lastSeen - a.lastSeen);
}
