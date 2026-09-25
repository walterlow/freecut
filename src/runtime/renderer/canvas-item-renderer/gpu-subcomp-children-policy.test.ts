// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { AdjustmentItem, TimelineItem } from '@/types/timeline'
import type { ItemEffect } from '@/types/effects'
import type { ItemKeyframes } from '@/types/keyframe'
import { getAnimatedTransform } from '../canvas-keyframes'
import {
  combineEffects,
  getAdjustmentLayerEffects,
  type AdjustmentLayerWithTrackOrder,
} from '../canvas-effects'
import { getItemRenderTimelineSpan } from '../render-span'
import {
  resolveSubCompChildLayers,
  resolveSubCompChildLayerWrites,
} from './gpu-subcomp-children-policy'
import type { SubCompChildLayer } from './gpu-subcomp-children-policy'
import type { CanvasSettings } from './types'

/** The mask fields the child pass reads, plus the flag its support predicate keys on. */
interface FixtureMask {
  trackOrder: number
  supported: boolean
}

interface FixtureEffectsContext {
  renderMode: 'export' | 'preview'
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
  getLiveItemSnapshotById?: (itemId: string) => TimelineItem | undefined
}

interface ChildPlanInput {
  sortedTracks: Array<{ order: number; visible: boolean; items: TimelineItem[] }>
  keyframesMap: Map<string, ItemKeyframes>
  localFrame: number
  occlusionCutoffOrder: number | null
  activeMasks: FixtureMask[]
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  canvasSettings: CanvasSettings
  effectsContext: FixtureEffectsContext
  hasBlendPipeline: boolean
  hasEffectsPipeline: boolean
}

/**
 * Verbatim copy of the child walk that `renderGpuSubCompChildrenToTexture` ran
 * inline before the move, with the render context narrowed to the fields that
 * walk reads. It stays here as the equivalence oracle so a gate regression
 * cannot slip into the extracted policy:
 *
 * - the mask filter is the inline `doesMaskAffectTrack` comparison;
 * - `hasEffectsPipeline` stands in for the inline `!rctx.gpuPipeline`, which the
 *   caller only ever reaches with a pipeline present (the guard above the walk
 *   returns first);
 * - `masksSupported` stands in for the inline `areGpuSubCompMasksSupported`,
 *   which needs the GPU shape pipeline's path resolver and therefore stays in
 *   `gpu.ts` as an injected predicate.
 */
function childLayersVerbatim(
  input: ChildPlanInput,
  masksSupported: (masks: FixtureMask[]) => boolean,
): Array<SubCompChildLayer<FixtureMask>> | null {
  const rctx = input.effectsContext
  const visibleChildren: Array<SubCompChildLayer<FixtureMask>> = []
  for (const track of input.sortedTracks) {
    if (!track.visible) continue
    if (input.occlusionCutoffOrder !== null && track.order > input.occlusionCutoffOrder) continue
    for (const item of track.items) {
      if (input.localFrame < item.from || input.localFrame >= item.from + item.durationInFrames) {
        continue
      }
      if (
        item.type === 'adjustment' ||
        item.type === 'controller' ||
        (item.type === 'shape' && item.isMask)
      )
        continue
      if (item.blendMode && item.blendMode !== 'normal' && !input.hasBlendPipeline) {
        return null
      }
      const applicableMasks = input.activeMasks.filter((mask) => mask.trackOrder < track.order)
      if (!masksSupported(applicableMasks)) return null
      const itemEffects =
        (rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride?.(item.id) : undefined) ??
        item.effects ??
        []
      const adjEffects = getAdjustmentLayerEffects(
        track.order,
        input.adjustmentLayers,
        input.localFrame,
        rctx.renderMode === 'preview' ? rctx.getPreviewEffectsOverride : undefined,
        rctx.renderMode === 'preview' ? rctx.getLiveItemSnapshotById : undefined,
      )
      const effects = combineEffects(itemEffects, adjEffects)
      if (
        effects.some((effect) => effect.enabled && effect.effect.type !== 'gpu-effect') ||
        (effects.some((effect) => effect.enabled) && !input.hasEffectsPipeline)
      ) {
        return null
      }
      visibleChildren.push({
        participant: {
          item,
          transform: getAnimatedTransform(
            item,
            input.keyframesMap.get(item.id),
            input.localFrame,
            input.canvasSettings,
          ),
          effects,
          renderSpan: getItemRenderTimelineSpan(item),
        },
        masks: applicableMasks,
      })
    }
  }
  if (visibleChildren.length === 0) return null
  return visibleChildren
}

