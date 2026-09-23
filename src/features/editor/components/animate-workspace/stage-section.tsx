import { memo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface StageSectionProps {
  /** Uppercase intent label (e.g. "Entrance", "Loop & behaviors"). */
  title: string
  /** One-line description of what the stage does / how it behaves. */
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * Collapsible intent stage. Keyframed layer recipes and live text/layer motion
 * can share a stage without coupling their specialized render engines.
 */
export const StageSection = memo(function StageSection({
  title,
  hint,
  defaultOpen = true,
  children,
}: StageSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger className="group flex items-center justify-between gap-2 text-left">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform',
            !open && '-rotate-90',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2">
        {hint && <p className="text-[10px] leading-snug text-muted-foreground/70">{hint}</p>}
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
})
