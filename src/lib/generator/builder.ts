// Synthetic Mode S frame builder
// Pure functions: inputs → Uint8Array → hex string
// All frames are DF17 (ADS-B Extended Squitter) for simplicity.

import { crc24 } from '../parser/crc.js';
import { AIS_CHARSET } from '../parser/types.js';

// Encode a 6-bit AIS callsign (8 chars, space-padded) into 48 bits = 6 bytes
function encodeCallsign(callsign: string): Uint8Array {
	const padded = callsign.toUpperCase().padEnd(8, ' ').slice(0, 8);
	const out = new Uint8Array(6);
	for (let i = 0; i < 8; i++) {
		const ch = padded[i];
		const idx = AIS_CHARSET.indexOf(ch);
		const code = idx < 0 ? 32 : idx; // space for unknown
		// Pack 6 bits at bit offset i*6 within the 48-bit output
		const bitOffset = i * 6;
		const byteIdx = Math.floor(bitOffset / 8);
		const bitShift = 10 - (bitOffset % 8); // 8+2 for align
		if (bitShift >= 0) {
			out[byteIdx] |= code >> (bitShift - 8 > 0 ? bitShift - 8 : 0);
			if (bitShift > 8) out[byteIdx] |= code << (bitShift - 8);
			if (byteIdx + 1 < 6) out[byteIdx + 1] |= code << (bitShift - 2);
		}
	}

	// Use a simpler direct bit-packing approach
	const out2 = new Uint8Array(6);
	let bits = 0n;
	for (let i = 0; i < 8; i++) {
		const ch = padded[i];
		const idx = AIS_CHARSET.indexOf(ch);
		const code = BigInt(idx < 0 ? 32 : idx);
		bits = (bits << 6n) | code;
	}
	// bits is now 48 bits wide
	for (let i = 0; i < 6; i++) {
		out2[i] = Number((bits >> BigInt((5 - i) * 8)) & 0xffn);
	}
	return out2;
}

// Encode a 12-bit altitude (Q=1 encoding, 25ft steps) into 12 bits
// Returns the AC12 field value
function encodeAltitudeAC12(altFt: number): number {
	// Clamp to valid range
	const clamped = Math.max(-1000, Math.min(50175, altFt));
	const n = Math.round((clamped + 1000) / 25);
	// Pack n into 11 bits with Q=1 at bit 4
	// n = ((ac12 & 0x0FE0) >> 1) | (ac12 & 0x000F)
	// Invert: ac12 bits 11-5 = n bits 10-4; bit 4 = Q=1; bits 3-0 = n bits 3-0
	const nHigh = (n >> 4) & 0x7f;
	const nLow = n & 0x0f;
	return (nHigh << 5) | 0x10 | nLow;
}

// Encode CPR latitude for a given frame format (even=false, odd=true)
function encodeCPRLat(lat: number, odd: boolean): number {
	const nz = 15;
	const dLat = odd ? 360.0 / (4 * nz - 1) : 360.0 / (4 * nz);
	const yz = Math.floor(lat / dLat) * dLat;
	return Math.floor(((lat - yz) / dLat) * 131072) & 0x1ffff;
}

// Encode CPR longitude for a given lat/lon and frame format
function encodeCPRLon(lat: number, lon: number, odd: boolean): number {
	const nz = 15;
	const dLat = odd ? 360.0 / (4 * nz - 1) : 360.0 / (4 * nz);
	const latZone = Math.floor(lat / dLat) * dLat;
	const latDecode = latZone + (encodeCPRLat(lat, odd) / 131072) * dLat;

	// Compute NL for decoded latitude
	const absLat = Math.abs(latDecode);
	let nl = 59;
	if (absLat > 0) {
		const tmp = 1 - (1 - Math.cos(Math.PI / 30)) / Math.cos((Math.PI / 180) * absLat) ** 2;
		if (tmp > 0 && tmp < 2) nl = Math.floor((2 * Math.PI) / Math.acos(tmp));
		else if (tmp >= 2) nl = 59;
		else nl = 1;
	}
	const ni = Math.max(odd ? nl - 1 : nl, 1);
	const dLon = 360.0 / ni;
	const xz = Math.floor(lon / dLon) * dLon;
	return Math.floor(((lon - xz) / dLon) * 131072) & 0x1ffff;
}

