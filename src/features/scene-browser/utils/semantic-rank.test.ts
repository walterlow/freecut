import { describe, expect, it } from 'vite-plus/test'
import { cosineSimilarity, semanticRank, SEMANTIC_MATCH_THRESHOLD } from './semantic-rank'
import type { RankableScene } from './rank'

function unit(values: number[]): Float32Array {
  const magnitude = Math.sqrt(values.reduce((sum, x) => sum + x * x, 0)) || 1
  return Float32Array.from(values.map((x) => x / magnitude))
}

function scene(id: string, text: string): RankableScene {
  return {
    id,
    mediaId: id.split(':')[0] ?? 'm1',
    mediaFileName: `${id}.mp4`,
    timeSec: 0,
    text,
  }
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    const a = unit([1, 2, 3])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = unit([1, 0])
    const b = unit([0, 1])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
  })

  it('returns 0 when dimensions differ', () => {
    expect(cosineSimilarity(unit([1, 0]), unit([1, 0, 0]))).toBe(0)
  })
})

describe('semanticRank', () => {
  it('orders scenes by descending cosine similarity to the query', () => {
    const query = unit([1, 0, 0])
    const scenes = [scene('a:0', 'first'), scene('b:0', 'second'), scene('c:0', 'third')]
    const embeddings = new Map<string, Float32Array>([
      ['a:0', unit([0.9, 0.1, 0])],
      ['b:0', unit([0.2, 1, 0])],
      ['c:0', unit([1, 0, 0])],
    ])
    const result = semanticRank(query, scenes, embeddings, { threshold: 0 })
    expect(result.map((s) => s.id)).toEqual(['c:0', 'a:0', 'b:0'])
  })

  it('drops scenes below the threshold', () => {
    const query = unit([1, 0])
    const scenes = [scene('a:0', 'a'), scene('b:0', 'b')]
    const embeddings = new Map<string, Float32Array>([
      ['a:0', unit([0.99, 0.01])],
      ['b:0', unit([0.01, 0.99])],
    ])
    const result = semanticRank(query, scenes, embeddings)
    expect(result.map((s) => s.id)).toEqual(['a:0'])
    expect(result[0]!.score).toBeGreaterThan(SEMANTIC_MATCH_THRESHOLD)
  })

  it('skips scenes that have no embedding in the map', () => {
    const query = unit([1, 0])
    const scenes = [scene('a:0', 'with'), scene('b:0', 'without')]
    const embeddings = new Map<string, Float32Array>([['a:0', unit([1, 0])]])
    const result = semanticRank(query, scenes, embeddings, { threshold: 0 })
    expect(result.map((s) => s.id)).toEqual(['a:0'])
  })

  it('returns empty matchSpans so highlighting stays sane', () => {
    const query = unit([1, 0])
    const scenes = [scene('a:0', 'orange sky over water')]
    const embeddings = new Map<string, Float32Array>([['a:0', unit([1, 0])]])
    const [top] = semanticRank(query, scenes, embeddings, { threshold: 0 })
    expect(top!.matchSpans).toEqual([])
  })

  it('stable-sorts ties by filename then timestamp', () => {
    const query = unit([1, 0])
    const scenes: RankableScene[] = [
      { id: 'b:0', mediaId: 'b', mediaFileName: 'b.mp4', timeSec: 5, text: 'b' },
      { id: 'a:0', mediaId: 'a', mediaFileName: 'a.mp4', timeSec: 10, text: 'a' },
    ]
    const embeddings = new Map<string, Float32Array>([
      ['a:0', unit([1, 0])],
      ['b:0', unit([1, 0])],
    ])
    const result = semanticRank(query, scenes, embeddings, { threshold: 0 })
    expect(result.map((s) => s.id)).toEqual(['a:0', 'b:0'])
  })
})

