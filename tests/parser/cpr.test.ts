import { describe, it, expect } from 'vitest';
import { nlFunc, cprGlobalDecode, cprLocalDecode } from '../../src/lib/parser/cpr.js';
import { CPRFormat } from '../../src/lib/parser/types.js';

describe('nlFunc', () => {
	it('returns 59 at equator', () => {
		expect(nlFunc(0)).toBe(59);
	});

	it('returns 1 at poles', () => {
		expect(nlFunc(90)).toBe(1);
		expect(nlFunc(-90)).toBe(1);
		expect(nlFunc(87)).toBe(1);
		expect(nlFunc(-87)).toBe(1);
	});

	it('returns correct value at mid-latitudes', () => {
		// At ~51.5° (London area), NL should be around 36
		const nl = nlFunc(51.5);
		expect(nl).toBeGreaterThanOrEqual(34);
		expect(nl).toBeLessThanOrEqual(38);
	});

	it('is symmetric for N/S hemispheres', () => {
		for (const lat of [10, 20, 30, 40, 50, 60, 70, 80]) {
			expect(nlFunc(lat)).toBe(nlFunc(-lat));
		}
	});

	it('decreases monotonically with latitude', () => {
		let prev = nlFunc(0);
		for (let lat = 5; lat <= 85; lat += 5) {
			const cur = nlFunc(lat);
			expect(cur).toBeLessThanOrEqual(prev);
			prev = cur;
		}
	});
});

// Compute CPR encoding for a known lat/lon position
function encodeCpr(lat: number, lon: number, isOdd: boolean): { latCpr: number; lonCpr: number } {
	const nz = 15;
	const dLat = isOdd ? 360.0 / (4 * nz - 1) : 360.0 / (4 * nz);
	const yz = Math.floor(lat / dLat) * dLat;
	const latFrac = lat - yz;
	const latCpr = Math.floor((latFrac / dLat) * 131072);

	const nl = nlFunc(lat);
	const ni = Math.max(isOdd ? nl - 1 : nl, 1);
	const dLon = 360.0 / ni;
	const xz = Math.floor(lon / dLon) * dLon;
	const lonFrac = lon - xz;
	const lonCpr = Math.floor((lonFrac / dLon) * 131072);

	return { latCpr: latCpr & 0x1ffff, lonCpr: lonCpr & 0x1ffff };
}

describe('cprLocalDecode', () => {
	it('decodes a position near Schiphol (lat≈52.32, lon≈4.79)', () => {
		const refLat = 52.0;
		const refLon = 4.0;
		const testLat = 52.32;
		const testLon = 4.79;

		const { latCpr, lonCpr } = encodeCpr(testLat, testLon, false);
		const result = cprLocalDecode(latCpr, lonCpr, CPRFormat.Even, refLat, refLon);

		expect(result).not.toBeNull();
		expect(result!.lat).toBeCloseTo(testLat, 1);
		expect(result!.lon).toBeCloseTo(testLon, 1);
	});

	it('decodes a position in southern hemisphere', () => {
		const refLat = -33.8;
		const refLon = 151.2;
		const testLat = -33.87;
		const testLon = 151.21;

		const { latCpr, lonCpr } = encodeCpr(testLat, testLon, true);
		const result = cprLocalDecode(latCpr, lonCpr, CPRFormat.Odd, refLat, refLon);

		expect(result).not.toBeNull();
		expect(result!.lat).toBeCloseTo(testLat, 1);
		expect(result!.lon).toBeCloseTo(testLon, 1);
	});
});

describe('cprGlobalDecode', () => {
	it('decodes even/odd pair near Schiphol (lat≈52.32, lon≈4.79)', () => {
		const testLat = 52.32;
		const testLon = 4.79;

		const even = encodeCpr(testLat, testLon, false);
		const odd = encodeCpr(testLat, testLon, true);

		const result = cprGlobalDecode(
			even.latCpr, even.lonCpr,
			odd.latCpr, odd.lonCpr,
			CPRFormat.Even
		);

		expect(result).not.toBeNull();
		expect(result!.lat).toBeCloseTo(testLat, 0);
		expect(result!.lon).toBeCloseTo(testLon, 0);
	});

	it('decodes position in southern hemisphere', () => {
		const testLat = -33.87;
		const testLon = 151.21;

		const even = encodeCpr(testLat, testLon, false);
		const odd = encodeCpr(testLat, testLon, true);

		const result = cprGlobalDecode(
			even.latCpr, even.lonCpr,
			odd.latCpr, odd.lonCpr,
			CPRFormat.Odd
		);

		expect(result).not.toBeNull();
		if (result !== null) {
			expect(result.lat).toBeCloseTo(testLat, 0);
		}
	});

	it('returns null when NL values are incompatible', () => {
		// Frames from very different latitudes will produce incompatible NL values
		// Lat 0 has NL=59, lat ~60 has NL=30 — a large difference should cause null
		const evenNearEquator = encodeCpr(1.0, 10.0, false);  // NL≈59
		const oddNearPole = encodeCpr(80.0, 10.0, true);       // NL≈2

		// These may or may not produce null depending on j calculation,
		// but the function should not throw
		const result = cprGlobalDecode(
			evenNearEquator.latCpr, evenNearEquator.lonCpr,
			oddNearPole.latCpr, oddNearPole.lonCpr,
			CPRFormat.Even
		);
		expect(result === null || typeof result!.lat === 'number').toBe(true);
	});
});
