# FreeCut Web

## Commands

```bash
npm run dev          # Vite dev server on port 5173
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest (watch mode)
npm run test:run     # Vitest (single run)
npm run routes       # Regenerate TanStack Router tree (tsr generate)
```

## Architecture

Browser-based multi-track video editor. React 19 + TypeScript + Vite.

```text
src/
├── features/              # Self-contained feature modules
│   ├── editor/            # Editor shell, toolbar, panels, stores
│   ├── timeline/          # Multi-track timeline, actions, services
│   ├── preview/           # Preview canvas, transform gizmo, scrub renderer
│   ├── player/            # Playback engine (Clock, composition)
│   ├── composition-runtime/ # Composition rendering (sequences, items, audio, transitions)
│   ├── export/            # WebCodecs export pipeline (Web Worker)
│   ├── effects/           # GPU effect system
│   ├── keyframes/         # Keyframe animation, Bezier editor, easing
│   ├── media-library/     # Media import, metadata, OPFS proxies, transcription
│   ├── project-bundle/    # Project ZIP export/import
│   ├── projects/          # Project management
│   └── settings/          # App settings
├── domain/                # Framework-agnostic domain logic
│   └── timeline/          # Transitions (engine, registry, renderers), defaults
├── infrastructure/        # Browser/storage/GPU adapters
│   ├── gpu/               # Facades for gpu-effects, gpu-transitions, gpu-compositor
│   └── storage/           # IndexedDB persistence via idb
├── lib/                   # Core libraries (import via infrastructure/ facades)
│   ├── gpu-effects/       # WebGPU effect pipeline + shader definitions
│   ├── gpu-transitions/   # WebGPU transition pipeline + shaders
│   ├── gpu-compositor/    # WebGPU blend mode compositor
│   ├── gpu-scopes/        # WebGPU waveform/vectorscope renderers
│   ├── fonts/             # Font loading
│   ├── shapes/            # Shape path generators
│   └── migrations/        # Data migration system
├── shared/                # Shared UI/state/utilities across layers
│   ├── logging/           # Structured logger, frame jitter monitor
│   ├── state/             # Zustand stores (playback, editor, selection)
│   └── utils/             # Managed workers, media utilities
├── components/ui/         # shadcn/ui components
├── app/                   # App bootstrap, providers, debug utilities
├── routes/                # TanStack Router (file-based, auto-generated routeTree)
├── config/hotkeys.ts      # Keyboard shortcut definitions
└── types/                 # Shared TypeScript types
```

## Key Patterns

- **State**: Zustand stores + Zundo for undo/redo
- **Timeline store split**: `useTimelineStore` (from `timeline-store.ts`) is a **facade** over domain stores (`items-store`, `transitions-store`, `keyframes-store`, `markers-store`, `timeline-settings-store`, `timeline-command-store`). Components use the facade with selectors; action code accesses domain stores via `.getState()` directly
- **Timeline mutations**: Action modules in `features/timeline/stores/actions/*.ts` use `execute()` wrapper from `shared.ts` for undo/redo integration. Never mutate timeline stores directly — use these actions
- **Timeline item types**: `TimelineItem` is a discriminated union on `type`: `video | audio | text | image | shape | adjustment | composition` — GIFs use `image` type, no separate gif type. Types in `src/types/timeline.ts`
- **Item positioning**: Remotion convention — `from` (start frame in project FPS) + `durationInFrames`
- **Compositions**: Pre-compositions (sub-comps) have dedicated stores (`compositions-store.ts`, `composition-navigation-store.ts`). 1-level nesting only. Actions in `composition-actions.ts`
- **Migrations**: `lib/migrations/` — versioned migrations + normalization run on every project load. Increment `CURRENT_SCHEMA_VERSION` in `types.ts` when adding new migrations
- **Routing**: TanStack Router — run `npm run routes` after adding/changing route files
- **Path alias**: `@/*` → `src/*`
- **Styling**: Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Media processing**: Mediabunny for decode, WebCodecs for export, Web Workers for heavy ops
- **Storage**: IndexedDB via `idb` (see `lib/storage/`)

## Code Style

