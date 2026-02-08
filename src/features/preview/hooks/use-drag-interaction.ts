import { useEffect, useEffectEvent } from 'react';

/**
 * Escape key cancellation helper for interactions managed elsewhere.
 */
export function useEscapeCancel(
  isActive: boolean,
  onCancel: () => void
): void {
  const onEscapeKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  });

  useEffect(() => {
    if (!isActive) return;

    window.addEventListener('keydown', onEscapeKeyDown);
    return () => window.removeEventListener('keydown', onEscapeKeyDown);
  }, [isActive]);
}
