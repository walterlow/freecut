# `renderFrame` Decomposition Plan

A staged plan for decomposing `createCompositionRenderer`'s `renderFrame` method
in `src/features/export/utils/client-render-engine.ts`. This is the **highest-risk**
remaining work on the repo's #2 churn×complexity hotspot, and it touches the
export/preview render path where regressions are silent (wrong pixels, not crashes).

> **Do not attempt this without the app running for pixel verification.** Unlike
> the earlier extractions (cursor helpers, gesture router, GPU pipeline manager,
> occlusion predicate — all verbatim moves backed by lint + type-check + tests),
> the remaining `renderFrame` logic is stateful per-frame compositing that the
> automated suite does **not** exercise at the pixel level. Every phase below ends
> with a mandatory manual render check.

---

## 1. Current state (as of this plan)

Already extracted from the renderer and committed:

- `gpu-pipeline-manager.ts` — the WebGPU pipeline cluster (`GpuPipelineManager`).
- `frame-occlusion.ts` — `isItemFullyOccluding` pure predicate (+ 14 tests).

`client-render-engine.ts` is ~2,415 lines; `createCompositionRenderer` is the
outer factory and `renderFrame(frame)` is its per-frame method, **lines ~1223–2036
(~810 lines)**. The hotspot's `complexity_density` (~0.26) did **not** move from the
prior extractions because the removed code was low-complexity boilerplate — the
real complexity lives in `renderFrame`'s branching, which this plan targets.

## 2. Why `renderFrame` is hard: dual-scope closures

`renderFrame` defines **six nested functions, re-created on every call**, each
capturing a mix of two scopes:

| Nested helper (approx. region) | Captures (per-frame) | Captures (renderer-scope) |
|---|---|---|
| `hasGpuEffectsForItem` | — | `renderMode`, `getPreviewEffectsOverride` |
| `renderItemWithEffects` (largest) | `frame`, `activeMasks`, `contentCtx`, `useGpuCompositor` | `gpu`, `itemRenderContext`, `canvasPool`, `renderMode`, overrides, caches |
| `renderMasksToGpuTexture` | `activeMasks` | `gpu`, `canvasSettings`, `maskSettings` |
| `renderTransitionFallbackCanvas` | `frame`, `activeMasks` | `itemRenderContext`, `canvasPool` |
| `applyTrackScopedMasks` | `activeMasks` | `canvasPool`, `maskSettings` |
| `renderTask` | `frame`, `contentCtx`, `useGpuCompositor`, `occlusionCutoffOrder`, `renderTasks` | `gpu`, `itemRenderContext` |

The **per-frame** values (`frame`, `activeMasks`, `contentCtx`, `useGpuCompositor`,
`occlusionCutoffOrder`, `renderTasks`, transition state) are why these can't simply
move to module scope — they'd need ~10 params each, recreating the closure as an
argument list. Naive extraction trades a closure for a giant parameter object and
gains nothing.

## 3. Target architecture: a per-frame `FrameRenderPass`

Model one frame render as an object whose **fields are the per-frame state** and
whose **constructor takes the renderer-scope dependencies**. The nested helpers
become methods; `frame`/`activeMasks`/etc. become `this.*`.

```text
class FrameRenderPass {
  // renderer-scope deps (constructor)
  constructor(private deps: FrameRenderDeps) {}   // { gpu, itemRenderContext, canvasPool,
                                                  //   canvasSettings, maskSettings, renderMode,
                                                  //   renderPlan, sortedTracks, visibleTrackIds,
                                                  //   adjustmentLayers, getCurrentItem,
                                                  //   getCurrentKeyframes, overrides..., caches... }

  // per-frame state (set in run())
  private frame = 0
  private activeMasks: ActiveMask[] = []
  private useGpuCompositor = false
  private occlusionCutoffOrder: number | null = null
  ...

  async run(frame: number, ctx, canvas): Promise<void> { /* the body of renderFrame */ }

  private renderItemWithEffects(...) { ... }   // was nested
  private renderTask(...) { ... }              // was nested
  private renderMasksToGpuTexture(...) { ... } // was nested
  ...
}
```

