import { memo, useState } from 'react'
import { Bot, Music, Server, Sparkles } from 'lucide-react'
import { AiPanel } from './ai-panel'
import { AgentChatPanel } from './agent-chat-panel'
import { ComfyUiDockPanel } from './comfyui-dock/comfyui-dock-panel'

export type AiTabSubView = 'comfyui' | 'browser_audio' | 'assistant'

export const AiTab = memo(function AiTab() {
  const [activeSubView, setActiveSubView] = useState<AiTabSubView>('comfyui')

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sub-navigation bar */}
      <div className="flex border-b border-border/40 bg-secondary/30 p-1">
        <button
          type="button"
          onClick={() => setActiveSubView('comfyui')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded transition-all ${
            activeSubView === 'comfyui'
              ? 'bg-background text-primary font-medium shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          ComfyUI
        </button>

        <button
          type="button"
          onClick={() => setActiveSubView('assistant')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded transition-all ${
            activeSubView === 'assistant'
              ? 'bg-background text-primary font-medium shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          Asistente
        </button>

        <button
          type="button"
          onClick={() => setActiveSubView('browser_audio')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded transition-all ${
            activeSubView === 'browser_audio'
              ? 'bg-background text-primary font-medium shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Music className="w-3.5 h-3.5" />
          Voz / Música
        </button>
      </div>

      {/* Active panel view */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeSubView === 'comfyui' && <ComfyUiDockPanel />}
        {activeSubView === 'assistant' && <AgentChatPanel />}
        {activeSubView === 'browser_audio' && <AiPanel />}
      </div>
    </div>
  )
})
