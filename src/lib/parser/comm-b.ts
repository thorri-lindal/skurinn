// Comm-B BDS register decoding
// BDS (Broadcast Data Selector) registers carry various data in DF20/21

import type { CommBData } from './types.js';

// BDS 2,0 — Aircraft identification (callsign)
// Same format as ADS-B TC 1-4 identification
function decodeBDS20(mb: Uint8Array): Record<string, unknown> | null {
	// BDS field: bits 1-8 = BDS code (should be 0x20), bits 9-56 = callsign
	const bdsCode = mb[0];
	if (bdsCode !== 0x20) return null;

	const charset = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######';
	let callsign = '';
	for (let i = 0; i < 8; i++) {
		const byteOffset = 1 + Math.floor((i * 6) / 8);
		const bitOffset = (i * 6) % 8;
		let charCode: number;
		if (bitOffset <= 2) {
			charCode = (mb[byteOffset] >> (2 - bitOffset)) & 0x3f;
		} else {
			charCode = ((mb[byteOffset] << (bitOffset - 2)) & 0x3f) | (mb[byteOffset + 1] >> (10 - bitOffset));
		}
		if (charCode < charset.length) {
			callsign += charset[charCode];
		} else {
			callsign += '#';
		}
	}

	return { callsign: callsign.trimEnd() };
}

// BDS 4,0 — Selected vertical intention
function decodeBDS40(mb: Uint8Array): Record<string, unknown> | null {
	// Status bits validate each field
	const mcp_fcu_status = (mb[0] >> 7) & 1;
	const mcp_fcu_alt = mcp_fcu_status
		? (((mb[0] & 0x7f) << 5) | (mb[1] >> 3)) * 16
		: null;

	const fms_status = (mb[1] >> 2) & 1;
	const fms_alt = fms_status
		? (((mb[1] & 0x03) << 10) | (mb[2] << 2) | (mb[3] >> 6)) * 16
		: null;

	const baro_status = (mb[3] >> 5) & 1;
	const baro_setting = baro_status
		? 800 + (((mb[3] & 0x1f) << 5) | (mb[4] >> 3)) * 0.1
		: null;

	return {
		mcpFcuAlt: mcp_fcu_alt,
		fmsAlt: fms_alt,
		baroSetting: baro_setting,
	};
}

// BDS 4,4 — Meteorological routine air report
function decodeBDS44(mb: Uint8Array): Record<string, unknown> | null {
	const windStatus = (mb[0] >> 7) & 1;
	let windSpeed: number | null = null;
	let windDirection: number | null = null;

	if (windStatus) {
		windSpeed = ((mb[0] & 0x7f) << 2) | (mb[1] >> 6);
		windDirection = ((mb[1] & 0x3f) << 3) | (mb[2] >> 5);
		windDirection = Math.round((windDirection / 512.0) * 360.0);
	}

	const tempStatus = (mb[2] >> 4) & 1;
	let temperature: number | null = null;
	if (tempStatus) {
		const tempRaw = ((mb[2] & 0x0f) << 6) | (mb[3] >> 2);
		// Temperature in 0.25°C steps, signed
		temperature = (tempRaw > 511 ? tempRaw - 1024 : tempRaw) * 0.25;
	}

	return { windSpeed, windDirection, temperature };
}

// BDS 5,0 — Track and turn report
function decodeBDS50(mb: Uint8Array): Record<string, unknown> | null {
	const rollStatus = (mb[0] >> 7) & 1;
	let rollAngle: number | null = null;
	if (rollStatus) {
		const rollRaw = ((mb[0] & 0x7f) << 1) | (mb[1] >> 7);
		rollAngle = (rollRaw > 127 ? rollRaw - 256 : rollRaw) * 45.0 / 128.0;
	}

	const trackStatus = (mb[1] >> 6) & 1;
	let track: number | null = null;
	if (trackStatus) {
		const trackRaw = ((mb[1] & 0x3f) << 4) | (mb[2] >> 4);
		track = (trackRaw * 90.0) / 512.0;
		if (track < 0) track += 360;
	}

	const gsStatus = (mb[2] >> 3) & 1;
	let groundSpeed: number | null = null;
	if (gsStatus) {
		groundSpeed = (((mb[2] & 0x07) << 9) | (mb[3] << 1) | (mb[4] >> 7)) * 2;
	}

	return { rollAngle, track, groundSpeed };
}

// BDS 6,0 — Heading and speed report
function decodeBDS60(mb: Uint8Array): Record<string, unknown> | null {
	const hdgStatus = (mb[0] >> 7) & 1;
	let heading: number | null = null;
	if (hdgStatus) {
		const hdgRaw = ((mb[0] & 0x7f) << 3) | (mb[1] >> 5);
		heading = (hdgRaw * 90.0) / 512.0;
		if (heading < 0) heading += 360;
	}

	const iasStatus = (mb[1] >> 4) & 1;
	let ias: number | null = null;
	if (iasStatus) {
		ias = ((mb[1] & 0x0f) << 6) | (mb[2] >> 2);
	}

	const tasStatus = (mb[2] >> 1) & 1;
	let tas: number | null = null;
	if (tasStatus) {
		tas = (((mb[2] & 0x01) << 9) | (mb[3] << 1) | (mb[4] >> 7)) * 2;
	}

	return { heading, ias, tas };
}

// Attempt to identify and decode a Comm-B MB field
// Returns decoded CommBData or null if unrecognised
export function decodeCommB(mb: Uint8Array): CommBData {
	// Try to identify the BDS register from the content
	// BDS 2,0: first byte should be 0x20 and content looks like callsign
	if (mb[0] === 0x20) {
		const decoded = decodeBDS20(mb);
		if (decoded) {
			return { bdsRegister: '20', raw: mb, decoded };
		}
	}

	// For BDS 4,0 / 4,4 / 5,0 / 6,0, there's no explicit register ID in the MB field —
	// they are identified heuristically or via BDS request.
	// Store raw for now; callers can attempt specific decodes.
	return { bdsRegister: 'unknown', raw: mb };
}

// Decode a specific BDS register from an MB field
export function decodeCommBRegister(
	mb: Uint8Array,
	bds: string
): CommBData {
	let decoded: Record<string, unknown> | null = null;

	switch (bds) {
		case '20': decoded = decodeBDS20(mb); break;
		case '40': decoded = decodeBDS40(mb); break;
		case '44': decoded = decodeBDS44(mb); break;
		case '50': decoded = decodeBDS50(mb); break;
		case '60': decoded = decodeBDS60(mb); break;
	}

	return {
		bdsRegister: bds,
		raw: mb,
		decoded: decoded ?? undefined,
	};
}
