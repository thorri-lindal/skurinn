import { describe, it, expect } from 'vitest';
import { updateTracker, pruneStale, getAircraftList } from '../../src/lib/tracker/tracker.js';
import { parseHex } from '../../src/lib/parser/index.js';
import { STALE_AGE_MS } from '../../src/lib/tracker/types.js';

function makeMap() {
	return new Map<string, import('../../src/lib/tracker/types.js').Aircraft>();
}

describe('updateTracker', () => {
	it('creates a new aircraft entry for an unknown ICAO', () => {
		const ac = makeMap();
		const msg = parseHex('8D4840D6202CC371C32CE0576098');
		const result = updateTracker(ac, msg, 1000);
		expect(result).toBeDefined();
		expect(result!.icao).toBe('4840D6');
		expect(ac.has('4840D6')).toBe(true);
	});

	it('increments msgCount on each message', () => {
		const ac = makeMap();
		const msg = parseHex('8D4840D6202CC371C32CE0576098');
		updateTracker(ac, msg, 1000);
		updateTracker(ac, msg, 2000);
		updateTracker(ac, msg, 3000);
		expect(ac.get('4840D6')!.msgCount).toBe(3);
	});

	it('sets firstSeen only on first message', () => {
		const ac = makeMap();
		const msg = parseHex('8D4840D6202CC371C32CE0576098');
		updateTracker(ac, msg, 1000);
		updateTracker(ac, msg, 5000);
		const aircraft = ac.get('4840D6')!;
		expect(aircraft.firstSeen).toBe(1000);
		expect(aircraft.lastSeen).toBe(5000);
	});

	it('extracts callsign from identification message', () => {
		const ac = makeMap();
		const msg = parseHex('8D4840D6202CC371C32CE0576098');
		updateTracker(ac, msg, 1000);
		expect(ac.get('4840D6')!.callsign).toBe('KLM1023');
	});

	it('extracts category from identification message', () => {
		const ac = makeMap();
		const msg = parseHex('8D4840D6202CC371C32CE0576098');
		updateTracker(ac, msg, 1000);
		const aircraft = ac.get('4840D6')!;
		expect(aircraft.categoryLetter).toBe('A');
	});

	it('extracts altitude from airborne position message', () => {
		const ac = makeMap();
		const msg = parseHex('8D40621D58C382D690C8AC2863A7');
		updateTracker(ac, msg, 1000);
		expect(ac.get('40621D')!.altBaro).toBe(38000);
	});

	it('stores CPR frame data from airborne position', () => {
		const ac = makeMap();
		const msg = parseHex('8D40621D58C382D690C8AC2863A7');
		updateTracker(ac, msg, 1000);
		const aircraft = ac.get('40621D')!;
		// Should have either an even or odd frame stored
		const hasFrame = aircraft.evenFrame !== undefined || aircraft.oddFrame !== undefined;
		expect(hasFrame).toBe(true);
	});

	it('extracts velocity from airborne velocity message', () => {
		const ac = makeMap();
		const msg = parseHex('8D485020994409940838175B284F');
		updateTracker(ac, msg, 1000);
		const aircraft = ac.get('485020')!;
		expect(aircraft.groundSpeed).toBeDefined();
		expect(aircraft.groundSpeed!).toBeGreaterThan(155);
		expect(aircraft.groundSpeed!).toBeLessThan(165);
		expect(aircraft.track).toBeDefined();
		expect(aircraft.track!).toBeGreaterThan(178);
		expect(aircraft.track!).toBeLessThan(186);
	});

	it('returns undefined for message with no ICAO', () => {
		const ac = makeMap();
		// A message with unknown/undetermined ICAO — we construct a minimal one
		// DF0 (56-bit short) with all zeros (ICAO would be derived from CRC)
		// The simplest test: updateTracker with a msg that has icao = undefined
		const msg = parseHex('8D4840D6202CC371C32CE0576098');
		// Force undefined ICAO
		const noIcao = { ...msg, icao: undefined };
		const result = updateTracker(ac, noIcao, 1000);
		expect(result).toBeUndefined();
	});

	it('updates operational status fields', () => {
		const ac = makeMap();
		const msg = parseHex('8DA63E26F8230006004AB8C01E4E');
		updateTracker(ac, msg, 1000);
		const aircraft = ac.get('A63E26')!;
		expect(aircraft.version).toBeDefined();
	});
});

describe('pruneStale', () => {
	it('removes aircraft not seen within STALE_AGE_MS', () => {
		const ac = makeMap();
		const msg = parseHex('8D4840D6202CC371C32CE0576098');
		updateTracker(ac, msg, 0);
		expect(ac.has('4840D6')).toBe(true);
		pruneStale(ac, STALE_AGE_MS + 1);
		expect(ac.has('4840D6')).toBe(false);
	});

	it('keeps aircraft seen within STALE_AGE_MS', () => {
		const ac = makeMap();
		const msg = parseHex('8D4840D6202CC371C32CE0576098');
		updateTracker(ac, msg, 0);
		pruneStale(ac, STALE_AGE_MS - 1);
		expect(ac.has('4840D6')).toBe(true);
	});

	it('prunes multiple stale aircraft', () => {
		const ac = makeMap();
		updateTracker(ac, parseHex('8D4840D6202CC371C32CE0576098'), 0);
		updateTracker(ac, parseHex('8D40621D58C382D690C8AC2863A7'), 0);
		pruneStale(ac, STALE_AGE_MS + 1);
		expect(ac.size).toBe(0);
	});
});

describe('getAircraftList', () => {
	it('returns aircraft sorted by lastSeen descending', () => {
		const ac = makeMap();
		updateTracker(ac, parseHex('8D4840D6202CC371C32CE0576098'), 1000);
		updateTracker(ac, parseHex('8D40621D58C382D690C8AC2863A7'), 3000);
		updateTracker(ac, parseHex('8D485020994409940838175B284F'), 2000);
		const list = getAircraftList(ac);
		expect(list[0].icao).toBe('40621D');  // lastSeen=3000
		expect(list[1].icao).toBe('485020');  // lastSeen=2000
		expect(list[2].icao).toBe('4840D6');  // lastSeen=1000
	});

	it('returns an empty array for an empty map', () => {
		expect(getAircraftList(makeMap())).toEqual([]);
	});
});
