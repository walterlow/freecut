// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  readAnimationPresets,
  saveAnimationPresets,
  sanitizeAnimationPresets,
  type AnimationPreset,
} from './animation-presets'

const mocks = vi.hoisted(() => ({
  root: { kind: 'mock-root' },
  readJson: vi.fn(),
  writeJsonAtomic: vi.fn(),
}))

vi.mock('./root', () => ({
  requireWorkspaceRoot: () => mocks.root,
}))

vi.mock('./fs-primitives', () => ({
  readJson: (...args: unknown[]) => mocks.readJson(...args),
  writeJsonAtomic: (...args: unknown[]) => mocks.writeJsonAtomic(...args),
}))

function makePreset(overrides: Partial<AnimationPreset> = {}): AnimationPreset {
  return {
    id: 'preset-1',
    name: 'Slide in',
    sourceItemType: 'text',
    properties: [
      {
        property: 'x',
        keyframes: [
          { id: 'kf-1', frame: 0, value: -100, easing: 'linear' },
          { id: 'kf-2', frame: 30, value: 0, easing: 'ease-out' },
        ],
      },
    ],
    effects: [],
    sourceDurationInFrames: 60,
    createdAt: 1000,
    ...overrides,
  }
}

describe('workspace animation presets storage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('round-trips presets through save then read', async () => {
    const preset = makePreset({
      effects: [{ type: 'gpu-effect', gpuEffectType: 'gpu-blur', params: { amount: 2 } }],
    })

    await saveAnimationPresets('proj-A', [preset])

    expect(mocks.writeJsonAtomic).toHaveBeenCalledWith(
      mocks.root,
      ['projects', 'proj-A', 'animation-presets.json'],
      { version: 4, presets: [preset] },
    )

    // Reading back the same envelope yields identical sanitized data.
    mocks.readJson.mockResolvedValue({ version: 2, presets: [preset] })
    await expect(readAnimationPresets('proj-A')).resolves.toEqual([preset])
    expect(mocks.readJson).toHaveBeenCalledWith(mocks.root, [
      'projects',
      'proj-A',
      'animation-presets.json',
    ])
  })

  it('round-trips procedural-only layer and text recipes', () => {
    const result = sanitizeAnimationPresets({
      version: 3,
      presets: [
        {
          id: 'live-shape',
          name: 'Living shape',
          sourceItemType: 'shape',
          properties: [],
          motionModifiers: [
            {
              id: 'sway-1',
              type: 'sway',
              enabled: true,
              amplitude: 1.25,
              frequency: 0.5,
              phaseFrames: 0,
              seed: 1,
            },
          ],
        },
        {
          id: 'text-rise',
          name: 'Word rise',
          sourceItemType: 'text',
          properties: [],
          textMotion: {
            in: {
              presetId: 'rise',
              durationFrames: 14,
              staggerFrames: 4,
              intensity: 1,
              order: 'forward',
              easing: 'ease-out',
              seed: 0,
              unit: 'word',
            },
          },
        },
      ],
    })

    expect(result).toHaveLength(2)
    expect(result[0]?.motionModifiers?.[0]).toMatchObject({
      type: 'sway',
      amplitude: 1.25,
    })
    expect(result[1]?.textMotion?.in).toMatchObject({ presetId: 'rise', unit: 'word' })
  })

  it('round-trips named additive animation layers', () => {
    const result = sanitizeAnimationPresets({
      version: 4,
      presets: [
        {
          id: 'layered',
          name: 'Layered slide',
          sourceItemType: 'shape',
          properties: [],
          motionLayers: [
            {
              id: 'layer-1',
              name: 'Slide Left',
              enabled: true,
              source: 'built-in-preset',
              sourcePresetId: 'slide-left',
              tracks: [
                {
                  property: 'x',
                  blend: 'add',
                  keyframes: [
                    { id: 'k0', frame: 0, value: -100, easing: 'ease-out' },
                    { id: 'k1', frame: 20, value: 0, easing: 'linear' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    expect(result[0]?.motionLayers?.[0]).toMatchObject({
      name: 'Slide Left',
      tracks: [{ property: 'x', blend: 'add' }],
    })
  })

  it('sanitizes malformed/partial data without throwing', async () => {
    mocks.readJson.mockResolvedValue({
      version: 1,
      presets: [
        // Valid; missing createdAt/sourceDuration fall back, bad keyframe + bad effect dropped.
        {
          id: 'good',
          name: 'Good',
          sourceItemType: 'image',
          properties: [
            {
              property: 'opacity',
              keyframes: [
                { id: 'a', frame: 0, value: 0, easing: 'linear' },
                { frame: 'nope', value: 1 }, // bad frame → dropped
                { id: 'b', frame: 10, value: 1 }, // no easing → defaults to linear
              ],
            },
            { property: 'x', keyframes: [] }, // empty → dropped
          ],
          effects: [
            { type: 'gpu-effect', gpuEffectType: 'gpu-blur', params: { amount: 1 } },
            { type: 'not-an-effect' }, // dropped
          ],
        },
        // Invalid item type → entire preset dropped.
        { id: 'bad-type', name: 'X', sourceItemType: 'bogus', properties: [] },
        // No valid properties → dropped.
        {
          id: 'no-props',
          name: 'Y',
          sourceItemType: 'video',
          properties: [{ property: 'x', keyframes: [{ frame: NaN, value: 0 }] }],
        },
        // Missing required fields → dropped.
        { id: 'missing' },
        'garbage',
        null,
      ],
    })

    await expect(readAnimationPresets('proj-A')).resolves.toEqual([
      {
        id: 'good',
        name: 'Good',
        sourceItemType: 'image',
        properties: [
          {
            property: 'opacity',
            keyframes: [
              { id: 'a', frame: 0, value: 0, easing: 'linear' },
              { id: 'b', frame: 10, value: 1, easing: 'linear' },
            ],
          },
        ],
        effects: [{ type: 'gpu-effect', gpuEffectType: 'gpu-blur', params: { amount: 1 } }],
        sourceDurationInFrames: 0,
        createdAt: 0,
      },
    ])
  })

  it('preserves easingConfig when present', () => {
    const result = sanitizeAnimationPresets({
      version: 1,
      presets: [
        {
          id: 'p',
          name: 'P',
          sourceItemType: 'shape',
          properties: [
            {
              property: 'rotation',
              keyframes: [
                {
                  id: 'k',
                  frame: 0,
                  value: 0,
                  easing: 'cubic-bezier',
                  easingConfig: {
                    type: 'cubic-bezier',
                    bezier: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
                  },
                },
              ],
            },
          ],
        },
      ],
    })

    expect(result[0]?.properties[0]?.keyframes[0]?.easingConfig).toEqual({
      type: 'cubic-bezier',
      bezier: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
    })
  })

  it('round-trips v2 vector motion with temporal velocity and spatial handles', () => {
    const result = sanitizeAnimationPresets({
      version: 2,
      presets: [
        {
          id: 'vector-only',
          name: 'Curved move',
          sourceItemType: 'shape',
          properties: [],
          vectorProperties: [
            {
              property: 'position',
              keyframes: [
                {
                  id: 'p0',
                  frame: 0,
                  value: { x: -120, y: 20 },
                  easing: 'linear',
                  temporalEase: { out: { speed: 220, influence: 45 } },
                  spatial: {
                    inTangent: { x: 0, y: 0 },
                    outTangent: { x: 60, y: -40 },
                    continuous: false,
                  },
                },
              ],
            },
          ],
        },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.properties).toEqual([])
    expect(result[0]?.vectorProperties?.[0]?.keyframes[0]).toMatchObject({
      value: { x: -120, y: 20 },
      temporalEase: { out: { speed: 220, influence: 45 } },
      spatial: {
        inTangent: { x: 0, y: 0 },
        outTangent: { x: 60, y: -40 },
        continuous: false,
      },
    })
  })

  it('continues loading legacy v1 scalar-only preset files', () => {
    expect(sanitizeAnimationPresets({ version: 1, presets: [makePreset()] })).toEqual([
      makePreset(),
    ])
  })

  it('returns an empty set when the file does not exist', async () => {
    mocks.readJson.mockResolvedValue(null)
    await expect(readAnimationPresets('proj-A')).resolves.toEqual([])
  })

  it('returns an empty set when reading throws', async () => {
    mocks.readJson.mockRejectedValue(new Error('boom'))
    await expect(readAnimationPresets('proj-A')).resolves.toEqual([])
  })

  it('throws a friendly error when writing fails', async () => {
    mocks.writeJsonAtomic.mockRejectedValue(new Error('disk full'))
    await expect(saveAnimationPresets('proj-A', [makePreset()])).rejects.toThrow(
      'Failed to save animation presets',
    )
  })

  it('scopes presets per project via the path builder', async () => {
    await saveAnimationPresets('proj-A', [makePreset()])
    await readAnimationPresets('proj-B')

    expect(mocks.writeJsonAtomic).toHaveBeenCalledWith(
      mocks.root,
      ['projects', 'proj-A', 'animation-presets.json'],
      expect.anything(),
    )
    expect(mocks.readJson).toHaveBeenCalledWith(mocks.root, [
      'projects',
      'proj-B',
      'animation-presets.json',
    ])
    // Project A's write path is not the path project B reads from.
    expect(mocks.readJson).not.toHaveBeenCalledWith(mocks.root, [
      'projects',
      'proj-A',
      'animation-presets.json',
    ])
  })
})
