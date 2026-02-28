# Architecture Boundaries

This document defines the target module boundaries for the FreeCut frontend.

## Target Layers

- `src/app`: bootstrap, router wiring, global providers
- `src/features`: user-facing vertical slices (timeline, editor, export, etc.)
- `src/domain`: framework-agnostic business logic and pure models
- `src/infrastructure`: storage, browser API adapters, workers, IO
- `src/shared`: reusable UI primitives and generic utilities

## Dependency Direction

- `app -> features | domain | infrastructure | shared`
- `features -> domain | infrastructure | shared`
- `infrastructure -> domain | shared`
- `domain -> shared`
- `shared -> (no app/features/routes dependencies)`

## Current Enforcement (Phase 1)

- `src/domain/**`: disallows app/feature/route/component and React framework imports
- `src/infrastructure/**`: disallows feature/route imports
- `src/shared/**`: disallows app/feature/route imports
- `src/features/effects/**`: disallows importing from `@/features/editor/**`
- `src/features/effects/**`: disallows importing from `@/features/timeline/**` and `@/features/preview/**` (except `effects/deps/*`)
- `src/features/timeline/**`: disallows importing from `@/features/editor/**`
- `src/features/timeline/**`: disallows importing from `@/features/preview/**`
- `src/features/timeline/**`: disallows importing from `@/features/media-library/**` (except `timeline/deps/*`)
- `src/features/timeline/**`: disallows importing from `@/features/keyframes/**` (except `timeline/deps/*`)
- `src/features/timeline/**`: disallows importing from `@/features/projects/**` (except `timeline/deps/*`)
- `src/features/timeline/**`: disallows importing from `@/features/composition-runtime/**`, `@/features/settings/**`, and `@/features/export/**` (except `timeline/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/timeline/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/media-library/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/preview/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/project-bundle/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/keyframes/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/projects/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/settings/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/effects/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/export/**` (except `editor/deps/*`)
- `src/features/editor/**`: disallows importing from `@/features/composition-runtime/**` (except `editor/deps/*`)
- `src/features/preview/**`: disallows importing from `@/features/timeline/**` (except `preview/deps/*`)
- `src/features/preview/**`: disallows importing from `@/features/media-library/**` (except `preview/deps/*`)
- `src/features/preview/**`: disallows importing from `@/features/player/**` (except `preview/deps/*`)
- `src/features/preview/**`: disallows importing from `@/features/export/**` (except `preview/deps/*`)
- `src/features/preview/**`: disallows importing from `@/features/keyframes/**` (except `preview/deps/*`)
- `src/features/preview/**`: disallows importing from `@/features/composition-runtime/**` (except `preview/deps/*`)
- `src/features/media-library/**`: disallows importing from `@/features/timeline/**` (except `media-library/deps/*`)
- `src/features/media-library/**`: disallows importing from `@/features/projects/**` (except `media-library/deps/*`)
- `src/features/export/**`: disallows importing from `@/features/media-library/**` (except `export/deps/*`)
- `src/features/export/**`: disallows importing from `@/features/composition-runtime/**`, `@/features/keyframes/**`, `@/features/timeline/**`, `@/features/projects/**`, and `@/features/player/**` (except `export/deps/*`)
- `src/features/keyframes/**`: disallows importing from `@/features/timeline/**`, `@/features/preview/**`, and `@/features/composition-runtime/**` (except `keyframes/deps/*`)
- `src/features/projects/**`: disallows importing from `@/features/settings/**` and `@/features/media-library/**` (except `projects/deps/*`)
- `src/features/project-bundle/**`: disallows importing from `@/features/media-library/**` (except `project-bundle/deps/*`)

## Migration Strategy

1. Keep existing behavior intact while surfacing boundary violations.
2. Move pure logic from feature modules into `domain`.
3. Move browser/storage adapters into `infrastructure`.
4. Keep routes thin and feature pages in `features/*/pages`.
5. Keep layer boundaries strict and avoid reintroducing legacy compatibility shims.

## Automated Checks

- Local: run `npm run check:boundaries` to detect direct cross-feature imports
  outside `deps/*` (both alias and relative-path imports).
- Local: run `npm run check:deps-contracts` to enforce that all cross-feature
  imports in `deps/*` live in `*-contract.ts` files (non-contract deps files
  must re-export from local contract modules).
- Local: run `npm run check:legacy-lib-imports` to enforce that `@/lib/*`
  imports are not used.
- Local: run `npm run check:deps-wrapper-health` to fail when pass-through
  compatibility wrappers in `deps/*` have no importers (dead adapter layer).
- Local: run `npm run report:deps-wrapper-health:json` for machine-readable
  wrapper/importer health output.
- Local: run `npm run report:feature-edges` to view the current dependency
  matrix split by direct imports vs. `deps/*` adapter imports.
- Local: run `npm run report:feature-edges:json` for machine-readable output.
- Local: run `npm run check:edge-budgets` to enforce adapter coupling budgets
  on key seams:
  - `editor -> timeline` (max `2` imports across `2` files)
  - `editor -> preview` (max `8` imports across `2` files)
  - `editor -> media-library` (max `8` imports across `2` files)
  - `preview -> timeline` (max `2` imports across `2` files)
  - `preview -> player` (max `2` imports across `2` files)
  - `timeline -> media-library` (max `2` imports across `2` files)
  - `media-library -> timeline` (max `2` imports across `2` files)
  - `composition-runtime -> player` (max `8` imports across `2` files)
- Local: run `npm run check:bundle-budgets` after a production build to
  enforce JavaScript chunk size limits for key runtime/vendor/media bundles.
- CI: `.github/workflows/ci.yml` runs boundary checks (including deps contract
  seam checks), legacy-lib import checks, deps-wrapper health checks, lint,
  build, and bundle budget checks on pull requests and pushes to `main`,
  enforces edge budgets, and publishes
  `feature-edges-report.json` + `deps-wrapper-health-report.json` as workflow
  artifacts.

## Granularity Guardrails

- Keep one `deps/<feature>.ts` adapter per feature edge by default.
- Split an adapter only when there are distinct consumer groups that change independently (for example store APIs vs UI-only helpers) and the split has at least two downstream consumers.
- Avoid one-export micro-adapters unless they are enforcing a strict budgeted seam (`check:edge-budgets` monitored edges).
- `*-contract.ts` files are the internal seam bindings; non-contract `deps/*`
  files may remain as compatibility re-exports during migration, but should not
  accumulate feature logic.

## Composition Runtime Boundary

- `src/features/composition-runtime/deps/*` is the only allowed cross-feature integration point for composition runtime.
- Files in `composition-runtime` (outside `deps/*`) must not import other feature modules directly.

## Preview Timeline Boundary

- `src/features/preview/deps/timeline.ts` is the only allowed integration point
  for preview modules that depend on timeline stores/utils/actions.
- Files in `preview` (outside `deps/*`) must not import timeline modules directly.
- `src/features/preview/deps/timeline-contract.ts` is the internal seam binding;
  timeline adapter files re-export from this contract.
- Preferred granular adapters:
  - `src/features/preview/deps/timeline-store.ts`
  - `src/features/preview/deps/timeline-edit-preview.ts`
  - `src/features/preview/deps/timeline-utils.ts`
  - `src/features/preview/deps/timeline-source-edit.ts`

## Preview Media-Library Boundary

- `src/features/preview/deps/media-library.ts` is the only allowed integration
  point for preview modules that depend on media-library stores/services/utils.
- Files in `preview` (outside `deps/*`) must not import media-library modules
  directly.

## Preview Player Boundary

- `src/features/preview/deps/player.ts` is the only allowed integration point
  for preview modules that depend on player components/hooks/services.
- Files in `preview` (outside `deps/*`) must not import player modules directly.
- `src/features/preview/deps/player-contract.ts` is the internal seam binding;
  player adapter files re-export from this contract.
- Preferred granular adapters:
  - `src/features/preview/deps/player-core.ts`
  - `src/features/preview/deps/player-context.ts`
  - `src/features/preview/deps/player-pool.ts`

## Preview Export Boundary

- `src/features/preview/deps/export.ts` is the only allowed integration point
  for preview modules that depend on export rendering/frame extraction
  utilities.
- Files in `preview` (outside `deps/*`) must not import export modules
  directly.

## Preview Keyframes Boundary

- `src/features/preview/deps/keyframes.ts` is the only allowed integration
  point for preview modules that depend on keyframe hooks/utilities.
- Files in `preview` (outside `deps/*`) must not import keyframes modules
  directly.

## Preview Composition-Runtime Boundary

- `src/features/preview/deps/composition-runtime.ts` is the only allowed
  integration point for preview modules that depend on composition-runtime
  components/utilities.
- Files in `preview` (outside `deps/*`) must not import composition-runtime
  modules directly.

## Editor Timeline Boundary

- `src/features/editor/deps/timeline.ts` is the only allowed integration point
  for editor modules that depend on timeline stores/components/utils/hooks.
- Files in `editor` (outside `deps/*`) must not import timeline modules directly.
- `src/features/editor/deps/timeline-contract.ts` is the internal seam binding;
  timeline adapter files re-export from this contract.
- Preferred granular adapters:
  - `src/features/editor/deps/timeline-store.ts`
  - `src/features/editor/deps/timeline-ui.ts`
  - `src/features/editor/deps/timeline-hooks.ts`
  - `src/features/editor/deps/timeline-utils.ts`
  - `src/features/editor/deps/timeline-cache.ts`
  - `src/features/editor/deps/timeline-subscriptions.ts`

## Editor Media-Library Boundary

- `src/features/editor/deps/media-library.ts` is the only allowed integration
  point for editor modules that depend on media-library stores/components/utils.
- Files in `editor` (outside `deps/*`) must not import media-library modules
  directly.

## Editor Preview Boundary

- `src/features/editor/deps/preview.ts` is the only allowed integration point
  for editor modules that depend on preview components/stores/hooks.
- Files in `editor` (outside `deps/*`) must not import preview modules directly.

## Editor Project-Bundle Boundary

- `src/features/editor/deps/project-bundle.ts` is the only allowed integration
  point for editor modules that depend on project-bundle dialogs/services.
- Files in `editor` (outside `deps/*`) must not import project-bundle modules
  directly.

## Editor Keyframes Boundary

- `src/features/editor/deps/keyframes.ts` is the only allowed integration point
  for editor modules that depend on keyframes components/utils.
- Files in `editor` (outside `deps/*`) must not import keyframes modules
  directly.

## Editor Projects Boundary

- `src/features/editor/deps/projects.ts` is the only allowed integration point
  for editor modules that depend on project metadata/state stores.
- Files in `editor` (outside `deps/*`) must not import projects modules
  directly.

## Editor Composition-Runtime Boundary

- `src/features/editor/deps/composition-runtime.ts` is the only allowed
  integration point for editor modules that depend on composition-runtime
  transform/audio-cache utilities.
- Files in `editor` (outside `deps/*`) must not import composition-runtime
  modules directly.

## Editor Settings Boundary

- `src/features/editor/deps/settings.ts` is the only allowed integration point
  for editor modules that depend on settings stores/preferences.
- Files in `editor` (outside `deps/*`) must not import settings modules
  directly.

## Editor Effects Boundary

- `src/features/editor/deps/effects-contract.ts` is the only allowed
  integration point for editor modules that depend on effects feature
  components.
- Files in `editor` (outside `deps/*`) must not import effects modules
  directly.

## Editor Export Boundary

- `src/features/editor/deps/export-contract.ts` is the only allowed
  integration point for editor modules that depend on export dialogs/helpers.
- Files in `editor` (outside `deps/*`) must not import export modules
  directly.

## Effects Timeline/Preview Boundary

- `src/features/effects/deps/timeline-contract.ts` and
  `src/features/effects/deps/preview-contract.ts` are the only allowed
  integration points for effects modules that depend on timeline stores or
  preview stores.
- Files in `effects` (outside `deps/*`) must not import timeline or preview
  modules directly.

## Timeline Media-Library Boundary

- `src/features/timeline/deps/media-library.ts` is the only allowed integration
  point for timeline modules that depend on media-library stores/services/utils.
- Files in `timeline` (outside `deps/*`) must not import media-library modules
  directly.
- `src/features/timeline/deps/media-library-contract.ts` is the internal seam
  binding; media-library adapter files re-export from this contract.
- Preferred granular adapters:
  - `src/features/timeline/deps/media-library-store.ts`
  - `src/features/timeline/deps/media-library-service.ts`
  - `src/features/timeline/deps/media-library-resolver.ts` (including media
    drag-data cache helpers)

## Timeline Keyframes Boundary

- `src/features/timeline/deps/keyframes.ts` is the only allowed integration
  point for timeline modules that depend on keyframe editors/utilities.
- Files in `timeline` (outside `deps/*`) must not import keyframes modules
  directly.

## Timeline Projects Boundary

- `src/features/timeline/deps/projects.ts` is the only allowed integration
  point for timeline modules that depend on project metadata/state stores.
- Files in `timeline` (outside `deps/*`) must not import projects modules
  directly.

## Timeline Composition-Runtime Boundary

- `src/features/timeline/deps/composition-runtime.ts` is the only allowed
  integration point for timeline modules that depend on composition-runtime
  transform/audio-codec helpers.
- Files in `timeline` (outside `deps/*`) must not import composition-runtime
  modules directly.

## Timeline Settings Boundary

- `src/features/timeline/deps/settings.ts` is the only allowed integration
  point for timeline modules that depend on settings stores/preferences.
- Files in `timeline` (outside `deps/*`) must not import settings modules
  directly.

## Timeline Export Boundary

- `src/features/timeline/deps/export-contract.ts` is the only allowed
  integration point for timeline modules that depend on export
  conversion/single-frame rendering helpers.
- Files in `timeline` (outside `deps/*`) must not import export modules
  directly.

## Media-Library Timeline Boundary

- `src/features/media-library/deps/timeline.ts` is the only allowed integration
  point for media-library modules that depend on timeline stores/actions/utils.
- Files in `media-library` (outside `deps/*`) must not import timeline modules
  directly.
- `src/features/media-library/deps/timeline-contract.ts` is the internal seam
  binding; timeline adapter files re-export from this contract.
- Preferred granular adapters:
  - `src/features/media-library/deps/timeline-stores.ts`
  - `src/features/media-library/deps/timeline-actions.ts`
  - `src/features/media-library/deps/timeline-utils.ts`
  - `src/features/media-library/deps/timeline-services.ts`

## Media-Library Projects Boundary

- `src/features/media-library/deps/projects.ts` is the only allowed integration
  point for media-library modules that depend on project metadata/state stores.
- Files in `media-library` (outside `deps/*`) must not import projects modules
  directly.

## Export Media-Library Boundary

- `src/features/export/deps/media-library.ts` is the only allowed integration
  point for export modules that depend on media-library resolution utilities.
- Files in `export` (outside `deps/*`) must not import media-library modules
  directly.

## Export Composition-Runtime Boundary

- `src/features/export/deps/composition-runtime.ts` is the only allowed
  integration point for export modules that depend on composition-runtime
  transform/shape utilities.
- Files in `export` (outside `deps/*`) must not import composition-runtime
  modules directly.

## Export Keyframes Boundary

- `src/features/export/deps/keyframes.ts` is the only allowed integration
  point for export modules that depend on keyframe interpolation/animation
  utilities.
- Files in `export` (outside `deps/*`) must not import keyframes modules
  directly.

## Export Timeline Boundary

- `src/features/export/deps/timeline.ts` is the only allowed integration point
  for export modules that depend on timeline stores/utilities or GIF frame
  cache services.
- Files in `export` (outside `deps/*`) must not import timeline modules
  directly.

## Export Projects Boundary

- `src/features/export/deps/projects.ts` is the only allowed integration point
  for export modules that depend on project metadata/state stores.
- Files in `export` (outside `deps/*`) must not import projects modules
  directly.

## Export Player Boundary

- `src/features/export/deps/player-contract.ts` is the only allowed
  integration point for export modules that depend on player source-pool
  utilities.
- Files in `export` (outside `deps/*`) must not import player modules directly.

## Keyframes Timeline/Preview Boundary

- `src/features/keyframes/deps/timeline.ts` and
  `src/features/keyframes/deps/preview-contract.ts` are the only allowed
  integration points for keyframes modules that depend on timeline stores or
  preview hooks.
- Files in `keyframes` (outside `deps/*`) must not import timeline or preview
  modules directly.

## Keyframes Composition-Runtime Boundary

- `src/features/keyframes/deps/composition-runtime-contract.ts` is the only
  allowed integration point for keyframes modules that depend on
  composition-runtime transform helpers.
- Files in `keyframes` (outside `deps/*`) must not import composition-runtime
  modules directly.

## Projects Settings/Media-Library Boundary

- `src/features/projects/deps/settings-contract.ts` and
  `src/features/projects/deps/media-library-contract.ts` are the only allowed
  integration points for projects modules that depend on settings or
  media-library modules.
- Files in `projects` (outside `deps/*`) must not import settings or
  media-library modules directly.

## Project-Bundle Media-Library Boundary

- `src/features/project-bundle/deps/media-library.ts` is the only allowed
  integration point for project-bundle modules that depend on media-library
  services/utilities.
- Files in `project-bundle` (outside `deps/*`) must not import media-library
  modules directly.

## Shared Property Controls

- Property panel primitives used across features now live in
  `src/shared/ui/property-controls/*`.
- Editor compatibility wrappers remain in
  `src/features/editor/components/properties-sidebar/components/*` for
  incremental migration.

## Shared State Modules

- Cross-feature UI state stores moved to `src/shared/state/*`:
  - `selection`
  - `editor`
  - `clipboard`
  - `clear-keyframes-dialog`
  - `playback`
  - `source-player`
- Editor compatibility wrappers remain in `src/features/editor/stores/*` and
  `src/features/editor/components/clear-keyframes-dialog-store.ts`.
