import { describe, expect, it } from 'vite-plus/test'
import { Chunker } from './chunker'
import type { PCMChunk } from '../types'

const SAMPLE_RATE = 16_000

function makeSamples(seconds: number): Float32Array {
  return Float32Array.from({ length: SAMPLE_RATE * seconds }, (_, index) => index)
}

describe('Chunker', () => {
  it('emits overlapping chunks to preserve words near chunk boundaries', () => {
    const chunks: PCMChunk[] = []
    const chunker = new Chunker((chunk) => chunks.push(chunk))

    chunker.push(makeSamples(50))
    chunker.flush()

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ timestamp: 0, final: false })
    expect(chunks[0]?.samples.length).toBe(SAMPLE_RATE * 30)
    expect(chunks[1]).toMatchObject({ timestamp: 25, final: true })
    expect(chunks[1]?.samples.length).toBe(SAMPLE_RATE * 25)
    expect(chunks[1]?.samples[0]).toBe(chunks[0]?.samples[SAMPLE_RATE * 25])
  })

  it('does not emit a duplicate final overlap for exact chunk-length audio', () => {
    const chunks: PCMChunk[] = []
    const chunker = new Chunker((chunk) => chunks.push(chunk))

    chunker.push(makeSamples(30))
    chunker.flush()

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ timestamp: 0, final: false })
    expect(chunks[0]?.samples.length).toBe(SAMPLE_RATE * 30)
    expect(chunks[1]).toMatchObject({ timestamp: 25, final: true })
    expect(chunks[1]?.samples.length).toBe(0)
  })

  it('emits short audio as a single final chunk', () => {
    const chunks: PCMChunk[] = []
    const chunker = new Chunker((chunk) => chunks.push(chunk))

    chunker.push(makeSamples(4))
    chunker.flush()

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ timestamp: 0, final: true })
    expect(chunks[0]?.samples.length).toBe(SAMPLE_RATE * 4)
  })
})