const CANVAS: CanvasSettings = { width: 640, height: 360, fps: 30 }

const masksSupported = (masks: ReadonlyArray<FixtureMask>): boolean =>
  masks.every((mask) => mask.supported)

function makeItem(id: string, overrides: Record<string, unknown> = {}): TimelineItem {
  return {
    id,
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: id,
    type: 'video',
    sourceWidth: 640,
    sourceHeight: 360,
    transform: { x: 0, y: 0, width: 640, height: 360, rotation: 0, opacity: 1, cornerRadius: 0 },
    effects: [],
    ...overrides,
  } as unknown as TimelineItem
}

function makeGpuEffect(id: string, enabled: boolean): ItemEffect {
  return { id, enabled, effect: { type: 'gpu-effect', params: {} } } as unknown as ItemEffect
}

function makeNonGpuEffect(id: string, enabled: boolean): ItemEffect {
  return { id, enabled, effect: { type: 'blur' } } as unknown as ItemEffect
}

function makeAdjustmentLayer(
  trackOrder: number,
  effects: ItemEffect[],
  overrides: Record<string, unknown> = {},
): AdjustmentLayerWithTrackOrder {
  return {
    trackOrder,
    layer: {
      id: `adjustment-${trackOrder}`,
      trackId: 'track-adj',
      from: 0,
      durationInFrames: 30,
      label: 'adjustment',
      type: 'adjustment',
      effects,
      ...overrides,
    } as unknown as AdjustmentItem,
  }
}

function baseInput(overrides: Partial<ChildPlanInput> = {}): ChildPlanInput {
  return {
    sortedTracks: [],
    keyframesMap: new Map(),
    localFrame: 0,
    occlusionCutoffOrder: null,
    activeMasks: [],
    adjustmentLayers: [],
    canvasSettings: CANVAS,
    effectsContext: { renderMode: 'export' },
    hasBlendPipeline: true,
    hasEffectsPipeline: true,
    ...overrides,
  }
}

function plan(input: ChildPlanInput): Array<SubCompChildLayer<FixtureMask>> | null {
  return resolveSubCompChildLayers({
    ...input,
    areChildMasksSupported: masksSupported,
  })
}

function layerIds(layers: Array<SubCompChildLayer<FixtureMask>> | null): string[] | null {
  return layers?.map((layer) => layer.participant.item.id) ?? null
}

