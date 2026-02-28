# preview/deps

Preview-local adapters for external feature dependencies.

- `timeline-contract.ts`: internal preview->timeline seam binding. Other
  timeline adapter files re-export from this contract to keep cross-feature
  coupling centralized.
- `player-contract.ts`: internal preview->player seam binding. Player adapter
  files re-export from this contract to keep cross-feature coupling
  centralized.
- `timeline-store.ts`: timeline stores/types used by preview rendering.
- `timeline-edit-preview.ts`: rolling/ripple/slip/slide preview stores.
- `timeline-utils.ts`: timeline utility helpers for preview rendering.
- `timeline-source-edit.ts`: source-monitor insert/overwrite edit actions.
- `timeline.ts`: compatibility barrel that re-exports the timeline adapters
  above. Prefer importing the more specific module directly in new code.
- `media-library.ts`: the only allowed entry point for preview modules that
  need media-library stores, services, or media resolution utilities.
- `player-core.ts`: player component exports (`Player`, `PlayerRef`,
  `AbsoluteFill`) used by preview.
- `player-context.ts`: player context/providers/hooks used by preview.
- `player-pool.ts`: video source pool access used by preview.
- `player.ts`: compatibility barrel that re-exports the player adapters above.
  Prefer importing the more specific module directly in new code.
- `export.ts`: the only allowed entry point for preview modules that need
  export rendering or frame extraction utilities.
- `keyframes.ts`: the only allowed entry point for preview modules that need
  keyframe animation hooks or auto-keyframing utilities.
- `composition-runtime.ts`: the only allowed entry point for preview modules
  that need composition runtime components or transform/time utilities.
