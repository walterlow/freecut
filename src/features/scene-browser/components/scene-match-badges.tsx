import { memo } from 'react'
import { Eye, MessageSquareText, Palette, Sparkles, Type } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import type { SceneMatchSignals } from '../utils/rank'

/**
 * all-MiniLM-L6-v2 and CLIP cosines both compress heavily — a 0.38 text
 * match is a *great* hit, not a "38% match". Showing raw percentages
 * scared users (see the bug report where `38%` on the top result
 * looked like the system was barely finding anything). We translate
 * raw cosines into qualitative tiers calibrated to each model's real
 * behavior and fill the strength bar proportionally to the tier's
 * reachable range rather than to the raw 0–1 cosine — so a strong
 * text hit actually looks full.
 */

const TEXT_TIER_STRONG = 0.5
const TEXT_TIER_GOOD = 0.4
const TEXT_TIER_FAIR = 0.3

const IMAGE_TIER_STRONG = 0.3
const IMAGE_TIER_GOOD = 0.25
const IMAGE_TIER_FAIR = 0.22

type Tier = 'strong' | 'good' | 'fair'

function scoreTier(
  score: number,
  thresholds: { strong: number; good: number; fair: number },
): Tier | null {
  if (score >= thresholds.strong) return 'strong'
  if (score >= thresholds.good) return 'good'
  if (score >= thresholds.fair) return 'fair'
  return null
}

function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'strong':
      return 'Strong'
    case 'good':
      return 'Good'
    case 'fair':
      return 'Fair'
  }
}

/**
 * Map raw cosine to a 0-1 display fraction calibrated to the model's
 * real reachable range. For text embeddings we treat 0.3 (Fair floor)
 * as "empty bar" and 0.6 as "full bar"; for CLIP it's 0.22 → 0.35.
 * Users see a half-full bar on what's actually a ~0.4 text hit,
 * matching the intuition that it's a solid but not perfect match.
 */
function calibratedFraction(score: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) return 0
  return Math.max(0, Math.min(1, (score - floor) / (ceiling - floor)))
}

function textFraction(score: number): number {
  return calibratedFraction(score, TEXT_TIER_FAIR, 0.6)
}

function imageFraction(score: number): number {
  return calibratedFraction(score, IMAGE_TIER_FAIR, 0.35)
}

/**
 * Per-row surface that tells the user *why* a scene ranked — which
 * signal (keyword, semantic meaning, visual CLIP) fired and how
 * strongly. This is the main feedback loop that makes "I typed a query
 * and scrolled a list" feel like something is actually happening rather
 * than magic.
 *
 * Conventions:
 *   - Keyword matches get a single yellow "Word" chip (match spans are
 *     already highlighted in the caption text itself, so the chip is a
 *     reinforcement rather than the only signal).
 *   - Semantic-text matches get a blue "Meaning" chip with the percent.
 *   - Semantic-visual matches get a purple "Visual" chip with the percent.
 *   - When both semantic signals fire, both chips render — users see
 *     directly which side of the parallel vector store contributed.
 */

interface SceneMatchBadgesProps {
  signals: SceneMatchSignals
  score: number
  /** `true` for the first scene in the list — earns a "Top" label. */
  isTop?: boolean
  className?: string
}

