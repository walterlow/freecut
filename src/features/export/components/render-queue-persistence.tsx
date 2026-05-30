/**
 * Loads/saves the render queue for the active project. Renders nothing —
 * mount once near the editor root alongside <RenderQueueRunner/>.
 */

import { useRenderQueuePersistence } from '../hooks/use-render-queue-persistence'

export function RenderQueuePersistence({ projectId }: { projectId: string }): null {
  useRenderQueuePersistence(projectId)
  return null
}
