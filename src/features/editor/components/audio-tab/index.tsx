import { useState, memo } from 'react'
import { Volume2, Sliders } from 'lucide-react'
import { ProjectAudioPanel } from './project-audio-panel'
import { SfxLibraryPanel } from './sfx-library-panel'

export const AudioTabPanel = memo(function AudioTabPanel() {
  const [subTab, setSubTab] = useState<'project' | 'sfx'>('project')

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Sub-tab Switcher Header */}
      <div className="flex items-center border-b border-border/80 px-3 py-2 bg-secondary/10 shrink-0 gap-1.5">
        <button
          type="button"
          onClick={() => setSubTab('project')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
            subTab === 'project'
              ? 'bg-secondary text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Audio del Proyecto</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('sfx')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
            subTab === 'sfx'
              ? 'bg-secondary text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground'
          }`}
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span>Efectos de Sonido</span>
        </button>
      </div>

      {/* Sub-tab Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {subTab === 'project' ? <ProjectAudioPanel /> : <SfxLibraryPanel />}
      </div>
    </div>
  )
})
