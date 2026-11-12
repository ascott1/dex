<script module lang="ts">
  // Line icons (§8 "Icons"): 16×16 viewBox, 1px stroke, square caps, no fill, currentColor.
  export type IconName = 'overview' | 'fullscreen' | 'settings';
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    size?: number;
  }

  let { name, size = 13 }: Props = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1"
  stroke-linecap="square"
  aria-hidden="true"
>
  {#if name === 'overview'}
    <!-- A square divided 3×3 -->
    <rect x="1.5" y="1.5" width="13" height="13" />
    <path d="M5.83 1.5v13M10.17 1.5v13M1.5 5.83h13M1.5 10.17h13" />
  {:else if name === 'fullscreen'}
    <!-- Four corner brackets -->
    <path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" />
  {:else if name === 'settings'}
    <!-- Two horizontal lines, each with a small square knob -->
    <path d="M1.5 4.5h13M1.5 11.5h13" />
    <rect x="4" y="3" width="3" height="3" fill="var(--bg)" />
    <rect x="9" y="10" width="3" height="3" fill="var(--bg)" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }

  .icon :global(*) {
    vector-effect: non-scaling-stroke;
  }
</style>
