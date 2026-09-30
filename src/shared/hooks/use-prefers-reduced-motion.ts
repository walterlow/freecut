import { useEffect, useState } from 'react'

/**
 * Custom hook to detect if the user's operating system prefers reduced motion.
 *
 * In development mode, returns false to prevent Framer Motion's intrusive dev warning:
 * "You have Reduced Motion enabled on your device. Animations may not appear as expected..."
 * and to allow normal previewing of animations as configured by <MotionConfig>.
 *
 * In production mode, honors the user's OS preference via matchMedia.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    if (!import.meta.env.PROD) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env.PROD) return

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  return prefersReducedMotion
}
