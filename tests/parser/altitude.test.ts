import { describe, it, expect } from 'vitest';
import { decodeAC12Field, decodeAC13Field } from '../../src/lib/parser/altitude.js';
import { AltitudeUnit } from '../../src/lib/parser/types.js';

describe('decodeAC12Field', () => {
	it('decodes 38000ft from reference message 2', () => {
		// From 8D40621D58C382D690C8AC2863A7
		// ME = 58 C3 82 D6 90 C8 AC
		// ME[0]=0x58 (TC=11), ME[1]=0xC3, ME[2]=0x82
		// AC12 = (ME[1] << 4) | (ME[2] >> 4) = 0xC38
		const ac12 = 0xc38;
		const result = decodeAC12Field(ac12);
		expect(result).not.toBeNull();
		expect(result!.altitude).toBe(38000);
		expect(result!.unit).toBe(AltitudeUnit.Feet);
	});

	it('decodes Q=1 altitude: n=0 gives -1000ft', () => {
		// Q bit set (bit 4 = 1), n=0: altitude = 0 * 25 - 1000 = -1000
		// AC12 with Q=1, all other bits 0: 0x010
		const ac12 = 0x010; // bit 4 set = Q, rest = 0 → n=0 → -1000ft
		const result = decodeAC12Field(ac12);
		expect(result).not.toBeNull();
		expect(result!.altitude).toBe(-1000);
	});

	it('decodes Q=1 altitude: n=1 gives -975ft', () => {
		// n=1 → 1*25-1000 = -975
		// Q=1 (bit 4), remaining bits encode n=1
		// n = ((ac12 & 0x0FE0) >> 1) | (ac12 & 0x000F)
		// For n=1: 0x0001 in the 11-bit field after removing Q
		// n uses bits 11-5 and 3-0 (skipping bit 4)
		// n=1 means bits 3-0 = 0001, bits 11-5 = 0 → AC12 = 0x0010 | 0x0001 = 0x011
		const ac12 = 0x011;
		const result = decodeAC12Field(ac12);
		expect(result).not.toBeNull();
		expect(result!.altitude).toBe(-975);
	});

	it('decodes known altitude 10000ft', () => {
		// 10000ft = (n * 25) - 1000 → n = 11000/25 = 440
		// n=440 = 0b110111000
		// n < 2048 so no issue
		// AC12 bits: bits 11-5 = n[10:4], bit 4 = Q=1, bits 3-0 = n[3:0]
		// n = 440 = 0b0001_1011_1000
		// n[10:4] = 0b0001_101 = 0x0D (7 bits, but shifted)
		// AC12 = (n >> 4) << 5 | 0x10 | (n & 0x0F)
		// Wait: n bits layout in AC12:
		// n = ((ac12 & 0x0FE0) >> 1) | (ac12 & 0x000F)
		// ac12 bits 11-5 contribute: (ac12 & 0x0FE0) >> 1 gives n bits 10-4
		// ac12 bits 3-0 give n bits 3-0
		// n=440=0b110111000
		// n bits 10-4 = 0b0110111 = 55 → ac12 bits 11-5 = 55 << 1 = 110 → (110) << 5...
		// Let me compute: ac12 & 0x0FE0 = n_high << 1, so ac12 |= (n >> 4) << 5 (approx)
		// Easier: n_high = n >> 4 = 27 (bits 10-4 of n) → ac12[11:5] = 27 → ac12 high part = 27 << 5 = 0x360
		// n_low = n & 0x0F = 8 → ac12[3:0] = 8 → ac12 low = 8
		// ac12 = 0x360 | Q(0x010) | 8 = 0x378
		const n = (10000 + 1000) / 25; // = 440
		const nHigh = (n >> 4) & 0x7f;
		const nLow = n & 0x0f;
		const ac12 = (nHigh << 5) | 0x10 | nLow;
		const result = decodeAC12Field(ac12);
		expect(result).not.toBeNull();
		expect(result!.altitude).toBe(10000);
	});
});

describe('decodeAC13Field', () => {
	it('decodes Q=1 altitude: 10000ft', () => {
		// Q=1 (bit 4), M=0 (bit 6)
		// altitude = n * 25 - 1300 → n = (10000 + 1300) / 25 = 452
		// n bits: remove M(bit6) and Q(bit4) from 13-bit field
		// n = ((ac13 & 0x1F80) >> 2) | ((ac13 & 0x0020) >> 1) | (ac13 & 0x000F)
		const n = (10000 + 1300) / 25;
		// Reconstruct ac13 from n (inverse of the extraction)
		// n has 11 bits: n[10:6] → ac13[12:7] (bits above M), n[5] → ac13[5], n[4:0] → ac13[3:0]
		// ac13[12:7] = n[10:6] << 7 → (n >> 6) << 7... let me trace the extraction:
		// n = ((ac13 & 0x1F80) >> 2) | ((ac13 & 0x0020) >> 1) | (ac13 & 0x000F)
		// ac13 & 0x1F80 (bits 12-7) >> 2 → n bits [10:5] (6 bits)
		// ac13 & 0x0020 (bit 5) >> 1 → n bit [4]
		// ac13 & 0x000F (bits 3-0) → n bits [3:0]
		// So: n[10:5] = (ac13 & 0x1F80) >> 2, meaning ac13 bits 12-7 = (n >> 4)...
		// Let me just solve directly:
		// n bits 10-5 → ac13 bits 12-7: ac13 |= (n >> 5) << 7 = (n >> 5) * 128...
		// Hmm: ac13[12:7] = n[10:5] → shift: n >> 5 gives n[10:5], then << 7
		const nBits10to5 = (n >> 5) & 0x3f;
		const nBit4 = (n >> 4) & 1;
		const nBits3to0 = n & 0x0f;
		// ac13[12:7] = nBits10to5, ac13[6]=0(M=0), ac13[5]=nBit4, ac13[4]=1(Q=1), ac13[3:0]=nBits3to0
		const ac13 = (nBits10to5 << 7) | (nBit4 << 5) | (1 << 4) | nBits3to0;
		const result = decodeAC13Field(ac13);
		expect(result).not.toBeNull();
		expect(result!.altitude).toBe(10000);
		expect(result!.unit).toBe(AltitudeUnit.Feet);
	});

	it('returns null for metric altitude (M=1)', () => {
		const ac13 = 0x40; // M bit set (bit 6)
		expect(decodeAC13Field(ac13)).toBeNull();
	});
});
