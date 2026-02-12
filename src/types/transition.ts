/**
 * Transition Types
 *
 * Transitions are visual effects applied between two adjacent clips.
 * Supports asymmetric alignment around the cut point.
 * Timeline duration remains unchanged - transitions are purely visual effects.
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
  | 'iris';

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
 * A transition between two adjacent clips.
 * Clips stay at their original positions - transition is a visual effect.
 * The `alignment` property controls where the transition sits relative to the cut point.
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
  | 'cross_track'
  | 'invalid_duration'
  | 'invalid_type';

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
    minDuration: 5,
    maxDuration: 90,
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
 * All available transition presentations with their configurations.
 * Each direction is a separate card for easy selection.
 *
 * NOTE: This is the legacy static list. The transitions panel now generates
 * configs from the registry. This is kept for backward compatibility.
 */
export const PRESENTATION_CONFIGS: PresentationConfig[] = [
  // Basic transitions
  {
    id: 'fade',
    label: 'Fade',
    description: 'Simple crossfade between clips',
    icon: 'Blend',
    category: 'basic',
  },
  // Wipe transitions (each direction as separate card)
  {
    id: 'wipe',
    label: 'Left',
    description: 'Wipe from left to right',
    icon: 'ArrowRight',
    category: 'wipe',
    direction: 'from-left',
  },
  {
    id: 'wipe',
    label: 'Right',
    description: 'Wipe from right to left',
    icon: 'ArrowLeft',
    category: 'wipe',
    direction: 'from-right',
  },
  {
    id: 'wipe',
    label: 'Top',
    description: 'Wipe from top to bottom',
    icon: 'ArrowDown',
    category: 'wipe',
    direction: 'from-top',
  },
  {
    id: 'wipe',
    label: 'Bottom',
    description: 'Wipe from bottom to top',
    icon: 'ArrowUp',
    category: 'wipe',
    direction: 'from-bottom',
  },
  // Slide transitions (each direction as separate card)
  {
    id: 'slide',
    label: 'Left',
    description: 'Slide in from left',
    icon: 'MoveRight',
    category: 'slide',
    direction: 'from-left',
  },
  {
    id: 'slide',
    label: 'Right',
    description: 'Slide in from right',
    icon: 'MoveLeft',
    category: 'slide',
    direction: 'from-right',
  },
  {
    id: 'slide',
    label: 'Top',
    description: 'Slide in from top',
    icon: 'MoveDown',
    category: 'slide',
    direction: 'from-top',
  },
  {
    id: 'slide',
    label: 'Bottom',
    description: 'Slide in from bottom',
    icon: 'MoveUp',
    category: 'slide',
    direction: 'from-bottom',
  },
  // Flip transitions (each direction as separate card)
  {
    id: 'flip',
    label: 'Left',
    description: '3D flip from left',
    icon: 'FlipHorizontal',
    category: 'flip',
    direction: 'from-left',
  },
  {
    id: 'flip',
    label: 'Right',
    description: '3D flip from right',
    icon: 'FlipHorizontal2',
    category: 'flip',
    direction: 'from-right',
  },
  {
    id: 'flip',
    label: 'Top',
    description: '3D flip from top',
    icon: 'FlipVertical',
    category: 'flip',
    direction: 'from-top',
  },
  {
    id: 'flip',
    label: 'Bottom',
    description: '3D flip from bottom',
    icon: 'FlipVertical2',
    category: 'flip',
    direction: 'from-bottom',
  },
  // Special / Mask transitions
  {
    id: 'clockWipe',
    label: 'Clock Wipe',
    description: 'Circular wipe like a clock hand',
    icon: 'Clock',
    category: 'mask',
  },
  {
    id: 'iris',
    label: 'Iris',
    description: 'Circular iris expanding/contracting',
    icon: 'Circle',
    category: 'mask',
  },
];

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
