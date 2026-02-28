# timeline/deps

Timeline-local adapters for external feature dependencies.

- `media-library-contract.ts`: internal timeline->media-library seam binding.
  Media-library adapter files re-export from this contract to keep cross-feature
  coupling centralized.
- `media-library-store.ts`: media-library store selectors used by timeline.
- `media-library-service.ts`: media-library services (including OPFS service
  re-exports) used by timeline.
- `media-library-resolver.ts`: media URL resolver utilities, media drag-data
  cache helpers, and media-library helper exports used by timeline.
- `media-library.ts`: compatibility barrel that re-exports the adapters above.
  Prefer importing the more specific module directly in new code.
- `keyframes.ts`: the preferred entry point for timeline modules that need
  keyframe editors, transition-region helpers, or animation utilities.
- `projects.ts`: the preferred entry point for timeline modules that need
  project metadata/state stores.
- `composition-runtime.ts`: the preferred entry point for timeline modules
  that need composition-runtime transform/audio-codec helpers.
- `settings.ts`: the preferred entry point for timeline modules that need
  settings stores (timeline UI preferences/history limits).
- `export-contract.ts`: adapter exports for timeline modules that need export
  rendering utilities (single-frame render + timeline conversion helpers).
