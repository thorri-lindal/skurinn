// HTTP polling adapter for dump1090-fa aircraft.json
// Polls http://<host>:<port>/data/aircraft.json at a configurable interval.

import type { AdapterCallbacks, AdapterStatus, AircraftJsonResponse } from './types.js';

const DEFAULT_PORT = 8080;
const DEFAULT_INTERVAL_MS = 1000;

export interface JsonPollerOptions {
	host: string;
	port?: number;
	intervalMs?: number;
}

export class JsonPoller {
	private host: string;
	private port: number;
	private intervalMs: number;
	private callbacks: AdapterCallbacks;
	private timerId: ReturnType<typeof setInterval> | null = null;
	private _status: AdapterStatus = 'idle';
	private abortController: AbortController | null = null;

	constructor(opts: JsonPollerOptions, callbacks: AdapterCallbacks) {
		this.host = opts.host;
		this.port = opts.port ?? DEFAULT_PORT;
		this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.callbacks = callbacks;
	}

	get status(): AdapterStatus {
		return this._status;
	}

	private get url(): string {
		return `http://${this.host}:${this.port}/data/aircraft.json`;
	}

	private setStatus(s: AdapterStatus, error?: string): void {
		this._status = s;
		this.callbacks.onStatusChange(s, error);
	}

	start(): void {
		if (this._status === 'connected' || this._status === 'connecting') return;
		this.setStatus('connecting');
		this.poll(); // immediate first poll
		this.timerId = setInterval(() => this.poll(), this.intervalMs);
	}

	stop(): void {
		if (this.timerId !== null) {
			clearInterval(this.timerId);
			this.timerId = null;
		}
		this.abortController?.abort();
		this.abortController = null;
		this.setStatus('disconnected');
	}

	private async poll(): Promise<void> {
		this.abortController = new AbortController();
		try {
			const response = await fetch(this.url, {
				signal: this.abortController.signal,
				cache: 'no-store',
			});
			if (!response.ok) {
				this.setStatus('error', `HTTP ${response.status}`);
				return;
			}
			const data: AircraftJsonResponse = await response.json();
			if (this._status !== 'connected') this.setStatus('connected');
			this.callbacks.onAircraftJson(data.aircraft ?? [], data.now ?? Date.now() / 1000);
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') return;
			const msg = err instanceof Error ? err.message : String(err);
			this.setStatus('error', msg);
		}
	}
}
