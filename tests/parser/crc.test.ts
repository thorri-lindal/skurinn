import { describe, it, expect } from 'vitest';
import { crc24, checkCRC } from '../../src/lib/parser/crc.js';

function hex(s: string): Uint8Array {
	const clean = s.replace(/\s/g, '');
	const b = new Uint8Array(clean.length / 2);
	for (let i = 0; i < b.length; i++) {
		b[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return b;
}

describe('CRC-24', () => {
	it('computes zero syndrome for valid DF17 ident message', () => {
		const msg = hex('8D4840D6202CC371C32CE0576098');
		expect(checkCRC(msg)).toBe(0);
	});

	it('computes zero syndrome for DF17 airborne position', () => {
		const msg = hex('8D40621D58C382D690C8AC2863A7');
		expect(checkCRC(msg)).toBe(0);
	});

	it('computes zero syndrome for DF17 airborne velocity', () => {
		const msg = hex('8D485020994409940838175B284F');
		expect(checkCRC(msg)).toBe(0);
	});

	it('detects CRC errors — flipping a bit produces non-zero syndrome', () => {
		const msg = hex('8D4840D6202CC371C32CE0576098');
		const corrupt = new Uint8Array(msg);
		corrupt[5] ^= 0x01;
		expect(checkCRC(corrupt)).not.toBe(0);
	});

	it('detects CRC errors in multiple messages', () => {
		const msg = hex('8D40621D58C382D690C8AC2863A7');
		const corrupt = new Uint8Array(msg);
		corrupt[4] ^= 0x80;
		expect(checkCRC(corrupt)).not.toBe(0);
	});

	it('for valid DF17, CRC(first 11 bytes) equals stored PI field', () => {
		// For DF17: PI = CRC(data), no ICAO XOR. So checkCRC = CRC(data) XOR PI = 0.
		const msg = hex('8D4840D6202CC371C32CE0576098');
		const computed = crc24(msg, 11);
		const stored = (msg[11] << 16) | (msg[12] << 8) | msg[13];
		// The PI is just CRC(data) with no XOR for DF17
		expect(computed).toBe(stored);
	});

	it('crc24 produces a 24-bit result', () => {
		const msg = hex('8D4840D6202CC371C32CE0576098');
		const crc = crc24(msg, msg.length);
		expect(crc).toBeGreaterThanOrEqual(0);
		expect(crc).toBeLessThanOrEqual(0xffffff);
	});

	it('CRC differs for different messages', () => {
		const msg1 = hex('8D4840D6202CC371C32CE0576098');
		const msg2 = hex('8D40621D58C382D690C8AC2863A7');
		const crc1 = crc24(msg1, 11);
		const crc2 = crc24(msg2, 11);
		expect(crc1).not.toBe(crc2);
	});
});
