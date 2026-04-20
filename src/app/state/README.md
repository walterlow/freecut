# app/state

Application-level workflow state.

Use this layer for stores that coordinate editor workflows across multiple
features but are still specific to the FreeCut app shell rather than generally
reusable shared state.

Current modules:

- `editor`: editor shell UI state (panels, sidebar sizing, source monitor)
- `clear-keyframes-dialog`: workflow state for bulk keyframe deletion UI
- `project-media-match-dialog`: workflow state for reconciling project/media metadata
- `tts-generate-dialog`: workflow state for the editor TTS generation dialog
