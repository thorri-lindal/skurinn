// Public API for the Mode S / ADS-B parser

export { decodeMessage } from './mode-s.js';
export { crc24, checkCRC, verifyCRCWithICAO } from './crc.js';
export { decodeAC12Field, decodeAC13Field } from './altitude.js';
export { decodeID13Field } from './squawk.js';
export { decodeADSB, extractBits } from './adsb.js';
export { cprGlobalDecode, cprLocalDecode, nlFunc } from './cpr.js';
export { decodeCommB, decodeCommBRegister } from './comm-b.js';
export * from './types.js';

// Convenience: parse a hex string to a ModeSMessage
import { decodeMessage } from './mode-s.js';
import type { ModeSMessage } from './types.js';

export function parseHex(hex: string): ModeSMessage {
	const clean = hex.replace(/\s+/g, '').toUpperCase();
	if (!/^[0-9A-F]+$/.test(clean)) {
		throw new Error(`Invalid hex string: ${hex}`);
	}
	if (clean.length % 2 !== 0) {
		throw new Error(`Hex string must have even length: ${hex}`);
	}
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return decodeMessage(bytes);
}
