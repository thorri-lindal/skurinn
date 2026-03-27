// Squawk (Mode A) identity field decoding
// The 13-bit identity field has bits interleaved as:
// C1 A1 C2 A2 C4 A4 0 B1 D1 B2 D2 B4 D4

// Decode a 13-bit identity field to a 4-digit octal squawk code
// The result is returned as a 4-character string (e.g. "7700")
export function decodeID13Field(id13: number): string {
	// Extract individual bits from the 13-bit field
	// Bit positions (MSB = bit 12):
	// 12=C1, 11=A1, 10=C2, 9=A2, 8=C4, 7=A4, 6=0, 5=B1, 4=D1, 3=B2, 2=D2, 1=B4, 0=D4

	const c1 = (id13 >> 12) & 1;
	const a1 = (id13 >> 11) & 1;
	const c2 = (id13 >> 10) & 1;
	const a2 = (id13 >> 9) & 1;
	const c4 = (id13 >> 8) & 1;
	const a4 = (id13 >> 7) & 1;
	// bit 6 unused (always 0)
	const b1 = (id13 >> 5) & 1;
	const d1 = (id13 >> 4) & 1;
	const b2 = (id13 >> 3) & 1;
	const d2 = (id13 >> 2) & 1;
	const b4 = (id13 >> 1) & 1;
	const d4 = (id13 >> 0) & 1;

	// Assemble 4 octal digits
	// Each octal digit is 3 bits: digit = 4*x4 + 2*x2 + 1*x1
	const a = a4 * 4 + a2 * 2 + a1;
	const b = b4 * 4 + b2 * 2 + b1;
	const c = c4 * 4 + c2 * 2 + c1;
	const d = d4 * 4 + d2 * 2 + d1;

	return `${a}${b}${c}${d}`;
}

// Decode 13-bit identity field to a numeric Mode A code (decimal representation of octal)
export function decodeID13FieldNumeric(id13: number): number {
	const s = decodeID13Field(id13);
	// Parse as decimal (digits are already octal: 0-7 each)
	return parseInt(s, 10);
}
