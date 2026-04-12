export interface SoundTouchPreviewSourceChunk {
  startFrame: number;
  leftChannel: Float32Array;
  rightChannel: Float32Array;
  frameCount: number;
}

interface StoredChunk extends SoundTouchPreviewSourceChunk {
  endFrame: number;
  sequence: number;
}

export class QueuedStereoBufferSource {
  private chunks: StoredChunk[] = [];
  private sequence = 0;
  frameCount = 0;

  append(chunk: SoundTouchPreviewSourceChunk): void {
    const startFrame = Math.max(0, Math.floor(chunk.startFrame));
    const frameCount = Math.max(0, Math.min(
      Math.floor(chunk.frameCount),
      chunk.leftChannel.length,
      chunk.rightChannel.length,
    ));
    if (frameCount === 0) {
      return;
    }

    const nextChunk: StoredChunk = {
      startFrame,
      leftChannel: chunk.leftChannel,
      rightChannel: chunk.rightChannel,
      frameCount,
      endFrame: startFrame + frameCount,
      sequence: ++this.sequence,
    };

    this.chunks = this.chunks
      .filter((existing) => {
        if (nextChunk.startFrame <= existing.startFrame && nextChunk.endFrame >= existing.endFrame) {
          return false;
        }
        return true;
      })
      .concat(nextChunk)
      .sort((a, b) => a.startFrame - b.startFrame || a.sequence - b.sequence);

    this.frameCount = Math.max(this.frameCount, nextChunk.endFrame);
  }

  clear(): void {
    this.chunks = [];
    this.sequence = 0;
    this.frameCount = 0;
  }

  extract(target: Float32Array, numFrames: number, sourcePosition: number = 0): number {
    const safeSourcePosition = Math.max(0, Math.floor(sourcePosition));
    const requestedFrames = Math.max(0, Math.floor(numFrames));
    if (requestedFrames === 0) {
      return 0;
    }

    let copiedFrames = 0;
    let cursorFrame = safeSourcePosition;
    let outIndex = 0;

    while (copiedFrames < requestedFrames) {
      const chunk = this.findChunkContainingFrame(cursorFrame);
      if (!chunk) {
        break;
      }

      const chunkOffset = cursorFrame - chunk.startFrame;
      const availableFrames = chunk.frameCount - chunkOffset;
      if (availableFrames <= 0) {
        break;
      }

      const framesToCopy = Math.min(requestedFrames - copiedFrames, availableFrames);
      for (let i = 0; i < framesToCopy; i++) {
        const sourceIndex = chunkOffset + i;
        target[outIndex++] = chunk.leftChannel[sourceIndex] ?? 0;
        target[outIndex++] = chunk.rightChannel[sourceIndex] ?? 0;
      }

      copiedFrames += framesToCopy;
      cursorFrame += framesToCopy;
    }

    return copiedFrames;
  }

  private findChunkContainingFrame(frame: number): StoredChunk | null {
    let match: StoredChunk | null = null;
    for (const chunk of this.chunks) {
      if (frame >= chunk.startFrame && frame < chunk.endFrame) {
        if (!match || chunk.sequence > match.sequence) {
          match = chunk;
        }
      }
    }
    return match;
  }
}