`renderFrame` shrinks to: build/seed the pass deps once (can be cached on the
renderer since they're renderer-scoped), then `await pass.run(frame, ctx, canvas)`.

`FrameRenderDeps` is large but **stable** — assemble it once at renderer creation,
not per frame.

## 4. Phased, independently-verifiable steps

Each phase is a separate commit that compiles, passes lint + the existing export
suite, and is followed by the **manual render check (§5)**. Stop at any phase.

### Phase A — extract the leaf pure/near-pure helpers first (lowest risk)
These have the fewest captures and no cross-item state:
1. `hasGpuEffectsForItem` → pure `(item, getPreviewEffectsOverride?)` helper (it's a
   thin wrapper over `itemHasEnabledGpuEffect`; may not even need its own file).
2. `applyTrackScopedMasks` → `(result, trackOrder, skipMasks, { activeMasks,
   canvasPool, maskSettings })`. Pure transform over a `RenderedTaskResult`.
3. `renderMasksToGpuTexture` → `(masks, { gpu, canvasSettings, maskSettings })`.
   Returns `{ texture, view } | null`. Self-contained GPU upload.

Each is unit-testable with mocked deps (mirror `frame-occlusion.test.ts`). Land
them one commit at a time.

### Phase B — introduce `FrameRenderDeps` + the `FrameRenderPass` shell
4. Define `FrameRenderDeps` and assemble it **once** in `createCompositionRenderer`
   (after `itemRenderContext` is built). No behavior change yet — just the struct.
5. Create `FrameRenderPass` with `run()` containing a **verbatim copy** of the
   current `renderFrame` body, reading deps via `this.deps.*` and per-frame state
   via locals (not yet `this.*`). `renderFrame` becomes
   `new FrameRenderPass(deps).run(frame, ctx, canvas)` (or a cached instance).
   This is the riskiest single step — it's a large move. Diff it against the
   original body line-by-line before running.

### Phase C — convert nested helpers to methods
6. One at a time, lift `renderTransitionFallbackCanvas`, `renderTask`, and finally
   `renderItemWithEffects` (largest, do last) from closures inside `run()` to
   private methods, moving their per-frame captures to `this.*` fields set at the
   top of `run()`. **One helper per commit + render check** — `renderItemWithEffects`
   especially, since it drives the per-item effects/mask/blend path.

### Phase D — split `run()` into named phases
7. With state on `this`, carve `run()` into private phases that read/write `this.*`:
   `resolveFrameScene()` (masks + frameScene + transition state), `detectGpuNeeds()`,
   `wirePipelines()` (the `itemRenderContext.gpu* = gpu.*` assignments),
   `computeOcclusion()`, `executeRenderTasks()`, `composite()` (GPU vs Canvas2D
   path), `blitAndCache()`. Each is a mechanical cut; the win is readability and
   isolating the GPU-compositing branch from the Canvas2D branch.

## 5. Mandatory verification protocol (per phase)

Automated checks are necessary but **not sufficient** here.

- `npm run lint` (0/0) and `npm run test:run -- src/features/export/utils/
  src/features/preview/components/video-preview.sync.test.tsx
  src/features/preview/components/inline-composition-preview.test.tsx` (all green).
- **Manual, in `npm run dev`:**
  - Preview scrub across a project with: stacked tracks, a full-screen opaque clip
    over other tracks (verifies occlusion still hides covered tracks), a clip with
    GPU effects, a non-normal **blend mode**, an active **mask**, and a **transition**.
  - A real **export** of that project; diff the output against a pre-refactor export
    of the same project (same seed/frames). Spot-check transition frames, masked
    frames, and blend-mode frames.
  - Confirm no GPU device-loss / pipeline re-init regressions in the console.
- Keep a known-good reference export from `main` to compare against.

## 6. Risk register

- **Silent pixel regressions** — the dominant risk. Mitigation: §5 manual diff,
  one helper per commit, verbatim moves.
- **Per-frame vs renderer-scope confusion** — moving a per-frame value onto a
  field that isn't reset each `run()` causes stale-frame bugs. Mitigation: reset
  all per-frame `this.*` at the top of `run()`; keep renderer-scope in `deps`.
- **GPU resource lifetime** — texture pool acquire/release pairing must stay
  intact across the extraction (leaks or use-after-release). Mitigation: keep
  acquire+release within the same method; review `poolCanvases` bookkeeping.
- **Effect/mask/transition ordering** — z-order compositing and mask scoping are
  order-sensitive. Mitigation: don't reorder statements during moves.
- **Preview-only paths** — `scrubbingCache`, sub-comp refresh, and the many
  `renderMode === 'preview' ? … : undefined` branches must be preserved exactly.

## 7. Explicitly out of scope / do-not

- Do **not** change rendering algorithms, compositing order, or caching behavior
  while restructuring — this is a pure structural decomposition.
- Do **not** collapse the GPU-compositor and Canvas2D fallback paths into one;
  keep them as distinct methods.
- Do **not** attempt Phases B–D in a single commit or without the manual render
  check between them.

## 8. Expected outcome

- `renderFrame`/`FrameRenderPass.run()` drops from ~810 lines to a short
  orchestrator (~60–100 lines) calling named phase methods.
- The GPU-compositing branch becomes independently readable and testable.
- `client-render-engine.ts` likely drops below ~1,800 lines with the pass class in
  its own file (`frame-render-pass.ts`).
- The hotspot's `complexity_density` should finally drop (complexity is split
  across cohesive methods), and the per-helper unit tests from Phase A improve the
  coverage signal fallow currently flags.
