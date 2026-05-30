import { create } from 'zustand'

export type MediaPreparationTaskType = 'import' | 'filmstrip' | 'waveform'
export type MediaPreparationTaskStatus = 'queued' | 'running' | 'error'

export interface MediaPreparationTask {
  id: string
  mediaId: string
  type: MediaPreparationTaskType
  status: MediaPreparationTaskStatus
  progress: number
  updatedAt: number
  error?: string
}

interface MediaPreparationState {
  tasks: Map<string, MediaPreparationTask>
  queueTask: (mediaId: string, type: MediaPreparationTaskType) => void
  updateTask: (
    mediaId: string,
    type: MediaPreparationTaskType,
    updates: Partial<Pick<MediaPreparationTask, 'status' | 'progress' | 'error'>>,
  ) => void
  completeTask: (mediaId: string, type: MediaPreparationTaskType) => void
  clearMedia: (mediaId: string) => void
  clearAll: () => void
}

function taskId(mediaId: string, type: MediaPreparationTaskType): string {
  return `${mediaId}:${type}`
}

export const useMediaPreparationStore = create<MediaPreparationState>()((set) => ({
  tasks: new Map(),

  queueTask: (mediaId, type) =>
    set((state) => {
      const id = taskId(mediaId, type)
      const tasks = new Map(state.tasks)
      tasks.set(id, {
        id,
        mediaId,
        type,
        status: 'queued',
        progress: 0,
        updatedAt: Date.now(),
      })
      return { tasks }
    }),

  updateTask: (mediaId, type, updates) =>
    set((state) => {
      const id = taskId(mediaId, type)
      const current = state.tasks.get(id)
      if (!current) return state
      const tasks = new Map(state.tasks)
      tasks.set(id, {
        ...current,
        ...updates,
        progress: Math.max(0, Math.min(1, updates.progress ?? current.progress)),
        updatedAt: Date.now(),
      })
      return { tasks }
    }),

  completeTask: (mediaId, type) =>
    set((state) => {
      const tasks = new Map(state.tasks)
      tasks.delete(taskId(mediaId, type))
      return { tasks }
    }),

  clearMedia: (mediaId) =>
    set((state) => {
      const tasks = new Map(state.tasks)
      for (const [id, task] of tasks) {
        if (task.mediaId === mediaId) tasks.delete(id)
      }
      return { tasks }
    }),

  clearAll: () => set({ tasks: new Map() }),
}))