- Strict TypeScript (`noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`)
- `no-console` rule — always use `createLogger` from `src/shared/logging/logger.ts`, never raw `console.*` calls
- **Logging**: Use wide event pattern for multi-step operations (export, import, save): `log.startEvent(name, opId)` accumulates context, emits one structured event via `.success()` / `.failure()`. Use `createOperationId()` for correlation. Include business context (project ID, item counts, codec, resolution) in events
- `@typescript-eslint/no-explicit-any` warned

## Testing

- Vitest + jsdom + @testing-library/react
- `src/test/setup.ts` mocks ImageData, WebGPU APIs (`navigator.gpu`), and GPU constants
- Tests live next to source files: `*.test.ts` / `*.test.tsx`

## Environment

- `VITE_SHOW_DEBUG_PANEL=false` — set to hide debug panel in dev mode (shown by default)

## Git

- `main` — production, `develop` — active development
- PR target: `main`
- Commit messages: conventional commits — `type(scope): description` (e.g. `fix(timeline):`, `feat(export):`)

## Gotchas

- Track groups are 1-level only (no nested groups). Gate behavior (mute/visible/locked) propagates from group to children via `resolveEffectiveTrackStates()` in `group-utils.ts`
- Browser shortcut conflicts (e.g. Ctrl+E) need `eventListenerOptions: { capture: true }` on the hotkey to override Chrome's default behavior
- Feature modules use `index.ts` barrel files to define public API surface — follow this convention when adding new features
- `routeTree.gen.ts` is auto-generated — don't edit manually
- `*.mp4` files are gitignored
- Vite pre-bundles `lucide-react` to avoid analyzing 1500+ icons — don't remove from `optimizeDeps`
- WebGPU tests need mocks from `src/test/setup.ts` — tests will fail without jsdom environment
- Build uses manual chunk splitting — check `vite.config.ts` when adding large dependencies
- `HOTKEY_OPTIONS` has `preventDefault: true` — the library consumes keys before the callback. For panel-scoped shortcuts, use `onKeyDown` on the element with `tabIndex={-1}` + focus-on-hover + `stopPropagation()`, not global `useHotkeys` with guards
- `sourceStart`/`sourceEnd`/`sourceDuration` on timeline items are in **source-native FPS** frames, not project FPS. Use media's `fps` from media library store when converting to seconds
- Track `order` convention: lower value = visually higher (top of timeline). New tracks go at `minOrder - 1`. When creating pre-comps, place the comp item on the bottom-most (highest order) selected track; dissolve expands upward
- Group tracks (`isGroup: true`) are headers only — never place items on them. Filter them out when searching for candidate tracks
- Inline edit cancel (Escape) triggers blur on unmount — use a ref guard to prevent `onBlur` from committing the cancelled value
- `_splitItem()` returns `{ leftItem, rightItem } | null` — capture the return for correct IDs; the original item ID is stale after split
- Timeline has its own `keydown` listener in `timeline.tsx` — new keyboard handlers on child panels must `stopPropagation()` and timeline checks `e.defaultPrevented`
- **Effects are GPU-only** — all visual effects use WebGPU shaders (`type: 'gpu-effect'`). Legacy CSS filter, glitch, halftone, vignette, LUT types were removed in v6 migration. Effect definitions in `src/lib/gpu-effects/effects/`, pipeline in `effects-pipeline.ts`. Specialized UI panels exist for `gpu-curves` and `gpu-color-wheels`; all others use the generic `GpuEffectPanel`
- **Transitions are GPU-only** — all 13 transitions (fade, wipe, slide, flip, clockWipe, iris, dissolve, sparkles, glitch, lightLeak, pixelate, chromatic, radialBlur) render via WebGPU shaders in `lib/gpu-transitions/`. Each renderer in `domain/timeline/transitions/renderers/` has `gpuTransitionId` linking to its shader, plus a `renderCanvas()` Canvas 2D fallback for non-WebGPU environments. `calculateStyles()` is dead code (CSS/DOM transition rendering was removed). Canvas `drawImage` offsets must use `Math.round()` to avoid sub-pixel interpolation artifacts
- After clip edits that change position/duration, call `applyTransitionRepairs(changedClipIds)` from `shared.ts` — transitions auto-heal or report breakages
- `lib/logger.ts` uses only `function` declarations (no `class`/`const` at module scope) to avoid temporal dead zone errors in production chunk ordering — maintain this pattern
- Fast scrub render loop: prewarm frames use WASM decode (40-80ms) and block the loop from processing priority frames. During playback, skip prewarm entirely (`isPlaying` check) — priority frames render fast via DOM video zero-copy (~1ms) and the loop must stay responsive. Background worker preseek (`backgroundPreseek` in `decoder-prewarm.ts`) also fires on large timeline jumps (>3s) for all visible clips — the worker decodes off-thread and the render engine picks up the cached bitmap
- **Render loop concurrency** — `pumpRenderLoop` uses a single-mutex (`scrubRenderInFlightRef`) to prevent concurrent pump iterations during scrubbing. A `scrubRenderGenerationRef` counter is bumped ONLY on playback-start force-clear (not during scrub). The `finally` block releases the lock and triggers follow-up work only when the generation matches; stale pumps (from a superseded playback-start) leave the lock for the new owner. Never bump generation or force-clear the lock on sequential scrub frames — this causes unbounded concurrent pumps. The `data-transition-hold` attribute on DOM video elements coordinates with `video-content.tsx` premount logic and `clearTransitionPlaybackSession` cleanup
- **Transition participant video hold** — during transitions, the incoming clip's DOM video element is paused by `video-content.tsx` premount logic. The transition provider marks it with `data-transition-hold="1"` and calls `.play()` so the canvas renderer gets advancing frames. The mark is removed in `clearTransitionPlaybackSession`. Without this, the incoming clip shows a frozen frame during the transition
- When updating multiple GPU effect params atomically (e.g. color wheel hue + amount), use `onParamsBatchChange`/`onParamsBatchLiveChange` — calling `onParamChange` twice reads stale state on the second call and overwrites the first
- **Reuse rendered frames** — the preview scrub renderer already has fully composited frames with effects/masks/blend modes. Features needing the current frame (thumbnails, scopes, snapshots) should use `usePlaybackStore.getState().captureCanvasSource()` first, falling back to `renderSingleFrame()` only when the preview is unavailable. Never spin up a new render pipeline when an existing one already has the frame
- **Progressive downscaling** — when scaling high-res canvases to small sizes (e.g. 1920→320 thumbnails), halve dimensions repeatedly instead of one large jump. Single-step downscaling causes moire/aliasing with high-frequency GPU effects (halftone, pixelate, etc.)
- `StableVideoSequence`'s `areGroupPropsEqual` in `stable-video-sequence.tsx` whitelists item properties for React.memo comparison. When adding new visual properties to `TimelineItem`, add them to this comparison — missing properties cause stale renders during playback
- **GPU pipeline caching** — `EffectsPipeline.requestCachedDevice()` caches the WebGPU adapter + device globally. Subsequent `EffectsPipeline.create()` calls reuse the device (~50-100ms saved). The device-loss handler checks identity before clearing to avoid discarding a freshly acquired device. The preview component eagerly warms the GPU pipeline on mount (parallel with media resolution)
- **`__DEBUG__` API** — `window.__DEBUG__` (DEV-only, tree-shaken in prod) provides console debugging: `stores()`, `getTransitions()`, `getTransitionWindows()`, `getPlaybackState()`, `getTracks()`, `getMediaLibrary()`, `jitter()` (frame timing), `previewPerf()`, `transitionTrace()`, `prewarmCache()`, `filmstripMetrics()`, plus playback control (`seekTo`, `play`, `pause`). All use lazy `await import()` to avoid pulling in stores eagerly
- **Transition prearm covers all types** — the `forceFastScrubOverlay` subscription uses `getPlayingAnyTransitionPrewarmStartFrame` (not complex-only) so all transitions get their session pinned and DOM video elements playing before entry. Also checks `getTransitionWindowForFrame` for playback starting inside an active transition
- **Feature boundary rules** — features must not import from `@/lib/*` directly (use `@/infrastructure/` facades). Cross-feature imports must go through `deps/` adapter modules. The pre-push hook enforces both via `check:boundaries` and `check:legacy-lib-imports`
