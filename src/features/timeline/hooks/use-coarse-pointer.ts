import { useEffect, useState } from 'react';

/**
 * Returns true when the primary input is coarse (e.g. touch).
 * Used to enlarge hit zones (e.g. trim edge) on touch devices.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  });

  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    const handler = () => setCoarse(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return coarse;
}
