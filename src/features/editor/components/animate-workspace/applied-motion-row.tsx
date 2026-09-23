import { memo } from 'react'
import { X } from 'lucide-react'

export const AppliedMotionRow = memo(function AppliedMotionRow({
  label,
  detail,
  removeLabel,
  onRemove,
  onNavigate,
}: {
  label: string
  detail: string
  removeLabel?: string
  onRemove?: () => void
  onNavigate?: () => void
}) {
  const content = (
    <>
      <div className="truncate text-[11px] font-medium text-foreground">{label}</div>
      <div className="truncate text-[10px] text-muted-foreground">{detail}</div>
    </>
  )

  return (
    <div className="flex min-w-0 items-center rounded-md border border-border/60 bg-background/50">
      {onNavigate ? (
        <button
          type="button"
          className="min-w-0 flex-1 rounded-l-md px-2 py-1.5 text-left hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={onNavigate}
        >
          {content}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-2 py-1.5">{content}</div>
      )}
      {onRemove && removeLabel ? (
        <button
          type="button"
          aria-label={removeLabel}
          className="mr-1 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  )
})
