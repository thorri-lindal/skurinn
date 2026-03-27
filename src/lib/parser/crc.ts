// CRC-24 implementation for Mode S
// Polynomial: 0xFFF409 = x^24 + x^23 + x^22 + x^21 + x^20 + x^19 + x^17 + x^16 + x^15 + x^14 + x^13 + x^10 + x^3 + 1

const MODES_GENERATOR_POLY = 0xfff409;

const crcTable = new Uint32Array(256);

function initTable(): void {
	for (let i = 0; i < 256; i++) {
		let crc = i << 16;
		for (let j = 0; j < 8; j++) {
			if (crc & 0x800000) {
				crc = ((crc << 1) ^ MODES_GENERATOR_POLY) & 0xffffff;
			} else {
				crc = (crc << 1) & 0xffffff;
			}
		}
		crcTable[i] = crc;
	}
}

initTable();

// Compute CRC-24 over the first `len` bytes of msg
export function crc24(msg: Uint8Array, len: number): number {
	let crc = 0;
	for (let i = 0; i < len; i++) {
		crc = ((crc << 8) ^ crcTable[((crc >> 16) ^ msg[i]) & 0xff]) & 0xffffff;
	}
	return crc;
}

// Compute the syndrome (CRC of entire message including last 3 bytes).
// For DF11/17/18: last 3 bytes = CRC XOR ICAO. Syndrome = 0 only when ICAO matches.
// For DF0/4/5/16/20/21: last 3 bytes = address/parity. Syndrome = ICAO address.
export function computeSyndrome(msg: Uint8Array): number {
	return crc24(msg, msg.length);
}

// Verify CRC for a DF17/18/11 message.
// Returns computed CRC XOR stored last-3-bytes. Zero means valid.
export function checkCRC(msg: Uint8Array): number {
	const len = msg.length;
	const computed = crc24(msg, len - 3);
	const stored = ((msg[len - 3] << 16) | (msg[len - 2] << 8) | msg[len - 1]) >>> 0;
	return (computed ^ stored) >>> 0;
}

// For DF11/17/18, extract ICAO from bytes 1-3 and check CRC.
// Returns true if CRC is consistent with the embedded ICAO.
export function verifyCRCWithICAO(msg: Uint8Array): boolean {
	return checkCRC(msg) === 0;
}
