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
  registerMaskTransitions,
} from './renderers';

let registered = false;

export function registerBuiltinTransitions(): void {
  if (registered) return;
  registered = true;

  registerBasicTransitions(transitionRegistry);
  registerWipeTransitions(transitionRegistry);
  registerSlideTransitions(transitionRegistry);
  registerFlipTransitions(transitionRegistry);
  registerMaskTransitions(transitionRegistry);
}
