import { describe, expect, it } from 'vite-plus/test'
import type { ProjectTimeline } from '@/types/project'
import { convertTimelineForBundle, restoreTimelineFromBundle } from './bundle-timeline'

describe('bundle-timeline', () => {
  it('keeps transition metadata when converting timeline data for export', () => {
    const timeline: ProjectTimeline = {
      tracks: [
        {
          id: 'track-1',
          name: 'V1',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        },
      ],
      items: [
        {
          id: 'item-1',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 90,
          label: 'clip-1',
          type: 'video',
          mediaId: 'media-1',
          src: 'blob:clip-1',
          thumbnailUrl: 'blob:thumb-1',
        },
      ],
      scrollPosition: 144,
      markers: [{ id: 'marker-1', frame: 12, color: '#fff000', label: 'Cut' }],
      transitions: [
        {
          id: 'transition-1',
          type: 'crossfade',
          leftClipId: 'item-1',
          rightClipId: 'item-2',
          trackId: 'track-1',
          durationInFrames: 18,
          presentation: 'wipe',
          timing: 'cubic-bezier',
          direction: 'from-right',
          alignment: 0.75,
          bezierPoints: { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 },
          presetId: 'preset-1',
          properties: { feather: 0.4 },
          createdAt: 100,
          lastModifiedAt: 200,
        },
      ],
      keyframes: [
        {
          itemId: 'item-1',
          properties: [
            {
              property: 'x',
              keyframes: [{ id: 'keyframe-1', frame: 0, value: 0, easing: 'linear' }],
            },
          ],
        },
      ],
      compositions: [
        {
          id: 'composition-1',
          name: 'Comp 1',
          items: [
            {
              id: 'comp-item-1',
              trackId: 'track-1',
              from: 10,
              durationInFrames: 45,
              label: 'Comp Clip',
              type: 'video',
              mediaId: 'media-2',
              src: 'blob:comp-clip',
              thumbnailUrl: 'blob:comp-thumb',
            },
          ],
          tracks: [
            {
              id: 'track-1',
              name: 'V1',
              height: 80,
              locked: false,
              visible: true,
              muted: false,
              solo: false,
              order: 0,
            },
          ],
          transitions: [
            {
              id: 'comp-transition-1',
              type: 'crossfade',
              leftClipId: 'comp-item-1',
              rightClipId: 'comp-item-2',
              trackId: 'track-1',
              durationInFrames: 12,
              presentation: 'fade',
              timing: 'linear',
            },
          ],
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 90,
        },
      ],
    }

    const bundleTimeline = convertTimelineForBundle(timeline)

    expect(bundleTimeline.transitions).toEqual(timeline.transitions)
    expect(bundleTimeline.scrollPosition).toBe(144)
    expect(bundleTimeline.markers).toEqual(timeline.markers)
    expect(bundleTimeline.keyframes).toEqual(timeline.keyframes)
    expect(bundleTimeline.items[0]).toMatchObject({
      id: 'item-1',
      mediaRef: 'media-1',
    })
    expect(bundleTimeline.items[0]).not.toHaveProperty('mediaId')
    expect(bundleTimeline.items[0]).not.toHaveProperty('src')
    expect(bundleTimeline.items[0]).not.toHaveProperty('thumbnailUrl')
    expect(bundleTimeline.compositions?.[0]?.items[0]).toMatchObject({ mediaRef: 'media-2' })
  })

  it('restores bundle timelines without dropping transitions or timeline state', () => {
    const restored = restoreTimelineFromBundle(
      {
        tracks: [
          {
            id: 'track-1',
            name: 'V1',
            height: 80,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
          },
        ],
        items: [
          {
            id: 'item-1',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 90,
            label: 'clip-1',
            type: 'video',
            mediaRef: 'original-media-1',
          },
        ],
        scrollPosition: 144,
        markers: [{ id: 'marker-1', frame: 12, color: '#fff000', label: 'Cut' }],
        transitions: [
          {
            id: 'transition-1',
            type: 'crossfade',
            leftClipId: 'item-1',
            rightClipId: 'item-2',
            trackId: 'track-1',
            durationInFrames: 18,
            presentation: 'wipe',
            timing: 'cubic-bezier',
            direction: 'from-right',
            alignment: 0.75,
            bezierPoints: { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 },
            presetId: 'preset-1',
            properties: { feather: 0.4 },
            createdAt: 100,
            lastModifiedAt: 200,
          },
        ],
        keyframes: [
          {
            itemId: 'item-1',
            properties: [
              {
                property: 'x',
                keyframes: [{ id: 'keyframe-1', frame: 0, value: 0, easing: 'linear' }],
              },
            ],
          },
        ],
        compositions: [
          {
            id: 'composition-1',
            name: 'Comp 1',
            items: [
              {
                id: 'comp-item-1',
                trackId: 'track-1',
                from: 10,
                durationInFrames: 45,
                label: 'Comp Clip',
                type: 'video',
                mediaRef: 'original-media-2',
              },
            ],
            tracks: [
              {
                id: 'track-1',
                name: 'V1',
                height: 80,
                locked: false,
                visible: true,
                muted: false,
                solo: false,
                order: 0,
              },
            ],
            transitions: [
              {
                id: 'comp-transition-1',
                type: 'crossfade',
                leftClipId: 'comp-item-1',
                rightClipId: 'comp-item-2',
                trackId: 'track-1',
                durationInFrames: 12,
                presentation: 'fade',
                timing: 'linear',
              },
            ],
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 90,
          },
        ],
      },
      new Map([
        ['original-media-1', 'imported-media-1'],
        ['original-media-2', 'imported-media-2'],
      ]),
    )

    expect(restored).toMatchObject({
      scrollPosition: 144,
      markers: [{ id: 'marker-1', frame: 12, color: '#fff000', label: 'Cut' }],
      transitions: [
        {
          id: 'transition-1',
          alignment: 0.75,
          bezierPoints: { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 },
          presetId: 'preset-1',
          properties: { feather: 0.4 },
          createdAt: 100,
          lastModifiedAt: 200,
        },
      ],
      keyframes: [
        {
          itemId: 'item-1',
          properties: [
            {
              property: 'x',
              keyframes: [{ id: 'keyframe-1', frame: 0, value: 0, easing: 'linear' }],
            },
          ],
        },
      ],
      compositions: [
        {
          id: 'composition-1',
          transitions: [{ id: 'comp-transition-1', durationInFrames: 12 }],
        },
      ],
    })
    expect(restored?.items[0]).toMatchObject({ mediaId: 'imported-media-1' })
    expect(restored?.items[0]).not.toHaveProperty('mediaRef')
    expect(restored?.items[0]).toHaveProperty('src', undefined)
    expect(restored?.items[0]).toHaveProperty('thumbnailUrl', undefined)
    expect(restored?.compositions?.[0]?.items[0]).toMatchObject({ mediaId: 'imported-media-2' })
  })
})
