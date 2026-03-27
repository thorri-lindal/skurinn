// SBS CSV line parser (dump1090 port 30003)
// Format: MSG,<type>,<sid>,<aid>,<icao>,<fid>,<date_gen>,<time_gen>,<date_log>,<time_log>,
//              <callsign>,<alt>,<gs>,<track>,<lat>,<lon>,<vrate>,<squawk>,<alert>,<emergency>,<spi>,<on_ground>

import type { SBSMessage } from './types.js';

// Parse a single SBS CSV line. Returns null if the line is not a MSG record.
export function parseSBSLine(line: string, timestampMs: number = Date.now()): SBSMessage | null {
	const parts = line.split(',');
	if (parts.length < 22 || parts[0] !== 'MSG') return null;

	const msgType = parseInt(parts[1], 10);
	const icao = parts[4].trim().toUpperCase();
	if (!icao || icao.length === 0) return null;

	const msg: SBSMessage = { msgType, icao, timestampMs };

	// Field indices (0-based):
	// 10=callsign, 11=alt, 12=gs, 13=track, 14=lat, 15=lon,
	// 16=vrate, 17=squawk, 18=alert, 19=emergency, 20=spi, 21=on_ground
	const callsign = parts[10]?.trim();
	if (callsign) msg.callsign = callsign;

	const alt = parseFloat(parts[11]);
	if (!isNaN(alt)) msg.altitude = alt;

	const gs = parseFloat(parts[12]);
	if (!isNaN(gs)) msg.groundSpeed = gs;

	const track = parseFloat(parts[13]);
	if (!isNaN(track)) msg.track = track;

	const lat = parseFloat(parts[14]);
	const lon = parseFloat(parts[15]);
	if (!isNaN(lat) && !isNaN(lon)) {
		msg.lat = lat;
		msg.lon = lon;
	}

	const vrate = parseFloat(parts[16]);
	if (!isNaN(vrate)) msg.verticalRate = vrate;

	const squawk = parts[17]?.trim();
	if (squawk) msg.squawk = squawk;

	msg.emergency = parts[19]?.trim() === '-1';
	msg.onGround = parts[21]?.trim() === '-1';

	return msg;
}

// Parse a multi-line SBS buffer, splitting on newlines
export function parseSBSBuffer(buffer: string): SBSMessage[] {
	const now = Date.now();
	return buffer
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => parseSBSLine(line, now))
		.filter((m): m is SBSMessage => m !== null);
}
