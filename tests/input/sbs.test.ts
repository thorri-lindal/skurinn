import { describe, it, expect } from 'vitest';
import { parseSBSLine, parseSBSBuffer } from '../../src/lib/input/sbs.js';

const TS = 1700000000000;

describe('parseSBSLine', () => {
	it('returns null for non-MSG lines', () => {
		expect(parseSBSLine('STA,1,111,111,4840D6,1,,,,,,,,,,,,,,,,', TS)).toBeNull();
		expect(parseSBSLine('', TS)).toBeNull();
		expect(parseSBSLine('not,csv', TS)).toBeNull();
	});

	it('parses MSG type 1 (ident)', () => {
		const line = 'MSG,1,111,111,4840D6,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,KLM1023,,,,,,,,,,,';
		const msg = parseSBSLine(line, TS);
		expect(msg).not.toBeNull();
		expect(msg!.msgType).toBe(1);
		expect(msg!.icao).toBe('4840D6');
		expect(msg!.callsign).toBe('KLM1023');
	});

	it('parses MSG type 3 (airborne position)', () => {
		const line = 'MSG,3,111,111,40621D,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,,38000,,,52.3216,4.7891,,,,,,';
		const msg = parseSBSLine(line, TS);
		expect(msg).not.toBeNull();
		expect(msg!.msgType).toBe(3);
		expect(msg!.icao).toBe('40621D');
		expect(msg!.altitude).toBe(38000);
		expect(msg!.lat).toBeCloseTo(52.3216);
		expect(msg!.lon).toBeCloseTo(4.7891);
	});

	it('parses MSG type 4 (velocity)', () => {
		const line = 'MSG,4,111,111,485020,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,,,459,182.5,,,−1024,,,,,';
		const msg = parseSBSLine(line, TS);
		expect(msg).not.toBeNull();
		expect(msg!.msgType).toBe(4);
		expect(msg!.groundSpeed).toBe(459);
		expect(msg!.track).toBeCloseTo(182.5);
	});

	it('parses MSG type 6 (squawk)', () => {
		const line = 'MSG,6,111,111,4840D6,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,,,,,,,,-1,-1,,,';
		const msg = parseSBSLine(line, TS);
		expect(msg).not.toBeNull();
		expect(msg!.msgType).toBe(6);
	});

	it('normalises ICAO to uppercase', () => {
		const line = 'MSG,1,111,111,4840d6,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,KLM1023,,,,,,,,,,,';
		const msg = parseSBSLine(line, TS);
		expect(msg!.icao).toBe('4840D6');
	});

	it('sets timestampMs from parameter', () => {
		const line = 'MSG,1,111,111,4840D6,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,KLM1023,,,,,,,,,,,';
		const msg = parseSBSLine(line, 999999);
		expect(msg!.timestampMs).toBe(999999);
	});
});

describe('parseSBSBuffer', () => {
	it('parses multiple lines', () => {
		const buf = [
			'MSG,1,111,111,4840D6,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,KLM1023,,,,,,,,,,,',
			'MSG,3,111,111,40621D,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,,38000,,,52.32,4.79,,,,,,',
		].join('\n');
		const msgs = parseSBSBuffer(buf);
		expect(msgs).toHaveLength(2);
		expect(msgs[0].icao).toBe('4840D6');
		expect(msgs[1].icao).toBe('40621D');
	});

	it('skips blank lines and non-MSG records', () => {
		const buf = '\nSTA,1\nMSG,1,111,111,4840D6,1,2023/01/01,12:00:00.000,2023/01/01,12:00:00.000,KLM1023,,,,,,,,,,,\n\n';
		const msgs = parseSBSBuffer(buf);
		expect(msgs).toHaveLength(1);
	});
});
