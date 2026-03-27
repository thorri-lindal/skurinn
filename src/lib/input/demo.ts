// Demo mode — generates synthetic aircraft traffic for offline testing.
// Produces a handful of aircraft flying realistic patterns around a
// configurable centre point.

import type { AdapterCallbacks, AdapterStatus, AircraftJson } from './types.js';

interface DemoAircraft {
	hex: string;
	flight: string;
	lat: number;
	lon: number;
	alt: number;
	gs: number;
	track: number;
	vrate: number;
}

const DEMO_FLEET: DemoAircraft[] = [
	{ hex: '4840d6', flight: 'KLM1023 ', lat: 52.32, lon:  4.79, alt: 38000, gs: 460, track:  92, vrate:    0 },
	{ hex: '40621d', flight: 'BAW442  ', lat: 51.47, lon: -0.46, alt: 35000, gs: 490, track: 275, vrate:    0 },
	{ hex: '485020', flight: 'DLH452  ', lat: 48.36, lon:  8.54, alt: 36000, gs: 480, track: 182, vrate: -256 },
	{ hex: 'a63e26', flight: 'AAL103  ', lat: 53.63, lon: -6.78, alt: 31000, gs: 510, track:  60, vrate:  128 },
	{ hex: '3c6444', flight: 'DLH6    ', lat: 50.04, lon:  8.57, alt:   500, gs: 140, track: 254, vrate:    0 },
	{ hex: '4ca7b1', flight: 'RYR33EF ', lat: 53.42, lon:  6.19, alt: 22000, gs: 395, track: 290, vrate: -960 },
];

const TICK_INTERVAL_MS = 1000;

export class DemoAdapter {
	private callbacks: AdapterCallbacks;
	private _status: AdapterStatus = 'idle';
	private fleet: DemoAircraft[];
	private timerId: ReturnType<typeof setInterval> | null = null;

	constructor(callbacks: AdapterCallbacks) {
		this.callbacks = callbacks;
		// Deep-copy so we can mutate positions
		this.fleet = DEMO_FLEET.map((a) => ({ ...a }));
	}

	get status(): AdapterStatus {
		return this._status;
	}

	start(): void {
		this._status = 'connected';
		this.callbacks.onStatusChange('connected');
		this.tick();
		this.timerId = setInterval(() => this.tick(), TICK_INTERVAL_MS);
	}

	stop(): void {
		if (this.timerId !== null) {
			clearInterval(this.timerId);
			this.timerId = null;
		}
		this._status = 'disconnected';
		this.callbacks.onStatusChange('disconnected');
	}

	private tick(): void {
		const dtH = TICK_INTERVAL_MS / 3_600_000; // hours per tick

		for (const ac of this.fleet) {
			// Advance position along current track
			const dist = ac.gs * dtH; // nautical miles
			const trackRad = (ac.track * Math.PI) / 180;
			const dLat = (dist * Math.cos(trackRad)) / 60;
			const dLon = (dist * Math.sin(trackRad)) / (60 * Math.cos((ac.lat * Math.PI) / 180));
			ac.lat += dLat;
			ac.lon += dLon;

			// Gentle altitude change
			ac.alt += (ac.vrate / 60) * (TICK_INTERVAL_MS / 1000);
			ac.alt = Math.max(0, Math.min(45000, ac.alt));

			// Slight track wander
			ac.track = (ac.track + (Math.random() - 0.5) * 0.5 + 360) % 360;
		}

		const now = Date.now() / 1000;
		const aircraft: AircraftJson[] = this.fleet.map((ac) => ({
			hex: ac.hex,
			flight: ac.flight,
			alt_baro: Math.round(ac.alt),
			gs: Math.round(ac.gs),
			track: Math.round(ac.track * 10) / 10,
			baro_rate: ac.vrate,
			lat: Math.round(ac.lat * 100000) / 100000,
			lon: Math.round(ac.lon * 100000) / 100000,
			seen_pos: 0,
			seen: 0,
		}));

		this.callbacks.onAircraftJson(aircraft, now);
	}
}
