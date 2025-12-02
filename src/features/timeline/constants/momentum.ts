// Momentum scrolling config - tweak these values to adjust feel
export const SCROLL_SENSITIVITY = 1.5; // Scroll speed multiplier
export const SCROLL_FRICTION = 0.8; // Deceleration (0-1, lower = more friction)
export const SCROLL_MIN_VELOCITY = 0.5; // Stop threshold in pixels
export const SCROLL_SMOOTHING = 0.15; // Input smoothing (0-1, lower = smoother)
export const SCROLL_GESTURE_TIMEOUT = 100; // ms before resetting velocity

// Zoom momentum config (shared between ctrl+scroll and slider)
export const ZOOM_SENSITIVITY = 0.005; // Zoom speed multiplier
export const ZOOM_FRICTION = 0.15; // Deceleration for zoom
export const ZOOM_MIN_VELOCITY = 0.001; // Stop threshold for zoom
export const ZOOM_SMOOTHING = 0.25; // Input smoothing for zoom
export const ZOOM_MIN = 0.01;
export const ZOOM_MAX = 2;
