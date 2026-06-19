/**
 * Shared flag that lets a transient gesture (dragging the ruler IO markers)
 * keep updating the preview canvas via `previewFrame` while hiding the ghost
 * skim scrubber so it doesn't chase the marker.
 *
 * Mirrors the Color workspace, where the playhead stays pinned during an IO
 * drag while the preview keeps refreshing. The IO markers flip this on at drag
 * start and off on release; {@link TimelinePreviewScrubber} reads it and keeps
 * itself hidden while set.
 */
export const previewScrubberSuppressRef = { current: false }
