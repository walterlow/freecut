// =============================================================================
// TIMELINE CONSTANTS
// =============================================================================
// All timeline-related constants in one place, organized by category.
import {
  DEFAULT_TRACK_HEIGHT as SHARED_DEFAULT_TRACK_HEIGHT,
  DEFAULT_FPS as SHARED_DEFAULT_FPS,
} from '@/domain/timeline/defaults';

export const DEFAULT_TRACK_HEIGHT = SHARED_DEFAULT_TRACK_HEIGHT;
export const DEFAULT_FPS = SHARED_DEFAULT_FPS;

// =============================================================================
// TRACK & CLIP DIMENSIONS
// =============================================================================

export const MIN_TRACK_HEIGHT = 48;
export const MAX_TRACK_HEIGHT = 200;

// Clip fills entire track height (selection ring is inset)
const CLIP_HEIGHT = DEFAULT_TRACK_HEIGHT;

// Shared clip layout
export const CLIP_LABEL_ROW_HEIGHT = 18;

// Video clip layout (3 rows: label | filmstrip | waveform)
export const VIDEO_WAVEFORM_HEIGHT = 30;
const VIDEO_FILMSTRIP_HEIGHT = CLIP_HEIGHT - CLIP_LABEL_ROW_HEIGHT - VIDEO_WAVEFORM_HEIGHT;

// =============================================================================
// FILMSTRIP / THUMBNAILS
// =============================================================================

export const THUMBNAIL_HEIGHT = VIDEO_FILMSTRIP_HEIGHT;
export const THUMBNAIL_WIDTH = Math.round(THUMBNAIL_HEIGHT * (16 / 9));

// =============================================================================
// TIMELINE LAYOUT
// =============================================================================

const MIN_ZOOM_LEVEL = 0.01;
const MAX_ZOOM_LEVEL = 2; // Capped at 2x for UI performance

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
export const ZOOM_FRICTION = 0; // 0 = instant zoom (no momentum drift after gesture)
export const ZOOM_MIN_VELOCITY = 0.001;

// Aliases for zoom limits (used by momentum code)
export const ZOOM_MIN = MIN_ZOOM_LEVEL;
export const ZOOM_MAX = MAX_ZOOM_LEVEL;

// =============================================================================
// COLORS
// =============================================================================

// Waveform colors (canvas doesn't support CSS vars)
export const WAVEFORM_FILL_COLOR = 'rgba(158, 107, 214, 0.5)';
export const WAVEFORM_STROKE_COLOR = 'rgba(158, 107, 214, 0.8)';
