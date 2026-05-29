/**
 * Abort-controller registry for the render queue.
 *
 * AbortControllers aren't serializable, so they can't live in the Zustand
 * store. The runner registers the active job's controller here; the store's
 * `cancelJob` (and the panel) call `abortJob` to interrupt an in-flight render.
 * Kept as a tiny standalone module so both the store and the runner can import
 * it without a cycle.
 */

const controllers = new Map<string, AbortController>()

export function registerJobController(jobId: string, controller: AbortController): void {
  controllers.set(jobId, controller)
}

export function unregisterJobController(jobId: string): void {
  controllers.delete(jobId)
}

/** Abort the in-flight render for `jobId` (no-op if none is running). */
export function abortJob(jobId: string): void {
  controllers.get(jobId)?.abort()
}