function icaoBytes(icao: string): [number, number, number] {
	const n = parseInt(icao.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).padStart(6, '0'), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function appendCRC(frame: Uint8Array): Uint8Array {
	// For DF17: PI = CRC(first 11 bytes)
	const crc = crc24(frame, 11);
	const out = new Uint8Array(14);
	out.set(frame.slice(0, 11));
	out[11] = (crc >> 16) & 0xff;
	out[12] = (crc >> 8) & 0xff;
	out[13] = crc & 0xff;
	return out;
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0').toUpperCase())
		.join('');
}

// ── Public builders ────────────────────────────────────────────────────────

export interface IdentParams {
	icao: string;          // 6 hex chars
	callsign: string;      // up to 8 chars
	category: number;      // 1-4 (TC) — 4=A, 3=B, 2=C, 1=D
	emitterCategory: number; // 0-7 (EC / subtype)
}

/** Build a DF17 aircraft identification frame */
export function buildIdent(p: IdentParams): string {
	const frame = new Uint8Array(14);
	frame[0] = (17 << 3) | 5; // DF=17, CA=5
	const [i1, i2, i3] = icaoBytes(p.icao);
	frame[1] = i1; frame[2] = i2; frame[3] = i3;

	// ME byte 0: TC (bits 7-3) + EC (bits 2-0)
	const tc = Math.max(1, Math.min(4, p.category));
	frame[4] = (tc << 3) | (p.emitterCategory & 0x07);

	// Callsign packed into ME bytes 1-6
	const cs = encodeCallsign(p.callsign);
	frame[5] = cs[0]; frame[6] = cs[1]; frame[7] = cs[2];
	frame[8] = cs[3]; frame[9] = cs[4]; frame[10] = cs[5];

	return toHex(appendCRC(frame));
}

export interface PositionParams {
	icao: string;
	lat: number;
	lon: number;
	altFt: number;
	odd: boolean; // false=even frame, true=odd frame
}

/** Build a DF17 airborne position frame (TC=11, baro altitude) */
export function buildPosition(p: PositionParams): string {
	const frame = new Uint8Array(14);
	frame[0] = (17 << 3) | 5;
	const [i1, i2, i3] = icaoBytes(p.icao);
	frame[1] = i1; frame[2] = i2; frame[3] = i3;

	// ME[0]: TC=11 (0b01011), SS=0, NIC_b=0
	frame[4] = (11 << 3);

	// AC12 altitude
	const ac12 = encodeAltitudeAC12(p.altFt);
	frame[5] = (ac12 >> 4) & 0xff;

	// T=0, F=odd, lat(17bit), lon(17bit)
	const latCpr = encodeCPRLat(p.lat, p.odd);
	const lonCpr = encodeCPRLon(p.lat, p.lon, p.odd);
	const f = p.odd ? 1 : 0;

	// Pack: [ac12 low 4 bits][T=0][F][lat 17 bits][lon 17 bits]
	// = 4 + 1 + 1 + 17 + 17 = 40 bits = 5 bytes (ME bytes 1-5)
	let bits = BigInt(ac12 & 0x0f);
	bits = (bits << 1n) | 0n; // T=0
	bits = (bits << 1n) | BigInt(f);
	bits = (bits << 17n) | BigInt(latCpr);
	bits = (bits << 17n) | BigInt(lonCpr);
	// bits is now 40 bits
	for (let i = 0; i < 5; i++) {
		frame[6 + i] = Number((bits >> BigInt((4 - i) * 8)) & 0xffn);
	}

	return toHex(appendCRC(frame));
}

export interface VelocityParams {
	icao: string;
	groundSpeedKt: number;
	trackDeg: number;      // 0-360 true
	verticalRateFpm: number;
}

/** Build a DF17 airborne velocity frame (TC=19, ST=1 ground speed) */
export function buildVelocity(p: VelocityParams): string {
	const frame = new Uint8Array(14);
	frame[0] = (17 << 3) | 5;
	const [i1, i2, i3] = icaoBytes(p.icao);
	frame[1] = i1; frame[2] = i2; frame[3] = i3;

	// ME[0]: TC=19, ST=1
	frame[4] = (19 << 3) | 1;

	// Decompose ground speed into E/W and N/S components
	const trackRad = (p.trackDeg * Math.PI) / 180;
	const ve = p.groundSpeedKt * Math.sin(trackRad);
	const vn = p.groundSpeedKt * Math.cos(trackRad);

	const dirEW = ve < 0 ? 1 : 0;
	const vEW = Math.min(1023, Math.round(Math.abs(ve)) + 1);
	const dirNS = vn < 0 ? 1 : 0;
	const vNS = Math.min(1023, Math.round(Math.abs(vn)) + 1);

	const vrSign = p.verticalRateFpm < 0 ? 1 : 0;
	const vrValue = Math.min(511, Math.round(Math.abs(p.verticalRateFpm) / 64) + 1);

	// Pack ME bits 8-55:
	// IC(1) IFR(1) NACv(3) DirEW(1) VEW(10) DirNS(1) VNS(10) VRSrc(1) VRSign(1) VR(9) res(2) DAlt(1) AltDiff(7)
	let bits = 0n;
	bits = (bits << 1n) | 0n;        // IC
	bits = (bits << 1n) | 1n;        // IFR
	bits = (bits << 3n) | 3n;        // NACv=3
	bits = (bits << 1n) | BigInt(dirEW);
	bits = (bits << 10n) | BigInt(vEW);
	bits = (bits << 1n) | BigInt(dirNS);
	bits = (bits << 10n) | BigInt(vNS);
	bits = (bits << 1n) | 1n;        // VRate source = baro
	bits = (bits << 1n) | BigInt(vrSign);
	bits = (bits << 9n) | BigInt(vrValue);
	bits = (bits << 2n) | 0n;        // reserved
	bits = (bits << 1n) | 0n;        // dAlt sign
	bits = (bits << 7n) | 0n;        // dAlt value

	// 48 bits → ME bytes 1-6
	for (let i = 0; i < 6; i++) {
		frame[5 + i] = Number((bits >> BigInt((5 - i) * 8)) & 0xffn);
	}

	return toHex(appendCRC(frame));
}
