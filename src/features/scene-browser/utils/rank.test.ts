import { describe, expect, it } from 'vite-plus/test'
import { rankScenes, type RankableScene } from './rank'

function scene(id: string, text: string, extra: Partial<RankableScene> = {}): RankableScene {
  return {
    id,
    mediaId: extra.mediaId ?? id.split(':')[0] ?? 'm1',
    mediaFileName: extra.mediaFileName ?? 'clip.mp4',
    timeSec: extra.timeSec ?? 0,
    text,
    thumbRelPath: extra.thumbRelPath,
  }
}

describe('rankScenes', () => {
  it('returns scenes unchanged when the query is empty', () => {
    const scenes = [scene('a', 'A chef plates pasta'), scene('b', 'Sunset over mountains')]
    const result = rankScenes('', scenes)
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.id)).toEqual(['a', 'b'])
    expect(result[0]!.matchSpans).toEqual([])
  })

  it('scores exact substring matches above token matches', () => {
    const scenes = [
      scene('a', 'A chef plating roasted chicken on a wooden board'),
      scene('b', 'Kitchen preparation shot with chef tools'),
    ]
    const result = rankScenes('roasted chicken', scenes)
    expect(result[0]!.id).toBe('a')
    expect(result[0]!.score).toBeGreaterThan(result[1]?.score ?? 0)
  })

  it('matches on token overlap when no substring is present', () => {
    const scenes = [
      scene('a', 'Wide shot of a kitchen counter with copper pots'),
      scene('b', 'Living room with bookshelves'),
    ]
    const result = rankScenes('kitchen pots', scenes)
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('tolerates a single-char typo via trigram similarity', () => {
    const scenes = [scene('a', 'Bright kitchen counter shot')]
    const result = rankScenes('kitchin', scenes)
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('does not fuzzy-match on a shared suffix when the prefix differs', () => {
    // "orange" vs "range" share four trigrams at the tail end — without a
    // prefix gate, the whole mountain library falls out of a fruit query.
    const scenes = [
      scene('a', 'A snowy mountain range with a field of green trees in the foreground.'),
      scene('b', 'A tree with orange leaves is shown against a blue sky.'),
    ]
    const result = rankScenes('orange', scenes)
    expect(result.map((s) => s.id)).toEqual(['b'])
  })

  it('filters out scenes below the score threshold', () => {
    const scenes = [
      scene('a', 'A chef plating roasted chicken'),
      scene('b', 'Sunset over mountains'),
    ]
    const result = rankScenes('kitchen', scenes)
    expect(result.find((s) => s.id === 'b')).toBeUndefined()
  })

  it('returns merged case-insensitive match spans', () => {
    const scenes = [scene('a', 'Chef places a pan. Chef plates pasta.')]
    const result = rankScenes('chef', scenes)
    expect(result).toHaveLength(1)
    const spans = result[0]!.matchSpans
    expect(spans.length).toBeGreaterThanOrEqual(2)
    for (const [from, to] of spans) {
      expect(result[0]!.text.slice(from, to).toLowerCase()).toBe('chef')
    }
  })

  it('ignores punctuation differences between query and caption', () => {
    const scenes = [scene('a', 'A close-up of a wine glass.')]
    const result = rankScenes('close up wine', scenes)
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('matches richer scene-caption vocabulary for shot size and weather terms', () => {
    const scenes = [
      scene('a', 'Wide shot of a city skyline at dusk.'),
      scene('b', 'Medium close-up of a singer on a rainy street.'),
      scene('c', 'Close-up of hands slicing limes on a cutting board.'),
    ]

    expect(rankScenes('wide shot dusk skyline', scenes).map((s) => s.id)).toEqual(['a'])
    expect(rankScenes('rainy singer', scenes).map((s) => s.id)).toEqual(['b'])
    expect(rankScenes('close up limes', scenes)[0]?.id).toBe('c')
  })

  it('is stable in sort by filename then timestamp when scores tie', () => {
    const scenes = [
      scene('b', 'chef pans', { timeSec: 10, mediaFileName: 'b.mp4' }),
      scene('a', 'chef pans', { timeSec: 5, mediaFileName: 'a.mp4' }),
    ]
    const result = rankScenes('chef pans', scenes)
    expect(result.map((s) => s.id)).toEqual(['a', 'b'])
  })
})