describe('resolveSubCompChildLayers', () => {
  it('matches the inline child walk on every generated sub-composition', () => {
    const random = createSeededRandom(0x5eed_1234)
    const cases: ChildPlanInput[] = [...explicitChildPlans()]
    for (let index = 0; index < 400; index++) {
      cases.push(randomChildPlan(random))
    }
    let rendered = 0
    for (const input of cases) {
      const expected = childLayersVerbatim(input, masksSupported)
      expect(plan(input)).toEqual(expected)
      if (expected) rendered++
    }
    // Both outcomes must be well represented, or the equivalence proves nothing.
    const blocked = cases.length - rendered
    expect(rendered).toBeGreaterThan(150)
    expect(blocked).toBeGreaterThan(150)
  })

  it('keeps only tracks at or below the occlusion cutoff', () => {
    const tracks = [
      { order: 0, visible: true, items: [makeItem('top')] },
      { order: 1, visible: true, items: [makeItem('middle')] },
      { order: 2, visible: true, items: [makeItem('bottom')] },
    ]
    expect(layerIds(plan(baseInput({ sortedTracks: tracks })))).toEqual(['top', 'middle', 'bottom'])
    expect(layerIds(plan(baseInput({ sortedTracks: tracks, occlusionCutoffOrder: 1 })))).toEqual([
      'top',
      'middle',
    ])
    expect(layerIds(plan(baseInput({ sortedTracks: tracks, occlusionCutoffOrder: 0 })))).toEqual([
      'top',
    ])
    expect(layerIds(plan(baseInput({ sortedTracks: tracks, occlusionCutoffOrder: -1 })))).toBeNull()
  })

  it('drops hidden tracks, inactive items and non-rendering item kinds', () => {
    const input = baseInput({
      localFrame: 10,
      sortedTracks: [
        {
          order: 0,
          visible: false,
          items: [makeItem('hidden-track')],
        },
        {
          order: 1,
          visible: true,
          items: [
            makeItem('ended', { from: 0, durationInFrames: 10 }),
            makeItem('starts-later', { from: 11, durationInFrames: 10 }),
            makeItem('active', { from: 10, durationInFrames: 10 }),
            makeItem('adjustment', { type: 'adjustment' }),
            makeItem('controller', { type: 'controller' }),
            makeItem('shape-mask', { type: 'shape', isMask: true }),
            makeItem('shape', { type: 'shape' }),
          ],
        },
      ],
    })
    expect(layerIds(plan(input))).toEqual(['active', 'shape'])
  })

  it('blocks the frame on a non-normal blend without the blend pipeline', () => {
    const tracks = [
      { order: 0, visible: true, items: [makeItem('normal', { blendMode: 'normal' })] },
      { order: 1, visible: true, items: [makeItem('multiply', { blendMode: 'multiply' })] },
    ]
    expect(layerIds(plan(baseInput({ sortedTracks: tracks })))).toEqual(['normal', 'multiply'])
    expect(layerIds(plan(baseInput({ sortedTracks: tracks, hasBlendPipeline: false })))).toBeNull()
  })

  it('scopes a track to the masks authored below it', () => {
    const tracks = [
      { order: 1, visible: true, items: [makeItem('masked')] },
      { order: 2, visible: true, items: [makeItem('unmasked')] },
    ]
    const input = baseInput({
      sortedTracks: tracks,
      activeMasks: [
        { trackOrder: 0, supported: true },
        { trackOrder: 1, supported: true },
      ],
    })
    const layers = plan(input)
    expect(layerIds(layers)).toEqual(['masked', 'unmasked'])
    expect(layers?.[0]?.masks.map((mask) => mask.trackOrder)).toEqual([0])
    expect(layers?.[1]?.masks.map((mask) => mask.trackOrder)).toEqual([0, 1])
  })

  it('blocks the frame on masks the mask pipeline cannot render, but only where they apply', () => {
    const tracks = [
      { order: 1, visible: true, items: [makeItem('below-mask')] },
      { order: 2, visible: true, items: [makeItem('above-mask')] },
    ]
    // A mask authored above every item scopes nothing, so it cannot block.
    expect(
      layerIds(
        plan(
          baseInput({
            sortedTracks: tracks,
            activeMasks: [{ trackOrder: 2, supported: false }],
          }),
        ),
      ),
    ).toEqual(['below-mask', 'above-mask'])
    // Once the unsupported mask scopes a candidate, the whole frame falls back.
    expect(
      layerIds(
        plan(
          baseInput({
            sortedTracks: tracks,
            activeMasks: [{ trackOrder: 1, supported: false }],
          }),
        ),
      ),
    ).toBeNull()
  })

  it('blocks the frame on enabled non-GPU effects and on GPU effects without a pipeline', () => {
    const withEffects = (effects: ItemEffect[]) =>
      baseInput({
        sortedTracks: [{ order: 0, visible: true, items: [makeItem('item', { effects })] }],
      })
    expect(layerIds(plan(withEffects([makeGpuEffect('gpu', true)])))).toEqual(['item'])
    expect(layerIds(plan(withEffects([makeGpuEffect('gpu', false)])))).toEqual(['item'])
    expect(layerIds(plan(withEffects([makeNonGpuEffect('cpu', false)])))).toEqual(['item'])
    expect(layerIds(plan(withEffects([makeNonGpuEffect('cpu', true)])))).toBeNull()
    expect(
      layerIds(plan(withEffects([makeGpuEffect('gpu', true), makeNonGpuEffect('cpu', true)]))),
    ).toBeNull()

    const disabledPipeline = baseInput({
      hasEffectsPipeline: false,
      sortedTracks: [{ order: 0, visible: true, items: [makeItem('item')] }],
    })
    expect(layerIds(plan(disabledPipeline))).toEqual(['item'])
    expect(
      layerIds(
        plan({
          ...disabledPipeline,
          sortedTracks: [
            {
              order: 0,
              visible: true,
              items: [makeItem('item', { effects: [makeGpuEffect('gpu', true)] })],
            },
          ],
        }),
      ),
    ).toBeNull()
  })

  it('stacks adjustment-layer effects below the item effects and honours the preview override', () => {
    const emptyItem = baseInput({
      adjustmentLayers: [makeAdjustmentLayer(0, [makeGpuEffect('adjustment', true)])],
      sortedTracks: [
        {
          order: 1,
          visible: true,
          items: [makeItem('item', { effects: [makeGpuEffect('authored', true)] })],
        },
      ],
    })
    expect(plan(emptyItem)?.[0]?.participant.effects.map((effect) => effect.id)).toEqual([
      'adjustment',
      'authored',
    ])
    // An adjustment scoped to a track below the item does not reach it.
    expect(
      plan({
        ...emptyItem,
        adjustmentLayers: [makeAdjustmentLayer(1, [makeGpuEffect('a', true)])],
      })?.[0]?.participant.effects.map((effect) => effect.id),
    ).toEqual(['authored'])

    const preview = baseInput({
      effectsContext: {
        renderMode: 'preview',
        getPreviewEffectsOverride: (itemId) =>
          itemId === 'item' ? [makeGpuEffect('preview', true)] : undefined,
      },
      sortedTracks: [
        {
          order: 0,
          visible: true,
          items: [makeItem('item', { effects: [makeGpuEffect('authored', true)] })],
        },
      ],
    })
    expect(plan(preview)?.[0]?.participant.effects.map((effect) => effect.id)).toEqual(['preview'])
  })

  it('returns null when nothing survives the gates or a track holds no items', () => {
    expect(plan(baseInput())).toBeNull()
    expect(
      plan(
        baseInput({
          sortedTracks: [{ order: 0, visible: true, items: [] }],
        }),
      ),
    ).toBeNull()
    expect(
      plan(
        baseInput({
          localFrame: 40,
          sortedTracks: [{ order: 0, visible: true, items: [makeItem('item')] }],
        }),
      ),
    ).toBeNull()
  })

  it('plans layers in track then item order with the resolved transform and render span', () => {
    const item = makeItem('item', { from: 4, durationInFrames: 8 })
    const layers = plan(
      baseInput({
        localFrame: 6,
        sortedTracks: [
          { order: 0, visible: true, items: [item] },
          { order: 1, visible: true, items: [makeItem('second')] },
        ],
      }),
    )
    expect(layerIds(layers)).toEqual(['item', 'second'])
    expect(layers?.[0]?.participant.item).toBe(item)
    expect(layers?.[0]?.participant.renderSpan).toEqual(getItemRenderTimelineSpan(item))
    expect(layers?.[0]?.participant.transform).toEqual(
      getAnimatedTransform(item, undefined, 6, CANVAS),
    )
  })
})

