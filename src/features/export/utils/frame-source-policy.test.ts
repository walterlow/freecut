import { describe, expect, it } from 'vite-plus/test'

import {
  resolvePreviewDomVideoDrawDecision,
  resolvePreviewMediabunnyInitAction,
  shouldAllowPreviewVideoElementFallback,
  shouldTryPreviewWorkerBitmap,
  shouldUsePreviewStrictWaitingFallback,
} from './frame-source-policy'

function makeDomVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    currentTime: 5,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    dataset: {},
    ...overrides,
  } as HTMLVideoElement
}

describe('frame-source-policy', () => {
  it('accepts a ready DOM video when drift is within threshold', () => {
    const decision = resolvePreviewDomVideoDrawDecision({
      domVideo: makeDomVideo({ currentTime: 10.12 }),
      sourceTime: 10,
      speed: 1,
      isRenderingTransition: false,
    })

    expect(decision.hasReadyDomVideo).toBe(true)
    expect(decision.shouldDraw).toBe(true)
    expect(decision.driftThreshold).toBe(0.2)
  })

  it('widens DOM video tolerance when transition hold is active', () => {
    const decision = resolvePreviewDomVideoDrawDecision({
      domVideo: makeDomVideo({
        currentTime: 10.8,
        dataset: { transitionHold: '1' } as DOMStringMap,
      }),
      sourceTime: 10,
      speed: 1,
      isRenderingTransition: false,
    })

    expect(decision.shouldDraw).toBe(true)
    expect(decision.driftThreshold).toBe(1.0)
  })

  it('warms mediabunny in the background for variable-speed preview playback', () => {
    expect(
      resolvePreviewMediabunnyInitAction({
        renderMode: 'preview',
        hasMediabunny: false,
        isMediabunnyDisabled: false,
        hasEnsureVideoItemReady: true,
        speed: 1.25,
      }),
    ).toBe('warm-background-and-skip')
  })

  it('awaits mediabunny readiness for 1x preview playback', () => {
    expect(
      resolvePreviewMediabunnyInitAction({
        renderMode: 'preview',
        hasMediabunny: false,
        isMediabunnyDisabled: false,
        hasEnsureVideoItemReady: true,
        speed: 1,
      }),
    ).toBe('await-ready')
  })

  it('uses strict waiting fallback only when preview has no decoder or fallback element', () => {
    expect(
      shouldUsePreviewStrictWaitingFallback({
        renderMode: 'preview',
        hasMediabunny: false,
        hasFallbackVideoElement: false,
      }),
    ).toBe(true)
    expect(
      shouldUsePreviewStrictWaitingFallback({
        renderMode: 'preview',
        hasMediabunny: true,
        hasFallbackVideoElement: false,
      }),
    ).toBe(false)
    expect(
      shouldUsePreviewStrictWaitingFallback({
        renderMode: 'export',
        hasMediabunny: false,
        hasFallbackVideoElement: false,
      }),
    ).toBe(false)
  })

  it('only tries worker bitmaps when preview lacks a ready DOM video', () => {
    expect(
      shouldTryPreviewWorkerBitmap({
        renderMode: 'preview',
        hasReadyDomVideo: false,
      }),
    ).toBe(true)
    expect(
      shouldTryPreviewWorkerBitmap({
        renderMode: 'preview',
        hasReadyDomVideo: true,
      }),
    ).toBe(false)
    expect(
      shouldTryPreviewWorkerBitmap({
        renderMode: 'export',
        hasReadyDomVideo: false,
      }),
    ).toBe(false)
  })

  it('allows preview video element fallback when mediabunny is unavailable', () => {
    expect(
      shouldAllowPreviewVideoElementFallback({
        renderMode: 'preview',
        hasFallbackVideoElement: true,
        hasMediabunny: false,
        isMediabunnyDisabled: false,
        mediabunnyFailedThisFrame: false,
      }),
    ).toBe(true)
    expect(
      shouldAllowPreviewVideoElementFallback({
        renderMode: 'preview',
        hasFallbackVideoElement: true,
        hasMediabunny: true,
        isMediabunnyDisabled: false,
        mediabunnyFailedThisFrame: false,
      }),
    ).toBe(false)
  })
})
