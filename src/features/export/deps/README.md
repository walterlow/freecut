# export/deps

Export-local adapters for external feature dependencies.

- `media-library.ts`: the preferred entry point for export modules that need
  media resolution utilities from media-library.
- `composition-runtime.ts`: the preferred entry point for export modules that
  need composition-runtime transform/shape utilities.
- `keyframes.ts`: the preferred entry point for export modules that need
  keyframe interpolation/animation utilities.
- `timeline.ts`: the preferred entry point for export modules that need
  timeline stores, timeline utilities, or GIF frame cache services.
- `projects.ts`: the preferred entry point for export modules that need
  project metadata/state stores.
- `player-contract.ts`: adapter exports for export modules that need player
  source-pool utilities.
