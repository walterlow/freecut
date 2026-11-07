import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Hash } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TextCounterEasing } from '@/types/text'
import type { TextCounter, TextItem } from '@/types/timeline'
import { updateItem } from '@/features/editor/deps/timeline-store'
import { KeyframeToggle, resolveTextCounterValue } from '@/features/editor/deps/keyframes'
import { useThrottledFrame } from '@/features/editor/deps/preview'
import {
  DEFAULT_TEXT_COUNTER,
  TEXT_COUNTER_MAX_DECIMALS,
  formatTextCounterValue,
} from '@/shared/typography/text-counter'
import { NumberInput, PropertyRow, PropertySection } from '../components'
import { useKeyframesByItemId } from './use-keyframes-by-item-id'

const EASING_OPTIONS: TextCounterEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out']

interface TextCounterSectionProps {
  textItems: TextItem[]
}

/**
 * Text input that commits on blur / Enter so each keystroke isn't an undo step.
 * Callers key it by `value` so an external change (undo, other selection)
 * remounts it with a fresh draft.
 */
function CommitTextInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string
  onCommit: (value: string) => void
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(value)

  return (
    <Input
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="h-7 flex-1 min-w-0 text-xs"
    />
  )
}

/**
 * "Counter" section: turns a text clip into an animated number (1% → 100%)
 * without placing one clip per value. Settings live on `item.textCounter`;
 * the rendered text is generated per frame by `resolveAnimatedTextItem`.
 */
export function TextCounterSection({ textItems }: TextCounterSectionProps) {
  const { t } = useTranslation()
  const firstItem = textItems[0]
  const counter = firstItem?.textCounter
  const enabled = counter?.enabled === true
  const settings: TextCounter = counter ?? DEFAULT_TEXT_COUNTER

  const itemIds = useMemo(() => textItems.map((item) => item.id), [textItems])
  const keyframesByItemId = useKeyframesByItemId(itemIds)
  const currentFrame = useThrottledFrame()

  const currentValuesByItemId = useMemo(() => {
    const values: Record<string, number> = {}
    for (const item of textItems) {
      const value = resolveTextCounterValue(
        item,
        keyframesByItemId.get(item.id) ?? undefined,
        currentFrame - item.from,
      )
      if (value !== undefined) values[item.id] = value
    }
    return values
  }, [currentFrame, keyframesByItemId, textItems])

  const patchCounter = useCallback(
    (patch: Partial<TextCounter>) => {
      for (const item of textItems) {
        updateItem(item.id, {
          textCounter: { ...(item.textCounter ?? DEFAULT_TEXT_COUNTER), ...patch },
        })
      }
    },
    [textItems],
  )

  if (!firstItem) return null

  const currentValue = currentValuesByItemId[firstItem.id] ?? settings.from

  return (
    <PropertySection title={t('editor.textCounter.sectionTitle')} icon={Hash} defaultOpen={enabled}>
      <PropertyRow label={t('editor.textCounter.enable')}>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => patchCounter({ enabled: checked })}
        />
      </PropertyRow>

      {enabled && (
        <>
          <p className="text-[10px] leading-snug text-muted-foreground/70 pb-1">
            {t('editor.textCounter.hint')}
          </p>

          <PropertyRow label={t('editor.textCounter.from')}>
            <NumberInput
              value={settings.from}
              onChange={(from) => patchCounter({ from })}
              step={1}
              className="flex-1 min-w-0"
            />
          </PropertyRow>

          <PropertyRow label={t('editor.textCounter.to')}>
            <NumberInput
              value={settings.to}
              onChange={(to) => patchCounter({ to })}
              step={1}
              className="flex-1 min-w-0"
            />
          </PropertyRow>

          <PropertyRow label={t('editor.textCounter.value')}>
            <div className="flex items-center gap-1 min-w-0 w-full">
              <span className="flex-1 min-w-0 truncate text-xs tabular-nums text-foreground/80">
                {formatTextCounterValue(settings, currentValue)}
              </span>
              <KeyframeToggle
                itemIds={itemIds}
                property="counterValue"
                currentValue={currentValue}
                currentValuesByItemId={currentValuesByItemId}
              />
            </div>
          </PropertyRow>

          <PropertyRow label={t('editor.textCounter.easing')}>
            <Select
              value={settings.easing}
              onValueChange={(easing) => patchCounter({ easing: easing as TextCounterEasing })}
            >
              <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EASING_OPTIONS.map((easing) => (
                  <SelectItem key={easing} value={easing} className="text-xs">
                    {t(`editor.textCounter.easings.${easing}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropertyRow>

          <PropertyRow label={t('editor.textCounter.decimals')}>
            <NumberInput
              value={settings.decimals}
              onChange={(decimals) => patchCounter({ decimals: Math.round(decimals) })}
              min={0}
              max={TEXT_COUNTER_MAX_DECIMALS}
              step={1}
              className="flex-1 min-w-0"
            />
          </PropertyRow>

          <PropertyRow label={t('editor.textCounter.prefix')}>
            <CommitTextInput
              key={`prefix:${firstItem.id}:${settings.prefix ?? ''}`}
              value={settings.prefix ?? ''}
              ariaLabel={t('editor.textCounter.prefix')}
              onCommit={(prefix) => patchCounter({ prefix })}
            />
          </PropertyRow>

          <PropertyRow label={t('editor.textCounter.suffix')}>
            <CommitTextInput
              key={`suffix:${firstItem.id}:${settings.suffix ?? ''}`}
              value={settings.suffix ?? ''}
              ariaLabel={t('editor.textCounter.suffix')}
              onCommit={(suffix) => patchCounter({ suffix })}
            />
          </PropertyRow>

          <PropertyRow label={t('editor.textCounter.separator')}>
            <Switch
              checked={settings.thousandsSeparator === true}
              onCheckedChange={(checked) => patchCounter({ thousandsSeparator: checked })}
            />
          </PropertyRow>
        </>
      )}
    </PropertySection>
  )
}
