import type { SceneCut } from './scene-detection'

/**
 * Seek video and wait for the seeked event with a timeout fallback.
 */
export async function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }, 1000)
    video.addEventListener('seeked', onSeeked)
    video.currentTime = timeSec
  })
}

/**
 * Cluster scene cuts that are closer than `minGapSec` and keep only
 * the one with the highest total motion in each cluster.
 */
export function deduplicateCuts(cuts: SceneCut[], minGapSec: number): SceneCut[] {
  if (cuts.length <= 1) return cuts

  const result: SceneCut[] = []
  let clusterBest = cuts[0]!

  for (let i = 1; i < cuts.length; i++) {
    const cut = cuts[i]!
    if (cut.time - clusterBest.time < minGapSec) {
      if (cut.motion.totalMotion > clusterBest.motion.totalMotion) {
        clusterBest = cut
      }
    } else {
      result.push(clusterBest)
      clusterBest = cut
    }
  }
  result.push(clusterBest)

  return result
}
