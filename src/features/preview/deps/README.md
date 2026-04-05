# preview/deps

Preview-local adapters for external feature dependencies.

- `timeline-contract.ts`: internal preview->timeline seam binding. Other
  timeline adapter files re-export from this contract to keep cross-feature
  coupling centralized.
- `transport-contract.ts`: internal preview->transport seam binding.
  Transport adapter
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
- `transport-core.ts`: transport component exports (`Player`,
  `HeadlessTransport`, `TransportRef`, `AbsoluteFill`) used by
  preview.
- `transport-context.ts`: transport context/providers/hooks used by preview.
- `transport-pool.ts`: video source pool access used by preview.
- `transport.ts`: barrel that re-exports the transport adapters above.
  Prefer importing the more specific module directly in new code.
- `export.ts`: the only allowed entry point for preview modules that need
  export rendering or frame extraction utilities.
- `keyframes.ts`: the only allowed entry point for preview modules that need
  keyframe animation hooks or auto-keyframing utilities.
- `composition-runtime.ts`: the only allowed entry point for preview modules
  that need composition runtime components or transform/time utilities.
