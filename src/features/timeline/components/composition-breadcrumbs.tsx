import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useCompositionNavigationStore } from '../stores/composition-navigation-store'

/**
 * Breadcrumb navigation for composition hierarchy.
 * Shows "Main Timeline > Pre-Comp 1 > ..." and allows clicking to navigate.
 * Only visible when inside a sub-composition.
 */
export const CompositionBreadcrumbs = memo(function CompositionBreadcrumbs() {
  const breadcrumbs = useCompositionNavigationStore((s) => s.breadcrumbs)
  const navigateTo = useCompositionNavigationStore((s) => s.navigateTo)

  // Don't render when at root (only "Main Timeline")
  if (breadcrumbs.length <= 1) return null

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-background/80 backdrop-blur-sm border-b border-border text-xs">
      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1
        return (
          <span key={crumb.compositionId ?? 'root'} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            {isLast ? (
              <span className="text-foreground font-medium">{crumb.label}</span>
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => navigateTo(index)}
              >
                {crumb.label}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
})
