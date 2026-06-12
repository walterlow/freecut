# Color grading upgrade — status & remaining tasks

Working tree state as of 2026-06-12 (branch `develop`, uncommitted). All 8 planned
features are **implemented and unit-tested**; what remains is final verification,
manual smoke testing, and the commit.

## Done (implemented + tests green)

1. **Dedicated Color panel with implicit grade** — `ColorGradeSection`
   (`src/features/effects/components/color-grade-section.tsx`) shows wheels + curves
   always; first adjustment lazily creates the effect (live drags preview via the gizmo
   effects-preview path before the effect exists). Hosted by
   `properties-sidebar/color-grade-panel/` when the Color workspace is active; the
   color workspace preset now also defaults `propertiesFullColumn: true`.
2. **Copy/paste grade** — clip context menu (`GradeActions` in `item-context-menu.tsx`),
   ops in `src/features/timeline/utils/grade-clipboard-ops.ts` (+6 tests), clipboard in
   `src/shared/state/grade-clipboard.ts`. Paste = one undo step (`setItemEffects`).
3. **Grade bypass** — `colorGradeBypassed` flag in the gizmo store; filtered in
   `getPreviewEffectsOverride` (`use-preview-composition-model.ts`) so it is
   preview-only by construction (export never receives that hook). Pump/overlay
   subscriptions invalidate on toggle. UI button in the Color panel header.
4. **Adjustment layer quick action** — extracted `addAdjustmentLayer()` to
   `src/features/editor/utils/add-adjustment-layer.ts`; button in the Color panel.
5. **Multi-point curves via 1D LUT** — curves now bake combined channel∘master
   transfer functions into a 256×1 rgba8 texture (`buildGpuCurvesLutData` in
   `src/shared/utils/gpu-curves.ts`), sampled at `@binding(3)`. Panel rewritten for
   arbitrary points (click to add, double-click to remove, 16 max). Legacy 2-point
   params remain keyframable; `<channel>Points` JSON params take precedence.
   Pipeline gained generic `dataTexture` support (`effects-pipeline.ts`, cached per
   pass, contents rewritten in place via `writeTexture`).
6. **.cube LUT import** — parser/resampler/base64 in
   `src/infrastructure/gpu-effects/lut/cube-lut.ts` (11 tests); `gpu-lut` effect
   (`effects/lut.ts`, 3D texture, trilinear, intensity mix); `GpuLutPanel` import UI.
   LUT data is embedded in effect params (resampled ≤33³) so it reaches the export
   worker and travels inside project bundles.
7. **User grade presets** — `app/effect-presets.json` via workspace-fs
   (`effect-presets.ts` + storage barrel), `useUserPresetsStore`, save-as-preset in the
   Color panel, list/apply/delete in the Add Effect picker.
8. **Effect reordering** — up/down buttons on all effect panel headers
   (`EffectMoveButtons`), `setItemEffects` store mutation/action, one undo step.

i18n: all new strings added across all 9 languages (effects/timeline/editor partials).
Verification already passing: `tsc`, oxlint, oxfmt, full vitest (2695 tests),
boundaries, deps-contracts, legacy-lib, deps-wrapper-health, edge-budgets,
unused-exports, unused-class-members.

## Remaining tasks

1. **`npm run check:changed-health` gate fails** — fallow attributes
   4 introduced complexity + 4 introduced duplication findings to the new code
   (`Introduced: dead_code=0, complexity=4, duplication=4`). The script doesn't print
   per-finding detail; extract it with
   `npx fallow@2.89.0 audit --format json --quiet --base HEAD` and inspect the
   `attribution === 'introduced'` entries. Likely suspects: `effects-section.tsx`
   (grew), `color-grade-section.tsx` (handler shapes resemble effects-section),
   `gpu-curves-panel.tsx` (rewrite), `item-context-menu.tsx`. Either refactor the
   worst offenders (e.g. extract shared param-update helpers between
   effects-section and color-grade-section) or allowlist consciously.
2. **`npm run verify`** — full gate including `vp build`; run once after (1).
3. **Manual smoke test** (`npm run dev`): switch to Color workspace → select clip →
   drag a wheel with no effects applied (verify implicit creation + live preview),
   multi-point curve editing, bypass toggle during playback + that exports ignore
   bypass, import a .cube LUT (and re-open project / export with it), save + apply +
   delete a grade preset (verify `app/effect-presets.json` in the workspace folder),
   copy/paste grade via clip right-click, reorder effects, undo/redo across all of it.
4. **Minor polish**
   - `effects.curves.multiPointHint` uses `{{channel}}` interpolation in the panel but
     the locale strings have no placeholder (harmless; add `{{channel}}` if wanted).
   - Bypass inside sub-compositions falls back to a linear scan of compositions in
     `findCurrentItemEffects` — fine at current scale.
   - Consider a bypass hotkey (DaVinci uses Shift+D) and a scopes-header bypass button.
5. **CLAUDE.md** — consider documenting: `dataTexture` pipeline capability,
   the implicit-grade pattern, and that gpu-lut embeds LUT data in params.
6. **Changelog + commit** — feature-sized entry; conventional commits, e.g.
   `feat(effects): DaVinci-style color workspace grading suite`. PRs target `staging`.

## Key new/changed files (for review)

- `src/infrastructure/gpu-effects/`: `types.ts` (dataTexture spec, 'json' param type),
  `effects-pipeline.ts` (binding 3 + texture cache), `effects/color.ts` (curves LUT),
  `effects/lut.ts`, `lut/cube-lut.ts`, `registry.ts` (isColorGradeEffectType)
- `src/features/effects/`: `color-grade-section.tsx`, `panels/gpu-lut-panel.tsx`,
  `panels/gpu-curves-panel.tsx` (rewritten), `panels/effect-move-buttons.tsx`,
  `stores/user-presets-store.ts`, `effects-section.tsx` (reorder, user presets, LUT)
- `src/features/timeline/`: `utils/grade-clipboard-ops.ts`, `stores/items-store.ts`
  (`_setItemEffects`), `actions/effect-actions.ts` (`setItemEffects`),
  `timeline-item/item-context-menu.tsx` (GradeActions)
- `src/features/preview/`: `stores/gizmo-store.ts` (bypass flag),
  `hooks/use-preview-composition-model.ts` (bypass filter),
  `use-preview-render-pump-controller.ts` / `use-gpu-effects-overlay.ts` (invalidation)
- `src/features/editor/`: `properties-sidebar/color-grade-panel/`,
  `utils/add-adjustment-layer.ts`, `deps/effects-contract.ts`
- `src/shared/`: `utils/gpu-curves.ts` (multi-point + LUT bake),
  `state/grade-clipboard.ts`, `state/editor/store.ts` (propertiesFullColumn per
  workspace), `src/config/editor-workspaces.ts`
- `src/infrastructure/storage/workspace-fs/effect-presets.ts` + barrel export
- i18n: 27 locale partial files (effects/timeline/editor × 9 languages)
