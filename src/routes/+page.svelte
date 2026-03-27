<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		trackerState,
		applySBS,
		applyAircraftJson,
		selectAircraft,
		getSelected,
		setAdapterStatus,
		prune,
	} from '$lib/stores/tracker.svelte.js';
	import { JsonPoller } from '$lib/input/json-poller.js';
	import { WebSocketAdapter } from '$lib/input/websocket.js';
	import { DemoAdapter } from '$lib/input/demo.js';
	import { startRecording, stopRecording } from '$lib/recorder/recorder.js';
	import type { AdapterStatus, AircraftJson, SBSMessage } from '$lib/input/types.js';
	import type { Aircraft } from '$lib/tracker/types.js';
	import type { Map as MapLibreMap } from 'maplibre-gl';

	async function toggleRecording() {
		if (trackerState.recording) {
			await stopRecording();
		} else {
			await startRecording();
		}
	}

	// ── Connection form ─────────────────────────────────────────────────────
	type AdapterChoice = 'demo' | 'json-poll' | 'websocket';
	let adapterChoice = $state<AdapterChoice>('demo');
	let hostInput = $state('localhost');
	let portInput = $state(8080);

	// ── Adapter instances ───────────────────────────────────────────────────
	let currentAdapter: JsonPoller | WebSocketAdapter | DemoAdapter | null = null;

	const adapterCallbacks = {
		onSBS: (msg: SBSMessage) => applySBS(msg),
		onAircraftJson: (aircraft: AircraftJson[], serverNow: number) =>
			applyAircraftJson(aircraft, serverNow),
		onStatusChange: (status: AdapterStatus, error?: string) =>
			setAdapterStatus(status, error ?? undefined),
	};

	function connect() {
		disconnect();
		if (adapterChoice === 'demo') {
			currentAdapter = new DemoAdapter(adapterCallbacks);
		} else if (adapterChoice === 'json-poll') {
			currentAdapter = new JsonPoller({ host: hostInput, port: portInput }, adapterCallbacks);
		} else {
			const wsUrl = `ws://${hostInput}:${portInput}`;
			currentAdapter = new WebSocketAdapter({ url: wsUrl }, adapterCallbacks);
		}
		currentAdapter.start();
	}

	function disconnect() {
		currentAdapter?.stop();
		currentAdapter = null;
		setAdapterStatus('idle');
	}

	const isConnected = $derived(
		trackerState.adapterStatus === 'connected' || trackerState.adapterStatus === 'connecting'
	);

	// ── Prune stale aircraft every 30 s ────────────────────────────────────
	let pruneTimer: ReturnType<typeof setInterval> | null = null;

	// ── MapLibre ────────────────────────────────────────────────────────────
	let mapContainer: HTMLDivElement;
	let map: MapLibreMap | null = null;
	const MAP_SOURCE = 'aircraft';
	const MAP_LAYER_CIRCLE = 'aircraft-circle';
	const MAP_LAYER_LABEL = 'aircraft-label';

	onMount(async () => {
		pruneTimer = setInterval(prune, 30_000);

		// Dynamic import keeps MapLibre out of the SSR path
		const maplibre = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');

		map = new maplibre.Map({
			container: mapContainer,
			style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
			center: [10, 51],
			zoom: 4,
			attributionControl: false,
		});

		map.addControl(new maplibre.AttributionControl({ compact: true }), 'bottom-right');
		map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

		map.on('load', () => {
			map!.addSource(MAP_SOURCE, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});

			map!.addLayer({
				id: MAP_LAYER_CIRCLE,
				type: 'circle',
				source: MAP_SOURCE,
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 6],
					'circle-color': [
						'case',
						['==', ['get', 'selected'], true], '#ff9800',
						['==', ['get', 'onGround'], true], '#888888',
						'#4caf50',
					],
					'circle-stroke-width': [
						'case',
						['==', ['get', 'selected'], true], 2,
						1,
					],
					'circle-stroke-color': [
						'case',
						['==', ['get', 'selected'], true], '#ffffff',
						'#1a1a1a',
					],
					'circle-opacity': 0.9,
				},
			});

			map!.addLayer({
				id: MAP_LAYER_LABEL,
				type: 'symbol',
				source: MAP_SOURCE,
				minzoom: 5,
				layout: {
					'text-field': ['coalesce', ['get', 'callsign'], ['get', 'icao']],
					'text-font': ['Open Sans Regular'],
					'text-size': 10,
					'text-offset': [0, 1.2],
					'text-anchor': 'top',
					'text-allow-overlap': false,
				},
				paint: {
					'text-color': '#aaa',
					'text-halo-color': '#000',
					'text-halo-width': 1,
				},
			});

			// Click on aircraft dot
			map!.on('click', MAP_LAYER_CIRCLE, (e) => {
				const feat = e.features?.[0];
				if (feat?.properties?.icao) {
					selectAircraft(feat.properties.icao as string);
				}
			});

			map!.on('mouseenter', MAP_LAYER_CIRCLE, () => {
				map!.getCanvas().style.cursor = 'pointer';
			});
			map!.on('mouseleave', MAP_LAYER_CIRCLE, () => {
				map!.getCanvas().style.cursor = '';
			});
		});

		// Auto-start demo
		connect();
	});

	onDestroy(() => {
		disconnect();
		map?.remove();
		if (pruneTimer) clearInterval(pruneTimer);
	});

	// ── Update map GeoJSON whenever aircraft list changes ───────────────────
	$effect(() => {
		if (!map?.isStyleLoaded()) return;
		const features = trackerState.aircraft
			.filter((a) => a.lat !== undefined && a.lon !== undefined)
			.map((a) => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [a.lon!, a.lat!] },
				properties: {
					icao: a.icao,
					callsign: a.callsign ?? null,
					altitude: a.altBaro ?? null,
					track: a.track ?? null,
					onGround: (a.altBaro ?? 0) < 100 && a.groundSpeed !== undefined && a.groundSpeed < 30,
					selected: a.icao === trackerState.selectedIcao,
				},
			}));

		const source = map.getSource(MAP_SOURCE) as import('maplibre-gl').GeoJSONSource | undefined;
		source?.setData({ type: 'FeatureCollection', features });
	});

	// ── Helpers ─────────────────────────────────────────────────────────────
	function fmtAlt(a: Aircraft): string {
		if (a.altBaro === undefined) return '—';
		return (a.altBaro / 100).toFixed(0).padStart(3, '0') + 'FL';
	}

	function fmtSpeed(a: Aircraft): string {
		return a.groundSpeed !== undefined ? `${Math.round(a.groundSpeed)}kt` : '—';
	}

	function fmtTrack(a: Aircraft): string {
		return a.track !== undefined ? `${Math.round(a.track)}°` : '—';
	}

	function fmtAge(a: Aircraft): string {
		const secs = Math.round((Date.now() - a.lastSeen) / 1000);
		return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`;
	}

	function fmtCoord(n: number | undefined, digits = 4): string {
		return n !== undefined ? n.toFixed(digits) : '—';
	}

	function statusColor(s: AdapterStatus): string {
		switch (s) {
			case 'connected': return '#4caf50';
			case 'connecting': return '#ffa726';
			case 'error': return '#ff5252';
			default: return '#555';
		}
	}

	const selectedAc = $derived(getSelected());
</script>

<svelte:head>
	<title>ADS-B Workbench</title>
</svelte:head>

<div class="workbench">
	<!-- ── Top bar ── -->
	<header class="topbar">
		<span class="brand">ADS-B WORKBENCH</span>
		<nav class="nav">
			<a href="/" class="nav-link active">DASHBOARD</a>
			<a href="/inspector" class="nav-link">INSPECTOR</a>
			<a href="/replay" class="nav-link dim">REPLAY</a>
			<a href="/coverage" class="nav-link dim">COVERAGE</a>
			<a href="/generator" class="nav-link dim">GENERATOR</a>
		</nav>
		<div class="stats">
			<span class="stat">
				<span class="stat-val">{trackerState.aircraft.length}</span>
				<span class="stat-label">AC</span>
			</span>
			<span class="stat">
				<span class="stat-val">{trackerState.messageCount.toLocaleString()}</span>
				<span class="stat-label">MSG</span>
			</span>
			<button
				class="rec-btn"
				class:recording={trackerState.recording}
				onclick={toggleRecording}
				title={trackerState.recording ? 'Stop recording' : 'Start recording'}
			>
				{trackerState.recording ? '⏹ REC' : '⏺ REC'}
			</button>
			<span class="status-dot" style="background:{statusColor(trackerState.adapterStatus)}"
				title={trackerState.statusMessage}></span>
			<span class="status-text">{trackerState.statusMessage}</span>
		</div>
	</header>

	<!-- ── Main layout ── -->
	<div class="main">
		<!-- Left: connection + table -->
		<aside class="sidebar">
			<!-- Connection panel -->
			<div class="panel connect-panel">
				<div class="panel-title">SOURCE</div>
				<div class="connect-form">
					<div class="form-row">
						<select bind:value={adapterChoice} disabled={isConnected}>
							<option value="demo">Demo (offline)</option>
							<option value="json-poll">dump1090 JSON</option>
							<option value="websocket">WebSocket SBS</option>
						</select>
					</div>
					{#if adapterChoice !== 'demo'}
						<div class="form-row">
							<input
								type="text"
								bind:value={hostInput}
								placeholder="host"
								disabled={isConnected}
							/>
							<input
								type="number"
								bind:value={portInput}
								placeholder="port"
								disabled={isConnected}
								class="port-input"
							/>
						</div>
					{/if}
					<div class="form-row">
						{#if isConnected}
							<button class="btn-disconnect" onclick={disconnect}>DISCONNECT</button>
						{:else}
							<button class="btn-connect" onclick={connect}>CONNECT</button>
						{/if}
					</div>
				</div>
			</div>

			<!-- Aircraft table -->
			<div class="panel table-panel">
				<div class="panel-title">
					AIRCRAFT
					<span class="count">{trackerState.aircraft.length}</span>
				</div>
				<div class="table-scroll">
					<table>
						<thead>
							<tr>
								<th>ICAO</th>
								<th>CALLSIGN</th>
								<th>ALT</th>
								<th>SPD</th>
								<th>TRK</th>
								<th>AGE</th>
							</tr>
						</thead>
						<tbody>
							{#each trackerState.aircraft as ac (ac.icao)}
								<tr
									class:selected={ac.icao === trackerState.selectedIcao}
									onclick={() => selectAircraft(ac.icao === trackerState.selectedIcao ? null : ac.icao)}
								>
									<td class="mono green">{ac.icao}</td>
									<td class="mono amber">{ac.callsign ?? '—'}</td>
									<td class="mono">{fmtAlt(ac)}</td>
									<td class="mono">{fmtSpeed(ac)}</td>
									<td class="mono">{fmtTrack(ac)}</td>
									<td class="mono dim">{fmtAge(ac)}</td>
								</tr>
							{/each}
							{#if trackerState.aircraft.length === 0}
								<tr>
									<td colspan="6" class="empty">No aircraft</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		</aside>

		<!-- Centre: map -->
		<div class="map-wrap">
			<div bind:this={mapContainer} class="map"></div>
		</div>

		<!-- Right: detail panel -->
		{#if selectedAc}
			<aside class="detail-panel">
				<div class="panel-title">
					DETAIL
					<button class="close-btn" onclick={() => selectAircraft(null)}>✕</button>
				</div>
				<div class="detail-body">
					<div class="detail-icao">{selectedAc.icao}</div>
					{#if selectedAc.callsign}
						<div class="detail-callsign">{selectedAc.callsign}</div>
					{/if}

					<div class="detail-section">POSITION</div>
					<div class="detail-row">
						<span>Latitude</span>
						<span class="mono">{fmtCoord(selectedAc.lat)}</span>
					</div>
					<div class="detail-row">
						<span>Longitude</span>
						<span class="mono">{fmtCoord(selectedAc.lon)}</span>
					</div>
					<div class="detail-row">
						<span>Alt Baro</span>
						<span class="mono amber">
							{selectedAc.altBaro !== undefined ? `${selectedAc.altBaro} ft` : '—'}
						</span>
					</div>
					{#if selectedAc.altGeom !== undefined}
						<div class="detail-row">
							<span>Alt Geom</span>
							<span class="mono">{selectedAc.altGeom} ft</span>
						</div>
					{/if}

					<div class="detail-section">VELOCITY</div>
					<div class="detail-row">
						<span>Ground Speed</span>
						<span class="mono amber">{fmtSpeed(selectedAc)}</span>
					</div>
					<div class="detail-row">
						<span>Track</span>
						<span class="mono">{fmtTrack(selectedAc)}</span>
					</div>
					{#if selectedAc.verticalRate !== undefined}
						<div class="detail-row">
							<span>Vert Rate</span>
							<span class="mono" class:amber={selectedAc.verticalRate !== 0}>
								{selectedAc.verticalRate > 0 ? '+' : ''}{selectedAc.verticalRate} ft/min
							</span>
						</div>
					{/if}

					<div class="detail-section">IDENTITY</div>
					{#if selectedAc.squawk}
						<div class="detail-row">
							<span>Squawk</span>
							<span class="mono amber">{selectedAc.squawk}</span>
						</div>
					{/if}
					{#if selectedAc.categoryLetter}
						<div class="detail-row">
							<span>Category</span>
							<span class="mono">{selectedAc.categoryLetter}{selectedAc.categoryNumber}</span>
						</div>
					{/if}

					<div class="detail-section">METADATA</div>
					<div class="detail-row">
						<span>Messages</span>
						<span class="mono">{selectedAc.msgCount}</span>
					</div>
					<div class="detail-row">
						<span>Last seen</span>
						<span class="mono">{fmtAge(selectedAc)} ago</span>
					</div>
					{#if selectedAc.nacP !== undefined}
						<div class="detail-row">
							<span>NACp</span>
							<span class="mono">{selectedAc.nacP}</span>
						</div>
					{/if}
					{#if selectedAc.sil !== undefined}
						<div class="detail-row">
							<span>SIL</span>
							<span class="mono">{selectedAc.sil}</span>
						</div>
					{/if}
					{#if selectedAc.version !== undefined}
						<div class="detail-row">
							<span>ADS-B ver</span>
							<span class="mono">{selectedAc.version}</span>
						</div>
					{/if}

					<div class="detail-actions">
						<a href="/inspector" class="action-btn">INSPECT HEX</a>
					</div>
				</div>
			</aside>
		{/if}
	</div>
</div>

<style>
	.workbench {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ── Top bar ── */
	.topbar {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 0 12px;
		height: 36px;
		background: #0a0a0a;
		border-bottom: 1px solid #1e1e1e;
		flex-shrink: 0;
		z-index: 10;
	}

	.brand {
		font-size: 11px;
		letter-spacing: 4px;
		color: #4caf50;
		white-space: nowrap;
	}

	.nav {
		display: flex;
		gap: 16px;
		flex: 1;
	}

	.nav-link {
		font-size: 10px;
		letter-spacing: 2px;
		color: #888;
		white-space: nowrap;
	}

	.nav-link.active {
		color: #4caf50;
	}

	.nav-link.dim {
		color: #444;
	}

	.nav-link:hover {
		color: #c8c8c8;
	}

	.stats {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}

	.stat {
		display: flex;
		align-items: baseline;
		gap: 4px;
	}

	.stat-val {
		font-size: 13px;
		color: #ffa726;
	}

	.stat-label {
		font-size: 9px;
		color: #444;
		letter-spacing: 1px;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.rec-btn {
		background: #1a1a1a;
		border: 1px solid #333;
		color: #555;
		font-family: inherit;
		font-size: 9px;
		letter-spacing: 2px;
		padding: 3px 8px;
	}
	.rec-btn:hover { color: #c8c8c8; border-color: #555; }
	.rec-btn.recording { color: #ff5252; border-color: #5a2a2a; animation: blink 1s step-end infinite; }
	@keyframes blink { 50% { opacity: 0.5; } }

	.status-text {
		font-size: 10px;
		color: #555;
		letter-spacing: 1px;
	}

	/* ── Main layout ── */
	.main {
		flex: 1;
		display: flex;
		overflow: hidden;
	}

	/* ── Sidebar ── */
	.sidebar {
		width: 260px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-right: 1px solid #1a1a1a;
		overflow: hidden;
		background: #0d0d0d;
	}

	.panel {
		border-bottom: 1px solid #1a1a1a;
	}

	.panel-title {
		padding: 5px 10px;
		font-size: 9px;
		letter-spacing: 3px;
		color: #444;
		background: #0a0a0a;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.count {
		color: #ffa726;
	}

	/* ── Connect form ── */
	.connect-panel {
		flex-shrink: 0;
	}

	.connect-form {
		padding: 6px 8px 8px;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.form-row {
		display: flex;
		gap: 4px;
	}

	select,
	input[type='text'],
	input[type='number'] {
		flex: 1;
		background: #111;
		border: 1px solid #2a2a2a;
		color: #c8c8c8;
		padding: 4px 6px;
		font-size: 11px;
		outline: none;
	}

	select:focus,
	input:focus {
		border-color: #3a5a3a;
	}

	select:disabled,
	input:disabled {
		opacity: 0.4;
	}

	.port-input {
		width: 64px;
		flex: none;
	}

	.btn-connect,
	.btn-disconnect {
		flex: 1;
		border: 1px solid;
		padding: 5px;
		font-size: 10px;
		letter-spacing: 2px;
	}

	.btn-connect {
		background: #1a2a1a;
		border-color: #3a5a3a;
		color: #4caf50;
	}

	.btn-connect:hover {
		background: #2a3a2a;
	}

	.btn-disconnect {
		background: #2a1a1a;
		border-color: #5a2a2a;
		color: #ff5252;
	}

	.btn-disconnect:hover {
		background: #3a2020;
	}

	/* ── Aircraft table ── */
	.table-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.table-scroll {
		flex: 1;
		overflow-y: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 11px;
	}

	thead th {
		position: sticky;
		top: 0;
		background: #0a0a0a;
		padding: 3px 6px;
		text-align: left;
		font-size: 9px;
		letter-spacing: 1px;
		color: #444;
		border-bottom: 1px solid #1a1a1a;
		font-weight: normal;
	}

	tbody tr {
		border-bottom: 1px solid #141414;
		cursor: pointer;
	}

	tbody tr:hover {
		background: #161616;
	}

	tbody tr.selected {
		background: #1a2010;
	}

	tbody td {
		padding: 3px 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 80px;
	}

	.empty {
		text-align: center;
		color: #333;
		padding: 20px !important;
		font-size: 11px;
	}

	.mono { font-family: 'Courier New', monospace; }
	.green { color: #4caf50; }
	.amber { color: #ffa726; }
	.dim { color: #555; }

	/* ── Map ── */
	.map-wrap {
		flex: 1;
		position: relative;
		overflow: hidden;
	}

	.map {
		position: absolute;
		inset: 0;
	}

	/* ── Detail panel ── */
	.detail-panel {
		width: 220px;
		flex-shrink: 0;
		border-left: 1px solid #1a1a1a;
		background: #0d0d0d;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.detail-panel .panel-title {
		justify-content: space-between;
	}

	.close-btn {
		background: none;
		border: none;
		color: #444;
		font-size: 11px;
		padding: 0;
		line-height: 1;
	}

	.close-btn:hover {
		color: #c8c8c8;
	}

	.detail-body {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}

	.detail-icao {
		font-size: 18px;
		color: #4caf50;
		letter-spacing: 3px;
		margin-bottom: 2px;
	}

	.detail-callsign {
		font-size: 13px;
		color: #ffa726;
		letter-spacing: 2px;
		margin-bottom: 10px;
	}

	.detail-section {
		font-size: 9px;
		letter-spacing: 2px;
		color: #444;
		margin: 10px 0 4px;
		border-bottom: 1px solid #1a1a1a;
		padding-bottom: 2px;
	}

	.detail-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 2px 0;
		font-size: 11px;
	}

	.detail-row span:first-child {
		color: #555;
	}

	.detail-actions {
		margin-top: 16px;
	}

	.action-btn {
		display: block;
		text-align: center;
		background: #111;
		border: 1px solid #2a2a2a;
		color: #666;
		padding: 5px;
		font-size: 9px;
		letter-spacing: 2px;
	}

	.action-btn:hover {
		color: #4caf50;
		border-color: #3a5a3a;
	}
</style>
