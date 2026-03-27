<script lang="ts">
	import { page } from '$app/stores';
	let { children } = $props();
</script>

<svelte:head>
	<meta name="theme-color" content="#0d0d0d" />
</svelte:head>

<div class="app">
	{@render children()}
</div>

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: #0d0d0d;
		color: #c8c8c8;
		font-family: 'Courier New', Courier, monospace;
		font-size: 13px;
		overflow: hidden;
	}

	:global(a) {
		color: inherit;
		text-decoration: none;
	}

	:global(button) {
		cursor: pointer;
		font-family: inherit;
	}

	:global(input, select) {
		font-family: inherit;
	}

	:global(::-webkit-scrollbar) {
		width: 4px;
		height: 4px;
	}
	:global(::-webkit-scrollbar-track) {
		background: #111;
	}
	:global(::-webkit-scrollbar-thumb) {
		background: #333;
	}

	.app {
		height: 100dvh;
		display: flex;
		flex-direction: column;
	}
</style>
