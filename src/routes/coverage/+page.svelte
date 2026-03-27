<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { loadCoveragePoints, clearCoverage } from '$lib/recorder/coverage.js';
	import type { CoveragePoint } from '$lib/recorder/types.js';
	import type { Map as MapLibreMap } from 'maplibre-gl';

	let mapContainer: HTMLDivElement;
	let map: MapLibreMap | null = null;
	let points = $state<CoveragePoint[]>([]);
	let loading = $state(true);
	let count = $derived(points.length);

	const SRC = 'coverage';

	onMount(async () => {
		points = await loadCoveragePoints();
		loading = false;

		const ml = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');

		map = new ml.Map({
			container: mapContainer,
			style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
			center: [10, 51], zoom: 3,
			attributionControl: false,
		});
		map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
		map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right');

		map.on('load', () => {
			map!.addSource(SRC, {
				type: 'geojson',
				data: buildGeoJSON(points),
			});

			// Heatmap layer (visible at low zoom)
			map!.addLayer({
				id: 'coverage-heat',
				type: 'heatmap',
				source: SRC,
				maxzoom: 10,
				paint: {
					'heatmap-weight': 1,
					'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 10, 2],
					'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 10, 20],
					'heatmap-color': [
						'interpolate', ['linear'], ['heatmap-density'],
						0,    'rgba(0,0,0,0)',
						0.1,  'rgba(0,128,0,0.3)',
						0.3,  'rgba(50,180,50,0.5)',
						0.6,  'rgba(255,167,38,0.7)',
						0.9,  'rgba(255,82,82,0.85)',
						1.0,  '#fff',
					],
					'heatmap-opacity': 0.85,
				},
			});

			// Individual dots at high zoom
			map!.addLayer({
				id: 'coverage-dots',
				type: 'circle',
				source: SRC,
				minzoom: 8,
				paint: {
					'circle-radius': 2,
					'circle-color': '#4caf50',
					'circle-opacity': 0.5,
				},
			});
		});
	});

	onDestroy(() => map?.remove());

	function buildGeoJSON(pts: CoveragePoint[]) {
		return {
			type: 'FeatureCollection' as const,
			features: pts.map((p) => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
				properties: {},
			})),
		};
	}

	// Update map whenever points change
	$effect(() => {
		if (!map?.isStyleLoaded()) return;
		const src = map.getSource(SRC) as import('maplibre-gl').GeoJSONSource | undefined;
		src?.setData(buildGeoJSON(points));
	});

	async function handleClear() {
		if (!confirm('Delete all coverage data?')) return;
		await clearCoverage();
		points = [];
	}
</script>

<svelte:head><title>Coverage — ADS-B Workbench</title></svelte:head>

<div class="page">
	<header class="topbar">
		<span class="brand">ADS-B WORKBENCH</span>
		<nav>
			<a href="/">DASHBOARD</a>
			<a href="/inspector">INSPECTOR</a>
			<a href="/replay">REPLAY</a>
			<a href="/coverage" class="active">COVERAGE</a>
			<a href="/generator">GENERATOR</a>
		</nav>
		<div class="topbar-right">
			<span class="stat">{count.toLocaleString()} POSITIONS</span>
			<button class="clear-btn" onclick={handleClear}>CLEAR</button>
		</div>
	</header>

	<div class="map-wrap">
		<div bind:this={mapContainer} class="map"></div>

		{#if loading}
			<div class="overlay-msg">Loading coverage data…</div>
		{:else if count === 0}
			<div class="overlay-msg">
				No coverage data yet.<br/>
				<span class="hint">Positions accumulate automatically while the dashboard is connected.</span>
			</div>
		{/if}

		<!-- Legend -->
		<div class="legend">
			<div class="legend-title">SIGNAL DENSITY</div>
			<div class="legend-bar"></div>
			<div class="legend-labels">
				<span>LOW</span>
				<span>HIGH</span>
			</div>
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
	.topbar-right { display: flex; align-items: center; gap: 12px; }
	.stat { font-size: 10px; color: #ffa726; letter-spacing: 1px; }
	.clear-btn {
		background: #2a0a0a; border: 1px solid #5a1a1a; color: #ff5252;
		padding: 3px 10px; font-size: 9px; letter-spacing: 2px; font-family: inherit;
	}
	.clear-btn:hover { background: #3a1010; }

	.map-wrap { flex: 1; position: relative; overflow: hidden; }
	.map { position: absolute; inset: 0; }

	.overlay-msg {
		position: absolute; inset: 0; display: flex; flex-direction: column;
		align-items: center; justify-content: center;
		color: #444; font-size: 13px; letter-spacing: 1px; text-align: center;
		pointer-events: none;
	}
	.hint { font-size: 11px; color: #333; margin-top: 8px; }

	.legend {
		position: absolute; bottom: 32px; left: 12px;
		background: rgba(0,0,0,0.75); border: 1px solid #2a2a2a;
		padding: 8px 10px; min-width: 140px;
	}
	.legend-title { font-size: 9px; letter-spacing: 2px; color: #555; margin-bottom: 6px; }
	.legend-bar {
		height: 8px;
		background: linear-gradient(to right,
			rgba(0,128,0,0.3), rgba(50,180,50,0.5),
			rgba(255,167,38,0.7), rgba(255,82,82,0.85), #fff);
		border: 1px solid #333;
	}
	.legend-labels {
		display: flex; justify-content: space-between;
		font-size: 9px; color: #444; margin-top: 3px;
	}
</style>
