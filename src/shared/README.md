# shared

Reusable building blocks shared across the app.

This includes generic utilities and primitives that do not depend on feature
modules or route modules.

## UI Modules

- `ui/property-controls/*`: shared property panel controls (`PropertySection`,
  `PropertyRow`, `NumberInput`, `ColorPicker`) used by multiple features.
- `ui/cn.ts`: shared className merge utility (`cn`).

## Logging Modules

- `logging/logger.ts`: shared logger entry point for app/features.

## Media Modules

- `media/ac3-decoder.ts`: shared AC-3 codec detection and lazy decoder
  registration utilities for mediabunny integrations.

## Typography Modules

- `typography/fonts.ts`: shared font loading/catalog entry point.

## Graphics Modules

- `graphics/shapes/*`: shared shape generators, path helpers, and components.

## Async Modules

- `async/async-utils.ts`: shared async concurrency helpers.

## State Modules

- `state/selection/*`: cross-feature selection state (items/tracks/tools/drag)
- `state/editor/*`: editor shell UI state (panels, sidebar sizes, source monitor)
- `state/clipboard/*`: timeline copy/paste clipboard state
- `state/clear-keyframes-dialog/*`: clear keyframes dialog state
- `state/playback/*`: shared transport/playhead state (frame, play/pause, zoom, quality)
- `state/source-player/*`: shared source monitor state (in/out points, source frame, player methods)