describe('resolveSubCompChildLayerWrites', () => {
  it('clears the target for the first layer only and blends every layer', () => {
    expect(resolveSubCompChildLayerWrites(0)).toEqual([])
    expect(resolveSubCompChildLayerWrites(1)).toEqual([{ clear: true, blend: true }])
    expect(resolveSubCompChildLayerWrites(3)).toEqual([
      { clear: true, blend: true },
      { clear: false, blend: true },
      { clear: false, blend: true },
    ])
  })

  it('matches the per-layer request the layer loop built inline', () => {
    for (let layerIndex = 0; layerIndex < 5; layerIndex++) {
      const writes = resolveSubCompChildLayerWrites(layerIndex + 1)
      // Verbatim `{ clear: layerIndex === 0, blend: true }` from the old loop.
      expect(writes[layerIndex]).toEqual({ clear: layerIndex === 0, blend: true })
    }
  })
})

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!
}

const ITEM_TYPES = ['video', 'image', 'text', 'shape', 'adjustment', 'controller'] as const
const BLEND_MODES_RENDERABLE = [undefined, 'normal'] as const
const BLEND_MODES_BLOCKING = ['multiply', 'screen'] as const
const OCCLUSION_CUTOFFS = [null, null, null, 0, 1, 2, 3] as const
const EFFECT_SETS_RENDERABLE: ReadonlyArray<ItemEffect[] | undefined> = [
  undefined,
  [],
  [makeGpuEffect('gpu', true)],
  [makeGpuEffect('gpu', false)],
  [makeNonGpuEffect('cpu', false)],
]
const EFFECT_SETS_BLOCKING: ReadonlyArray<ItemEffect[] | undefined> = [
  [makeNonGpuEffect('cpu', true)],
  [makeGpuEffect('gpu', true), makeNonGpuEffect('cpu', true)],
]

/**
 * Most random plans must render (so the oracle proves the layer list, not just
 * the fallback), while a solid minority must block (so the gates themselves are
 * exercised): the renderable/blocking split keeps both outcomes well populated.
 */
