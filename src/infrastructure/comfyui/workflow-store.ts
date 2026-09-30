import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ComfyAssetType, ComfyNodeBinding, ComfyWorkflowSlot } from './types'
import { DEFAULT_WORKFLOW_SLOTS } from './presets/default-workflows'
import { parseComfyWorkflow } from './workflow-parser'

export interface ComfyWorkflowStoreState {
  slots: Record<ComfyAssetType, ComfyWorkflowSlot>
  activeSlotId: ComfyAssetType

  // Actions
  setActiveSlot: (slotId: ComfyAssetType) => void
  loadWorkflowJson: (slotId: ComfyAssetType, jsonString: string, fileName?: string) => { success: boolean; error?: string }
  updateSlotBindings: (slotId: ComfyAssetType, bindings: Partial<ComfyNodeBinding>) => void
  resetSlotToPreset: (slotId: ComfyAssetType) => void
  getSlot: (slotId: ComfyAssetType) => ComfyWorkflowSlot
}

export const useComfyWorkflowStore = create<ComfyWorkflowStoreState>()(
  persist(
    (set, get) => ({
      slots: DEFAULT_WORKFLOW_SLOTS,
      activeSlotId: 'video_broll',

      setActiveSlot: (slotId) => set({ activeSlotId: slotId }),

      loadWorkflowJson: (slotId, jsonString, fileName) => {
        try {
          const { promptGraph, uiGraph, detectedBindings } = parseComfyWorkflow(jsonString, slotId)
          const currentSlot = get().slots[slotId] || DEFAULT_WORKFLOW_SLOTS[slotId]

          const updatedSlot: ComfyWorkflowSlot = {
            ...currentSlot,
            workflowName: fileName || `Custom_${slotId}_Workflow.json`,
            rawWorkflow: promptGraph,
            uiWorkflow: uiGraph,
            bindings: detectedBindings,
            isCustom: true,
            lastUpdated: Date.now(),
          }

          set((state) => ({
            slots: {
              ...state.slots,
              [slotId]: updatedSlot,
            },
          }))

          return { success: true }
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Error desconocido al procesar el workflow JSON.',
          }
        }
      },

      updateSlotBindings: (slotId, newBindings) => {
        set((state) => {
          const slot = state.slots[slotId]
          if (!slot) return state
          return {
            slots: {
              ...state.slots,
              [slotId]: {
                ...slot,
                bindings: {
                  ...slot.bindings,
                  ...newBindings,
                },
                lastUpdated: Date.now(),
              },
            },
          }
        })
      },

      resetSlotToPreset: (slotId) => {
        const preset = DEFAULT_WORKFLOW_SLOTS[slotId]
        if (!preset) return
        set((state) => ({
          slots: {
            ...state.slots,
            [slotId]: { ...preset },
          },
        }))
      },

      getSlot: (slotId) => {
        return get().slots[slotId] || DEFAULT_WORKFLOW_SLOTS[slotId]
      },
    }),
    {
      name: 'freecut-comfyui-workflows-v1',
    }
  )
)
