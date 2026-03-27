<script lang="ts">
	import { parseHex } from '$lib/parser/index.js';
	import { buildIdent, buildPosition, buildVelocity } from '$lib/generator/builder.js';
	import type { ModeSMessage } from '$lib/parser/types.js';
	import { ADSBMessageType, AltitudeUnit, CPRFormat } from '$lib/parser/types.js';

	type MsgKind = 'ident' | 'position' | 'velocity';

	let kind = $state<MsgKind>('ident');

	// Shared
	let icao = $state('4840D6');

	// Ident fields
	let callsign = $state('KLM1023');
	let category = $state(4);        // TC: 1=D, 2=C, 3=B, 4=A
	let emitterCat = $state(0);      // EC: 0-7

	// Position fields
	let lat = $state(52.3216);
	let lon = $state(4.7892);
	let altFt = $state(38000);
	let oddFrame = $state(false);

	// Velocity fields
	let groundSpeed = $state(450);
	let trackDeg = $state(270);
	let verticalRate = $state(0);

	// Output
	let generated = $state('');
	let decoded = $state<ModeSMessage | null>(null);
	let decodeError = $state<string | null>(null);
	let copied = $state(false);

	function generate() {
		decodeError = null;
		try {
			if (kind === 'ident') {
				generated = buildIdent({ icao, callsign, category, emitterCategory: emitterCat });
			} else if (kind === 'position') {
				generated = buildPosition({ icao, lat, lon, altFt, odd: oddFrame });
			} else {
				generated = buildVelocity({ icao, groundSpeedKt: groundSpeed, trackDeg, verticalRateFpm: verticalRate });
			}
			decoded = parseHex(generated);
		} catch (e) {
			decodeError = e instanceof Error ? e.message : String(e);
			generated = '';
			decoded = null;
		}
	}

	async function copyHex() {
		if (!generated) return;
		await navigator.clipboard.writeText(generated);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	// Auto-generate on any input change
	$effect(() => {
		void kind; void icao; void callsign; void category; void emitterCat;
		void lat; void lon; void altFt; void oddFrame;
		void groundSpeed; void trackDeg; void verticalRate;
		generate();
	});

	function dfLabel(df: number): string {
		const m: Record<number, string> = { 17: 'DF17 — ADS-B Extended Squitter', 18: 'DF18 — TIS-B' };
		return m[df] ?? `DF${df}`;
	}

	function adsbTypeLabel(t: ADSBMessageType): string {
		const m: Record<ADSBMessageType, string> = {
			[ADSBMessageType.AircraftIdentification]: 'Aircraft Identification',
			[ADSBMessageType.SurfacePosition]: 'Surface Position',
			[ADSBMessageType.AirbornePositionBaro]: 'Airborne Position (Baro)',
			[ADSBMessageType.AirbornePositionGNSS]: 'Airborne Position (GNSS)',
			[ADSBMessageType.AirborneVelocity]: 'Airborne Velocity',
			[ADSBMessageType.AircraftStatus]: 'Aircraft Status',
			[ADSBMessageType.TargetStateAndStatus]: 'Target State',
			[ADSBMessageType.OperationalStatus]: 'Operational Status',
			[ADSBMessageType.Reserved]: 'Reserved',
			[ADSBMessageType.Unknown]: 'Unknown',
		};
		return m[t] ?? t;
	}

	function byteToBits(b: number): number[] {
		return [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >> i) & 1);
	}

	const catLetters: Record<number, string> = { 1: 'D', 2: 'C', 3: 'B', 4: 'A' };
</script>

<svelte:head><title>Generator — ADS-B Workbench</title></svelte:head>

