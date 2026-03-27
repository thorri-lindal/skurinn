import { describe, it, expect } from 'vitest';
import { decodeID13Field } from '../../src/lib/parser/squawk.js';

describe('decodeID13Field', () => {
	it('decodes all-zeros to 0000', () => {
		expect(decodeID13Field(0)).toBe('0000');
	});

	it('decodes emergency code 7700', () => {
		// Squawk 7700: A=7, B=7, C=0, D=0
		// A=7 = A4+A2+A1 all set, B=7 = B4+B2+B1 all set, C=0, D=0
		// Reconstruct the 13-bit field from the bit pattern
		// Bits: C1 A1 C2 A2 C4 A4 0 B1 D1 B2 D2 B4 D4
		// A=7: a4=1, a2=1, a1=1
		// B=7: b4=1, b2=1, b1=1
		// C=0: c4=0, c2=0, c1=0
		// D=0: d4=0, d2=0, d1=0
		const c1 = 0, a1 = 1, c2 = 0, a2 = 1, c4 = 0, a4 = 1;
		const b1 = 1, d1 = 0, b2 = 1, d2 = 0, b4 = 1, d4 = 0;
		const id13 =
			(c1 << 12) | (a1 << 11) | (c2 << 10) | (a2 << 9) |
			(c4 << 8) | (a4 << 7) | (b1 << 5) | (d1 << 4) |
			(b2 << 3) | (d2 << 2) | (b4 << 1) | d4;
		expect(decodeID13Field(id13)).toBe('7700');
	});

	it('decodes emergency code 7500', () => {
		// Squawk 7500: A=7, B=5, C=0, D=0
		// A=7: a4=1, a2=1, a1=1
		// B=5: b4=1, b2=0, b1=1
		const c1 = 0, a1 = 1, c2 = 0, a2 = 1, c4 = 0, a4 = 1;
		const b1 = 1, d1 = 0, b2 = 0, d2 = 0, b4 = 1, d4 = 0;
		const id13 =
			(c1 << 12) | (a1 << 11) | (c2 << 10) | (a2 << 9) |
			(c4 << 8) | (a4 << 7) | (b1 << 5) | (d1 << 4) |
			(b2 << 3) | (d2 << 2) | (b4 << 1) | d4;
		expect(decodeID13Field(id13)).toBe('7500');
	});

	it('decodes 1234', () => {
		// 1=A1, 2=A2 set... wait: each digit is 3 bits in A/B/C/D groups
		// Squawk 1234 means A=1, B=2, C=3, D=4
		// A=1: a4=0, a2=0, a1=1
		// B=2: b4=0, b2=1, b1=0
		// C=3: c4=0, c2=1, c1=1
		// D=4: d4=1, d2=0, d1=0
		const c1 = 1, a1 = 1, c2 = 1, a2 = 0, c4 = 0, a4 = 0;
		const b1 = 0, d1 = 0, b2 = 1, d2 = 0, b4 = 0, d4 = 1;
		const id13 =
			(c1 << 12) | (a1 << 11) | (c2 << 10) | (a2 << 9) |
			(c4 << 8) | (a4 << 7) | (b1 << 5) | (d1 << 4) |
			(b2 << 3) | (d2 << 2) | (b4 << 1) | d4;
		expect(decodeID13Field(id13)).toBe('1234');
	});

	it('decodes max code 7777', () => {
		// All bits set (except the reserved bit 6)
		// A=7, B=7, C=7, D=7: all x4/x2/x1 = 1
		const id13 = 0b1_1_1_1_1_1_0_1_1_1_1_1_1; // all bits except bit 6
		// bit 13: c1=1, a1=1, c2=1, a2=1, c4=1, a4=1, 0, b1=1, d1=1, b2=1, d2=1, b4=1, d4=1
		const c1=1,a1=1,c2=1,a2=1,c4=1,a4=1,b1=1,d1=1,b2=1,d2=1,b4=1,d4=1;
		const field =
			(c1 << 12) | (a1 << 11) | (c2 << 10) | (a2 << 9) |
			(c4 << 8) | (a4 << 7) | (b1 << 5) | (d1 << 4) |
			(b2 << 3) | (d2 << 2) | (b4 << 1) | d4;
		expect(decodeID13Field(field)).toBe('7777');
	});
});
