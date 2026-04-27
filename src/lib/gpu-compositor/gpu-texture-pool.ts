/**
 * GPU Texture Pool
 *
 * Reuses GPUTexture objects across frames to eliminate per-frame allocation
 * and destruction overhead in the compositor pipeline. Textures are keyed
 * by dimensions + format and recycled via acquire/release semantics.
 *
 * Typical savings: 0.5-2ms per frame with 5+ composited layers.
 */

import { createLogger } from '@/shared/logging/logger'

const log = createLogger('GpuTexturePool')

interface PoolEntry {
  texture: GPUTexture
  inUse: boolean
}

function poolKeyToString(width: number, height: number, format: GPUTextureFormat): string {
  return `${width}x${height}x${format}`
}

export class GpuTexturePool {
  private device: GPUDevice
  private pools = new Map<string, PoolEntry[]>()
  private usage: GPUTextureUsageFlags
  private totalCreated = 0
  private totalAcquires = 0
  private cacheHits = 0

  constructor(
    device: GPUDevice,
    usage: GPUTextureUsageFlags = GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
  ) {
    this.device = device
    this.usage = usage
  }

  acquire(width: number, height: number, format: GPUTextureFormat = 'rgba8unorm'): GPUTexture {
    const key = poolKeyToString(width, height, format)
    this.totalAcquires++

    const entries = this.pools.get(key)
    if (entries) {
      for (const entry of entries) {
        if (!entry.inUse) {
          entry.inUse = true
          this.cacheHits++
          return entry.texture
        }
      }
    }

    const texture = this.device.createTexture({
      size: { width, height },
      format,
      usage: this.usage,
    })

    const entry: PoolEntry = { texture, inUse: true }
    if (entries) {
      entries.push(entry)
    } else {
      this.pools.set(key, [entry])
    }
    this.totalCreated++
    return texture
  }

  release(texture: GPUTexture): void {
    const key = poolKeyToString(texture.width, texture.height, texture.format)
    const entries = this.pools.get(key)
    if (!entries) return
    for (const entry of entries) {
      if (entry.texture === texture) {
        entry.inUse = false
        return
      }
    }
  }

  destroy(): void {
    for (const entries of this.pools.values()) {
      for (const entry of entries) {
        entry.texture.destroy()
      }
    }
    this.pools.clear()
    log.debug('Texture pool destroyed', {
      totalCreated: this.totalCreated,
      totalAcquires: this.totalAcquires,
      cacheHitRate:
        this.totalAcquires > 0
          ? `${((this.cacheHits / this.totalAcquires) * 100).toFixed(1)}%`
          : 'n/a',
    })
  }

  /** Shrink pools by destroying unused textures. Call periodically (e.g. every 60 frames). */
  compact(): void {
    for (const [key, entries] of this.pools.entries()) {
      const inUse = entries.filter((e) => e.inUse)
      const unused = entries.filter((e) => !e.inUse)
      // Keep at most 2 unused textures per key
      const toDestroy = unused.slice(2)
      for (const entry of toDestroy) {
        entry.texture.destroy()
      }
      if (toDestroy.length > 0) {
        this.pools.set(key, [...inUse, ...unused.slice(0, 2)])
      }
    }
  }

  getMetrics() {
    return {
      totalCreated: this.totalCreated,
      totalAcquires: this.totalAcquires,
      cacheHits: this.cacheHits,
      cacheHitRate:
        this.totalAcquires > 0
          ? `${((this.cacheHits / this.totalAcquires) * 100).toFixed(1)}%`
          : 'n/a',
      poolCount: this.pools.size,
    }
  }
}
