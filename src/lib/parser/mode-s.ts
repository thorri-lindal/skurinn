// Top-level Mode S decoder
// Dispatches by DF, extracts fields, validates CRC

import { AltitudeUnit, DownlinkFormat, type ModeSMessage } from './types.js';
import { checkCRC, crc24 } from './crc.js';
import { decodeAC12Field, decodeAC13Field } from './altitude.js';
import { decodeID13Field } from './squawk.js';
import { decodeADSB } from './adsb.js';
import { decodeCommB } from './comm-b.js';

// Minimum message lengths in bytes
const SHORT_MSG_BYTES = 7;   // 56 bits: DF 0-15
const LONG_MSG_BYTES = 14;   // 112 bits: DF 16+

// DF values that always produce 112-bit messages
const LONG_DF = new Set([16, 17, 18, 19, 20, 21, 24]);

function msgLength(df: number): number {
	return df >= 16 ? LONG_MSG_BYTES : SHORT_MSG_BYTES;
}

// Decode a raw Mode S message from bytes
export function decodeMessage(msg: Uint8Array): ModeSMessage {
	if (msg.length < SHORT_MSG_BYTES) {
		throw new Error(`Message too short: ${msg.length} bytes`);
	}

	const hex = Array.from(msg)
		.map((b) => b.toString(16).padStart(2, '0').toUpperCase())
		.join('');

	const df = (msg[0] >> 3) & 0x1f;
	const expectedLen = msgLength(df);

	if (msg.length < expectedLen) {
		throw new Error(`DF${df} requires ${expectedLen} bytes, got ${msg.length}`);
	}

	// Trim to expected length (ignore trailing bytes)
	const frame = msg.length === expectedLen ? msg : msg.slice(0, expectedLen);

	// CRC validation
	let crcOk = false;
	let crc = 0;
	let icao: string | undefined;

	if (df === 11 || df === 17 || df === 18) {
		// CRC XOR ICAO is stored in last 3 bytes; syndrome should be 0
		crc = checkCRC(frame);
		crcOk = crc === 0;
		// ICAO from bytes 1-3
		icao = ((msg[1] << 16) | (msg[2] << 8) | msg[3]).toString(16).padStart(6, '0').toUpperCase();
	} else {
		// For other DFs, last 3 bytes = address/parity = ICAO XOR CRC
		const computed = crc24(frame, frame.length - 3);
		const stored = ((frame[frame.length - 3] << 16) | (frame[frame.length - 2] << 8) | frame[frame.length - 1]) >>> 0;
		crc = (computed ^ stored) >>> 0;
		// The syndrome IS the ICAO for DF0/4/5/16/20/21
		// We cannot fully verify without a known ICAO, but store the derived address
		icao = crc.toString(16).padStart(6, '0').toUpperCase();
		// For DF4/5/20/21, CRC is technically valid if we have the ICAO, but we can't verify here
		crcOk = true; // accept — let caller verify against known ICAO if desired
	}

	const result: ModeSMessage = {
		raw: frame,
		hex,
		df,
		icao,
		crcOk,
		crc,
	};

	// DF-specific field extraction
	switch (df) {
		case DownlinkFormat.DF0:
		case DownlinkFormat.DF16: {
			// Short/long air-air surveillance
			// Bits 5-7: VS, CC, SL fields (complex ACAS)
			// Bits 20-31: AC field (12-bit altitude)
			const ac12 = ((msg[2] & 0x1f) << 7) | (msg[3] >> 1);
			const altResult = decodeAC12Field(ac12);
			if (altResult) {
				result.altitude = altResult.altitude;
				result.altUnit = altResult.unit;
			}
			break;
		}

		case DownlinkFormat.DF4:
		case DownlinkFormat.DF20: {
			// Surveillance/Comm-B altitude reply
			// Bits 5-7: FS (flight status)
			result.flightStatus = msg[0] & 0x07;
			// Bits 20-32: AC field (13-bit altitude)
			const ac13 = ((msg[2] & 0x1f) << 8) | msg[3];
			const altResult = decodeAC13Field(ac13);
			if (altResult) {
				result.altitude = altResult.altitude;
				result.altUnit = altResult.unit;
			}
			if (df === DownlinkFormat.DF20) {
				// MB field: bytes 4-10
				const mb = frame.slice(4, 11);
				result.commB = decodeCommB(mb);
			}
			break;
		}

		case DownlinkFormat.DF5:
		case DownlinkFormat.DF21: {
			// Surveillance/Comm-B identity reply
			result.flightStatus = msg[0] & 0x07;
			// ID13 field (squawk): bits 20-32
			const id13 = ((msg[2] & 0x1f) << 8) | msg[3];
			result.squawk = decodeID13Field(id13);
			if (df === DownlinkFormat.DF21) {
				const mb = frame.slice(4, 11);
				result.commB = decodeCommB(mb);
			}
			break;
		}

		case DownlinkFormat.DF11: {
			// All-call reply
			// Bits 5-7: CA (capability)
			result.capability = msg[0] & 0x07;
			// ICAO already set above
			break;
		}

		case DownlinkFormat.DF17:
		case DownlinkFormat.DF18: {
			// ADS-B / TIS-B Extended Squitter
			result.capability = msg[0] & 0x07; // CA (DF17) or CF (DF18)
			// ME field: bytes 4-10 (7 bytes)
			const me = frame.slice(4, 11);
			result.adsb = decodeADSB(me);
			break;
		}
	}

	return result;
}
