import type { ReactNode } from 'react'

interface DetailOnlyLayersProps {
  isCompactShell: boolean
  children: ReactNode
}

/**
 * Gate for the clip layers that only exist in full-detail shells. Compact shells
 * already suppress rich content, so these regions are skipped outright instead
 * of being rendered and hidden. The density boolean is computed once by the
 * clip and passed down, so every gated region agrees.
 */
export function DetailOnlyLayers({ isCompactShell, children }: DetailOnlyLayersProps) {
  if (isCompactShell) return null
  return children
}
