// ADS-B Extended Squitter decoder
// Handles DF17/18 ME field (56 bits = 7 bytes)

import {
	ADSBMessageType,
	AIS_CHARSET,
	AltitudeUnit,
	CPRFormat,
	VelocitySubtype,
	type ADSBData,
	type AircraftIdentification,
	type CprPosition,
	type Velocity,
} from './types.js';
import { decodeAC12Field } from './altitude.js';
import { decodeID13Field } from './squawk.js';

// Extract a value from a Uint8Array spanning multiple bytes
// bitOffset: bit offset from start of array (MSB = bit 0)
// bitLength: number of bits to extract (max 32)
export function extractBits(data: Uint8Array, bitOffset: number, bitLength: number): number {
	let result = 0;
	for (let i = 0; i < bitLength; i++) {
		const byteIdx = Math.floor((bitOffset + i) / 8);
		const bitIdx = 7 - ((bitOffset + i) % 8);
		result = (result << 1) | ((data[byteIdx] >> bitIdx) & 1);
	}
	return result >>> 0;
}

// Decode aircraft identification (TC 1-4)
function decodeIdentification(me: Uint8Array, tc: number, ec: number): AircraftIdentification {
	// TC 1=D, 2=C, 3=B, 4=A
	const catLetters = ['?', 'D', 'C', 'B', 'A'];
	const categoryLetter = tc >= 1 && tc <= 4 ? catLetters[tc] : '?';
	const categoryNumber = ec;

	// Callsign: bits 8-55 of ME = 48 bits = 8 × 6-bit characters
	let callsign = '';
	for (let i = 0; i < 8; i++) {
		const charCode = extractBits(me, 8 + i * 6, 6);
		if (charCode < AIS_CHARSET.length) {
			callsign += AIS_CHARSET[charCode];
		} else {
			callsign += '#';
		}
	}

	return {
		callsign: callsign.trimEnd(),
		categoryLetter,
		categoryNumber,
	};
}

// Decode airborne position (TC 9-18 for baro, 20-22 for GNSS)
function decodeAirbornePosition(
	me: Uint8Array,
	tc: number
): { cprPosition: CprPosition; altitude: number | null; altUnit: AltitudeUnit } {
	let altitude: number | null = null;
	const altUnit = AltitudeUnit.Feet;

	if (tc >= 9 && tc <= 18) {
		const ac12 = extractBits(me, 8, 12);
		const decoded = decodeAC12Field(ac12);
		altitude = decoded ? decoded.altitude : null;
	}

	// Bit 20: T (UTC sync flag) — ignored for position decode
	// Bit 21: F (CPR format: 0=even, 1=odd)
	const f = extractBits(me, 21, 1);
	// Bits 22-38: encoded latitude (17 bits)
	const latCpr = extractBits(me, 22, 17);
	// Bits 39-55: encoded longitude (17 bits)
	const lonCpr = extractBits(me, 39, 17);

	return {
		cprPosition: {
			latCpr,
			lonCpr,
			format: f === 0 ? CPRFormat.Even : CPRFormat.Odd,
		},
		altitude,
		altUnit,
	};
}

// Decode surface position (TC 5-8)
function decodeSurfacePosition(me: Uint8Array): { cprPosition: CprPosition } {
	const f = extractBits(me, 21, 1);
	const latCpr = extractBits(me, 22, 17);
	const lonCpr = extractBits(me, 39, 17);

	return {
		cprPosition: {
			latCpr,
			lonCpr,
			format: f === 0 ? CPRFormat.Even : CPRFormat.Odd,
		},
	};
}

