// Mode S altitude decoding
// Handles Q-bit encoding (25ft/100ft increments) and Gillham Gray code

import { decodeID13Field } from './squawk.js';
import { AltitudeUnit } from './types.js';

// Convert a Gray-coded integer of `bits` length to binary
function grayToBinary(gray: number, bits: number): number {
	let bin = 0;
	for (let i = bits - 1; i >= 0; i--) {
		const gBit = (gray >> i) & 1;
		if (i === bits - 1) {
			bin = gBit;
		} else {
			bin = ((bin & 1) ^ gBit) | (bin << 1 & ~1);
		}
	}
	// Simpler iterative approach
	bin = 0;
	let mask = gray;
	while (mask) {
		bin ^= mask;
		mask >>= 1;
	}
	return bin;
}

// Convert Mode A squawk code (4 decimal digits representing octal) to Mode C altitude
// Returns altitude in 100ft units, or -9999 if invalid
function modeAToModeC(modeA: string): number {
	// Parse the 4 octal digits
	const a = parseInt(modeA[0], 10);
	const b = parseInt(modeA[1], 10);
	const c = parseInt(modeA[2], 10);
	const d = parseInt(modeA[3], 10);

	// Each digit must be 0-7 (valid octal)
	if (a > 7 || b > 7 || c > 7 || d > 7) return -9999;

	// Reconstruct the individual bits
	const a1 = a & 1;
	const a2 = (a >> 1) & 1;
	const a4 = (a >> 2) & 1;
	const b1 = b & 1;
	const b2 = (b >> 1) & 1;
	const b4 = (b >> 2) & 1;
	const c1 = c & 1;
	const c2 = (c >> 1) & 1;
	const c4 = (c >> 2) & 1;
	const d1 = d & 1;
	const d2 = (d >> 1) & 1;
	const d4 = (d >> 2) & 1;

	// C bits form the 500ft Gray code
	// Gray: C1 C2 C4 → decoded to n500
	let n500 = grayToBinary((c1 << 2) | (c2 << 1) | c4, 3);

	// A/B/D bits form the 100ft subdivision Gray code
	// The 100ft Gray code uses D1 A1 B1 D2 A2 B2 D4 A4 B4 ... (interleaved)
	// For Mode C, D1 is always 0
	// The sequence for the 100ft Gray code (from MSB): D1 A1 B1 D2 A2 B2 D4 A4 B4
	let n100gray = (d1 << 8) | (a1 << 7) | (b1 << 6) | (d2 << 5) | (a2 << 4) | (b2 << 3) | (d4 << 2) | (a4 << 1) | b4;
	let n100 = grayToBinary(n100gray, 9);

	// n100 maps to a 100ft offset within the 500ft block
	// Valid n100 values after Gray decode: 1, 2, 3, 4, 5 (cycling 1..5)
	// The n100 mod 5 gives the offset (0-indexed, then add 1)
	// But we need the value to be 1-5 in the correct cycle
	n100 = n100 % 5;
	if (n100 === 0) n100 = 5; // shouldn't happen for valid codes but be safe

	// Check for invalid C codes (Mode C doesn't use C=7)
	if (c4 && c2 && !c1) return -9999; // C=6+... (11x Gray patterns that are invalid)

	// The Gray code 3-bit for C (n500):
	// Gray 000=0 → bin 0 (invalid for Mode C)
	// Gray 001=1 → bin 1
	// Gray 010=3 → bin 2 (Gray decode: 011→2, wait need to recalc)
	// Let me redo: grayToBinary properly:
	// Gray 000 → 0, 001 → 1, 011 → 2, 010 → 3, 110 → 4, 111 → 5, 101 → 6, 100 → 7
	// For Mode C, C=0 (Gray 000) is invalid.

	// Altitude = (n500 * 500 + n100 * 100) - 1300
	// But there's a parity consideration: if n500 is odd, the 100ft sequence runs in reverse
	if (n500 % 2 === 1) {
		n100 = 6 - n100;
	}

	return n500 * 5 + n100 - 13;  // in 100ft units; multiply by 100 for feet
}

// Decode 13-bit AC field (used in DF4, DF5, DF20, DF21)
// Returns { altitude: feet, unit } or null if invalid
export function decodeAC13Field(ac13: number): { altitude: number; unit: AltitudeUnit } | null {
	const m = (ac13 >> 6) & 1;  // metric bit
	const q = (ac13 >> 4) & 1;  // Q bit

	if (m) {
		// Metric altitude — not commonly used; skip for now
		return null;
	}

	if (q) {
		// Q=1: 11-bit integer × 25ft - 1300ft
		// Remove M bit (bit 6) and Q bit (bit 4) to get 11-bit value
		const n =
			((ac13 & 0x1f80) >> 2) | // bits 12-7 shifted right 2 (removing M at bit 6)
			((ac13 & 0x0020) >> 1) | // bit 5 shifted right 1
			(ac13 & 0x000f);          // bits 3-0

		return { altitude: n * 25 - 1300, unit: AltitudeUnit.Feet };
	} else {
		// Gillham (Gray code)
		// Reuse the identity decoder — same bit interleaving
		const modeA = decodeID13Field(ac13);
		const n100 = modeAToModeC(modeA);
		if (n100 === -9999) return null;
		return { altitude: n100 * 100, unit: AltitudeUnit.Feet };
	}
}

// Decode 12-bit AC field (used in DF0, DF16)
// Returns { altitude: feet, unit } or null if invalid
export function decodeAC12Field(ac12: number): { altitude: number; unit: AltitudeUnit } | null {
	const q = (ac12 >> 4) & 1;  // Q bit

	if (q) {
		// Q=1: 11-bit integer × 25ft - 1000ft
		const n = ((ac12 & 0x0fe0) >> 1) | (ac12 & 0x000f);
		return { altitude: n * 25 - 1000, unit: AltitudeUnit.Feet };
	} else {
		// Gillham — insert M=0 at bit 6 to form a 13-bit ID field
		// AC12 bits: C1 A1 C2 A2 C4 A4 B1 Q B2 D2 B4 D4  (12 bits, no M, no D1)
		// Insert M=0 at position 6 of the 13-bit field
		const ac13 = ((ac12 & 0x0fc0) << 1) | (ac12 & 0x003f);
		const modeA = decodeID13Field(ac13);
		const n100 = modeAToModeC(modeA);
		if (n100 === -9999) return null;
		return { altitude: n100 * 100, unit: AltitudeUnit.Feet };
	}
}
