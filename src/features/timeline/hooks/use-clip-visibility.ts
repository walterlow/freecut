import { useEffect, useState, useRef, RefObject } from 'react';

/**
 * Hook to detect when a timeline clip becomes visible using IntersectionObserver
 *
 * Uses the timeline-container as the root element and adds 200px margin
 * for prefetching content before it becomes visible.
 */
export function useClipVisibility(clipRef: RefObject<HTMLElement | null>): boolean {
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const element = clipRef.current;
    if (!element) return;

    // Find the timeline container as the root
    const timelineContainer = element.closest('.timeline-container');

    // Create observer with margin for prefetching
    observerRef.current = new IntersectionObserver(
      (entries) => {
        // We only observe one element, so take the first entry
        const entry = entries[0];
        if (entry) {
          setIsVisible(entry.isIntersecting);
        }
      },
      {
        root: timelineContainer || null, // Use viewport if container not found
        rootMargin: '0px 200px', // 200px horizontal margin for prefetching
        threshold: 0, // Trigger as soon as any part is visible
      }
    );

    observerRef.current.observe(element);

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [clipRef]);

  return isVisible;
}
