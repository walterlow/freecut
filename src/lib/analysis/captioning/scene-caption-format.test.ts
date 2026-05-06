import { describe, expect, it } from 'vite-plus/test'
import {
  formatSceneCaption,
  formatSceneCaptionFromData,
  LFM_SCENE_CAPTION_PROMPT,
  normalizeShotVocabulary,
  normalizeSceneCaptionData,
  parseSceneCaptionResponse,
} from './scene-caption-format'

describe('LFM_SCENE_CAPTION_PROMPT', () => {
  it('asks for JSON only with structured scene fields', () => {
    expect(LFM_SCENE_CAPTION_PROMPT).toContain('return a valid JSON object only')
    expect(LFM_SCENE_CAPTION_PROMPT).toContain('"caption": string')
    expect(LFM_SCENE_CAPTION_PROMPT).toContain('"shotType": string | null')
    expect(LFM_SCENE_CAPTION_PROMPT).toContain(
      'Use null for missing scalar fields and [] for missing subjects',
    )
    expect(LFM_SCENE_CAPTION_PROMPT).toContain(
      'The first character of the response must be { and the last character must be }',
    )
    expect(LFM_SCENE_CAPTION_PROMPT).toContain(
      'Use double quotes around every key and every string value',
    )
    expect(LFM_SCENE_CAPTION_PROMPT).toContain('Do not mention camera motion')
  })
})

describe('normalizeShotVocabulary', () => {
  it('normalizes common shot-term spelling and hyphenation inside prose', () => {
    expect(normalizeShotVocabulary('A medium close up of a singer')).toBe(
      'A medium close-up of a singer',
    )
    expect(normalizeShotVocabulary('An extreme closeup of an eye')).toBe(
      'An extreme close-up of an eye',
    )
    expect(normalizeShotVocabulary('A medium wide shot of a street')).toBe(
      'A medium-wide shot of a street',
    )
  })
})

describe('normalizeSceneCaptionData', () => {
  it('canonicalizes shotType aliases and strips empty fields', () => {
    expect(
      normalizeSceneCaptionData({
        caption: 'A singer under stage lights.',
        shot_type: 'medium close up',
        subjects: ['singer', ' ', 'microphone'],
        weather: 'unknown',
      }),
    ).toEqual({
      caption: 'A singer under stage lights.',
      shotType: 'medium close-up',
      subjects: ['singer', 'microphone'],
    })
  })
})

describe('formatSceneCaption', () => {
  it('strips lead-ins and standardizes leading shot phrasing', () => {
    expect(formatSceneCaption('This image shows a medium wide shot of a woman in a cafe')).toBe(
      'Medium-wide shot of a woman in a cafe.',
    )
  })

  it('collapses multi-sentence output to one sentence', () => {
    expect(
      formatSceneCaption(
        'Wide shot of two people crossing a city street. Rain falls in the distance.',
      ),
    ).toBe('Wide shot of two people crossing a city street.')
  })

  it('drops uncertain time-of-day or weather clauses instead of persisting guesses', () => {
    expect(formatSceneCaption('Close up of a woman indoors, possibly at dusk')).toBe(
      'Close-up of a woman indoors.',
    )
    expect(formatSceneCaption('A wide shot of a street, maybe rainy')).toBe(
      'Wide shot of a street.',
    )
  })
})

describe('formatSceneCaptionFromData', () => {
  it('builds a readable fallback sentence from structured fields', () => {
    expect(
      formatSceneCaptionFromData({
        shotType: 'wide shot',
        subjects: ['two people'],
        action: 'walking across the street',
        setting: 'city street',
        timeOfDay: 'dusk',
        weather: 'rainy',
      }),
    ).toBe(
      'Wide shot of two people walking across the street in city street in rainy weather at dusk.',
    )
  })
})

describe('parseSceneCaptionResponse', () => {
  it('parses JSON responses and preserves structured scene data', () => {
    expect(
      parseSceneCaptionResponse(
        '{"caption":"A woman in a red coat walks through a rainy city street at dusk.","shotType":"wide shot","subjects":["woman"],"action":"walking through the street","setting":"city street","lighting":"dim evening light","timeOfDay":"dusk","weather":"rainy"}',
      ),
    ).toEqual({
      text: 'A woman in a red coat walks through a rainy city street at dusk.',
      sceneData: {
        caption: 'A woman in a red coat walks through a rainy city street at dusk.',
        shotType: 'wide shot',
        subjects: ['woman'],
        action: 'walking through the street',
        setting: 'city street',
        lighting: 'dim evening light',
        timeOfDay: 'dusk',
        weather: 'rainy',
      },
    })
  })

  it('accepts fenced JSON and falls back to the structured fields when caption is missing', () => {
    expect(
      parseSceneCaptionResponse(
        '```json\n{"shotType":"medium close up","subjects":["singer"],"action":"singing into a microphone","setting":"stage","timeOfDay":null,"weather":null}\n```',
      ),
    ).toEqual({
      text: 'Medium close-up of singer singing into a microphone in stage.',
      sceneData: {
        caption: 'Medium close-up of singer singing into a microphone in stage.',
        shotType: 'medium close-up',
        subjects: ['singer'],
        action: 'singing into a microphone',
        setting: 'stage',
      },
    })
  })

  it('falls back to freeform text formatting when JSON parsing fails', () => {
    expect(
      parseSceneCaptionResponse('This image shows a close up of a hand holding a glass'),
    ).toEqual({
      text: 'Close-up of a hand holding a glass.',
    })
  })

  it('recovers known fields from json-ish output when strict parsing fails', () => {
    expect(
      parseSceneCaptionResponse(
        'Json ["caption":"A dimly lit corridor illuminated by hanging lanterns, with a text overlay in Chinese at the bottom.","shotType":"medium wide shot","subjects":["lanterns","corridor","text"],"action":"glowing softly","setting":"interior corridor","lighting":"golden lantern light","timeOfDay":null,"weather":null}.',
      ),
    ).toEqual({
      text: 'A dimly lit corridor illuminated by hanging lanterns, with a text overlay in Chinese at the bottom.',
      sceneData: {
        caption:
          'A dimly lit corridor illuminated by hanging lanterns, with a text overlay in Chinese at the bottom.',
        shotType: 'medium-wide shot',
        subjects: ['lanterns', 'corridor', 'text'],
        action: 'glowing softly',
        setting: 'interior corridor',
        lighting: 'golden lantern light',
      },
    })
  })
})
