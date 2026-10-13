// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { buildTimelineAnnotationModel } from './timeline-annotations'

describe('buildTimelineAnnotationModel', () => {
  it('normalizes markers and in/out points into timeline ratios', () => {
    const model = buildTimelineAnnotationModel({
      maxFrame: 200,
      inPoint: 50,
      outPoint: 150,
      markers: [
        { id: 'b', frame: 120, color: '#00f', label: 'B' },
        { id: 'a', frame: 20, color: '#f00', label: 'A' },
      ],
    })

    expect(model.ioRange).toEqual({
      inFrame: 50,
      outFrame: 150,
      startRatio: 0.25,
      endRatio: 0.75,
    })
    expect(model.markers.map((marker) => marker.id)).toEqual(['a', 'b'])
    expect(model.markers.map((marker) => marker.positionRatio)).toEqual([0.1, 0.6])
  })

  it('omits invalid ranges but keeps individual in/out posts', () => {
    const model = buildTimelineAnnotationModel({
      maxFrame: 100,
      inPoint: 80,
      outPoint: 20,
      markers: [],
    })

    expect(model.ioRange).toBeNull()
    expect(model.inPoint?.positionRatio).toBe(0.8)
    expect(model.outPoint?.positionRatio).toBe(0.2)
  })

  it('clamps annotation frames to the visible timeline span', () => {
    const model = buildTimelineAnnotationModel({
      maxFrame: 100,
      inPoint: -20,
      outPoint: 120,
      markers: [{ id: 'm', frame: 140, color: '#fff' }],
    })

    expect(model.inPoint?.frame).toBe(0)
    expect(model.outPoint?.frame).toBe(100)
    expect(model.markers[0]?.frame).toBe(100)
  })
})
