# media-library/deps

Media-library-local adapters for external feature dependencies.

- `timeline-contract.ts`: internal media-library->timeline seam binding. Other
  timeline adapter files re-export from this contract to keep cross-feature
  coupling centralized.
- `timeline-stores.ts`: timeline stores/types used by media-library modules.
- `timeline-actions.ts`: timeline actions used by media-library modules.
- `timeline-utils.ts`: timeline utility helpers used by media-library modules.
- `timeline-services.ts`: timeline services used by media-library modules.
- `timeline.ts`: compatibility barrel that re-exports the timeline adapters
  above. Prefer importing the more specific module directly in new code.
- `projects.ts`: the preferred entry point for media-library modules that need
  project metadata/state stores.
