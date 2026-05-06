/**
 * MonitorVolumeControl
 *
 * Per-device monitor-gain slider that sits next to the playback transport
 * controls. Drives `usePlaybackStore.volume` / `.muted` — which are
 * persisted per-origin in localStorage and applied only to preview, NOT
 * to exports. The project-scoped master bus fader lives in the audio
 * mixer panel.
 *
 * Click the icon button to toggle the slider popover. Mute toggles via
 * the mute button inside the popover.
 */

import { useMemo, type CSSProperties } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { usePlaybackStore } from '@/shared/state/playback'

interface MonitorVolumeControlProps {
  /** Style forwarded to the trigger button so it matches sibling controls. */
  buttonStyle?: CSSProperties
}

export function MonitorVolumeControl({ buttonStyle }: MonitorVolumeControlProps) {
  const volume = usePlaybackStore((s) => s.volume)
  const muted = usePlaybackStore((s) => s.muted)
  const setVolume = usePlaybackStore((s) => s.setVolume)
  const toggleMute = usePlaybackStore((s) => s.toggleMute)

  const Icon = useMemo(() => {
    if (muted || volume <= 0) return VolumeX
    if (volume < 0.5) return Volume1
    return Volume2
  }, [muted, volume])

  const percent = Math.round(volume * 100)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="flex-shrink-0"
          style={buttonStyle}
          data-tooltip={muted ? '监听已静音' : `监听 ${percent}%`}
          aria-label="监听音量"
        >
          <Icon className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 space-y-3" align="center" side="top" sideOffset={6}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">监听</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            仅当前设备
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={toggleMute}
            aria-label={muted ? '取消监听静音' : '监听静音'}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </Button>
          <Slider
            value={[muted ? 0 : volume]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={([v]) => {
              if (v === undefined) return
              if (muted && v > 0) toggleMute()
              setVolume(v)
            }}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">
            {muted ? '静音' : `${percent}%`}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-snug">
          仅影响预览，不影响项目主总线或导出结果。
        </p>
      </PopoverContent>
    </Popover>
  )
}
