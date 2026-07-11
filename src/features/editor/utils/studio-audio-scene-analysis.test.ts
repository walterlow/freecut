import { describe, expect, it } from 'vite-plus/test'
import type { MediaTranscript } from '@/types/storage'
import { analyzeStudioAudioScenes } from './studio-audio-scene-analysis'

const transcript: MediaTranscript = {
  id: 'narration',
  mediaId: 'narration',
  model: 'whisper-base',
  quantization: 'q8',
  text: 'At night rain struck the workshop. She opened the door. Silence followed.',
  segments: [
    { text: 'At night rain struck the workshop.', start: 0, end: 3 },
    { text: 'She opened the door.', start: 3.2, end: 5 },
    { text: 'Silence followed.', start: 7.2, end: 9 },
  ],
  createdAt: 1,
  updatedAt: 1,
}

describe('studio audio scene analysis', () => {
  it('detects scene breaks, environment, weather, actions and silence', () => {
    const scenes = analyzeStudioAudioScenes(transcript)
    expect(scenes).toHaveLength(2)
    expect(scenes[0]).toMatchObject({
      location: 'interior room',
      timeOfDay: 'night',
      weather: 'rain',
    })
    expect(scenes[0]?.actions).toContain('door')
    expect(scenes[1]?.silenceRecommended).toBe(true)
  })
})
