import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/shared/ui/cn'
import { AUDIO_EQ_PRESETS, type AudioEqPresetId } from '@/shared/utils/audio-eq'

interface EqPresetPickerProps {
  presetId: AudioEqPresetId | null
  placeholder: string
  disabled: boolean
  onPresetChange: (presetId: string) => void
  portalContainer?: HTMLElement | null
  compact: boolean
}

/** Preset dropdown shared by the floating header and the compact toolbar. */
function EqPresetPicker({
  presetId,
  placeholder,
  disabled,
  onPresetChange,
  portalContainer,
  compact,
}: EqPresetPickerProps) {
  return (
    <Select value={presetId ?? undefined} onValueChange={onPresetChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          compact
            ? 'h-7 flex-1 min-w-0 text-xs'
            : 'h-8 w-[220px] border-border bg-secondary/30 text-xs text-foreground',
          disabled && 'opacity-40',
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent container={portalContainer ?? undefined}>
        {AUDIO_EQ_PRESETS.map((preset) => (
          <SelectItem key={preset.id} value={preset.id} className="text-xs">
            {preset.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface EqResetButtonProps {
  disabled: boolean
  onReset: () => void
  compact: boolean
}

/** Reset-to-flat button: labelled in the floating header, iconic when compact. */
function EqResetButton({ disabled, onReset, compact }: EqResetButtonProps) {
  if (compact) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground',
          disabled && 'opacity-40',
        )}
        onClick={onReset}
        disabled={disabled}
        aria-label="Reset EQ"
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-8 shrink-0 px-3 text-muted-foreground hover:text-foreground',
        disabled && 'opacity-40',
      )}
      onClick={onReset}
      disabled={disabled}
    >
      Reset EQ
    </Button>
  )
}

interface AudioEqPanelHeaderProps {
  targetLabel: string
  eqEnabled: boolean
  presetId: AudioEqPresetId | null
  presetPlaceholder: string
  onEnabledChange?: (enabled: boolean) => void
  onPresetChange: (presetId: string) => void
  portalContainer?: HTMLElement | null
}

/** Title bar of the floating and detached panels. */
export function AudioEqPanelHeader({
  targetLabel,
  eqEnabled,
  presetId,
  presetPlaceholder,
  onEnabledChange,
  onPresetChange,
  portalContainer,
}: AudioEqPanelHeaderProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2">
      {onEnabledChange ? (
        <Switch
          checked={eqEnabled}
          onCheckedChange={onEnabledChange}
          className="h-5 w-9 shrink-0 shadow-none ring-offset-0"
          aria-label={`Turn ${targetLabel} EQ ${eqEnabled ? 'off' : 'on'}`}
        />
      ) : (
        <div className="h-2.5 w-2.5 rounded-full bg-primary" />
      )}
      <div className="text-sm font-medium text-foreground">
        Equalizer{targetLabel ? ` - ${targetLabel}` : ''}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Preset</div>
        <EqPresetPicker
          presetId={presetId}
          placeholder={presetPlaceholder}
          disabled={!eqEnabled}
          onPresetChange={onPresetChange}
          portalContainer={portalContainer}
          compact={false}
        />
        <EqResetButton
          disabled={!eqEnabled}
          onReset={() => onPresetChange('flat')}
          compact={false}
        />
      </div>
    </div>
  )
}

interface AudioEqPanelCompactToolbarProps {
  clipEqEnabled: boolean
  presetId: AudioEqPresetId | null
  presetPlaceholder: string
  onClipEqEnabledChange: (enabled: boolean) => void
  onPresetChange: (presetId: string) => void
  portalContainer?: HTMLElement | null
}

/** Clip EQ switch, preset picker and reset, as used inside clip panels. */
export function AudioEqPanelCompactToolbar({
  clipEqEnabled,
  presetId,
  presetPlaceholder,
  onClipEqEnabledChange,
  onPresetChange,
  portalContainer,
}: AudioEqPanelCompactToolbarProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
      <Switch
        checked={clipEqEnabled}
        onCheckedChange={onClipEqEnabledChange}
        className="shrink-0"
        aria-label={`Turn clip EQ ${clipEqEnabled ? 'off' : 'on'}`}
      />
      <EqPresetPicker
        presetId={presetId}
        placeholder={presetPlaceholder}
        disabled={!clipEqEnabled}
        onPresetChange={onPresetChange}
        portalContainer={portalContainer}
        compact
      />
      <EqResetButton disabled={!clipEqEnabled} onReset={() => onPresetChange('flat')} compact />
    </div>
  )
}
