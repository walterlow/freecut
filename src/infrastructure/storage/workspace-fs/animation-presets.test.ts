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
      { version: 1, presets: [preset] },
    )

    // Reading back the same envelope yields identical sanitized data.
    mocks.readJson.mockResolvedValue({ version: 1, presets: [preset] })
    await expect(readAnimationPresets('proj-A')).resolves.toEqual([preset])
    expect(mocks.readJson).toHaveBeenCalledWith(mocks.root, [
      'projects',
      'proj-A',
      'animation-presets.json',
    ])
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
                  easingConfig: { type: 'cubic-bezier', bezier: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 } },
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
