<script module lang="ts">
  // Layouts whose content is media, not text: auto-fit does not apply (§7).
  const NO_FIT = new Set(['figure', 'gallery', 'image', 'full']);
  // Overflow is logged once per version of a slide, not once per render.
  const warned = new Set<string>();

  // A relative url() inside a custom property (`--slide-bg: url("decks/…")`)
  // resolves against the stylesheet that uses the var(), which is assets/ in a
  // build. Make such URLs absolute against the page instead.
  function absoluteUrls(style: string | undefined): string | undefined {
    return style?.replace(/url\((["']?)([^"')]+)\1\)/g, (match, _quote: string, url: string) =>
      /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url) ? match : `url("${new URL(url, document.baseURI).href}")`,
    );
  }
</script>

<script lang="ts">
  import type { Slide, ThemeName } from '$shared/types';
  import { baseTheme, settings, slideTheme } from '../state/settings.svelte';

  interface Props {
    slide: Slide;
    /** Current build step; elements with a larger `data-step` are pending. */
    step?: number;
    /** Show every build step (thumbnails, print). */
    revealAll?: boolean;
    /** The visible slide: gets `.current`, plays autoplay videos. */
    current?: boolean;
    /** Override the slide's theme (defaults to the deck theme with invert/bg applied). */
    theme?: ThemeName;
  }

  let { slide, step = 0, revealAll = false, current = true, theme }: Props = $props();

  let el: HTMLElement;

  const resolvedTheme = $derived(theme ?? slideTheme(slide, baseTheme()));
  // `style` is applied as the element's style; every other key as an attribute.
  const attrs = $derived.by(() => {
    const { style: _style, ...rest } = slide.attrs;
    return rest;
  });

  // Builds: toggle `is-pending` after the HTML is in the DOM.
  $effect(() => {
    void slide.html;
    const limit = revealAll || !settings.builds ? Infinity : step;
    for (const node of el.querySelectorAll<HTMLElement>('[data-step]')) {
      node.classList.toggle('is-pending', Number(node.dataset.step) > limit);
    }
  });

  // Auto-fit: step the density down until `.s-main` fits (§7).
  function fit() {
    if (!el) return;
    el.removeAttribute('data-density');
    el.removeAttribute('data-overflow');
    if (NO_FIT.has(slide.layout)) return;
    const main = el.querySelector<HTMLElement>('.s-main');
    if (!main) return;
    const overflows = () => main.scrollHeight > main.clientHeight + 1;
    if (!overflows()) return;
    el.dataset.density = '1';
    if (!overflows()) return;
    el.dataset.density = '2';
    if (!overflows()) return;
    el.dataset.overflow = '';
    if (!warned.has(slide.hash)) {
      warned.add(slide.hash);
      console.warn(`dex: slide ${slide.index + 1} (${slide.id}) overflows at the smallest density`);
    }
  }

  $effect(() => {
    void slide.html;
    void slide.layout;
    void settings.textScale;
    let live = true;
    const run = () => {
      if (live) fit();
    };
    // Measure only once the fonts are in, and again as each image loads.
    void document.fonts.ready.then(run);
    el.addEventListener('load', run, true);
    return () => {
      live = false;
      el.removeEventListener('load', run, true);
    };
  });

  // Video: autoplay on show, pause on leave.
  $effect(() => {
    void slide.html;
    const videos = el.querySelectorAll<HTMLVideoElement>('video');
    if (current) {
      for (const video of videos) {
        if (!video.hasAttribute('data-autoplay')) continue;
        // `muted` set through {@html} does not always take effect.
        video.muted = video.hasAttribute('muted');
        void video.play().catch(() => {});
      }
    } else {
      for (const video of videos) if (!video.paused) video.pause();
    }
  });

  // In-slide `#…` links (footnotes) would replace the route hash.
  function onclick(event: MouseEvent) {
    const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
    if (link) event.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<section
  bind:this={el}
  class={['slide', slide.options.class, current && 'current']}
  data-layout={slide.layout}
  data-theme={resolvedTheme}
  data-id={slide.id}
  {...attrs}
  style={absoluteUrls(slide.attrs.style)}
  aria-roledescription="slide"
  aria-hidden={current ? undefined : 'true'}
  {onclick}
>
  {@html slide.html}
</section>
