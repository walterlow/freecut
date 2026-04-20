# shared/state

Shared Zustand stores used by multiple features.

Current modules:

- `selection`: cross-feature clip/track/marker selection and active tool state
- `clipboard`: transition and item clipboard data for copy/paste
- `playback`: global transport/playhead state for preview and timeline
- `preview-bridge`: preview presentation state (displayed overlay frame, frame capture hooks)
- `source-player`: source monitor/player interaction state (in/out points, hover target)
