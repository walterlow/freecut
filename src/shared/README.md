# shared

Reusable building blocks shared across the app.

This is the single home for framework-agnostic logic and cross-feature
primitives. Most modules avoid React/routing entirely; UI primitives that
do use React (e.g. `state/`, `ui/`, `hooks/`, `components/`) stay
independent of any specific feature.

A few subpaths are held to a stricter "framework-agnostic" standard —
`animation/`, `timeline/`, `projects/` — enforced via `.oxlintrc.json`.
Those modules must not import React, routing, or app/features/runtime
code. Other shared subpaths may use React when the primitive needs it
(e.g. `state/` Zustand stores, `ui/property-controls/`).

## Domain modules (framework-agnostic, enforced)

- `animation/easing.ts` — easing math primitives.
- `timeline/defaults.ts` — canonical timeline defaults (track height, fps).
- `timeline/transitions/*` — transition engine, registry, planner, and
  per-style renderers (Canvas 2D fallbacks).
- `projects/migrations/*` — versioned project schema migrations and
  normalization.

## State

- `state/selection/*` — cross-feature selection state (items/tracks/tools/drag)
- `state/clipboard/*` — timeline copy/paste clipboard state
- `state/playback/*` — shared transport/playhead state
- `state/preview-bridge/*` — shared preview presentation state
- `state/source-player/*` — source monitor/player interaction state
- `state/editor/*` — editor shell UI state (panel sizing, source monitor)
- `state/clear-keyframes-dialog/*`, `state/project-media-match-dialog/*`,
  `state/tts-generate-dialog/*` — cross-feature workflow stores for
  dialogs opened by one feature and rendered by another
- `state/local-inference/*`, `state/mixer-live-gain.ts`,
  `state/transition-drag.ts` — misc shared state

## UI primitives

- `ui/property-controls/*` — shared property panel controls
  (`PropertySection`, `PropertyRow`, `NumberInput`, `ColorPicker`).
- `ui/cn.ts` — shared className merge utility.

## Hooks

- `hooks/use-marquee-selection.ts` — reusable marquee-selection
  controller used across timeline/preview/media-library.

## Typography & graphics

- `typography/*` — font loading, font catalog, text style presets.
- `graphics/shapes/*` — shape generators, path helpers, components.

## Utilities

- `utils/*` — managed worker pools/sessions, time/format helpers, color
  math, curve/spline math, mask/audio DSP, transcription cancellation,
  and so on.
- `async/async-utils.ts` — async concurrency helpers.
- `logging/logger.ts` — structured logger entry point.
- `media/ac3-decoder.ts` — AC-3 codec detection and lazy decoder
  registration for mediabunny.
- `events/domain-events.ts` — shared event bus types.
- `components/color-scopes-view.tsx` — shared color scope visualization.
