<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		listSessions,
		loadSessionEvents,
		deleteSession,
		exportSession,
		importSession,
	} from '$lib/recorder/recorder.js';
	import { applyAircraftJson } from '$lib/stores/tracker.svelte.js';
	import { trackerState, selectAircraft } from '$lib/stores/tracker.svelte.js';
	import type { RecordedSession, SessionEvent } from '$lib/recorder/types.js';
	import type { Map as MapLibreMap } from 'maplibre-gl';

	// ── Sessions ────────────────────────────────────────────────────────────
	let sessions = $state<RecordedSession[]>([]);
	let loading = $state(true);

	onMount(async () => {
		sessions = await listSessions();
		loading = false;
	});

	async function handleDelete(id: string) {
		await deleteSession(id);
		sessions = await listSessions();
		if (activeSession?.id === id) {
			activeSession = null;
			events = [];
			stopPlayback();
		}
	}

	async function handleExport(id: string) {
		const blob = await exportSession(id);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `adsb-session-${id}.json`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	async function handleImport() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			await importSession(file);
			sessions = await listSessions();
		};
		input.click();
	}

	// ── Playback ────────────────────────────────────────────────────────────
	let activeSession = $state<RecordedSession | null>(null);
	let events = $state<SessionEvent[]>([]);
	let playbackPos = $state(0);      // ms from session start
	let playing = $state(false);
	let playbackSpeed = $state(1);
	let loadingSession = $state(false);

	const SPEEDS = [0.25, 0.5, 1, 2, 5, 10];

	let duration = $derived(
		events.length > 0 ? events[events.length - 1].t : 0
	);

	let currentFrame = $derived(() => {
		if (events.length === 0) return null;
		// Binary search for the last event with t <= playbackPos
		let lo = 0, hi = events.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (events[mid].t <= playbackPos) lo = mid;
			else hi = mid - 1;
		}
		return events[lo];
	});

	async function loadSession(session: RecordedSession) {
		stopPlayback();
		loadingSession = true;
		activeSession = session;
		events = await loadSessionEvents(session.id);
		playbackPos = 0;
		loadingSession = false;
		// Show first frame
		applyFrame(0);
	}

	function applyFrame(idx: number) {
		const ev = events[idx];
		if (ev) applyAircraftJson(ev.aircraft, (activeSession!.startedAt + ev.t) / 1000);
	}

	// Apply the frame closest to current playbackPos
	function applyCurrentFrame() {
		if (events.length === 0) return;
		let lo = 0, hi = events.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (events[mid].t <= playbackPos) lo = mid;
			else hi = mid - 1;
		}
		applyFrame(lo);
	}

	let playTimer: ReturnType<typeof setInterval> | null = null;
	const TICK_MS = 100;

	function startPlayback() {
		if (events.length === 0) return;
		if (playbackPos >= duration) playbackPos = 0;
		playing = true;
		playTimer = setInterval(() => {
			playbackPos = Math.min(playbackPos + TICK_MS * playbackSpeed, duration);
			applyCurrentFrame();
			if (playbackPos >= duration) stopPlayback();
		}, TICK_MS);
	}

	function stopPlayback() {
		playing = false;
		if (playTimer !== null) {
			clearInterval(playTimer);
			playTimer = null;
		}
	}

	function togglePlay() {
		if (playing) stopPlayback();
		else startPlayback();
	}

	function seek(e: Event) {
		const input = e.target as HTMLInputElement;
		playbackPos = Number(input.value);
		applyCurrentFrame();
	}

	onDestroy(() => stopPlayback());

	// ── Map ─────────────────────────────────────────────────────────────────
	let mapContainer: HTMLDivElement;
	let map: MapLibreMap | null = null;
	const SRC = 'aircraft';

	onMount(async () => {
		const ml = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');
		map = new ml.Map({
			container: mapContainer,
			style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
			center: [10, 51], zoom: 4,
			attributionControl: false,
		});
		map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
		map.on('load', () => {
			map!.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
			map!.addLayer({
				id: 'ac-circle', type: 'circle', source: SRC,
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 6],
					'circle-color': '#ffa726',
					'circle-stroke-width': 1,
					'circle-stroke-color': '#1a1a1a',
				},
			});
			map!.addLayer({
				id: 'ac-label', type: 'symbol', source: SRC, minzoom: 5,
				layout: {
					'text-field': ['coalesce', ['get', 'callsign'], ['get', 'icao']],
					'text-font': ['Open Sans Regular'],
					'text-size': 10,
					'text-offset': [0, 1.2],
					'text-anchor': 'top',
				},
				paint: { 'text-color': '#888', 'text-halo-color': '#000', 'text-halo-width': 1 },
			});
		});
	});

	onDestroy(() => map?.remove());

	$effect(() => {
		if (!map?.isStyleLoaded()) return;
		const features = trackerState.aircraft
			.filter((a) => a.lat !== undefined && a.lon !== undefined)
			.map((a) => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [a.lon!, a.lat!] },
				properties: { icao: a.icao, callsign: a.callsign ?? null },
			}));
		const src = map.getSource(SRC) as import('maplibre-gl').GeoJSONSource | undefined;
		src?.setData({ type: 'FeatureCollection', features });
	});

	// ── Formatting ──────────────────────────────────────────────────────────
	function fmtDuration(ms: number): string {
		const s = Math.floor(ms / 1000);
		const m = Math.floor(s / 60);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		if (m > 0) return `${m}m ${s % 60}s`;
		return `${s}s`;
	}

	function fmtDate(ms: number): string {
		return new Date(ms).toLocaleString();
	}
