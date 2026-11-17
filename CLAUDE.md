# dex

Markdown in, deck out. `PLAN.md` is the source of truth: §1–§8 are the spec, §9 is the build order (one phase per session), §11 logs deviations. Read it before changing anything.

## Ground rules (copied from PLAN.md §3)

1. Do only your phase. Later phases have stubs waiting for them; leave other phases' stubs alone.
2. Add no dependency that is not in §2. If you believe one is needed, stop and record why in §11.
3. Several of these libraries are newer than most training data (Vite 8, Vitest 5, Shiki 4, TypeScript 6, Svelte 5.57). Before using an API you have not seen verified in §2, read its types or README in `node_modules`. Do not code from memory.
4. Svelte 5 runes only: `$state`, `$derived`, `$effect`, `$props`, `onclick={...}`, `{@render}`, `mount()`. Never `export let`, `on:click`, `$:`, `<slot>`, or `svelte/store`. Shared state lives in `src/state/*.svelte.ts` as an exported `const` object created with `$state({...})`; mutate its properties, never reassign the export.
5. Slide content is injected with `{@html}`, so component-scoped styles do not reach it. All slide and theme CSS goes in `src/styles/*.css`. Component `<style>` blocks are for chrome components only.
6. Every color, font, and duration comes from a token in `tokens.css`. No hex values anywhere else. No `border-radius`. No `box-shadow` except on sticky notes. No fonts other than DM Sans and DM Mono.
7. Inside the stage, sizes are logical pixels on the 1600×900 canvas. Never use `vw`, `vh`, or `rem` inside `.stage`. Chrome (bars, sheets) uses real CSS pixels.
8. `shared/types.ts` is the contract between phases. If you must change it, update §5 in the same commit and note it in §11.
9. Global key handling ignores events whose target is an `input`, `textarea`, `select`, or `contenteditable` element, except `Escape`.
10. Before saying a phase is done: `pnpm check`, `pnpm test`, and (from Phase 3 on) `pnpm test:e2e` all pass, and you have looked at the result in a browser or in screenshots. Report anything you could not verify.
11. Commit once per phase: `phase N: <summary>`.
12. If your environment offers them, load the `svelte5-best-practices` skill before writing Svelte, and `make-interfaces-feel-better` for Phases 4, 5, and 10.
13. Type checking is split in two. `tsconfig.json` covers browser code (`src/`, `shared/`) and has no Node types. `tsconfig.node.json` covers Node code (`engine/`, `e2e/`, `*.config.ts`, `shared/`). Code under `src/` must not import `node:*` or anything under `engine/`; the only code both sides share is `shared/`.

## Notes

- `docs/reference/` is gitignored and local only. Never commit anything from it.
- Node 22, pnpm 10. TypeScript stays on 6 (`svelte-check` 4.7 peer range).
- When asked to make an image or diagram for a deck, follow `docs/images.md` and check the result on its slide in both themes.
