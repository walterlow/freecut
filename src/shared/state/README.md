# shared/state

Shared Zustand stores used by multiple features.

Current modules:

- `selection`: cross-feature clip/track/marker selection and active tool state
- `editor`: editor shell UI state (panel visibility, widths, source preview)
- `clipboard`: transition and item clipboard data for copy/paste
- `clear-keyframes-dialog`: dialog state for bulk/property keyframe deletion
- `playback`: global transport/playhead state for preview and timeline
- `source-player`: source monitor/player interaction state (in/out points, hover target)
