/**
 * Transition Types
 *
 * Transitions use a cut-centered, handle-based model: clips stay adjacent on
 * the timeline and the transition consumes hidden source handles around the
 * cut. Legacy overlap-based transitions may still exist in old projects.
 */

export type TransitionType = 'crossfade';

/**
 * Categories for organizing transitions in the UI
 */
export type TransitionCategory =
  | 'basic'
  | 'wipe'
  | 'slide'
  | 'flip'
  | 'mask'
  | 'light'
  | 'chromatic'
  | 'custom';

/**
 * Built-in presentation IDs.
 * The type is widened to string so custom registry entries work seamlessly.
 */
export type BuiltinTransitionPresentation =
  | 'fade'
  | 'wipe'
  | 'slide'
  | 'flip'
  | 'clockWipe'
  | 'iris'
  | 'dissolve'
  | 'sparkles'
  | 'glitch'
  | 'lightLeak'
  | 'pixelate'
  | 'chromatic'
  | 'radialBlur';

/**
 * Visual presentation styles for transitions.
 * Widened to `string` so the registry can accept custom IDs.
 * All BuiltinTransitionPresentation values are valid.
 */
export type TransitionPresentation = BuiltinTransitionPresentation | (string & {});

/**
 * Wipe direction options
 */
export type WipeDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';

/**
 * Slide direction options
 */
export type SlideDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';

/**
 * Flip direction options
 */
export type FlipDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';

/**
 * Timing function for transitions.
 * Extended with standard CSS easing names.
 */
export type TransitionTiming = 'linear' | 'spring' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier';

/**
 * Bezier control points for cubic-bezier timing
 */
export interface BezierPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * A transition between two clips that meet at a cut.
 * The transition is centered around the cut according to `alignment` and
 * consumes hidden source handles from each side without moving clip positions.
 */
export interface Transition {
  /** Unique identifier */
  id: string;
  /** Type of transition (for UI display) */
  type: TransitionType;
  /** Visual presentation style (registry key) */
  presentation: TransitionPresentation;
  /** Timing function */
  timing: TransitionTiming;
  /** ID of the clip ending */
  leftClipId: string;
  /** ID of the clip starting */
  rightClipId: string;
  /** Track where both clips reside */
  trackId: string;
  /** Duration of the transition in frames */
  durationInFrames: number;
  /** Direction for wipe/slide/flip transitions */
  direction?: WipeDirection | SlideDirection | FlipDirection;
  /**
   * Alignment of the transition relative to the cut point.
   * 0 = transition plays entirely in the right (incoming) clip
   * 0.5 = centered on cut point (default, backward compatible)
   * 1 = transition plays entirely in the left (outgoing) clip
   */
  alignment?: number;
  /** Bezier control points when timing is 'cubic-bezier' */
  bezierPoints?: BezierPoints;
  /** Reference to a preset configuration */
  presetId?: string;
  /** Custom properties for extensibility */
  properties?: Record<string, unknown>;
  /** Timestamp when transition was created */
  createdAt?: number;
  /** Timestamp of last modification */
  lastModifiedAt?: number;
}

/**
 * Reason why a transition became invalid
 */
export type TransitionBreakageReason =
  | 'clip_deleted'
  | 'not_adjacent'
  | 'not_overlapping'
  | 'cross_track'
  | 'invalid_duration'
  | 'invalid_type'
  | 'insufficient_handle';

/**
 * Information about a broken transition for user notification
 */
export interface TransitionBreakage {
  /** ID of the broken transition */
  transitionId: string;
  /** The transition that was broken */
  transition: Transition;
  /** Why the transition became invalid */
  reason: TransitionBreakageReason;
  /** Human-readable message for notifications */
  message: string;
  /** IDs of clips that caused the break */
  affectedClipIds: string[];
}

/**
 * Result of transition auto-repair
 */
export interface TransitionRepairResult {
  /** Transitions that are still valid (unmodified) */
  valid: Transition[];
  /** Transitions that were repaired (modified) */
  repaired: Array<{ original: Transition; repaired: Transition; action: string }>;
  /** Transitions that could not be repaired */
  broken: TransitionBreakage[];
}

/**
 * Index structure for O(1) transition lookups by clip
 */
export interface ClipTransitionIndex {
  /** Transition where this clip is on the left (outgoing) */
  outgoing?: Transition;
  /** Transition where this clip is on the right (incoming) */
  incoming?: Transition;
}

/**
 * Configuration for transition types
 */
interface TransitionConfig {
  label: string;
  description: string;
  /** Default duration in frames */
  defaultDuration: number;
  /** Minimum duration in frames */
  minDuration: number;
  /** Maximum duration in frames */
  maxDuration: number;
}

/**
 * Default configuration for each transition type
 */
export const TRANSITION_CONFIGS: Record<TransitionType, TransitionConfig> = {
  crossfade: {
    label: 'Crossfade',
    description: 'Smooth opacity blend between clips',
    defaultDuration: 30, // 1 second at 30fps
    minDuration: 30, // 1 second at 30fps
    maxDuration: 90, // 3 seconds at 30fps
  },
};

/**
 * Registry-based definition for a transition effect.
 * Stored in the TransitionRegistry alongside its renderer.
 */
export interface TransitionDefinition {
  /** Unique identifier (matches the presentation key) */
  id: string;
  /** Display label */
  label: string;
  /** Short description */
  description: string;
  /** Category for UI grouping */
  category: TransitionCategory;
  /** Icon name from lucide-react */
  icon: string;
  /** Whether this transition supports directional variants */
  hasDirection: boolean;
  /** Available directions if hasDirection is true */
  directions?: Array<WipeDirection | SlideDirection | FlipDirection>;
  /** Supported timing functions */
  supportedTimings: TransitionTiming[];
  /** Default duration in frames */
  defaultDuration: number;
  /** Minimum duration in frames */
  minDuration: number;
  /** Maximum duration in frames */
  maxDuration: number;
  /** Whether this transition benefits from WebGL acceleration */
  requiresWebGL?: boolean;
}


/**
 * Configuration for each presentation type.
 * Used by the transitions panel UI.
 */
export interface PresentationConfig {
  id: TransitionPresentation;
  label: string;
  description: string;
  icon: string; // Icon name from lucide-react
  category: TransitionCategory;
  direction?: WipeDirection | SlideDirection | FlipDirection;
}

/**
 * Presentation configs are now generated from the transition registry
 * at runtime. See `@/features/editor/utils/transition-ui-config.ts`.
 */

/**
 * Result of checking if a transition can be added
 */
export interface CanAddTransitionResult {
  canAdd: boolean;
  reason?: string;
  /** Available handle frames on left clip's end */
  leftHandle?: number;
  /** Available handle frames on right clip's start */
  rightHandle?: number;
}
