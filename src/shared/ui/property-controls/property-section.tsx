import { useEffect, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/shared/ui/cn'

interface PropertySectionProps {
  title: string
  icon?: LucideIcon
  defaultOpen?: boolean
  children: React.ReactNode
}

/** Every mounted PropertySection, so a shift-click can drive all of them at once. */
const openStateSubscribers = new Set<(open: boolean) => void>()

/**
 * Collapsible section wrapper for property groups.
 * Used for Source, Layout, Fill, Video, Audio sections.
 *
 * Shift-clicking a header collapses every section (or expands them all, when the
 * clicked header was already collapsed).
 */
export function PropertySection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: PropertySectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    openStateSubscribers.add(setOpen)
    return () => {
      openStateSubscribers.delete(setOpen)
    }
  }, [])

  const handleTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!event.shiftKey) return
    // Radix skips its own toggle when the click is default-prevented, so this
    // header is driven by the broadcast like every other one.
    event.preventDefault()
    for (const setSectionOpen of openStateSubscribers) setSectionOpen(!open)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        onClick={handleTriggerClick}
        className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors"
      >
        <ChevronRight
          className={cn('w-3 h-3 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        {Icon && <Icon className="w-3 h-3 text-muted-foreground" />}
        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
          {title}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-2 space-y-0">{children}</CollapsibleContent>
    </Collapsible>
  )
}
