// Compact Position Reporting (CPR) decoder
// Two frames (odd + even) needed for global decode.
// NL table encodes latitude zone boundaries.

import { CPRFormat, type DecodedPosition } from './types.js';

// NL (Number of Longitude zones) lookup table for airborne CPR
// Index 0 = 87.000°, entry n covers [lat_n, lat_{n+1})
// 59 entries covering 0° to 87°, symmetric for southern hemisphere.
// Generated from the standard NL formula: NL = floor(2π / acos(1 - (1-cos(π/2/NZ)) / cos²(π·lat/180)²))
const NL_TABLE: readonly number[] = [
	59, 59, 59, 59, 59, 59, 59, 59, 59, 59, // 0-9   (0°-8.xxx°)
	59, 58, 58, 58, 58, 58, 57, 57, 57, 56, // 10-19
	56, 56, 55, 55, 54, 54, 53, 53, 52, 52, // 20-29
	51, 50, 50, 49, 48, 48, 47, 46, 45, 45, // 30-39
	44, 43, 42, 41, 41, 40, 39, 38, 37, 36, // 40-49
	35, 34, 33, 32, 31, 30, 29, 27, 26, 24, // 50-59
	23, 21, 18, 14, 10, 6,  4,  3,  2,  1,  // 60-69
	1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  // 70-79
	1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  // 80-89
	1,                                        // 90
];

// Number of longitude zones for a given latitude
export function nlFunc(lat: number): number {
	const absLat = Math.abs(lat);
	if (absLat >= 87.0) return 1;
	if (absLat < 0) return 1; // should not happen after abs

	// Use the formula directly for precision matching the spec
	if (absLat === 0) return 59;

	const NZ = 15; // number of latitude zones (each zone = 360/4/NZ degrees)
	const tmp = 1 - (1 - Math.cos(Math.PI / (2 * NZ))) / (Math.cos((Math.PI / 180) * absLat) ** 2);
	if (tmp <= 0) return 1;
	if (tmp >= 2) return 59;
	return Math.floor((2 * Math.PI) / Math.acos(tmp));
}

// Modulo that always returns positive result
function cprMod(a: number, b: number): number {
	return ((a % b) + b) % b;
}

// Global CPR decode using an even and odd frame.
// Returns decoded position or null if frames are incompatible.
export function cprGlobalDecode(
	evenLat: number,
	evenLon: number,
	oddLat: number,
	oddLon: number,
	recentFrame: CPRFormat // which frame is more recent
): DecodedPosition | null {
	const dLatEven = 360.0 / 60;
	const dLatOdd = 360.0 / 59;

	// Decode latitude index
	const j = Math.floor(
		(59 * evenLat - 60 * oddLat) / (1 << 17) + 0.5
	);

	let latEven = dLatEven * (cprMod(j, 60) + evenLat / (1 << 17));
	let latOdd = dLatOdd * (cprMod(j, 59) + oddLat / (1 << 17));

	// Normalise to (-90, 90]
	if (latEven >= 270) latEven -= 360;
	if (latOdd >= 270) latOdd -= 360;

	// Check NL consistency
	if (nlFunc(latEven) !== nlFunc(latOdd)) return null;

	const lat = recentFrame === CPRFormat.Even ? latEven : latOdd;
	const nl = nlFunc(lat);

	// Decode longitude
	const ni = recentFrame === CPRFormat.Even ? Math.max(nl, 1) : Math.max(nl - 1, 1);
	const dLon = 360.0 / ni;

	const recentLon = recentFrame === CPRFormat.Even ? evenLon : oddLon;
	const m = Math.floor(
		(evenLon * (nl - 1) - oddLon * nl) / (1 << 17) + 0.5
	);

	let lon = dLon * (cprMod(m, ni) + recentLon / (1 << 17));
	if (lon >= 180) lon -= 360;

	return { lat, lon };
}

// Local CPR decode using a single frame and a reference position (within ~180nm)
export function cprLocalDecode(
	latCpr: number,
	lonCpr: number,
	format: CPRFormat,
	refLat: number,
	refLon: number
): DecodedPosition | null {
	const dLat = format === CPRFormat.Even ? 360.0 / 60 : 360.0 / 59;

	const j = Math.floor(refLat / dLat) + Math.floor(
		0.5 + cprMod(refLat, dLat) / dLat - latCpr / (1 << 17)
	);

	let lat = dLat * (j + latCpr / (1 << 17));
	if (lat >= 270) lat -= 360;

	const nl = nlFunc(lat);
	const ni = Math.max(format === CPRFormat.Even ? nl : nl - 1, 1);
	const dLon = 360.0 / ni;

	const m = Math.floor(refLon / dLon) + Math.floor(
		0.5 + cprMod(refLon, dLon) / dLon - lonCpr / (1 << 17)
	);

	let lon = dLon * (m + lonCpr / (1 << 17));
	if (lon >= 180) lon -= 360;

	return { lat, lon };
}

// Surface CPR uses different zone sizes (1/4 of airborne)
export function cprSurfaceGlobalDecode(
	evenLat: number,
	evenLon: number,
	oddLat: number,
	oddLon: number,
	recentFrame: CPRFormat,
	refLat: number
): DecodedPosition | null {
	const dLatEven = 90.0 / 60;
	const dLatOdd = 90.0 / 59;

	const j = Math.floor(
		(59 * evenLat - 60 * oddLat) / (1 << 17) + 0.5
	);

	let latEven = dLatEven * (cprMod(j, 60) + evenLat / (1 << 17));
	let latOdd = dLatOdd * (cprMod(j, 59) + oddLat / (1 << 17));

	// Apply southern hemisphere correction based on reference
	if (refLat < 0) {
		latEven -= 90;
		latOdd -= 90;
	}

	if (nlFunc(latEven) !== nlFunc(latOdd)) return null;

	const lat = recentFrame === CPRFormat.Even ? latEven : latOdd;
	const nl = nlFunc(lat);
	const ni = recentFrame === CPRFormat.Even ? Math.max(nl, 1) : Math.max(nl - 1, 1);
	const dLon = 90.0 / ni;

	const recentLon = recentFrame === CPRFormat.Even ? evenLon : oddLon;
	const m = Math.floor(
		(evenLon * (nl - 1) - oddLon * nl) / (1 << 17) + 0.5
	);

	let lon = dLon * (cprMod(m, ni) + recentLon / (1 << 17));

	// Quadrant correction based on reference longitude
	if (refLon - lon > 45) lon += 90;
	else if (lon - refLon > 45) lon -= 90;

	return { lat, lon };
}
