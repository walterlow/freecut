import { forwardRef, memo, useCallback, useImperativeHandle, useRef } from 'react'
import {
  getGhostPreviewItemClasses,
  type TimelineGhostPreviewType,
} from '../utils/drag-drop-preview'

export interface TimelineDropGhostPreview {
  left: number
  width: number
  label: string
  type: TimelineGhostPreviewType
}

export interface TimelineDropGhostPreviewsHandle {
  sync: (ghostPreviews: TimelineDropGhostPreview[]) => void
  clear: () => void
}

interface TimelineDropGhostPreviewsProps {
  variant: 'track' | 'zone'
}

type PreviewNode = {
  root: HTMLDivElement
  label: HTMLSpanElement
}

export const TimelineDropGhostPreviews = memo(
  forwardRef<TimelineDropGhostPreviewsHandle, TimelineDropGhostPreviewsProps>(
    function TimelineDropGhostPreviews({ variant }: TimelineDropGhostPreviewsProps, ref) {
      const previewLayerRef = useRef<HTMLDivElement>(null)
      const previewNodesRef = useRef<PreviewNode[]>([])

      const clear = useCallback(() => {
        previewLayerRef.current?.replaceChildren()
        previewNodesRef.current = []
      }, [])

      const sync = useCallback(
        (ghostPreviews: TimelineDropGhostPreview[]) => {
          const previewLayer = previewLayerRef.current
          if (!previewLayer) {
            return
          }

          const previewNodes = previewNodesRef.current
          while (previewNodes.length > ghostPreviews.length) {
            previewNodes.pop()?.root.remove()
          }

          const isTrackPreview = variant === 'track'
          const labelClassName = isTrackPreview
            ? 'text-xs text-foreground/70 truncate'
            : 'truncate text-[10px] font-medium text-foreground/80'

          for (let index = 0; index < ghostPreviews.length; index += 1) {
            const ghost = ghostPreviews[index]!
            let previewNode = previewNodes[index]

            if (!previewNode) {
              const root = document.createElement('div')
              const label = document.createElement('span')
              root.appendChild(label)
              previewLayer.appendChild(root)
              previewNode = { root, label }
              previewNodes[index] = previewNode
            }

            previewNode.root.className = `absolute rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2 ${getGhostPreviewItemClasses(ghost.type)} ${
              isTrackPreview ? 'inset-y-0' : ''
            }`
            previewNode.root.style.left = `${ghost.left}px`
            previewNode.root.style.width = `${ghost.width}px`
            previewNode.root.style.top = isTrackPreview ? '' : '0'
            previewNode.root.style.height = isTrackPreview ? '' : '100%'
            previewNode.label.className = labelClassName
            previewNode.label.textContent = ghost.label
          }
        },
        [variant],
      )

      useImperativeHandle(ref, () => ({ clear, sync }), [clear, sync])

      return <div ref={previewLayerRef} />
    },
  ),
)
