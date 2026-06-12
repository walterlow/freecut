import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface EffectMoveProps {
  /** Move the effect within the item's effect stack. Omitted = reordering unavailable. */
  onMove?: (effectId: string, direction: -1 | 1) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
}

/**
 * Up/down reorder buttons shared by all effect panel headers.
 * Effect order matters — color operations are not commutative.
 */
export function EffectMoveButtons({
  effectId,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
}: EffectMoveProps & { effectId: string }) {
  const { t } = useTranslation()
  if (!onMove) return null

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 flex-shrink-0 ${canMoveUp ? '' : 'opacity-30'}`}
        onClick={() => onMove(effectId, -1)}
        title={t('effects.panel.moveUp')}
        disabled={!canMoveUp}
      >
        <ChevronUp className="w-3 h-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 flex-shrink-0 ${canMoveDown ? '' : 'opacity-30'}`}
        onClick={() => onMove(effectId, 1)}
        title={t('effects.panel.moveDown')}
        disabled={!canMoveDown}
      >
        <ChevronDown className="w-3 h-3" />
      </Button>
    </>
  )
}
