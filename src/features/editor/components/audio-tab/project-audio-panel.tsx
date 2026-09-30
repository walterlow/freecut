import { useCallback, useMemo, memo } from 'react'
import {
  AudioWaveform,
  Volume2,
  VolumeX,
  Scissors,
  CheckCircle2,
  Sliders,
  Music,
  Film,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useTimelineStore, useItemsStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { toast } from 'sonner'
import type { AudioItem, VideoItem } from '@/types/timeline'

export const ProjectAudioPanel = memo(function ProjectAudioPanel() {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectItems = useSelectionStore((s) => s.selectItems)
  const items = useItemsStore((s) => s.items)
  const tracks = useItemsStore((s) => s.tracks)
  const updateItem = useTimelineStore((s) => s.updateItem)
  const extractAudioFromVideo = useTimelineStore((s) => s.extractAudioFromVideo)

  // Find single selected item
  const selectedItem = useMemo(() => {
    if (selectedItemIds.length !== 1) return null
    return items.find((i) => i.id === selectedItemIds[0]) ?? null
  }, [items, selectedItemIds])

  const selectedVideo = selectedItem?.type === 'video' ? (selectedItem as VideoItem) : null
  const selectedAudio = selectedItem?.type === 'audio' ? (selectedItem as AudioItem) : null

  // Check if selected video already has linked companion audio
  const linkedAudioCompanion = useMemo(() => {
    if (!selectedVideo) return null
    return getLinkedAudioCompanion(items, selectedVideo)
  }, [items, selectedVideo])

  // Audio tracks summary
  const audioTracks = useMemo(() => {
    return tracks.filter((t) => !t.isGroup && t.kind === 'audio')
  }, [tracks])

  // Extract audio action
  const handleExtractAudio = useCallback(() => {
    if (!selectedVideo) return
    try {
      const audioId = extractAudioFromVideo(selectedVideo.id)
      if (audioId) {
        toast.success('Audio extraído a pista independiente')
      } else {
        toast.error('No se pudo extraer el audio del video')
      }
    } catch (err) {
      toast.error(`Error al extraer audio: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [extractAudioFromVideo, selectedVideo])

  // Select linked companion audio
  const handleSelectCompanion = useCallback(() => {
    if (linkedAudioCompanion) {
      selectItems([linkedAudioCompanion.id])
    }
  }, [linkedAudioCompanion, selectItems])

  // Audio editing params
  const currentVolume = selectedAudio?.volume ?? selectedVideo?.volume ?? 0
  const currentFadeIn = selectedAudio?.audioFadeIn ?? selectedVideo?.audioFadeIn ?? 0
  const currentFadeOut = selectedAudio?.audioFadeOut ?? selectedVideo?.audioFadeOut ?? 0
  const currentPitch = selectedAudio?.audioPitchSemitones ?? 0
  const isMuted = selectedAudio
    ? selectedAudio.volume === -60
    : selectedVideo?.embeddedAudioMuted === true

  const handleVolumeChange = useCallback(
    (vals: number[]) => {
      const val = vals[0]
      if (selectedAudio) {
        updateItem(selectedAudio.id, { volume: val })
      } else if (selectedVideo) {
        updateItem(selectedVideo.id, { volume: val })
      }
    },
    [selectedAudio, selectedVideo, updateItem],
  )

  const handleToggleMute = useCallback(() => {
    if (selectedAudio) {
      updateItem(selectedAudio.id, { volume: isMuted ? 0 : -60 })
    } else if (selectedVideo) {
      updateItem(selectedVideo.id, { embeddedAudioMuted: !isMuted })
    }
  }, [isMuted, selectedAudio, selectedVideo, updateItem])

  const handleFadeInChange = useCallback(
    (vals: number[]) => {
      const targetId = selectedAudio?.id ?? selectedVideo?.id
      if (targetId) updateItem(targetId, { audioFadeIn: vals[0] })
    },
    [selectedAudio, selectedVideo, updateItem],
  )

  const handleFadeOutChange = useCallback(
    (vals: number[]) => {
      const targetId = selectedAudio?.id ?? selectedVideo?.id
      if (targetId) updateItem(targetId, { audioFadeOut: vals[0] })
    },
    [selectedAudio, selectedVideo, updateItem],
  )

  const handlePitchChange = useCallback(
    (vals: number[]) => {
      if (selectedAudio) updateItem(selectedAudio.id, { audioPitchSemitones: vals[0] })
    },
    [selectedAudio, updateItem],
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 space-y-4 text-xs bg-background">
      {/* 1. Extract Audio from Video Section */}
      <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-3">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <Scissors className="w-4 h-4 text-primary" />
          <span>Extracción de Audio de Video</span>
        </div>

        {selectedVideo ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-md bg-secondary/40 p-2 text-[11px]">
              <div className="flex items-center gap-2 truncate">
                <Film className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground truncate">
                  {selectedVideo.label || 'Video seleccionado'}
                </span>
              </div>
              <span className="text-muted-foreground shrink-0 font-mono">
                {Math.round((selectedVideo.durationInFrames / 30) * 10) / 10}s
              </span>
            </div>

            {linkedAudioCompanion ? (
              <div className="flex items-center justify-between p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-medium">Audio extraído en pista A1/A2</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleSelectCompanion}
                  className="h-6 text-[10px] px-2 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/20"
                >
                  Ver Clip Audio
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleExtractAudio}
                className="w-full gap-2 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Scissors className="w-3.5 h-3.5" />
                Extraer Audio a Pista Independiente
              </Button>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground bg-secondary/10 p-2.5 rounded-md border border-dashed border-border/60">
            <p>
              Selecciona un clip de video en la línea de tiempo para extraer su pista de audio de
              manera independiente.
            </p>
          </div>
        )}
      </div>

      {/* 2. Quick Audio Controls (when audio or video selected) */}
      {(selectedAudio || selectedVideo) && (
        <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-3">
          <div className="flex items-center justify-between text-foreground font-semibold">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" />
              <span>
                {selectedAudio ? 'Propiedades del Clip de Audio' : 'Audio Embebido del Video'}
              </span>
            </div>
            <Button
              size="sm"
              variant={isMuted ? 'destructive' : 'outline'}
              onClick={handleToggleMute}
              className="h-6 px-2 text-[10px] gap-1"
            >
              {isMuted ? (
                <>
                  <VolumeX className="w-3 h-3" />
                  Muteado
                </>
              ) : (
                <>
                  <Volume2 className="w-3 h-3" />
                  Activo
                </>
              )}
            </Button>
          </div>

          <div className="space-y-3 pt-1">
            {/* Volume dB */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Volumen</span>
                <span className="font-mono text-foreground">{currentVolume.toFixed(1)} dB</span>
              </div>
              <Slider
                value={[currentVolume]}
                min={-60}
                max={12}
                step={0.5}
                onValueChange={handleVolumeChange}
                className="py-1"
              />
            </div>

            {/* Fade In */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Fundido de Entrada (Fade In)</span>
                <span className="font-mono text-foreground">{currentFadeIn.toFixed(2)}s</span>
              </div>
              <Slider
                value={[currentFadeIn]}
                min={0}
                max={5}
                step={0.1}
                onValueChange={handleFadeInChange}
                className="py-1"
              />
            </div>

            {/* Fade Out */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Fundido de Salida (Fade Out)</span>
                <span className="font-mono text-foreground">{currentFadeOut.toFixed(2)}s</span>
              </div>
              <Slider
                value={[currentFadeOut]}
                min={0}
                max={5}
                step={0.1}
                onValueChange={handleFadeOutChange}
                className="py-1"
              />
            </div>

            {/* Pitch (only for independent audio) */}
            {selectedAudio && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Tono / Pitch (Semitonos)</span>
                  <span className="font-mono text-foreground">
                    {currentPitch > 0 ? `+${currentPitch}` : currentPitch} st
                  </span>
                </div>
                <Slider
                  value={[currentPitch]}
                  min={-12}
                  max={12}
                  step={1}
                  onValueChange={handlePitchChange}
                  className="py-1"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Project Audio Tracks Overview */}
      <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-2">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <AudioWaveform className="w-4 h-4 text-primary" />
          <span>Pistas de Audio en Proyecto</span>
        </div>

        {audioTracks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No hay pistas de audio dedicadas activas.
          </p>
        ) : (
          <div className="space-y-1.5 pt-1">
            {audioTracks.map((track) => {
              const trackItems = items.filter((i) => i.trackId === track.id)
              return (
                <div
                  key={track.id}
                  className="flex items-center justify-between rounded-md bg-secondary/30 px-2.5 py-1.5 text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <Music className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="font-medium text-foreground">
                      {track.name || 'Pista Audio'}
                    </span>
                  </div>
                  <span className="text-muted-foreground font-mono">
                    {trackItems.length} {trackItems.length === 1 ? 'clip' : 'clips'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})