</script>

<svelte:head><title>Replay — ADS-B Workbench</title></svelte:head>

<div class="page">
	<header class="topbar">
		<span class="brand">ADS-B WORKBENCH</span>
		<nav>
			<a href="/">DASHBOARD</a>
			<a href="/inspector">INSPECTOR</a>
			<a href="/replay" class="active">REPLAY</a>
			<a href="/coverage">COVERAGE</a>
			<a href="/generator">GENERATOR</a>
		</nav>
	</header>

	<div class="body">
		<!-- Session list -->
		<aside class="sessions-panel">
			<div class="panel-head">
				SESSIONS
				<div class="head-actions">
					<button class="icon-btn" onclick={handleImport} title="Import session">↑</button>
				</div>
			</div>

			{#if loading}
				<div class="empty">Loading…</div>
			{:else if sessions.length === 0}
				<div class="empty">No saved sessions.<br/>Connect a source on the dashboard to record.</div>
			{:else}
				<div class="session-list">
					{#each sessions as s (s.id)}
						<div
							class="session-item"
							class:active={activeSession?.id === s.id}
							onclick={() => loadSession(s)}
						>
							<div class="s-name">{s.name}</div>
							<div class="s-meta">
								{fmtDate(s.startedAt)} · {fmtDuration((s.endedAt ?? s.startedAt) - s.startedAt)}
							</div>
							<div class="s-stats">
								{s.aircraftSeen} AC · {s.eventCount} events
							</div>
							<div class="s-actions" onclick={(e) => e.stopPropagation()}>
								<button class="icon-btn" onclick={() => handleExport(s.id)} title="Export">↓</button>
								<button class="icon-btn danger" onclick={() => handleDelete(s.id)} title="Delete">✕</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</aside>

		<!-- Player + map -->
		<div class="player-area">
			{#if activeSession}
				<!-- Transport controls -->
				<div class="transport">
					<div class="transport-left">
						<button class="play-btn" onclick={togglePlay} disabled={loadingSession}>
							{playing ? '⏸' : '▶'}
						</button>
						<button class="icon-btn" onclick={() => { playbackPos = 0; applyCurrentFrame(); }}>⏮</button>
						<span class="time-display">
							{fmtDuration(playbackPos)} / {fmtDuration(duration)}
						</span>
					</div>
					<div class="scrubber-wrap">
						<input
							type="range"
							min="0"
							max={duration}
							value={playbackPos}
							oninput={seek}
							class="scrubber"
						/>
					</div>
					<div class="transport-right">
						<span class="speed-label">SPEED</span>
						{#each SPEEDS as spd}
							<button
								class="speed-btn"
								class:active={playbackSpeed === spd}
								onclick={() => { playbackSpeed = spd; }}
							>{spd}×</button>
						{/each}
					</div>
				</div>

				<!-- Map -->
				<div class="map-wrap">
					<div bind:this={mapContainer} class="map"></div>
					<!-- Status overlay -->
					<div class="map-overlay">
						<span class="ov-label">T+{fmtDuration(playbackPos)}</span>
						<span class="ov-ac">{trackerState.aircraft.length} AC</span>
					</div>
				</div>

				<!-- Mini table -->
				<div class="mini-table-wrap">
					<table class="mini-table">
						<thead><tr>
							<th>ICAO</th><th>CALLSIGN</th><th>ALT</th><th>SPD</th>
						</tr></thead>
						<tbody>
							{#each trackerState.aircraft.slice(0, 20) as ac (ac.icao)}
								<tr>
									<td class="green mono">{ac.icao}</td>
									<td class="amber mono">{ac.callsign ?? '—'}</td>
									<td class="mono">{ac.altBaro !== undefined ? ac.altBaro + 'ft' : '—'}</td>
									<td class="mono">{ac.groundSpeed !== undefined ? Math.round(ac.groundSpeed) + 'kt' : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div class="no-session">
					{#if loadingSession}
						<span>Loading session…</span>
					{:else}
						<span>Select a session to replay</span>
					{/if}
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
	nav a.active { color: #ffa726; }
	nav a:hover { color: #c8c8c8; }

	.body { flex: 1; display: flex; overflow: hidden; }

	/* Sessions panel */
	.sessions-panel {
		width: 260px; flex-shrink: 0; border-right: 1px solid #1a1a1a;
		display: flex; flex-direction: column; overflow: hidden; background: #0d0d0d;
	}
	.panel-head {
		padding: 5px 10px; font-size: 9px; letter-spacing: 3px; color: #444;
		background: #0a0a0a; border-bottom: 1px solid #1a1a1a;
		display: flex; justify-content: space-between; align-items: center;
	}
	.head-actions { display: flex; gap: 4px; }
	.icon-btn {
		background: none; border: 1px solid #2a2a2a; color: #555;
		padding: 2px 6px; font-size: 10px;
	}
	.icon-btn:hover { color: #c8c8c8; border-color: #444; }
	.icon-btn.danger:hover { color: #ff5252; border-color: #5a2a2a; }
	.empty { padding: 20px; text-align: center; color: #333; font-size: 11px; line-height: 1.5; }

	.session-list { flex: 1; overflow-y: auto; }
	.session-item {
		padding: 8px 10px; border-bottom: 1px solid #141414;
		cursor: pointer; position: relative;
	}
	.session-item:hover { background: #141414; }
	.session-item.active { background: #1a2010; }
	.s-name { font-size: 11px; color: #c8c8c8; margin-bottom: 2px; }
	.s-meta { font-size: 10px; color: #555; margin-bottom: 2px; }
	.s-stats { font-size: 10px; color: #444; }
	.s-actions {
		position: absolute; top: 6px; right: 6px;
		display: flex; gap: 3px; opacity: 0;
	}
	.session-item:hover .s-actions { opacity: 1; }

	/* Player area */
	.player-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

	.no-session {
		flex: 1; display: flex; align-items: center; justify-content: center;
		color: #333; font-size: 12px; letter-spacing: 2px;
	}

	/* Transport bar */
	.transport {
		height: 44px; background: #0a0a0a; border-bottom: 1px solid #1a1a1a;
		display: flex; align-items: center; gap: 12px; padding: 0 12px; flex-shrink: 0;
	}
	.transport-left { display: flex; align-items: center; gap: 8px; }
	.play-btn {
		background: #1a2a1a; border: 1px solid #3a5a3a; color: #4caf50;
		width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
		font-size: 13px;
	}
	.play-btn:disabled { opacity: 0.4; }
	.time-display { font-size: 11px; color: #666; white-space: nowrap; letter-spacing: 1px; }
	.scrubber-wrap { flex: 1; }
	.scrubber { width: 100%; height: 3px; accent-color: #ffa726; }
	.transport-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
	.speed-label { font-size: 9px; color: #444; letter-spacing: 1px; margin-right: 4px; }
	.speed-btn {
		background: #111; border: 1px solid #222; color: #555;
		padding: 2px 6px; font-size: 10px;
	}
	.speed-btn.active { border-color: #ffa726; color: #ffa726; }
	.speed-btn:hover { color: #c8c8c8; }

	/* Map */
	.map-wrap { flex: 1; position: relative; overflow: hidden; }
	.map { position: absolute; inset: 0; }
	.map-overlay {
		position: absolute; top: 8px; left: 8px;
		background: rgba(0,0,0,0.7); border: 1px solid #2a2a2a;
		padding: 4px 8px; display: flex; gap: 12px; font-size: 11px;
	}
	.ov-label { color: #ffa726; letter-spacing: 1px; }
	.ov-ac { color: #4caf50; }

	/* Mini table */
	.mini-table-wrap {
		height: 140px; overflow-y: auto; border-top: 1px solid #1a1a1a;
		background: #0d0d0d; flex-shrink: 0;
	}
	.mini-table { width: 100%; border-collapse: collapse; font-size: 11px; }
	.mini-table th {
		position: sticky; top: 0; background: #0a0a0a; padding: 3px 8px;
		font-size: 9px; letter-spacing: 1px; color: #444; font-weight: normal;
		text-align: left; border-bottom: 1px solid #1a1a1a;
	}
	.mini-table td { padding: 2px 8px; border-bottom: 1px solid #111; }
	.mono { font-family: 'Courier New', monospace; }
	.green { color: #4caf50; }
	.amber { color: #ffa726; }
</style>
