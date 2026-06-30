import React, { useCallback, useEffect, useRef } from 'react'
import { useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useVideoConfig } from '../hooks/use-player-compat'
import { getVideoTargetTimeSeconds } from '../utils/video-timing'
import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import {
  createProResSampleSink,
  detectProResTrack,
  type ProResSampleSink,
} from '@/infrastructure/browser/prores-sample-sink'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('ProResPreviewCanvas')

interface ProResPreviewState {
  sink: ProResSampleSink | null
  input: { dispose?: () => void } | null
  disposed: boolean
  pendingTime: number | null
  lastDrawnTime: number
  running: boolean
}

/**
 * DOM-layer preview for ProRes clips, which the browser cannot decode through a
 * `<video>` element (off-Safari). Mirrors {@link NativePreviewVideo}'s source-time
 * derivation, but decodes the frame at the current time via turbores and paints it to
 * a `<canvas>` mounted in the clip container. Rapid seeks are coalesced to the latest
 * requested time so scrubbing stays responsive (ProRes is all-intra — every frame is a
 * standalone seek).
 */
export const ProResPreviewCanvas: React.FC<{
  itemId: string
  src: string
  safeTrimBefore: number
  sequenceFrameOffset?: number
  sourceFps: number
  playbackRate: number
  isReversed?: boolean
  reverseSourceEnd?: number
  onError: (error: Error) => void
}> = ({
  itemId,
  src,
  safeTrimBefore,
  sequenceFrameOffset = 0,
  sourceFps,
  playbackRate,
  isReversed = false,
  reverseSourceEnd,
  onError,
}) => {
  const frame = useSequenceContext()?.localFrame ?? 0
  const { fps } = useVideoConfig()

  const targetTime = getVideoTargetTimeSeconds(
    safeTrimBefore,
    sourceFps,
    frame,
    playbackRate,
    fps,
    sequenceFrameOffset,
    isReversed,
    reverseSourceEnd,
  )

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef<ProResPreviewState | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // Drain pending seeks, always decoding the latest requested time and skipping
  // intermediate ones that arrived while a decode was in flight.
  const runDrawLoop = useCallback(async () => {
    const state = stateRef.current
    if (!state || state.running) return
    state.running = true
    try {
      while (
        !state.disposed &&
        state.sink &&
        state.pendingTime !== null &&
        state.pendingTime !== state.lastDrawnTime
      ) {
        const time = state.pendingTime
        state.lastDrawnTime = time
        const { value: sample } = await state.sink.samplesAtTimestamps([time]).next()
        if (state.disposed) {
          sample?.close()
          break
        }
        const canvas = canvasRef.current
        if (sample && canvas) {
          if (canvas.width !== sample.displayWidth) canvas.width = sample.displayWidth
          if (canvas.height !== sample.displayHeight) canvas.height = sample.displayHeight
          const ctx = canvas.getContext('2d')
          if (ctx) {
            sample.draw(ctx, 0, 0, canvas.width, canvas.height)
          }
        }
        sample?.close()
      }
    } catch (error) {
      log.warn('ProRes preview decode failed', { itemId, error })
      onErrorRef.current(error instanceof Error ? error : new Error(String(error)))
    } finally {
      const state = stateRef.current
      if (state) state.running = false
    }
  }, [itemId])

  // Mount the canvas and open the turbores-backed source.
  useEffect(() => {
    const state: ProResPreviewState = {
      sink: null,
      input: null,
      disposed: false,
      pendingTime: null,
      lastDrawnTime: Number.NaN,
      running: false,
    }
    stateRef.current = state

    void (async () => {
      try {
        const mb = await import('mediabunny')
        const input = new mb.Input({
          formats: mb.ALL_FORMATS,
          source: createMediabunnyInputSource(mb, src),
        })
        const track = await input.getPrimaryVideoTrack()
        if (!track) {
          throw new Error('No video track in ProRes source')
        }
        const info = await detectProResTrack(mb, track)
        if (!info) {
          throw new Error('Source is not a recognized ProRes track')
        }
        const sink = createProResSampleSink(mb, track, info)
        if (state.disposed) {
          await sink.close()
          input.dispose()
          return
        }
        state.input = input
        state.sink = sink
        // Paint the current frame now that the decoder is ready.
        void runDrawLoop()
      } catch (error) {
        if (!state.disposed) {
          onErrorRef.current(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })()

    return () => {
      state.disposed = true
      void state.sink?.close()
      state.input?.dispose?.()
      if (stateRef.current === state) {
        stateRef.current = null
      }
    }
  }, [src, itemId, runDrawLoop])

  // Request a decode whenever the source time changes.
  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    state.pendingTime = targetTime
    void runDrawLoop()
  }, [targetTime, runDrawLoop])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
    />
  )
}
