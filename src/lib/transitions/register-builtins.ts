/**
 * Register Built-in Transitions
 *
 * Calls all renderer registration functions to populate the global registry.
 * Called once at module load time.
 */

import { transitionRegistry } from './registry';
import {
  registerBasicTransitions,
  registerWipeTransitions,
  registerSlideTransitions,
  registerFlipTransitions,
  registerZoomTransitions,
  registerMaskTransitions,
  registerBlurTransitions,
  registerDistortionTransitions,
} from './renderers';

let registered = false;

export function registerBuiltinTransitions(): void {
  if (registered) return;
  registered = true;

  registerBasicTransitions(transitionRegistry);
  registerWipeTransitions(transitionRegistry);
  registerSlideTransitions(transitionRegistry);
  registerFlipTransitions(transitionRegistry);
  registerZoomTransitions(transitionRegistry);
  registerMaskTransitions(transitionRegistry);
  registerBlurTransitions(transitionRegistry);
  registerDistortionTransitions(transitionRegistry);
}
