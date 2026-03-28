// =============================================================================
// TIMELINE CONSTANTS
// =============================================================================
// All timeline-related constants in one place, organized by category.
import {
  DEFAULT_TRACK_HEIGHT as SHARED_DEFAULT_TRACK_HEIGHT,
  DEFAULT_FPS as SHARED_DEFAULT_FPS,
} from '@/domain/timeline/defaults';
import { EDITOR_LAYOUT } from '@/shared/ui/editor-layout';

export const DEFAULT_TRACK_HEIGHT = SHARED_DEFAULT_TRACK_HEIGHT;
export const DEFAULT_FPS = SHARED_DEFAULT_FPS;
export const TIMELINE_HEADER_HEIGHT = EDITOR_LAYOUT.timelineHeaderHeight;
export const TIMELINE_TRACKS_HEADER_HEIGHT = EDITOR_LAYOUT.timelineTracksHeaderHeight;
export const TIMELINE_RULER_HEIGHT = EDITOR_LAYOUT.timelineRulerHeight;
export const TIMELINE_SIDEBAR_WIDTH = EDITOR_LAYOUT.timelineSidebarWidth;

// =============================================================================
// TRACK & CLIP DIMENSIONS
// =============================================================================

export const MIN_TRACK_HEIGHT = 48;
export const MAX_TRACK_HEIGHT = 140;
export const TRACK_SECTION_DIVIDER_HEIGHT = 3;

// Clip fills entire track height (selection ring is inset)
const CLIP_HEIGHT = DEFAULT_TRACK_HEIGHT;

// Shared clip layout
export const CLIP_LABEL_ROW_HEIGHT = EDITOR_LAYOUT.timelineClipLabelRowHeight;

// Video clip layout (2 rows: label | filmstrip)
const VIDEO_FILMSTRIP_HEIGHT = CLIP_HEIGHT - CLIP_LABEL_ROW_HEIGHT;
const MAX_VIDEO_FILMSTRIP_HEIGHT = MAX_TRACK_HEIGHT - CLIP_LABEL_ROW_HEIGHT;

// =============================================================================
// FILMSTRIP / THUMBNAILS
// =============================================================================

export const THUMBNAIL_HEIGHT = VIDEO_FILMSTRIP_HEIGHT;
export const THUMBNAIL_WIDTH = Math.round(THUMBNAIL_HEIGHT * (16 / 9));
export const FILMSTRIP_EXTRACT_HEIGHT = MAX_VIDEO_FILMSTRIP_HEIGHT;
export const FILMSTRIP_EXTRACT_WIDTH = Math.round(FILMSTRIP_EXTRACT_HEIGHT * (16 / 9));

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

// Temporary gate: keep slip/slide implementation in code, but hide the UI and
// disable their keyboard shortcuts until the tools are ready to expose again.
export const SLIP_SLIDE_TOOLS_ENABLED = false;

// =============================================================================
// COLORS
// =============================================================================

// Waveform colors (canvas doesn't support CSS vars)
export const WAVEFORM_FILL_COLOR = 'rgba(158, 107, 214, 0.5)';
export const WAVEFORM_STROKE_COLOR = 'rgba(158, 107, 214, 0.8)';