export const SceneMatchBadges = memo(function SceneMatchBadges({
  signals,
  score,
  isTop,
  className,
}: SceneMatchBadgesProps) {
  const chips: React.ReactNode[] = []

  if (signals.ranker === 'keyword' && signals.keywordMatched) {
    chips.push(
      <Chip
        key="keyword"
        tone="keyword"
        icon={<Type className="h-2.5 w-2.5" />}
        label="Keyword"
        hint={`Keyword match · cosine ${score.toFixed(2)}`}
      />,
    )
  }

  if (signals.ranker === 'semantic') {
    const textScore = signals.textScore
    const imageScore = signals.imageScore
    const textTier =
      typeof textScore === 'number'
        ? scoreTier(textScore, {
            strong: TEXT_TIER_STRONG,
            good: TEXT_TIER_GOOD,
            fair: TEXT_TIER_FAIR,
          })
        : null
    const imageTier =
      typeof imageScore === 'number'
        ? scoreTier(imageScore, {
            strong: IMAGE_TIER_STRONG,
            good: IMAGE_TIER_GOOD,
            fair: IMAGE_TIER_FAIR,
          })
        : null

    if (textTier) {
      chips.push(
        <Chip
          key="semantic-text"
          tone="text"
          icon={<MessageSquareText className="h-2.5 w-2.5" />}
          label={`Meaning · ${tierLabel(textTier)}`}
          hint={`Text-embedding cosine: ${(textScore ?? 0).toFixed(3)}`}
        />,
      )
    }
    if (imageTier) {
      chips.push(
        <Chip
          key="semantic-image"
          tone="visual"
          icon={<Eye className="h-2.5 w-2.5" />}
          label={`Visual · ${tierLabel(imageTier)}`}
          hint={`CLIP cosine: ${(imageScore ?? 0).toFixed(3)}`}
        />,
      )
    }
    if (signals.colorMatch) {
      chips.push(
        <Chip
          key="semantic-color"
          tone="palette"
          icon={<Palette className="h-2.5 w-2.5" />}
          label={`Color · ${signals.colorMatch}`}
          hint={`Palette match on ${signals.colorMatch} (∆E 2000)`}
        />,
      )
    }
    if (typeof signals.paletteDistance === 'number') {
      chips.push(
        <Chip
          key="palette-similar"
          tone="palette"
          icon={<Palette className="h-2.5 w-2.5" />}
          label={`Palette · ∆E ${signals.paletteDistance.toFixed(1)}`}
          hint="Weighted-mean ∆E 2000 to the reference palette"
        />,
      )
    }

    if (!textTier && !imageTier && !signals.colorMatch && signals.paletteDistance === undefined) {
      // Shouldn't normally reach here — the ranker drops rows that clear
      // no threshold — but surface something so the row isn't silent.
      chips.push(
        <Chip
          key="semantic-weak"
          tone="text"
          icon={<Sparkles className="h-2.5 w-2.5" />}
          label="Below threshold"
          hint={`cosine ${score.toFixed(3)}`}
        />,
      )
    }
  }

  if (chips.length === 0 && !isTop) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {isTop && (
        <Chip
          tone="top"
          icon={<Sparkles className="h-2.5 w-2.5" />}
          label="Top"
          hint="Highest-scoring match"
        />
      )}
      {chips}
    </div>
  )
})

interface ChipProps {
  tone: 'keyword' | 'text' | 'visual' | 'top' | 'palette'
  icon: React.ReactNode
  label: string
  hint?: string
}

function Chip({ tone, icon, label, hint }: ChipProps) {
  const cls = (() => {
    switch (tone) {
      case 'keyword':
        return 'bg-amber-400/15 text-amber-300 border-amber-400/30'
      case 'text':
        return 'bg-sky-400/15 text-sky-300 border-sky-400/30'
      case 'visual':
        return 'bg-purple-400/15 text-purple-300 border-purple-400/30'
      case 'palette':
        return 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30'
      case 'top':
        return 'bg-primary/15 text-primary border-primary/40'
    }
  })()

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[9.5px] font-medium leading-none',
        cls,
      )}
      title={hint}
    >
      {icon}
      {label}
    </span>
  )
}

/**
 * Horizontal strength bar — fills proportionally to the calibrated
 * tier range, NOT the raw cosine. A 0.38 text hit shows as ~50%
 * filled rather than 38%, because 0.38 actually represents a solid
 * match in all-MiniLM's compressed output distribution.
 */
export const SceneMatchStrength = memo(function SceneMatchStrength({
  signals,
  score,
}: {
  signals: SceneMatchSignals
  score: number
}) {
  if (signals.ranker === 'keyword') {
    return (
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-amber-400/10">
        <div
          className="h-full bg-amber-400/70"
          style={{ width: `${Math.max(20, Math.min(100, score * 100))}%` }}
        />
      </div>
    )
  }

  const hasTextScore = typeof signals.textScore === 'number'
  const hasImageScore = typeof signals.imageScore === 'number'

  // Palette-only ranking has neither text nor image cosines — showing
  // two empty bars reads as broken UI, so skip the strength row entirely.
  if (!hasTextScore && !hasImageScore) return null

  const textPct = hasTextScore ? textFraction(signals.textScore!) : 0
  const imagePct = hasImageScore ? imageFraction(signals.imageScore!) : 0

  return (
    <div className="flex h-0.5 w-full gap-0.5">
      <div className="flex-1 overflow-hidden rounded-full bg-sky-400/10">
        <div className="h-full bg-sky-400/70" style={{ width: `${textPct * 100}%` }} />
      </div>
      <div className="flex-1 overflow-hidden rounded-full bg-purple-400/10">
        <div className="h-full bg-purple-400/70" style={{ width: `${imagePct * 100}%` }} />
      </div>
    </div>
  )
})
