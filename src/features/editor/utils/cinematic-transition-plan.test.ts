import { describe, expect, it } from 'vitest'
import type { AudioItem, ImageItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { planCinematicStoryTransitions } from './cinematic-transition-plan'

function image(
  id: string,
  trackId: string,
  from: number,
  role?: ImageItem['cinematicDepthRole'],
): ImageItem {
  return {
    id,
    type: 'image',
    trackId,
    from,
    durationInFrames: 90,
    label: `${id}.png`,
    src: `blob:${id}`,
    cinematicDepthRole: role,
  }
}

function narration(): AudioItem {
  return {
    id: 'narration',
    type: 'audio',
    trackId: 'audio',
    from: 0,
    durationInFrames: 360,
    label: 'narration.wav',
    src: 'blob:narration',
    transcriptCaptions: {
      type: 'transcript',
      mediaId: 'narration-media',
      enabled: true,
      updatedAt: 1,
      cues: [
        { id: 'cue-1', startSeconds: 3, endSeconds: 4, text: 'The moon revealed its secret' },
        { id: 'cue-2', startSeconds: 6, endSeconds: 7, text: 'A quiet room waited' },
      ],
    },
  }
}

describe('planCinematicStoryTransitions', () => {
  it('uses sparse reference-style direction instead of softening every cut', () => {
    const items = [
      image('a', 'base', 0),
      image('b', 'base', 90),
      image('c', 'base', 180),
      image('d', 'base', 270),
    ]

    const plan = planCinematicStoryTransitions({
      items,
      selectedImageIds: items.map((item) => item.id),
      existingTransitions: [],
      narrationItem: narration(),
      fps: 30,
    })

    expect(plan).toHaveLength(2)
    expect(plan[0]).toMatchObject({
      cutFrame: 90,
      presentation: 'lightLeakBurn',
      emphasis: 'fantasy',
    })
    expect(plan[1]).toMatchObject({
      cutFrame: 180,
      presentation: 'smoothCut',
      emphasis: 'continuity',
    })
  })

  it('applies the same cut direction to background and subject layers', () => {
    const items = [
      image('bg-a', 'base', 0, 'background'),
      image('bg-b', 'base', 90, 'background'),
      image('subject-a', 'subject', 0, 'subject'),
      image('subject-b', 'subject', 90, 'subject'),
    ]

    const plan = planCinematicStoryTransitions({
      items,
      selectedImageIds: items.map((item) => item.id),
      existingTransitions: [],
      narrationItem: narration(),
      fps: 30,
    })

    expect(plan).toHaveLength(2)
    expect(new Set(plan.map((item) => item.presentation))).toEqual(new Set(['lightLeakBurn']))
    expect(new Set(plan.map((item) => item.cutFrame))).toEqual(new Set([90]))
  })

  it('does not duplicate an existing transition pair', () => {
    const items = [image('a', 'base', 0), image('b', 'base', 90)]
    const existingTransitions = [
      {
        id: 'transition',
        type: 'crossfade',
        presentation: 'fade',
        timing: 'linear',
        leftClipId: 'a',
        rightClipId: 'b',
        trackId: 'base',
        durationInFrames: 6,
      } satisfies Transition,
    ]

    expect(
      planCinematicStoryTransitions({
        items,
        selectedImageIds: items.map((item) => item.id),
        existingTransitions,
        narrationItem: narration(),
        fps: 30,
      }),
    ).toEqual([])
  })

  it('keeps documentary edits on hard cuts except at factual story turns', () => {
    const items = [image('a', 'base', 0), image('b', 'base', 90), image('c', 'base', 180)]
    const plan = planCinematicStoryTransitions({
      items,
      selectedImageIds: items.map((item) => item.id),
      existingTransitions: [],
      narrationItem: narration(),
      fps: 30,
      profile: 'documentary',
    })

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({
      cutFrame: 90,
      presentation: 'smoothCut',
      emphasis: 'documentary',
      durationInFrames: 4,
    })
  })

  it('uses a single motivated perspective transition for Magnates 3D edits', () => {
    const items = [image('a', 'base', 0), image('b', 'base', 90), image('c', 'base', 180)]
    const plan = planCinematicStoryTransitions({
      items,
      selectedImageIds: items.map((item) => item.id),
      existingTransitions: [],
      narrationItem: narration(),
      fps: 30,
      profile: 'magnates-3d',
    })

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ presentation: 'lensWarpZoom', durationInFrames: 11 })
  })
})
