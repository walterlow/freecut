import { useCallback, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Compass,
  Globe,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sliders,
  Square,
  ShieldAlert,
  ShieldCheck,
  Expand,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import type { TimelineItem } from '@/types/timeline'
import {
  type FovPreset,
  type HorizonLockMode,
  type Projection360Settings,
  type ProjectionSourceMode,
  DEFAULT_PROJECTION_360_SETTINGS,
  applyFovPreset,
} from '@/types/projection360'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { PropertySection, PropertyRow, SliderInput } from '../components'

interface Projection360SectionProps {
  items: TimelineItem[]
}

interface PresetOption {
  id: FovPreset
  label: string
  sublabel: string
  icon: typeof Globe
}

const PRESET_BUTTONS: PresetOption[] = [
  { id: 'ultra-wide', label: 'UltraWide', sublabel: 'Lente Nativa', icon: Maximize2 },
  { id: 'wide', label: 'Wide', sublabel: 'Gran Angular', icon: Expand },
  { id: 'linear', label: 'Linear', sublabel: 'Rectilíneo', icon: Square },
  { id: 'narrow', label: 'Narrow', sublabel: 'Teleobjetivo', icon: Minimize2 },
  { id: 'horizon-45', label: '45° Horizont', sublabel: '±45° Lock', icon: ShieldAlert },
  { id: 'horizon-360', label: '360° Horizont', sublabel: '360° Lock', icon: ShieldCheck },
  { id: 'custom', label: 'Libre', sublabel: 'Sliders', icon: Sliders },
]

export const Projection360Section = memo(function Projection360Section({
  items,
}: Projection360SectionProps) {
  const { t } = useTranslation()
  const updateItem = useTimelineStore((s) => s.updateItem)

  const mediaItems = useMemo(
    () => items.filter((item) => item.type === 'video' || item.type === 'image'),
    [items],
  )

  const activeItem = mediaItems[0] ?? null
  const currentSettings: Projection360Settings = useMemo(() => {
    if (!activeItem?.projection360) {
      return { ...DEFAULT_PROJECTION_360_SETTINGS, enabled: false }
    }
    return activeItem.projection360
  }, [activeItem?.projection360])

  const isEnabled = currentSettings.enabled
  const sourceMode: ProjectionSourceMode = currentSettings.sourceMode ?? 'ultrawide'

  const updateSettings = useCallback(
    (updates: Partial<Projection360Settings>) => {
      mediaItems.forEach((item) => {
        const existing = item.projection360 ?? DEFAULT_PROJECTION_360_SETTINGS
        updateItem(item.id, {
          projection360: {
            ...existing,
            ...updates,
          },
        })
      })
      const playback = usePlaybackStore.getState()
      const currentFrame = playback.previewFrame ?? playback.currentFrame
      usePreviewBridgeStore.getState().requestPostEditWarm(
        currentFrame,
        mediaItems.map((item) => item.id),
      )
    },
    [mediaItems, updateItem],
  )

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      updateSettings({ enabled })
    },
    [updateSettings],
  )

  const handleSelectPreset = useCallback(
    (preset: FovPreset) => {
      const next = applyFovPreset(currentSettings, preset)
      updateSettings({
        enabled: true,
        preset: next.preset,
        fov: next.fov,
        distance: next.distance,
        distortion: next.distortion,
        horizonLock: next.horizonLock,
      })
    },
    [currentSettings, updateSettings],
  )

  const handleResetCamera = useCallback(() => {
    updateSettings({
      yaw: 0,
      pitch: 0,
      roll: 0,
      horizonOffset: 0,
    })
  }, [updateSettings])

  const handleResetAll = useCallback(() => {
    updateSettings({ ...DEFAULT_PROJECTION_360_SETTINGS })
  }, [updateSettings])

  if (mediaItems.length === 0) {
    return null
  }

  const isCustomMode = currentSettings.preset === 'custom'

  return (
    <PropertySection
      title={t('editor.clipPanel.projection360Title', { defaultValue: 'FOV Options & Dewarp' })}
      enabled={isEnabled}
      onEnabledChange={handleToggleEnabled}
      actions={
        isEnabled ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleResetAll}
            title={t('common.reset', { defaultValue: 'Restablecer' })}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4 pt-1">
        {/* Source Projection Kind Selector */}
        <div className="bg-muted/40 p-2 rounded border border-border/50 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>{t('editor.clipPanel.sourceProjection', { defaultValue: 'Tipo de Video' })}</span>
            <span className="text-[10px] text-primary font-normal">
              {sourceMode === 'spherical_360' ? '360° Esférico' : 'UltraWide Plano (Dewarp)'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => updateSettings({ sourceMode: 'ultrawide' })}
              className={cn(
                'py-1 px-2 rounded text-[11px] font-medium border text-center transition-colors',
                sourceMode === 'ultrawide'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/60 hover:bg-muted/50 text-muted-foreground',
              )}
            >
              {t('editor.clipPanel.sourceUltrawide', { defaultValue: 'UltraWide / Plano' })}
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ sourceMode: 'spherical_360' })}
              className={cn(
                'py-1 px-2 rounded text-[11px] font-medium border text-center transition-colors',
                sourceMode === 'spherical_360'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/60 hover:bg-muted/50 text-muted-foreground',
              )}
            >
              {t('editor.clipPanel.sourceSpherical360', { defaultValue: '360° Esférico' })}
            </button>
          </div>
        </div>

        {/* Preset Selector Grid */}
        <div>
          <div className="text-[11px] font-medium text-muted-foreground mb-2">
            {t('editor.clipPanel.fovPresets', { defaultValue: 'Opciones FOV (Dewarp / Lente)' })}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESET_BUTTONS.slice(0, 6).map((preset) => {
              const Icon = preset.icon
              const isSelected = currentSettings.preset === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  className={cn(
                    'flex flex-col items-center justify-center p-2 rounded border text-center transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary font-medium shadow-sm'
                      : 'border-border/60 hover:border-border hover:bg-muted/50 text-foreground',
                  )}
                >
                  <Icon className={cn('h-4 w-4 mb-1', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="text-[11px] leading-tight font-medium">{preset.label}</span>
                  <span className="text-[9px] text-muted-foreground leading-none mt-0.5">{preset.sublabel}</span>
                </button>
              )
            })}
          </div>

          {/* 7th Option: Libre (Custom) */}
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => handleSelectPreset('custom')}
              className={cn(
                'w-full flex items-center justify-center gap-2 p-2 rounded border transition-colors',
                isCustomMode
                  ? 'border-primary bg-primary/10 text-primary font-medium shadow-sm'
                  : 'border-border/60 hover:border-border hover:bg-muted/50 text-foreground',
              )}
            >
              <Sliders className={cn('h-4 w-4', isCustomMode ? 'text-primary' : 'text-muted-foreground')} />
              <span className="text-xs font-medium">
                {t('editor.clipPanel.presetCustom', { defaultValue: 'Modo Libre (Sliders)' })}
              </span>
            </button>
          </div>
        </div>

        {/* Detailed Controls */}
        <div className="space-y-3 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t('editor.clipPanel.lensGeometry', { defaultValue: 'Geometría y Perspectiva' })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={handleResetCamera}
            >
              <Compass className="h-3 w-3 mr-1" />
              {t('editor.clipPanel.centerCamera', { defaultValue: 'Centrar Vista' })}
            </Button>
          </div>

          {/* Horizontal FOV */}
          <PropertyRow label={t('editor.clipPanel.fov', { defaultValue: 'Campo de Visión (FOV)' })}>
            <SliderInput
              value={currentSettings.fov}
              onChange={(value) => updateSettings({ fov: value, preset: 'custom' })}
              min={30}
              max={150}
              step={1}
              unit="°"
            />
          </PropertyRow>

          {/* Distance / Zoom */}
          <PropertyRow label={t('editor.clipPanel.zoomDistance', { defaultValue: 'Distancia / Zoom' })}>
            <SliderInput
              value={currentSettings.distance}
              onChange={(value) => updateSettings({ distance: value, preset: 'custom' })}
              min={0.5}
              max={3.0}
              step={0.05}
              unit="x"
            />
          </PropertyRow>

          {/* Curvature / Dewarp */}
          <PropertyRow label={t('editor.clipPanel.curvature', { defaultValue: 'Curvatura (De-warp)' })}>
            <SliderInput
              value={Math.round(currentSettings.distortion * 100)}
              onChange={(value) => updateSettings({ distortion: value / 100, preset: 'custom' })}
              min={0}
              max={100}
              step={1}
              unit="%"
            />
          </PropertyRow>

          {/* 3D Camera Angles */}
          <div className="text-[11px] font-medium text-muted-foreground pt-1">
            {t('editor.clipPanel.cameraAngles', { defaultValue: 'Orientación de Cámara (Reframe)' })}
          </div>

          {/* Pan / Yaw */}
          <PropertyRow label={t('editor.clipPanel.yaw', { defaultValue: 'Giro Horizontal (Yaw)' })}>
            <SliderInput
              value={currentSettings.yaw}
              onChange={(value) => updateSettings({ yaw: value })}
              min={-180}
              max={180}
              step={0.5}
              unit="°"
            />
          </PropertyRow>

          {/* Tilt / Pitch */}
          <PropertyRow label={t('editor.clipPanel.pitch', { defaultValue: 'Inclinación (Pitch)' })}>
            <SliderInput
              value={currentSettings.pitch}
              onChange={(value) => updateSettings({ pitch: value })}
              min={-90}
              max={90}
              step={0.5}
              unit="°"
            />
          </PropertyRow>

          {/* Roll */}
          <PropertyRow label={t('editor.clipPanel.roll', { defaultValue: 'Rotación Axial (Roll)' })}>
            <SliderInput
              value={currentSettings.roll}
              onChange={(value) => updateSettings({ roll: value })}
              min={-180}
              max={180}
              step={0.5}
              unit="°"
            />
          </PropertyRow>

          {/* Horizon Lock Mode */}
          <PropertyRow label={t('editor.clipPanel.horizonLock', { defaultValue: 'Nivelación Horizonte' })}>
            <div className="grid grid-cols-3 gap-1 w-full">
              {(['off', '45', '360'] as HorizonLockMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => updateSettings({ horizonLock: mode })}
                  className={cn(
                    'py-1 px-1.5 rounded text-[10px] font-medium border text-center transition-colors',
                    currentSettings.horizonLock === mode
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/60 hover:bg-muted/50 text-muted-foreground',
                  )}
                >
                  {mode === 'off' ? 'Off' : mode === '45' ? '45° Lock' : '360° Lock'}
                </button>
              ))}
            </div>
          </PropertyRow>

          {/* Horizon Manual Offset */}
          <PropertyRow label={t('editor.clipPanel.horizonOffset', { defaultValue: 'Offset de Horizonte' })}>
            <SliderInput
              value={currentSettings.horizonOffset}
              onChange={(value) => updateSettings({ horizonOffset: value })}
              min={-45}
              max={45}
              step={0.5}
              unit="°"
            />
          </PropertyRow>
        </div>
      </div>
    </PropertySection>
  )
})
