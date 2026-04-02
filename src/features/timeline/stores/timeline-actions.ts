/**
 * Timeline Actions - Cross-domain operations with undo/redo support.
 *
 * These functions wrap operations that span multiple domain stores,
 * ensuring atomicity through the command system.
 *
 * Single-domain operations can be called directly on the domain stores,
 * but cross-domain operations (like removeItems which cascades to
 * transitions and keyframes) must go through these wrappers.
 *
 * Split into domain-specific modules under ./actions/ for maintainability.
 */

export * from './actions/track-actions';
export * from './actions/item-actions';
export * from './actions/transform-actions';
export * from './actions/effect-actions';
export * from './actions/transition-actions';
export * from './actions/keyframe-actions';
export * from './actions/marker-actions';
export * from './actions/settings-actions';
export * from './actions/source-edit-actions';
export * from './actions/composition-actions';
export * from './actions/project-item-actions';
export * from './actions/legacy-av-actions';
