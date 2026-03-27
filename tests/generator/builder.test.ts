import { describe, it, expect } from 'vitest';
import { buildIdent, buildPosition, buildVelocity } from '../../src/lib/generator/builder.js';
import { parseHex } from '../../src/lib/parser/index.js';
import { ADSBMessageType, CPRFormat } from '../../src/lib/parser/types.js';

describe('buildIdent', () => {
	it('produces a parseable DF17 ident frame', () => {
		const hex = buildIdent({ icao: '4840D6', callsign: 'KLM1023', category: 4, emitterCategory: 0 });
		expect(hex.length).toBe(28); // 14 bytes
		const msg = parseHex(hex);
		expect(msg.df).toBe(17);
	});

	it('encodes the correct ICAO', () => {
		const hex = buildIdent({ icao: '485020', callsign: 'DLH1', category: 4, emitterCategory: 3 });
		const msg = parseHex(hex);
		expect(msg.icao).toBe('485020');
	});

	it('produces a valid CRC', () => {
		const hex = buildIdent({ icao: '4840D6', callsign: 'KLM1023', category: 4, emitterCategory: 0 });
		const msg = parseHex(hex);
		expect(msg.crcOk).toBe(true);
	});

	it('decodes to AircraftIdentification type', () => {
		const hex = buildIdent({ icao: '4840D6', callsign: 'KLM1023', category: 4, emitterCategory: 0 });
		const msg = parseHex(hex);
		expect(msg.adsb?.messageType).toBe(ADSBMessageType.AircraftIdentification);
	});

	it('round-trips callsign KLM1023', () => {
		const hex = buildIdent({ icao: '4840D6', callsign: 'KLM1023', category: 4, emitterCategory: 0 });
		const msg = parseHex(hex);
		expect(msg.adsb?.identification?.callsign).toBe('KLM1023');
	});

	it('round-trips category letter', () => {
		const hex = buildIdent({ icao: '4840D6', callsign: 'TEST', category: 3, emitterCategory: 2 });
		const msg = parseHex(hex);
		expect(msg.adsb?.identification?.categoryLetter).toBe('B');
		expect(msg.adsb?.identification?.categoryNumber).toBe(2);
	});
});

describe('buildPosition', () => {
	it('produces a parseable DF17 airborne position frame', () => {
		const hex = buildPosition({ icao: '40621D', lat: 52.32, lon: 4.79, altFt: 38000, odd: false });
		expect(hex.length).toBe(28);
		const msg = parseHex(hex);
		expect(msg.df).toBe(17);
	});

	it('produces a valid CRC', () => {
		const hex = buildPosition({ icao: '40621D', lat: 52.32, lon: 4.79, altFt: 38000, odd: false });
		expect(parseHex(hex).crcOk).toBe(true);
	});

	it('decodes to AirbornePositionBaro type', () => {
		const hex = buildPosition({ icao: '40621D', lat: 52.32, lon: 4.79, altFt: 38000, odd: false });
		const msg = parseHex(hex);
		expect(msg.adsb?.messageType).toBe(ADSBMessageType.AirbornePositionBaro);
	});

	it('round-trips altitude 38000ft', () => {
		const hex = buildPosition({ icao: '40621D', lat: 52.32, lon: 4.79, altFt: 38000, odd: false });
		const msg = parseHex(hex);
		// Q=1 encoding is in 25ft steps so altitude should be exact
		expect(msg.adsb?.altitude).toBe(38000);
	});

	it('encodes even frame as CPRFormat.Even', () => {
		const hex = buildPosition({ icao: '40621D', lat: 52.32, lon: 4.79, altFt: 35000, odd: false });
		const msg = parseHex(hex);
		expect(msg.adsb?.cprPosition?.format).toBe(CPRFormat.Even);
	});

	it('encodes odd frame as CPRFormat.Odd', () => {
		const hex = buildPosition({ icao: '40621D', lat: 52.32, lon: 4.79, altFt: 35000, odd: true });
		const msg = parseHex(hex);
		expect(msg.adsb?.cprPosition?.format).toBe(CPRFormat.Odd);
	});
});

describe('buildVelocity', () => {
	it('produces a parseable DF17 velocity frame', () => {
		const hex = buildVelocity({ icao: '485020', groundSpeedKt: 450, trackDeg: 270, verticalRateFpm: 0 });
		expect(hex.length).toBe(28);
		const msg = parseHex(hex);
		expect(msg.df).toBe(17);
	});

	it('produces a valid CRC', () => {
		const hex = buildVelocity({ icao: '485020', groundSpeedKt: 450, trackDeg: 270, verticalRateFpm: 0 });
		expect(parseHex(hex).crcOk).toBe(true);
	});

	it('decodes to AirborneVelocity type', () => {
		const hex = buildVelocity({ icao: '485020', groundSpeedKt: 450, trackDeg: 270, verticalRateFpm: 0 });
		const msg = parseHex(hex);
		expect(msg.adsb?.messageType).toBe(ADSBMessageType.AirborneVelocity);
	});

	it('round-trips ground speed ~450kt within 5kt', () => {
		const hex = buildVelocity({ icao: '485020', groundSpeedKt: 450, trackDeg: 90, verticalRateFpm: 0 });
		const msg = parseHex(hex);
		const gs = msg.adsb?.velocity?.groundSpeed ?? 0;
		expect(gs).toBeGreaterThan(445);
		expect(gs).toBeLessThan(455);
	});

	it('round-trips track 182° within 2°', () => {
		const hex = buildVelocity({ icao: '485020', groundSpeedKt: 300, trackDeg: 182, verticalRateFpm: 0 });
		const msg = parseHex(hex);
		const track = msg.adsb?.velocity?.track ?? 0;
		expect(track).toBeGreaterThan(180);
		expect(track).toBeLessThan(184);
	});

	it('encodes climbing vertical rate', () => {
		const hex = buildVelocity({ icao: '485020', groundSpeedKt: 300, trackDeg: 0, verticalRateFpm: 1920 });
		const msg = parseHex(hex);
		const vr = msg.adsb?.velocity?.verticalRate ?? 0;
		expect(vr).toBeGreaterThan(0);
	});
});
