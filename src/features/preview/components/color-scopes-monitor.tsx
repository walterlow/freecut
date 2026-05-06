import { X } from 'lucide-react'
import { ColorScopesPanel } from './color-scopes-panel'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/app/editor-layout'

interface ColorScopesMonitorProps {
  onClose: () => void
}

export function ColorScopesMonitor({ onClose }: ColorScopesMonitorProps) {
  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0">
      <div
        className="flex items-center justify-between border-b border-border px-3 shrink-0"
        style={{ height: EDITOR_LAYOUT_CSS_VALUES.previewSplitHeaderHeight }}
      >
        <span className="text-xs text-muted-foreground truncate">示波器</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors shrink-0"
          aria-label="关闭示波器"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-3 bg-background/70">
        <ColorScopesPanel open embedded embeddedLayout="stack" />
      </div>
    </div>
  )
}