<div class="page">
	<header class="topbar">
		<span class="brand">ADS-B WORKBENCH</span>
		<nav>
			<a href="/">DASHBOARD</a>
			<a href="/inspector">INSPECTOR</a>
			<a href="/replay">REPLAY</a>
			<a href="/coverage">COVERAGE</a>
			<a href="/generator" class="active">GENERATOR</a>
		</nav>
	</header>

	<div class="body">
		<!-- Builder form -->
		<div class="builder-panel">
			<div class="panel-head">FRAME BUILDER</div>

			<!-- Message type tabs -->
			<div class="tabs">
				<button class="tab" class:active={kind === 'ident'} onclick={() => (kind = 'ident')}>
					IDENT
				</button>
				<button class="tab" class:active={kind === 'position'} onclick={() => (kind = 'position')}>
					POSITION
				</button>
				<button class="tab" class:active={kind === 'velocity'} onclick={() => (kind = 'velocity')}>
					VELOCITY
				</button>
			</div>

			<div class="form">
				<!-- Shared: ICAO -->
				<div class="field-row">
					<label>ICAO (hex)</label>
					<input type="text" bind:value={icao} maxlength="6" class="mono" placeholder="4840D6" />
				</div>

				{#if kind === 'ident'}
					<div class="field-row">
						<label>Callsign</label>
						<input type="text" bind:value={callsign} maxlength="8" class="mono" placeholder="KLM1023" />
					</div>
					<div class="field-row">
						<label>Category (TC)</label>
						<select bind:value={category}>
							<option value={4}>4 — Set A (light/small/large/heavy)</option>
							<option value={3}>3 — Set B (glider/lighter-than-air/…)</option>
							<option value={2}>2 — Set C (surface vehicle/obstacle)</option>
							<option value={1}>1 — Set D (no category info)</option>
						</select>
					</div>
					<div class="field-row">
						<label>Emitter Cat (EC)</label>
						<input type="number" bind:value={emitterCat} min="0" max="7" />
						<span class="suffix">{catLetters[category] ?? '?'}{emitterCat}</span>
					</div>

				{:else if kind === 'position'}
					<div class="field-row">
						<label>Latitude (°)</label>
						<input type="number" bind:value={lat} step="0.0001" min="-90" max="90" />
					</div>
					<div class="field-row">
						<label>Longitude (°)</label>
						<input type="number" bind:value={lon} step="0.0001" min="-180" max="180" />
					</div>
					<div class="field-row">
						<label>Altitude (ft)</label>
						<input type="number" bind:value={altFt} step="25" min="-1000" max="50175" />
					</div>
					<div class="field-row">
						<label>CPR Frame</label>
						<select bind:value={oddFrame}>
							<option value={false}>Even (0)</option>
							<option value={true}>Odd (1)</option>
						</select>
					</div>
					<div class="hint-box">
						Position requires an even + odd pair for global CPR decode.
						Generate both frames and feed them to the inspector.
					</div>

				{:else}
					<div class="field-row">
						<label>Ground Speed (kt)</label>
						<input type="number" bind:value={groundSpeed} min="0" max="4094" />
					</div>
					<div class="field-row">
						<label>Track (°)</label>
						<input type="number" bind:value={trackDeg} step="0.1" min="0" max="359.9" />
					</div>
					<div class="field-row">
						<label>Vertical Rate (fpm)</label>
						<input type="number" bind:value={verticalRate} step="64" min="-32640" max="32640" />
					</div>
				{/if}
			</div>
		</div>

		<!-- Output panel -->
		<div class="output-panel">
			<!-- Generated hex -->
			<div class="panel-head">
				OUTPUT HEX
				{#if generated}
					<button class="copy-btn" onclick={copyHex}>
						{copied ? '✓ COPIED' : 'COPY'}
					</button>
				{/if}
			</div>

			{#if decodeError}
				<div class="error-box">{decodeError}</div>
			{:else if generated}
				<div class="hex-output">
					<div class="hex-string mono">{generated}</div>
					<!-- Byte map -->
					<div class="byte-map">
						{#each Array.from(parseHex(generated).raw) as byte, i}
							<div class="byte-cell" title={`Byte ${i}: 0x${byte.toString(16).padStart(2,'0').toUpperCase()}`}>
								<span class="b-addr">{i.toString(16).padStart(2,'0')}</span>
								<span class="b-hex mono">{byte.toString(16).padStart(2,'0').toUpperCase()}</span>
								<span class="b-bits">
									{#each byteToBits(byte) as bit}
										<span class="bit" class:on={bit === 1}>{bit}</span>
									{/each}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Decoded fields -->
			{#if decoded?.adsb}
				{@const a = decoded.adsb}
				<div class="panel-head" style="margin-top:1px">DECODED</div>
				<div class="decoded-fields">
					<div class="df-row">
						<span>Downlink Format</span>
						<span class="mono green">DF{decoded.df}</span>
					</div>
					<div class="df-row">
						<span>ICAO</span>
						<span class="mono green">{decoded.icao}</span>
					</div>
					<div class="df-row">
						<span>CRC</span>
						<span class:green={decoded.crcOk} class:red={!decoded.crcOk}>
							{decoded.crcOk ? '✓ VALID' : '✗ INVALID'}
						</span>
					</div>
					<div class="df-row">
						<span>Type</span>
						<span class="mono">{adsbTypeLabel(a.messageType)} (TC={a.typeCode})</span>
					</div>

					{#if a.identification}
						<div class="df-row"><span>Callsign</span><span class="mono amber">{a.identification.callsign}</span></div>
						<div class="df-row"><span>Category</span><span class="mono">{a.identification.categoryLetter}{a.identification.categoryNumber}</span></div>
					{/if}

					{#if a.cprPosition}
						<div class="df-row"><span>CPR Frame</span><span class="mono">{a.cprPosition.format === CPRFormat.Even ? 'Even' : 'Odd'}</span></div>
						<div class="df-row"><span>CPR Lat</span><span class="mono">{a.cprPosition.latCpr}</span></div>
						<div class="df-row"><span>CPR Lon</span><span class="mono">{a.cprPosition.lonCpr}</span></div>
					{/if}

					{#if a.altitude !== undefined}
						<div class="df-row"><span>Altitude</span><span class="mono amber">{a.altitude} ft</span></div>
					{/if}

					{#if a.velocity}
						{@const v = a.velocity}
						{#if v.groundSpeed !== undefined}
							<div class="df-row"><span>Ground Speed</span><span class="mono amber">{v.groundSpeed} kt</span></div>
						{/if}
						{#if v.trackValid && v.track !== undefined}
							<div class="df-row"><span>Track</span><span class="mono amber">{v.track.toFixed(1)}°</span></div>
						{/if}
						{#if v.verticalRate !== undefined}
							<div class="df-row"><span>Vert Rate</span><span class="mono">{v.verticalRate > 0 ? '+' : ''}{v.verticalRate} fpm</span></div>
						{/if}
					{/if}
				</div>

				<!-- Inspector link -->
				<div class="inspect-link">
					<a href="/inspector?hex={generated}" class="action-btn">OPEN IN INSPECTOR →</a>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	:global(body) { margin: 0; background: #0d0d0d; color: #c8c8c8; font-family: 'Courier New', monospace; font-size: 13px; }

	.page { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }

	.topbar {
		display: flex; align-items: center; gap: 24px; padding: 0 12px;
		height: 36px; background: #0a0a0a; border-bottom: 1px solid #1e1e1e; flex-shrink: 0;
	}
	.brand { font-size: 11px; letter-spacing: 4px; color: #4caf50; }
	nav { display: flex; gap: 16px; flex: 1; }
	nav a { font-size: 10px; letter-spacing: 2px; color: #555; }
	nav a.active { color: #4caf50; }
	nav a:hover { color: #c8c8c8; }

	.body { flex: 1; display: flex; overflow: hidden; gap: 1px; background: #1a1a1a; }

	/* Builder */
	.builder-panel {
		width: 320px; flex-shrink: 0; background: #0d0d0d;
		display: flex; flex-direction: column; overflow-y: auto;
	}

	.panel-head {
		padding: 5px 10px; font-size: 9px; letter-spacing: 3px; color: #444;
		background: #0a0a0a; border-bottom: 1px solid #1a1a1a;
		display: flex; justify-content: space-between; align-items: center;
		flex-shrink: 0;
	}

	.tabs { display: flex; border-bottom: 1px solid #1a1a1a; flex-shrink: 0; }
	.tab {
		flex: 1; padding: 7px; background: none; border: none; border-right: 1px solid #1a1a1a;
		color: #444; font-family: inherit; font-size: 10px; letter-spacing: 2px;
	}
	.tab:last-child { border-right: none; }
	.tab:hover { color: #888; background: #111; }
	.tab.active { color: #4caf50; background: #0f1f0f; border-bottom: 2px solid #4caf50; }

	.form { padding: 10px; display: flex; flex-direction: column; gap: 8px; }

	.field-row { display: flex; flex-direction: column; gap: 3px; }
	label { font-size: 9px; color: #444; letter-spacing: 2px; }

	input, select {
		background: #111; border: 1px solid #2a2a2a; color: #c8c8c8;
		padding: 5px 7px; font-size: 12px; font-family: inherit; outline: none; width: 100%;
	}
	input:focus, select:focus { border-color: #3a5a3a; }
	.mono { font-family: 'Courier New', monospace; letter-spacing: 1px; }
	.suffix { font-size: 11px; color: #ffa726; margin-top: 2px; }

	.hint-box {
		background: #111; border: 1px solid #1a2a1a; color: #556; padding: 7px 9px;
		font-size: 10px; line-height: 1.5;
	}

	/* Output */
	.output-panel { flex: 1; background: #0d0d0d; display: flex; flex-direction: column; overflow-y: auto; }

	.copy-btn {
		background: #1a2a1a; border: 1px solid #3a5a3a; color: #4caf50;
		padding: 2px 8px; font-size: 9px; font-family: inherit; letter-spacing: 1px;
	}
	.copy-btn:hover { background: #2a3a2a; }

	.error-box { padding: 10px; color: #ff5252; font-size: 11px; }

	.hex-output { padding: 10px; border-bottom: 1px solid #1a1a1a; }
	.hex-string {
		font-size: 14px; color: #4caf50; letter-spacing: 2px;
		word-break: break-all; margin-bottom: 10px;
	}

	.byte-map { display: flex; flex-wrap: wrap; gap: 4px; }
	.byte-cell {
		display: flex; flex-direction: column; align-items: center;
		padding: 3px 5px; background: #111; border: 1px solid #1e1e1e; min-width: 46px;
	}
	.b-addr { font-size: 9px; color: #333; }
	.b-hex { font-size: 12px; color: #c8c8c8; }
	.b-bits { display: flex; gap: 1px; margin-top: 2px; }
	.bit { font-size: 9px; color: #1e3a1e; width: 7px; text-align: center; }
	.bit.on { color: #4caf50; }

	.decoded-fields { padding: 8px 10px; }
	.df-row {
		display: flex; justify-content: space-between; align-items: baseline;
		padding: 3px 0; border-bottom: 1px solid #141414; font-size: 11px;
	}
	.df-row span:first-child { color: #555; }
	.green { color: #4caf50; }
	.amber { color: #ffa726; }
	.red { color: #ff5252; }

	.inspect-link { padding: 10px; }
	.action-btn {
		display: block; text-align: center; background: #111; border: 1px solid #2a2a2a;
		color: #666; padding: 6px; font-size: 9px; letter-spacing: 2px;
		font-family: inherit;
	}
	.action-btn:hover { color: #4caf50; border-color: #3a5a3a; }
</style>