describe('semanticRank with CLIP image signal', () => {
  it('falls through to image match when caption text is weak', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0, 0])
    const scenes = [scene('a:0', 'terse caption')]
    const textEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.05, 1])], // nearly orthogonal to text query
    ])
    const imageEmbeds = new Map<string, Float32Array>([['a:0', unit([0.9, 0.1, 0])]])
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
    })
    expect(result.map((s) => s.id)).toEqual(['a:0'])
    expect(result[0]!.score).toBeGreaterThan(0.5)
  })

  it('takes max of text and image scores when both are present', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0, 0])
    const scenes = [scene('a:0', 'strong text'), scene('b:0', 'strong image')]
    const textEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([1, 0])], // text cosine ≈ 1
      ['b:0', unit([0.1, 1])], // text cosine low
    ])
    const imageEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.1, 1, 0])], // image cosine low
      ['b:0', unit([1, 0, 0])], // image cosine ≈ 1
    ])
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
      threshold: 0.2,
      imageThreshold: 0.2,
    })
    expect(result.map((s) => s.id).sort()).toEqual(['a:0', 'b:0'])
    expect(result[0]!.score).toBeGreaterThan(0.9)
    expect(result[1]!.score).toBeGreaterThan(0.9)
  })

  it('drops a scene only when both signals are below their thresholds', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0])
    const scenes = [scene('a:0', 'weak everywhere')]
    const textEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.1, 1])], // cosine ≈ 0.1
    ])
    const imageEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.05, 1])], // cosine ≈ 0.05
    ])
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
    })
    expect(result).toEqual([])
  })

  it('drops a scene whose only signal is a 0.21 visual match (below 0.22 threshold)', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0])
    const scenes = [scene('tower:0', 'A tall green tower at night')]
    const textEmbeds = new Map<string, Float32Array>() // no text match at all
    // 0.21 cosine — the exact false-positive level observed in the wild
    // for one-word queries before we raised the threshold.
    const imageEmbeds = new Map<string, Float32Array>([
      ['tower:0', unit([0.21, Math.sqrt(1 - 0.21 * 0.21)])],
    ])
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
    })
    expect(result).toEqual([])
  })

  it('drops a scene whose only signal is a Fair-tier visual match with no text support', () => {
    // The "seated down → doorknob close-up" failure: CLIP cosine just
    // above the 0.22 floor but no text corroboration. Should not pass.
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0])
    const scenes = [scene('doorknob:0', 'Close-up of a hand gripping a doorknob')]
    const textEmbeds = new Map<string, Float32Array>([
      ['doorknob:0', unit([0.1, 1])], // text cosine ≈ 0.1, below Fair floor
    ])
    const imageEmbeds = new Map<string, Float32Array>([
      ['doorknob:0', unit([0.25, Math.sqrt(1 - 0.25 * 0.25)])], // image cosine ≈ 0.25
    ])
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
    })
    expect(result).toEqual([])
  })

  it('accepts a Fair-Fair scene where both sides mutually confirm', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0])
    const scenes = [scene('a:0', 'An elderly couple sits in a wheelchair')]
    // 0.32 text (Fair) × 0.23 image (Fair) — weak alone, confirming together.
    const textEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.32, Math.sqrt(1 - 0.32 * 0.32)])],
    ])
    const imageEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.23, Math.sqrt(1 - 0.23 * 0.23)])],
    ])
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
    })
    expect(result.map((s) => s.id)).toEqual(['a:0'])
  })

  it('accepts a scene on strong text alone, even when image is weak', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0])
    const scenes = [scene('a:0', 'strong text')]
    const textEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.5, Math.sqrt(1 - 0.5 * 0.5)])], // text cosine = 0.5, strong
    ])
    const imageEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.15, Math.sqrt(1 - 0.15 * 0.15)])], // below Fair floor
    ])
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
    })
    expect(result.map((s) => s.id)).toEqual(['a:0'])
  })

  it('still ranks a scene that has no image embedding on text alone', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0])
    const scenes = [scene('a:0', 'text-only scene')]
    const textEmbeds = new Map<string, Float32Array>([['a:0', unit([1, 0])]])
    const imageEmbeds = new Map<string, Float32Array>() // empty
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
    })
    expect(result.map((s) => s.id)).toEqual(['a:0'])
  })

  it('ignores image side when queryImageEmbedding is null', () => {
    const textQuery = unit([1, 0])
    const scenes = [scene('a:0', 'has image not text')]
    const textEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([0.1, 1])], // weak text
    ])
    const imageEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([1, 0])], // strong image
    ])
    const result = semanticRank(textQuery, scenes, textEmbeds, {
      queryImageEmbedding: null,
      imageEmbeddings: imageEmbeds,
    })
    expect(result).toEqual([]) // image was strong but query image embed absent
  })

  it('uses palette-only ranking for explicit pure color queries', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0])
    const scenes = [
      scene('a:0', 'A person in a yellow jacket'),
      scene('b:0', 'A dark blue hallway'),
    ]
    const textEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([1, 0])], // strong text match that should be ignored
      ['b:0', unit([0, 1])],
    ])
    const imageEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([1, 0])], // strong visual match that should be ignored
      ['b:0', unit([0, 1])],
    ])
    const palettes = new Map([
      ['a:0', [{ l: 40, a: 15, b: -60, weight: 0.9 }]], // blue
      ['b:0', [{ l: 90, a: -5, b: 80, weight: 0.9 }]], // yellow
    ])

    const result = semanticRank(textQuery, scenes, textEmbeds, {
      query: 'yellow color',
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
      palettes,
    })

    expect(result.map((s) => s.id)).toEqual(['b:0'])
    expect(result[0]?.signals.colorMatch).toBe('yellow')
    expect(result[0]?.signals.textScore).toBeUndefined()
    expect(result[0]?.signals.imageScore).toBeUndefined()
  })

  it('keeps semantic text/image scoring for mixed color-content queries', () => {
    const textQuery = unit([1, 0])
    const imageQuery = unit([1, 0])
    const scenes = [scene('a:0', 'Yellow kitchen interior'), scene('b:0', 'Blue hallway')]
    const textEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([1, 0])],
      ['b:0', unit([0, 1])],
    ])
    const imageEmbeds = new Map<string, Float32Array>([
      ['a:0', unit([1, 0])],
      ['b:0', unit([0, 1])],
    ])
    const palettes = new Map([
      ['a:0', [{ l: 90, a: -5, b: 80, weight: 0.9 }]],
      ['b:0', [{ l: 40, a: 15, b: -60, weight: 0.9 }]],
    ])

    const result = semanticRank(textQuery, scenes, textEmbeds, {
      query: 'yellow color kitchen',
      queryImageEmbedding: imageQuery,
      imageEmbeddings: imageEmbeds,
      palettes,
    })

    expect(result[0]?.id).toBe('a:0')
    expect(result[0]?.signals.colorMatch).toBe('yellow')
    expect(result[0]?.signals.textScore).toBeDefined()
    expect(result[0]?.signals.imageScore).toBeDefined()
  })

  it('ranks by palette similarity and ignores text scores when referencePalette is set', () => {
    // With a reference palette, the ranker should find scenes whose
    // palettes are perceptually close to the reference, regardless of
    // how well the text side matches the query vector.
    const query = unit([1, 0])
    const scenes = [
      scene('warm:0', 'an unrelated caption'),
      scene('cool:0', 'a perfect text match'),
    ]
    const textEmbeds = new Map<string, Float32Array>([
      ['warm:0', unit([0, 1])],
      ['cool:0', unit([1, 0])],
    ])
    const palettes = new Map([
      ['warm:0', [{ l: 53, a: 70, b: 50, weight: 0.9 }]],
      ['cool:0', [{ l: 40, a: 15, b: -60, weight: 0.9 }]],
    ])
    const referencePalette = [{ l: 53, a: 70, b: 50, weight: 1 }]

    const result = semanticRank(query, scenes, textEmbeds, {
      palettes,
      referencePalette,
    })

    expect(result.map((s) => s.id)).toEqual(['warm:0'])
    expect(result[0]?.signals.paletteDistance).toBeDefined()
    expect(result[0]?.signals.textScore).toBeUndefined()
  })

  it('falls back to the scene-level palette when paletteMap lacks the id', () => {
    const query = unit([1, 0])
    const warmPalette = [{ l: 53, a: 70, b: 50, weight: 1 }]
    const scenes: RankableScene[] = [{ ...scene('warm:0', 'x'), palette: warmPalette }]
    const textEmbeds = new Map<string, Float32Array>()
    const result = semanticRank(query, scenes, textEmbeds, {
      referencePalette: warmPalette,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.score).toBeGreaterThan(0)
  })
})