// Decode airborne velocity (TC 19)
function decodeAirborneVelocity(me: Uint8Array, st: number): Velocity | null {
	if (st < 1 || st > 4) return null;

	const isGroundSpeed = st === 1 || st === 2;
	const isSupersonic = st === 2 || st === 4;
	const scale = isSupersonic ? 4 : 1;

	// Bit 35: vertical rate source (0=GNSS, 1=baro)
	const vrSource = extractBits(me, 35, 1);
	// Bit 36: vertical rate sign (0=up, 1=down)
	const vrSign = extractBits(me, 36, 1);
	// Bits 37-45: vertical rate value (9 bits)
	const vrValue = extractBits(me, 37, 9);

	// Bit 48: GNSS/baro alt diff sign (0=above, 1=below)
	const altDiffSign = extractBits(me, 48, 1);
	// Bits 49-55: GNSS/baro alt diff value (7 bits)
	const altDiffValue = extractBits(me, 49, 7);

	let verticalRate: number | undefined;
	if (vrValue > 0) {
		verticalRate = (vrSign === 0 ? 1 : -1) * (vrValue - 1) * 64;
	}

	let geomAltDiff: number | undefined;
	if (altDiffValue > 0) {
		geomAltDiff = (altDiffValue - 1) * 25;
	}

	if (isGroundSpeed) {
		// Bit 13: Dir_EW (0=East, 1=West)
		const dirEW = extractBits(me, 13, 1);
		// Bits 14-23: V_EW (10 bits, 0=no info, 1=0kt, 2=1kt, ...)
		const vEW = extractBits(me, 14, 10);
		// Bit 24: Dir_NS (0=North, 1=South)
		const dirNS = extractBits(me, 24, 1);
		// Bits 25-34: V_NS (10 bits)
		const vNS = extractBits(me, 25, 10);

		let groundSpeed: number | undefined;
		let track: number | undefined;
		let trackValid = false;

		if (vEW > 0 || vNS > 0) {
			const ve = vEW > 0 ? (dirEW === 0 ? 1 : -1) * (vEW - 1) * scale : 0;
			const vn = vNS > 0 ? (dirNS === 0 ? 1 : -1) * (vNS - 1) * scale : 0;
			groundSpeed = Math.round(Math.sqrt(ve * ve + vn * vn));
			let trackRad = Math.atan2(ve, vn);
			if (trackRad < 0) trackRad += 2 * Math.PI;
			track = Math.round((trackRad * 180) / Math.PI * 10) / 10;
			trackValid = true;
		}

		return {
			subtype: isSupersonic ? VelocitySubtype.GroundSpeedSupersonic : VelocitySubtype.GroundSpeedSubsonic,
			groundSpeed,
			track,
			trackValid,
			headingValid: false,
			verticalRate,
			verticalRateSource: vrSource === 0 ? 'gnss' : 'baro',
			geomAltDiff,
			geomAltDiffSign: altDiffSign === 0 ? 'above' : 'below',
		};
	} else {
		// Airspeed mode (ST 3 or 4)
		const hdgStatus = extractBits(me, 13, 1);
		const hdgRaw = extractBits(me, 14, 10);
		const asType = extractBits(me, 24, 1);
		const asValue = extractBits(me, 25, 10);

		let heading: number | undefined;
		let airspeed: number | undefined;

		if (hdgStatus === 1) {
			heading = Math.round((hdgRaw / 1024.0) * 360.0 * 10) / 10;
		}

		if (asValue > 0) {
			airspeed = (asValue - 1) * scale;
		}

		return {
			subtype: isSupersonic ? VelocitySubtype.AirspeedSupersonic : VelocitySubtype.AirspeedSubsonic,
			airspeedType: asType === 0 ? 'IAS' : 'TAS',
			airspeed,
			heading,
			headingValid: hdgStatus === 1,
			trackValid: false,
			verticalRate,
			verticalRateSource: vrSource === 0 ? 'gnss' : 'baro',
			geomAltDiff,
			geomAltDiffSign: altDiffSign === 0 ? 'above' : 'below',
		};
	}
}

// Decode operational status (TC 31)
function decodeOperationalStatus(me: Uint8Array, st: number): ADSBData['operationalStatus'] {
	const version = extractBits(me, 40, 3);
	const nicSuppA = extractBits(me, 43, 1);
	const nacPos = extractBits(me, 44, 4);
	const gvaAlt = extractBits(me, 48, 2);
	const sil = extractBits(me, 50, 2);
	const hrd = extractBits(me, 54, 1);

	return {
		version,
		nicSuppA,
		nacPos,
		gvaAlt,
		sil,
		hrd,
		subtype: st,
	};
}

// Main ADS-B ME field decoder
export function decodeADSB(me: Uint8Array): ADSBData {
	const tc = (me[0] >> 3) & 0x1f; // type code: top 5 bits of ME byte 0
	const st = me[0] & 0x07;         // subtype: low 3 bits of ME byte 0

	if (tc >= 1 && tc <= 4) {
		const identification = decodeIdentification(me, tc, st);
		return {
			typeCode: tc, subType: st,
			messageType: ADSBMessageType.AircraftIdentification,
			me, identification,
		};
	}

	if (tc >= 5 && tc <= 8) {
		const { cprPosition } = decodeSurfacePosition(me);
		return {
			typeCode: tc, subType: st,
			messageType: ADSBMessageType.SurfacePosition,
			me, cprPosition,
		};
	}

	if (tc >= 9 && tc <= 18) {
		const { cprPosition, altitude, altUnit } = decodeAirbornePosition(me, tc);
		return {
			typeCode: tc, subType: st,
			messageType: ADSBMessageType.AirbornePositionBaro,
			me, cprPosition, altitude: altitude ?? undefined, altUnit,
		};
	}

	if (tc === 19) {
		const velocity = decodeAirborneVelocity(me, st) ?? undefined;
		return {
			typeCode: tc, subType: st,
			messageType: ADSBMessageType.AirborneVelocity,
			me, velocity,
		};
	}

	if (tc >= 20 && tc <= 22) {
		const { cprPosition, altitude, altUnit } = decodeAirbornePosition(me, tc);
		return {
			typeCode: tc, subType: st,
			messageType: ADSBMessageType.AirbornePositionGNSS,
			me, cprPosition, altitude: altitude ?? undefined, altUnit,
		};
	}

	if (tc === 28) {
		const emergencyState = extractBits(me, 8, 3);
		const id13 = extractBits(me, 11, 13);
		const squawkFromStatus = decodeID13Field(id13);
		return {
			typeCode: tc, subType: st,
			messageType: ADSBMessageType.AircraftStatus,
			me, emergencyState, squawkFromStatus,
		};
	}

	if (tc === 29) {
		return {
			typeCode: tc, subType: st,
			messageType: ADSBMessageType.TargetStateAndStatus,
			me,
		};
	}

	if (tc === 31) {
		const operationalStatus = decodeOperationalStatus(me, st);
		return {
			typeCode: tc, subType: st,
			messageType: ADSBMessageType.OperationalStatus,
			me, operationalStatus,
		};
	}

	return { typeCode: tc, subType: st, messageType: ADSBMessageType.Unknown, me };
}
