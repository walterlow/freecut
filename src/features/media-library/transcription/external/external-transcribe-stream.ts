import type { TranscriptSegment, TranscribeProgress } from '../types'

export class ExternalTranscribeStream implements AsyncIterable<TranscriptSegment> {
  private cancelled = false
  private readonly abortController = new AbortController()

  constructor(
    private readonly runner: (
      signal: AbortSignal,
      onProgress?: (event: TranscribeProgress) => void,
    ) => Promise<TranscriptSegment[]>,
    private readonly onProgress?: (event: TranscribeProgress) => void,
  ) {}

  cancel(message = 'Transcripción cancelada'): void {
    this.cancelled = true
    this.abortController.abort(new Error(message))
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<TranscriptSegment> {
    const segments = await this.collect()
    for (const segment of segments) {
      yield segment
    }
  }

  async collect(): Promise<TranscriptSegment[]> {
    if (this.cancelled) {
      throw new Error('Transcripción cancelada')
    }
    return await this.runner(this.abortController.signal, this.onProgress)
  }
}
