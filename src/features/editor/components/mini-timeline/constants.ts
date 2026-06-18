/**
 * Shared geometry for the compact "mini timeline" used by the Color and Animate
 * workspaces. Both render a small ruler + track-lane strip with a self-tracking
 * playhead, an optional film-tile row, an in/out (IO) bar, and marker
 * annotations. Keeping these constants in one place lets the two consumers stay
 * pixel-aligned.
 */
export const MINI_TIMELINE_LABEL_WIDTH = 32
export const MINI_TIMELINE_MIN_FRAMES = 300
export const MINI_TIMELINE_RULER_HEIGHT = 20
export const MINI_TIMELINE_IO_LANE_HEIGHT = 14
export const MINI_TIMELINE_IO_HANDLE_WIDTH = 6
export const MINI_TIMELINE_IO_HANDLE_COLOR = 'var(--color-timeline-io-handle)'

// Film-tile geometry (clip thumbnail row).
export const MINI_FILM_TILE_WIDTH = 118
export const MINI_FILM_TILE_HEIGHT = 80
// Just enough to clear the 12px horizontal scrollbar (see index.css) without a
// large black band under the tiles.
export const MINI_FILM_TILE_SCROLLBAR_GUTTER = 8
// Tiles (80) + top padding (4) + scrollbar gutter — trimmed so whatever sits
// under the tiles (IO bar) hugs them and reclaimed height goes to track rows.
export const MINI_FILM_TILE_STRIP_HEIGHT =
  MINI_FILM_TILE_HEIGHT + 4 + MINI_FILM_TILE_SCROLLBAR_GUTTER
