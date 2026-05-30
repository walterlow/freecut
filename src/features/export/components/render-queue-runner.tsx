/**
 * Mounts the render queue runner. Render nothing — this just keeps the serial
 * drain loop alive for the editor's lifetime so queued jobs process even when
 * the queue panel is closed. Mount once near the editor root.
 */

import { useRenderQueueRunner } from '../hooks/use-render-queue-runner'

export function RenderQueueRunner(): null {
  useRenderQueueRunner()
  return null
}
