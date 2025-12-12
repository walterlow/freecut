// =============================================================================
// TIMELINE CONSTANTS
// =============================================================================
// All timeline-related constants in one place, organized by category.

// =============================================================================
// TRACK & CLIP DIMENSIONS
// =============================================================================

export const DEFAULT_TRACK_HEIGHT = 64;
export const MIN_TRACK_HEIGHT = 40;
export const MAX_TRACK_HEIGHT = 200;

// Clip fills entire track height (selection ring is inset)
export const CLIP_HEIGHT = DEFAULT_TRACK_HEIGHT;

// Shared clip layout
export const CLIP_LABEL_HEIGHT = 16;

// Video clip layout (2 rows: filmstrip with overlayed label | waveform)
export const VIDEO_WAVEFORM_HEIGHT = 20;
export const VIDEO_FILMSTRIP_HEIGHT = CLIP_HEIGHT - VIDEO_WAVEFORM_HEIGHT; // 44px

// Audio clip layout (2 rows: label | waveform)
export const AUDIO_WAVEFORM_HEIGHT = CLIP_HEIGHT - CLIP_LABEL_HEIGHT; // 48px

// =============================================================================
// FILMSTRIP / THUMBNAILS
// =============================================================================

export const THUMBNAIL_HEIGHT = VIDEO_FILMSTRIP_HEIGHT;
export const THUMBNAIL_WIDTH = Math.round(THUMBNAIL_HEIGHT * (16 / 9)); // ~78px

// =============================================================================
// TIMELINE LAYOUT
// =============================================================================

export const TIMELINE_HEADER_HEIGHT = 60;
export const TIMELINE_RULER_HEIGHT = 30;
export const TIMELINE_MIN_WIDTH = 800;

// =============================================================================
// ZOOM & NAVIGATION
// =============================================================================

export const DEFAULT_ZOOM_LEVEL = 1;
export const MIN_ZOOM_LEVEL = 0.01;
export const MAX_ZOOM_LEVEL = 2; // Capped at 2x for UI performance

export const DEFAULT_FPS = 30;

// =============================================================================
// SNAP & DRAG
// =============================================================================

export const SNAP_THRESHOLD = 5;
export const GUIDELINE_SNAP_DISTANCE = 5;
export const MAGNETIC_SNAP_DISTANCE = 10;
export const BASE_SNAP_THRESHOLD_PIXELS = 8; // Base threshold at 1x zoom

export const DRAG_THRESHOLD_PIXELS = 3; // Min movement to start drag
export const DRAG_OPACITY = 0.8;

// =============================================================================
// MOMENTUM PHYSICS (scroll & zoom)
// =============================================================================

// Scroll momentum
export const SCROLL_SENSITIVITY = 1.5;
export const SCROLL_FRICTION = 0.8; // 0-1, lower = more friction
export const SCROLL_MIN_VELOCITY = 0.5;
export const SCROLL_SMOOTHING = 0.15;
export const SCROLL_GESTURE_TIMEOUT = 100; // ms

// Zoom momentum (shared between ctrl+scroll and slider)
export const ZOOM_SENSITIVITY = 0.005;
export const ZOOM_FRICTION = 0.15;
export const ZOOM_MIN_VELOCITY = 0.001;
export const ZOOM_SMOOTHING = 0.25;

// Aliases for zoom limits (used by momentum code)
export const ZOOM_MIN = MIN_ZOOM_LEVEL;
export const ZOOM_MAX = MAX_ZOOM_LEVEL;

// =============================================================================
// COLORS
// =============================================================================

// Waveform colors (canvas doesn't support CSS vars)
export const WAVEFORM_FILL_COLOR = 'rgba(158, 107, 214, 0.5)';
export const WAVEFORM_STROKE_COLOR = 'rgba(158, 107, 214, 0.8)';
