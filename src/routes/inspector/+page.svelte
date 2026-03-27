<script lang="ts">
	import { onMount } from 'svelte';
	import { parseHex } from '$lib/parser/index.js';
	import type { ModeSMessage, ADSBData } from '$lib/parser/types.js';
	import { ADSBMessageType, AltitudeUnit, CPRFormat } from '$lib/parser/types.js';

	let inputHex = $state('');
	let result = $state<ModeSMessage | null>(null);
	let error = $state<string | null>(null);

	// Allow ?hex=<frame> from generator link
	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const hex = params.get('hex');
		if (hex) { inputHex = hex; parse(); }
	});

	const REFERENCE_MESSAGES = [
		{ label: 'DF17 Ident — KLM1023', hex: '8D4840D6202CC371C32CE0576098' },
		{ label: 'DF17 Position — 38000ft', hex: '8D40621D58C382D690C8AC2863A7' },
		{ label: 'DF17 Velocity — 159kt/182°', hex: '8D485020994409940838175B284F' },
		{ label: 'DF17 Opstatus', hex: '8DA63E26F8230006004AB8C01E4E' },
	];

	function parse() {
		error = null;
		result = null;
		try {
			result = parseHex(inputHex.trim());
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function loadSample(hex: string) {
		inputHex = hex;
		parse();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') parse();
	}

	// Format a byte array as space-separated hex pairs with highlights
	function formatBytes(bytes: Uint8Array): { hex: string; byte: number }[] {
		return Array.from(bytes).map((b) => ({
			hex: b.toString(16).padStart(2, '0').toUpperCase(),
			byte: b,
		}));
	}

	// Render a single byte as bit cells
	function byteToBits(b: number): number[] {
		return [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >> i) & 1);
	}

	// Decode format label for DF
	function dfLabel(df: number): string {
		const names: Record<number, string> = {
			0: 'DF0 — Short Air-Air Surveillance (ACAS)',
			4: 'DF4 — Surveillance Altitude Reply',
			5: 'DF5 — Surveillance Identity Reply',
			11: 'DF11 — All-Call Reply',
			16: 'DF16 — Long Air-Air Surveillance (ACAS)',
			17: 'DF17 — ADS-B Extended Squitter',
			18: 'DF18 — TIS-B / ADS-R Extended Squitter',
			20: 'DF20 — Comm-B Altitude Reply',
			21: 'DF21 — Comm-B Identity Reply',
		};
		return names[df] ?? `DF${df} — Unknown`;
	}

	function adsbTypeLabel(type: ADSBMessageType): string {
		const labels: Record<ADSBMessageType, string> = {
			[ADSBMessageType.AircraftIdentification]: 'Aircraft Identification',
			[ADSBMessageType.SurfacePosition]: 'Surface Position',
			[ADSBMessageType.AirbornePositionBaro]: 'Airborne Position (Barometric)',
			[ADSBMessageType.AirbornePositionGNSS]: 'Airborne Position (GNSS)',
			[ADSBMessageType.AirborneVelocity]: 'Airborne Velocity',
			[ADSBMessageType.AircraftStatus]: 'Aircraft Status',
			[ADSBMessageType.TargetStateAndStatus]: 'Target State and Status',
			[ADSBMessageType.OperationalStatus]: 'Operational Status',
			[ADSBMessageType.Reserved]: 'Reserved',
			[ADSBMessageType.Unknown]: 'Unknown',
		};
		return labels[type] ?? type;
	}

	function cprFormatLabel(f: CPRFormat): string {
		return f === CPRFormat.Even ? 'Even (0)' : 'Odd (1)';
	}

	// Return region indices for byte coloring in the raw frame view
	// Returns a region name per byte index
	function byteRegion(idx: number, df: number): string {
		if (idx === 0) return 'header';
		const isLong = df >= 16;
		if (isLong) {
			if (idx >= 1 && idx <= 3) return 'icao';
			if (idx >= 4 && idx <= 10) return 'payload';
			if (idx >= 11) return 'crc';
		} else {
			if (idx >= 1 && idx <= 3) return 'icao';
			if (idx >= 4) return 'crc';
		}
		return '';
	}

	const regionColors: Record<string, string> = {
		header: '#2d4a2d',
		icao: '#2d3a4a',
		payload: '#3a2d4a',
		crc: '#4a3a2d',
		'': '#1a1a1a',
	};

	const regionLabels: Record<string, string> = {
		header: 'DF/CA',
		icao: 'ICAO',
		payload: 'Payload',
		crc: 'PI/CRC',
	};
</script>

<svelte:head>
	<title>Inspector — ADS-B Workbench</title>
</svelte:head>

<div class="inspector">
	<header class="page-header">
		<h1>MODE S INSPECTOR</h1>
		<nav>
			<a href="/">Dashboard</a>
			<a href="/inspector" class="active">Inspector</a>
		</nav>
	</header>

	<section class="input-section">
		<div class="input-row">
			<label for="hex-input">HEX FRAME</label>
			<input
				id="hex-input"
				type="text"
				bind:value={inputHex}
				onkeydown={handleKeydown}
				placeholder="Paste Mode S hex (e.g. 8D4840D6202CC371C32CE0576098)"
				spellcheck="false"
				autocomplete="off"
			/>
			<button onclick={parse}>DECODE</button>
		</div>

		<div class="samples">
			<span class="samples-label">SAMPLES:</span>
			{#each REFERENCE_MESSAGES as ref}
				<button class="sample-btn" onclick={() => loadSample(ref.hex)}>{ref.label}</button>
			{/each}
		</div>
	</section>

	{#if error}
		<div class="error-panel">
			<span class="error-icon">!</span>
			{error}
		</div>
	{/if}

	{#if result}
		<!-- Raw byte view -->
		<section class="panel raw-panel">
			<h2>RAW FRAME <span class="byte-count">{result.raw.length * 8} bits / {result.raw.length} bytes</span></h2>

			<div class="byte-map">
				{#each formatBytes(result.raw) as { hex: byteHex, byte }, i}
					{@const region = byteRegion(i, result.df)}
					<div
						class="byte-cell"
						style="background:{regionColors[region]}"
						title={`Byte ${i}: 0x${byteHex} = ${byte}\nRegion: ${regionLabels[region] ?? region}`}
					>
						<span class="byte-addr">{i.toString(16).padStart(2, '0')}</span>
						<span class="byte-hex">{byteHex}</span>
						<span class="byte-bits">
							{#each byteToBits(byte) as bit}
								<span class="bit" class:bit-1={bit === 1}>{bit}</span>
							{/each}
						</span>
					</div>
				{/each}
			</div>

			<!-- Region legend -->
			<div class="region-legend">
				{#each Object.entries(regionLabels) as [key, label]}
					<span class="legend-item">
						<span class="legend-swatch" style="background:{regionColors[key]}"></span>
						{label}
					</span>
				{/each}
			</div>
		</section>

		<!-- Frame summary -->
		<section class="panel summary-panel">
			<h2>FRAME SUMMARY</h2>
			<div class="fields">
				<div class="field">
					<span class="field-name">Downlink Format</span>
					<span class="field-value highlight-green">{dfLabel(result.df)}</span>
				</div>
				{#if result.icao}
					<div class="field">
						<span class="field-name">ICAO Address</span>
						<span class="field-value mono">{result.icao}</span>
					</div>
				{/if}
				<div class="field">
					<span class="field-name">CRC / PI</span>
					<span class="field-value" class:highlight-green={result.crcOk} class:highlight-red={!result.crcOk}>
						{result.crcOk ? '✓ VALID' : '✗ INVALID'} (0x{result.crc.toString(16).padStart(6, '0').toUpperCase()})
					</span>
				</div>
				{#if result.capability !== undefined}
					<div class="field">
						<span class="field-name">CA / CF</span>
						<span class="field-value">{result.capability}</span>
					</div>
				{/if}
				{#if result.flightStatus !== undefined}
					<div class="field">
						<span class="field-name">Flight Status (FS)</span>
						<span class="field-value">{result.flightStatus}</span>
					</div>
				{/if}
				{#if result.altitude !== undefined}
					<div class="field">
						<span class="field-name">Altitude</span>
						<span class="field-value highlight-amber">{result.altitude} {result.altUnit === AltitudeUnit.Meters ? 'm' : 'ft'}</span>
					</div>
				{/if}
				{#if result.squawk}
					<div class="field">
						<span class="field-name">Squawk</span>
						<span class="field-value mono highlight-amber">{result.squawk}</span>
					</div>
				{/if}
			</div>
		</section>

		<!-- ADS-B ME payload -->
		{#if result.adsb}
			{@const adsb = result.adsb}
			<section class="panel adsb-panel">
				<h2>ADS-B ME PAYLOAD <span class="tc-badge">TC={adsb.typeCode} ST={adsb.subType}</span></h2>

				<div class="me-bytes">
					{#each formatBytes(adsb.me) as { hex: mHex, byte }, i}
						<div class="me-byte">
							<span class="byte-hex">{mHex}</span>
							<span class="byte-bits">
								{#each byteToBits(byte) as bit}
									<span class="bit" class:bit-1={bit === 1}>{bit}</span>
								{/each}
							</span>
						</div>
					{/each}
				</div>
				<div class="me-bit-labels">
					<span>bits 0-7: TC={adsb.typeCode} ST={adsb.subType}</span>
					<span>bits 8-55: payload</span>
				</div>

				<div class="fields">
					<div class="field">
						<span class="field-name">Message Type</span>
						<span class="field-value highlight-green">{adsbTypeLabel(adsb.messageType)}</span>
					</div>

					<!-- Identification -->
					{#if adsb.identification}
						{@const id = adsb.identification}
						<div class="field">
							<span class="field-name">Callsign</span>
							<span class="field-value mono highlight-amber">{id.callsign}</span>
						</div>
						<div class="field">
							<span class="field-name">Emitter Category</span>
							<span class="field-value">{id.categoryLetter}{id.categoryNumber} (TC={adsb.typeCode}, EC={adsb.subType})</span>
						</div>
					{/if}

					<!-- Position -->
					{#if adsb.cprPosition}
						{@const cpr = adsb.cprPosition}
						<div class="field">
							<span class="field-name">CPR Format</span>
							<span class="field-value">{cprFormatLabel(cpr.format)}</span>
						</div>
						<div class="field">
							<span class="field-name">CPR Latitude</span>
							<span class="field-value mono">{cpr.latCpr} (0x{cpr.latCpr.toString(16).padStart(5, '0').toUpperCase()})</span>
						</div>
						<div class="field">
							<span class="field-name">CPR Longitude</span>
							<span class="field-value mono">{cpr.lonCpr} (0x{cpr.lonCpr.toString(16).padStart(5, '0').toUpperCase()})</span>
						</div>
						{#if adsb.altitude !== undefined}
							<div class="field">
								<span class="field-name">Altitude</span>
								<span class="field-value highlight-amber">{adsb.altitude} {adsb.altUnit === AltitudeUnit.Meters ? 'm' : 'ft'}</span>
							</div>
						{/if}
					{/if}

					<!-- Velocity -->
					{#if adsb.velocity}
						{@const vel = adsb.velocity}
						{#if vel.groundSpeed !== undefined}
							<div class="field">
								<span class="field-name">Ground Speed</span>
								<span class="field-value highlight-amber">{vel.groundSpeed} kt</span>
							</div>
						{/if}
						{#if vel.trackValid && vel.track !== undefined}
							<div class="field">
								<span class="field-name">Track</span>
								<span class="field-value highlight-amber">{vel.track.toFixed(1)}°</span>
							</div>
						{/if}
						{#if vel.airspeed !== undefined}
							<div class="field">
								<span class="field-name">Airspeed ({vel.airspeedType})</span>
								<span class="field-value highlight-amber">{vel.airspeed} kt</span>
							</div>
						{/if}
						{#if vel.headingValid && vel.heading !== undefined}
							<div class="field">
								<span class="field-name">Heading</span>
								<span class="field-value highlight-amber">{vel.heading.toFixed(1)}°</span>
							</div>
						{/if}
						{#if vel.verticalRate !== undefined}
							<div class="field">
								<span class="field-name">Vertical Rate ({vel.verticalRateSource})</span>
								<span class="field-value" class:highlight-amber={vel.verticalRate !== 0}>
									{vel.verticalRate > 0 ? '+' : ''}{vel.verticalRate} ft/min
								</span>
							</div>
						{/if}
						{#if vel.geomAltDiff !== undefined}
							<div class="field">
								<span class="field-name">Geom Alt Diff (GNSS-Baro)</span>
								<span class="field-value">{vel.geomAltDiff} ft {vel.geomAltDiffSign}</span>
							</div>
						{/if}
					{/if}

					<!-- Aircraft Status -->
					{#if adsb.emergencyState !== undefined}
						<div class="field">
							<span class="field-name">Emergency State</span>
							<span class="field-value" class:highlight-red={adsb.emergencyState > 0}>{adsb.emergencyState}</span>
						</div>
					{/if}
					{#if adsb.squawkFromStatus}
						<div class="field">
							<span class="field-name">Squawk (from status)</span>
							<span class="field-value mono highlight-amber">{adsb.squawkFromStatus}</span>
						</div>
					{/if}

					<!-- Operational Status -->
					{#if adsb.operationalStatus}
						{@const ops = adsb.operationalStatus}
						<div class="field">
							<span class="field-name">ADS-B Version</span>
							<span class="field-value">{ops.version}</span>
						</div>
						{#if ops.nacPos !== undefined}
							<div class="field">
								<span class="field-name">NACp (Position Accuracy)</span>
								<span class="field-value">{ops.nacPos}</span>
							</div>
						{/if}
						{#if ops.sil !== undefined}
							<div class="field">
								<span class="field-name">SIL (Source Integrity)</span>
								<span class="field-value">{ops.sil}</span>
							</div>
						{/if}
						{#if ops.hrd !== undefined}
							<div class="field">
								<span class="field-name">HRD (Heading Ref)</span>
								<span class="field-value">{ops.hrd === 0 ? 'Magnetic North' : 'True North'}</span>
							</div>
						{/if}
					{/if}
				</div>
			</section>
		{/if}

		<!-- Comm-B -->
		{#if result.commB}
			{@const cb = result.commB}
			<section class="panel commb-panel">
				<h2>COMM-B MB PAYLOAD</h2>
				<div class="fields">
					<div class="field">
						<span class="field-name">BDS Register</span>
						<span class="field-value mono">{cb.bdsRegister}</span>
					</div>
					{#if cb.decoded}
						{#each Object.entries(cb.decoded) as [k, v]}
							{#if v !== null && v !== undefined}
								<div class="field">
									<span class="field-name">{k}</span>
									<span class="field-value">{v}</span>
								</div>
							{/if}
						{/each}
					{/if}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		background: #0d0d0d;
		color: #c8c8c8;
		font-family: 'Courier New', Courier, monospace;
		font-size: 13px;
	}

	.inspector {
		max-width: 1100px;
		margin: 0 auto;
		padding: 16px;
	}

	.page-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		border-bottom: 1px solid #2a2a2a;
		padding-bottom: 10px;
		margin-bottom: 16px;
	}

	.page-header h1 {
		margin: 0;
		font-size: 16px;
		letter-spacing: 4px;
		color: #4caf50;
	}

	nav {
		display: flex;
		gap: 16px;
	}

	nav a {
		color: #888;
		text-decoration: none;
		letter-spacing: 2px;
		font-size: 11px;
	}

	nav a.active,
	nav a:hover {
		color: #4caf50;
	}

	/* Input section */
	.input-section {
		background: #111;
		border: 1px solid #222;
		padding: 12px;
		margin-bottom: 12px;
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	label {
		color: #666;
		font-size: 10px;
		letter-spacing: 2px;
		white-space: nowrap;
	}

	input[type='text'] {
		flex: 1;
		background: #0d0d0d;
		border: 1px solid #333;
		color: #4caf50;
		font-family: inherit;
		font-size: 13px;
		padding: 6px 10px;
		outline: none;
		letter-spacing: 1px;
	}

	input[type='text']:focus {
		border-color: #4caf50;
	}

	button {
		background: #1a2a1a;
		border: 1px solid #3a5a3a;
		color: #4caf50;
		font-family: inherit;
		font-size: 11px;
		padding: 6px 14px;
		cursor: pointer;
		letter-spacing: 2px;
	}

	button:hover {
		background: #2a3a2a;
	}

	.samples {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		flex-wrap: wrap;
	}

	.samples-label {
		color: #444;
		font-size: 10px;
		letter-spacing: 2px;
	}

	.sample-btn {
		background: #111;
		border-color: #2a2a2a;
		color: #888;
		font-size: 10px;
		padding: 3px 8px;
		letter-spacing: 1px;
	}

	.sample-btn:hover {
		color: #ffa726;
		border-color: #5a4520;
	}

	/* Error */
	.error-panel {
		background: #2a0a0a;
		border: 1px solid #5a1a1a;
		color: #ff5252;
		padding: 8px 12px;
		margin-bottom: 12px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.error-icon {
		font-weight: bold;
		color: #ff5252;
	}

	/* Panels */
	.panel {
		background: #111;
		border: 1px solid #222;
		padding: 12px;
		margin-bottom: 12px;
	}

	.panel h2 {
		margin: 0 0 12px 0;
		font-size: 11px;
		letter-spacing: 3px;
		color: #666;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.byte-count,
	.tc-badge {
		font-size: 10px;
		color: #444;
		letter-spacing: 1px;
	}

	/* Byte map */
	.byte-map {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 8px;
	}

	.byte-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 4px 6px;
		border: 1px solid #1e1e1e;
		min-width: 50px;
		cursor: default;
	}

	.byte-cell:hover {
		border-color: #4caf50;
	}

	.byte-addr {
		font-size: 9px;
		color: #444;
	}

	.byte-hex {
		font-size: 13px;
		color: #c8c8c8;
		font-weight: bold;
	}

	.byte-bits {
		display: flex;
		gap: 1px;
		margin-top: 2px;
	}

	.bit {
		font-size: 9px;
		color: #2a4a2a;
		width: 7px;
		text-align: center;
	}

	.bit.bit-1 {
		color: #4caf50;
	}

	.region-legend {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		color: #555;
	}

	.legend-swatch {
		width: 12px;
		height: 12px;
		display: inline-block;
		border: 1px solid #333;
	}

	/* ME bytes */
	.me-bytes {
		display: flex;
		gap: 4px;
		margin-bottom: 4px;
	}

	.me-byte {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3px 5px;
		border: 1px solid #2a2a4a;
		background: #0f0f1a;
	}

	.me-bit-labels {
		display: flex;
		justify-content: space-between;
		font-size: 9px;
		color: #333;
		margin-bottom: 10px;
	}

	/* Fields */
	.fields {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0;
	}

	.field {
		display: grid;
		grid-template-columns: 220px 1fr;
		padding: 4px 0;
		border-bottom: 1px solid #161616;
	}

	.field:last-child {
		border-bottom: none;
	}

	.field-name {
		color: #555;
		font-size: 11px;
		letter-spacing: 1px;
		align-self: center;
	}

	.field-value {
		color: #c8c8c8;
		font-size: 12px;
	}

	.field-value.mono {
		font-family: 'Courier New', monospace;
		letter-spacing: 2px;
	}

	.highlight-green {
		color: #4caf50;
	}

	.highlight-amber {
		color: #ffa726;
	}

	.highlight-red {
		color: #ff5252;
	}
</style>
