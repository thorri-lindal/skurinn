// Common types shared across input adapters

export type AdapterStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

export type AdapterType = 'json-poll' | 'sbs' | 'websocket-sbs' | 'demo';

// Parsed data from the SBS CSV stream
export interface SBSMessage {
	msgType: number;       // 1-8
	icao: string;          // hex
	callsign?: string;
	altitude?: number;
	groundSpeed?: number;
	track?: number;
	lat?: number;
	lon?: number;
	verticalRate?: number;
	squawk?: string;
	onGround?: boolean;
	emergency?: boolean;
	timestampMs: number;
}

// A single aircraft record as returned by dump1090-fa aircraft.json
export interface AircraftJson {
	hex: string;
	flight?: string;
	alt_baro?: number | 'ground';
	alt_geom?: number;
	gs?: number;
	track?: number;
	baro_rate?: number;
	geom_rate?: number;
	squawk?: string;
	emergency?: string;
	category?: string;
	lat?: number;
	lon?: number;
	nic?: number;
	rc?: number;
	seen_pos?: number;
	version?: number;
	nac_p?: number;
	nac_v?: number;
	sil?: number;
	sil_type?: string;
	messages?: number;
	seen?: number;
	rssi?: number;
}

export interface AircraftJsonResponse {
	now: number;
	messages: number;
	aircraft: AircraftJson[];
}

export interface AdapterCallbacks {
	onSBS: (msg: SBSMessage) => void;
	onAircraftJson: (aircraft: AircraftJson[], serverNow: number) => void;
	onStatusChange: (status: AdapterStatus, error?: string) => void;
}