function randomItem(random: () => number, index: number): TimelineItem {
  return makeItem(`item-${index}`, {
    type: pick(random, ITEM_TYPES),
    isMask: random() < 0.5,
    from: pick(random, [0, 2, 5]),
    durationInFrames: pick(random, [5, 10, 30]),
    blendMode:
      random() < 0.88 ? pick(random, BLEND_MODES_RENDERABLE) : pick(random, BLEND_MODES_BLOCKING),
    effects:
      random() < 0.88 ? pick(random, EFFECT_SETS_RENDERABLE) : pick(random, EFFECT_SETS_BLOCKING),
  })
}

function randomChildPlan(random: () => number): ChildPlanInput {
  const trackCount = pick(random, [1, 2, 3])
  const sortedTracks = Array.from({ length: trackCount }, (_, index) => ({
    order: index,
    visible: random() < 0.9,
    items: Array.from({ length: pick(random, [1, 2, 3]) }, (_, itemIndex) =>
      randomItem(random, index * 10 + itemIndex),
    ),
  }))
  const maskCount = pick(random, [0, 1, 2, 3])
  const activeMasks = Array.from({ length: maskCount }, (_, index) => ({
    trackOrder: pick(random, [0, 1, 2, 3]),
    supported: random() < 0.9,
    index,
  }))
  const adjustmentCount = pick(random, [0, 1, 2])
  const adjustmentLayers = Array.from({ length: adjustmentCount }, (_, index) =>
    makeAdjustmentLayer(pick(random, [0, 1, 2]), pick(random, EFFECT_SETS_RENDERABLE) ?? [], {
      from: pick(random, [0, 5]),
      durationInFrames: pick(random, [5, 30]),
      id: `adjustment-${index}`,
    }),
  )
  return baseInput({
    sortedTracks,
    localFrame: pick(random, [0, 1, 3, 6, 10]),
    occlusionCutoffOrder: pick(random, OCCLUSION_CUTOFFS),
    activeMasks,
    adjustmentLayers,
    hasBlendPipeline: random() < 0.85,
    hasEffectsPipeline: random() < 0.8,
    effectsContext: {
      renderMode: random() < 0.5 ? 'preview' : 'export',
      getPreviewEffectsOverride: (itemId) =>
        itemId.endsWith('3') ? [makeGpuEffect('preview', true)] : undefined,
      getLiveItemSnapshotById: (itemId) =>
        itemId.endsWith('7')
          ? makeItem(itemId, { effects: [makeNonGpuEffect('live', true)] })
          : undefined,
    },
  })
}

/** Hand-picked plans covering each gate on its own and in combination. */
function explicitChildPlans(): ChildPlanInput[] {
  return [
    baseInput({
      sortedTracks: [{ order: 0, visible: true, items: [makeItem('plain')] }],
    }),
    baseInput({
      sortedTracks: [
        { order: 0, visible: true, items: [makeItem('shadowed')] },
        { order: 1, visible: true, items: [makeItem('visible')] },
      ],
      occlusionCutoffOrder: 0,
      activeMasks: [{ trackOrder: 0, supported: true }],
    }),
    baseInput({
      sortedTracks: [
        {
          order: 0,
          visible: true,
          items: [
            makeItem('blended', { blendMode: 'multiply' }),
            makeItem('masked', { type: 'shape' }),
            makeItem('controller', { type: 'controller' }),
          ],
        },
      ],
      hasBlendPipeline: false,
      activeMasks: [{ trackOrder: 0, supported: false }],
    }),
    baseInput({
      sortedTracks: [
        {
          order: 0,
          visible: true,
          items: [makeItem('item', { effects: [makeNonGpuEffect('cpu', true)] })],
        },
      ],
      hasEffectsPipeline: false,
    }),
    baseInput({
      localFrame: 4,
      sortedTracks: [
        { order: 0, visible: true, items: [makeItem('early', { from: 0, durationInFrames: 4 })] },
        { order: 1, visible: true, items: [makeItem('exact', { from: 4, durationInFrames: 4 })] },
      ],
      adjustmentLayers: [makeAdjustmentLayer(0, [makeGpuEffect('adjustment', true)])],
      activeMasks: [
        { trackOrder: 0, supported: true },
        { trackOrder: 1, supported: true },
        { trackOrder: 2, supported: false },
      ],
    }),
    baseInput({
      effectsContext: {
        renderMode: 'preview',
        getPreviewEffectsOverride: () => undefined,
        getLiveItemSnapshotById: () => makeItem('live', { type: 'adjustment' }),
      },
      sortedTracks: [
        { order: 0, visible: true, items: [makeItem('item')] },
        { order: 1, visible: false, items: [makeItem('hidden')] },
      ],
      adjustmentLayers: [makeAdjustmentLayer(0, [])],
    }),
  ]
}
