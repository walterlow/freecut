// Auto-register built-in transitions on module load
import { registerBuiltinTransitions } from './register-builtins';
import { transitionRegistry } from './registry';
import { _setRegistryGetter } from './engine';

registerBuiltinTransitions();

// Wire up the registry getter so engine can delegate without circular imports
_setRegistryGetter(() => transitionRegistry);

export { transitionRegistry } from './registry';
