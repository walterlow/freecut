import { describe, expect, it } from 'vite-plus/test'
import { getDisplayedGroupFrameGroups } from './sheet-preview-frame-groups'

describe('getDisplayedGroupFrameGroups', () => {
  const group = {
    rows: [
      {
        property: 'x' as const,
        keyframes: [
          { id: 'kf-1', frame: 20, value: 100, easing: 'linear' as const },
          { id: 'kf-2', frame: 30, value: 140, easing: 'linear' as const },
        ],
      },
      {
        property: 'y' as const,
        keyframes: [{ id: 'kf-3', frame: 20, value: 200, easing: 'linear' as const }],
      },
    ],
    frameGroups: [
      {
        frame: 20,
        keyframes: [
          {
            property: 'x' as const,
            keyframe: { id: 'kf-1', frame: 20, value: 100, easing: 'linear' as const },
          },
          {
            property: 'y' as const,
            keyframe: { id: 'kf-3', frame: 20, value: 200, easing: 'linear' as const },
          },
        ],
      },
      {
        frame: 30,
        keyframes: [
          {
            property: 'x' as const,
            keyframe: { id: 'kf-2', frame: 30, value: 140, easing: 'linear' as const },
          },
        ],
      },
    ],
  }

  it('returns the existing frame groups when there is no preview state', () => {
    expect(
      getDisplayedGroupFrameGroups({
        group,
        sheetPreviewFrames: null,
        sheetPreviewDuplicateKeyframeIds: null,
      }),
    ).toBe(group.frameGroups)
  })

  it('regroups previewed keyframes by their preview frames', () => {
    expect(
      getDisplayedGroupFrameGroups({
        group,
        sheetPreviewFrames: { 'kf-1': 24, 'kf-2': 24, 'kf-3': 18 },
        sheetPreviewDuplicateKeyframeIds: null,
      }),
    ).toEqual([
      {
        frame: 18,
        keyframes: [
          { property: 'y', keyframe: { id: 'kf-3', frame: 20, value: 200, easing: 'linear' } },
        ],
      },
      {
        frame: 24,
        keyframes: [
          { property: 'x', keyframe: { id: 'kf-1', frame: 20, value: 100, easing: 'linear' } },
          { property: 'x', keyframe: { id: 'kf-2', frame: 30, value: 140, easing: 'linear' } },
        ],
      },
    ])
  })

  it('filters preview groups down to the duplicated keyframes when provided', () => {
    expect(
      getDisplayedGroupFrameGroups({
        group,
        sheetPreviewFrames: { 'kf-1': 24, 'kf-2': 24, 'kf-3': 18 },
        sheetPreviewDuplicateKeyframeIds: ['kf-2'],
      }),
    ).toEqual([
      {
        frame: 24,
        keyframes: [
          { property: 'x', keyframe: { id: 'kf-2', frame: 30, value: 140, easing: 'linear' } },
        ],
      },
    ])
  })
})
