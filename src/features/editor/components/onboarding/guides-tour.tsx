import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/features/editor/deps/settings'
import { cn } from '@/shared/ui/cn'

interface GuideStep {
  target: string
  title: string
  body: string
}

const TARGET_BY_STEP: Array<[string, string]> = [
  ['workspaces', 'onboarding.step1'],
  ['media-rail', 'onboarding.step2'],
  ['preview', 'onboarding.step3'],
  ['timeline', 'onboarding.step4'],
  ['properties', 'onboarding.step5'],
  ['export', 'onboarding.step6'],
]

/** Distance from the target edge to the tooltip (px). */
const CARD_PAD = 16
const CARD_MAX_WIDTH = 320

/**
 * Lightweight first-run guided tour. Renders a dimmed overlay with a spotlight
 * on the target element and a small card with Prev / Next / Skip buttons. It
 * never blocks editing — everything except the card/progress dots is
 * pointer-events-none — and dismiss (Skip / Done) persists via the settings
 * store's hasSeenGuide flag. Idempotent: returns null when already seen.
 */
export const GuidesTour = memo(function GuidesTour({
  force = false,
  onComplete,
}: {
  /** When true, show even if hasSeenGuide is set (used by "Show guides"). */
  force?: boolean
  onComplete?: () => void
}) {
  const { t } = useTranslation()
  const hasSeenGuide = useSettingsStore((s) => s.hasSeenGuide)
  const setSetting = useSettingsStore((s) => s.setSetting)
  const prefersReducedMotion = useReducedMotion()

  const steps = useMemo<GuideStep[]>(
    () =>
      TARGET_BY_STEP.map(([target, key]) => ({
        target: `[data-guide-target="${target}"]`,
        title: t(`${key}.title`),
        body: t(`${key}.body`),
      })),
    // Intentionally rebuild only when the translation function changes.
    [t],
  )

  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const active = force || !hasSeenGuide
  const step = steps[Math.min(index, steps.length - 1)]

  const finish = useCallback(() => {
    setSetting('hasSeenGuide', true)
    onComplete?.()
  }, [setSetting, onComplete])

  // Measure the target each time the step changes and on resize/scroll, so the
  // spotlight follows the element. Falls back to a centered card if not found.
  useEffect(() => {
    if (!active) return
    const measure = () => {
      const el = document.querySelector(step?.target ?? '')
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [active, step?.target, index])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, finish])

  if (!active || !step) return null

  const cardStyle: CSSProperties = rect
    ? {
        top: rect.bottom + CARD_PAD,
        left: rect.right + CARD_PAD + CARD_MAX_WIDTH > window.innerWidth ? undefined : rect.left,
        right: rect.right + CARD_PAD + CARD_MAX_WIDTH > window.innerWidth ? CARD_PAD : undefined,
        width: Math.max(rect.width, 240),
      }
    : { top: '40%', left: '50%', width: 320 }

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      {/* Spotlight: dim everything except the target with a huge shadow ring. */}
      {rect && (
        <motion.div
          className="absolute"
          initial={false}
          animate={{
            left: rect.left - 4,
            top: rect.top - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
          style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', borderRadius: 6 }}
        />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          className="pointer-events-auto absolute z-10 w-60 rounded-xl border border-border bg-popover p-4 shadow-xl"
          style={cardStyle}
          initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-label={step.title}
        >
          <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={finish}>
              {t('onboarding.dismiss')}
            </Button>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                {t('onboarding.prev')}
              </Button>
              {index < steps.length - 1 ? (
                <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                  {t('onboarding.next')}
                </Button>
              ) : (
                <Button size="sm" onClick={finish}>
                  {t('onboarding.done')}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Progress dots */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/80 px-2 py-1">
        {steps.map((s, i) => (
          <span
            key={s.target}
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              i === index ? 'bg-primary' : 'bg-muted-foreground/40',
            )}
          />
        ))}
      </div>
    </div>
  )
})
