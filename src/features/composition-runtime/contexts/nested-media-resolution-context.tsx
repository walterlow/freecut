/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'

type NestedMediaResolutionMode = 'source' | 'proxy'

const NestedMediaResolutionContext = createContext<NestedMediaResolutionMode>('source')

export function NestedMediaResolutionProvider({
  value,
  children,
}: {
  value: NestedMediaResolutionMode
  children: ReactNode
}) {
  return (
    <NestedMediaResolutionContext.Provider value={value}>
      {children}
    </NestedMediaResolutionContext.Provider>
  )
}

export function useNestedMediaResolutionMode(): NestedMediaResolutionMode {
  return useContext(NestedMediaResolutionContext)
}
