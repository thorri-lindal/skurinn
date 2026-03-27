// All enums and interfaces for Mode S / ADS-B message parsing

export enum DownlinkFormat {
	DF0 = 0,   // Short air-air surveillance (ACAS)
	DF4 = 4,   // Surveillance altitude reply
	DF5 = 5,   // Surveillance identity reply
	DF11 = 11, // All-call reply
	DF16 = 16, // Long air-air surveillance (ACAS)
	DF17 = 17, // ADS-B Extended Squitter
	DF18 = 18, // TIS-B/ADS-R Extended Squitter
	DF20 = 20, // Comm-B altitude reply
	DF21 = 21, // Comm-B identity reply
}

export enum AltitudeUnit {
	Feet = 'feet',
	Meters = 'meters',
}

export enum CPRFormat {
	Even = 0,
	Odd = 1,
}

export enum ADSBMessageType {
	AircraftIdentification = 'aircraft_identification',
	SurfacePosition = 'surface_position',
	AirbornePositionBaro = 'airborne_position_baro',
	AirbornePositionGNSS = 'airborne_position_gnss',
	AirborneVelocity = 'airborne_velocity',
	AircraftStatus = 'aircraft_status',
	TargetStateAndStatus = 'target_state_and_status',
	OperationalStatus = 'operational_status',
	Reserved = 'reserved',
	Unknown = 'unknown',
}

export enum VelocitySubtype {
	GroundSpeedSubsonic = 1,
	GroundSpeedSupersonic = 2,
	AirspeedSubsonic = 3,
	AirspeedSupersonic = 4,
}

// Compact Position Reporting encoded position (not yet decoded to lat/lon)
export interface CprPosition {
	latCpr: number;    // 17-bit encoded latitude
	lonCpr: number;    // 17-bit encoded longitude
	format: CPRFormat; // 0 = even, 1 = odd
}

export interface DecodedPosition {
	lat: number;
	lon: number;
}

export interface Velocity {
	subtype: VelocitySubtype;
	// Ground speed mode
	groundSpeed?: number;     // knots (ST 1 or 2)
	track?: number;           // degrees true (0-360, ST 1 or 2)
	trackValid: boolean;
	// Airspeed mode
	airspeedType?: 'IAS' | 'TAS';
	airspeed?: number;        // knots (ST 3 or 4)
	heading?: number;         // degrees magnetic (ST 3 or 4)
	headingValid: boolean;
	// Vertical rate (both modes)
	verticalRate?: number;           // ft/min, positive = climbing
	verticalRateSource?: 'baro' | 'gnss';
	// Geometric altitude difference (GNSS alt - baro alt)
	geomAltDiff?: number;            // feet
	geomAltDiffSign?: 'above' | 'below';
}

export interface AircraftIdentification {
	callsign: string;
	categoryLetter: string;  // 'A', 'B', 'C', 'D', or ' ' if unknown
	categoryNumber: number;  // 0-7
}

// 6-bit AIS character encoding charset
// Position 0='#', 1-26='A'-'Z', 32=' ', 48-57='0'-'9'
export const AIS_CHARSET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######';

export interface ADSBData {
	typeCode: number;           // ME type code (bits 1-5 of ME)
	subType: number;            // ME subtype (bits 6-8 of ME)
	messageType: ADSBMessageType;
	me: Uint8Array;             // Raw 7-byte ME field

	// Aircraft identification (TC 1-4)
	identification?: AircraftIdentification;

	// Surface position (TC 5-8)
	// Airborne position baro (TC 9-18)
	// Airborne position GNSS (TC 20-22)
	cprPosition?: CprPosition;
	altitude?: number;          // feet (null for surface)
	altUnit?: AltitudeUnit;

	// Airborne velocity (TC 19)
	velocity?: Velocity;

	// Aircraft status (TC 28)
	emergencyState?: number;
	squawkFromStatus?: string;

	// Operational status (TC 31)
	operationalStatus?: {
		version: number;
		nicSuppA?: number;
		nicSuppB?: number;
		nacPos?: number;
		gvaAlt?: number;
		sil?: number;
		silSupplement?: number;
		selectedAltType?: number;
		nacVel?: number;
		hrd?: number;       // 0=magnetic, 1=true north
		sils?: number;      // SIL supplement
		subtype: number;    // 0=airborne, 1=surface
	};
}

export interface CommBData {
	bdsRegister: string;        // e.g. "20", "40"
	raw: Uint8Array;            // Raw 7-byte MB field
	decoded?: Record<string, unknown>;
}

export interface ModeSMessage {
	// Raw frame
	raw: Uint8Array;
	hex: string;

	// Downlink format
	df: number;

	// ICAO 24-bit address (if determinable)
	icao?: string;

	// CRC validation
	crcOk: boolean;
	crc: number;

	// DF0/4/16/20: CA or SL/ARA field
	capability?: number;         // CA bits (DF11/17/18)
	flightStatus?: number;       // FS bits (DF4/5/20/21)

	// DF0/4/16/20: altitude
	altitude?: number;
	altUnit?: AltitudeUnit;

	// DF5/21: squawk identity
	squawk?: string;

	// ADS-B payload (DF17/18)
	adsb?: ADSBData;

	// Comm-B payload (DF20/21)
	commB?: CommBData;
}
