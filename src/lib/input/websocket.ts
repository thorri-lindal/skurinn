// WebSocket adapter — connects to a WebSocket bridge that proxies
// dump1090's SBS stream (port 30003) or Beast binary (port 30002).
//
// Many dump1090 setups expose a WebSocket bridge (e.g. dump1090-fa
// with --net-bo-port or via a separate ws-proxy). This adapter expects
// each WebSocket message to contain one or more SBS CSV lines.

import type { AdapterCallbacks, AdapterStatus } from './types.js';
import { parseSBSBuffer } from './sbs.js';

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface WebSocketAdapterOptions {
	url: string; // e.g. ws://192.168.1.1:30003
}

export class WebSocketAdapter {
	private url: string;
	private callbacks: AdapterCallbacks;
	private ws: WebSocket | null = null;
	private _status: AdapterStatus = 'idle';
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;

	constructor(opts: WebSocketAdapterOptions, callbacks: AdapterCallbacks) {
		this.url = opts.url;
		this.callbacks = callbacks;
	}

	get status(): AdapterStatus {
		return this._status;
	}

	private setStatus(s: AdapterStatus, error?: string): void {
		this._status = s;
		this.callbacks.onStatusChange(s, error);
	}

	start(): void {
		this.stopped = false;
		this.reconnectAttempts = 0;
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.ws?.close();
		this.ws = null;
		this.setStatus('disconnected');
	}

	private connect(): void {
		if (this.stopped) return;
		this.setStatus('connecting');

		try {
			this.ws = new WebSocket(this.url);
		} catch {
			this.setStatus('error', 'Invalid WebSocket URL');
			return;
		}

		this.ws.onopen = () => {
			this.reconnectAttempts = 0;
			this.setStatus('connected');
		};

		this.ws.onmessage = (evt) => {
			const text = typeof evt.data === 'string' ? evt.data : '';
			if (!text) return;
			const msgs = parseSBSBuffer(text);
			for (const msg of msgs) {
				this.callbacks.onSBS(msg);
			}
		};

		this.ws.onerror = () => {
			this.setStatus('error', 'WebSocket error');
		};

		this.ws.onclose = () => {
			if (this.stopped) return;
			this.ws = null;
			this.reconnectAttempts++;
			if (this.reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
				const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;
				this.setStatus('connecting', `Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
				this.reconnectTimer = setTimeout(() => this.connect(), delay);
			} else {
				this.setStatus('error', 'Max reconnection attempts reached');
			}
		};
	}
}
