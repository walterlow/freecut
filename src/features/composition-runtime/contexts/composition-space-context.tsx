/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type FC, type ReactNode } from 'react';

export interface CompositionSpace {
  projectWidth: number;
  projectHeight: number;
  renderWidth: number;
  renderHeight: number;
  scaleX: number;
  scaleY: number;
  scale: number;
}

const CompositionSpaceContext = createContext<CompositionSpace | null>(null);

export const CompositionSpaceProvider: FC<{
  projectWidth: number;
  projectHeight: number;
  renderWidth: number;
  renderHeight: number;
  children: ReactNode;
}> = ({ projectWidth, projectHeight, renderWidth, renderHeight, children }) => {
  const value = useMemo<CompositionSpace>(() => {
    const safeProjectWidth = projectWidth > 0 ? projectWidth : renderWidth;
    const safeProjectHeight = projectHeight > 0 ? projectHeight : renderHeight;
    const scaleX = safeProjectWidth > 0 ? renderWidth / safeProjectWidth : 1;
    const scaleY = safeProjectHeight > 0 ? renderHeight / safeProjectHeight : 1;
    return {
      projectWidth: safeProjectWidth,
      projectHeight: safeProjectHeight,
      renderWidth,
      renderHeight,
      scaleX,
      scaleY,
      scale: Math.min(scaleX, scaleY),
    };
  }, [projectWidth, projectHeight, renderWidth, renderHeight]);

  return (
    <CompositionSpaceContext.Provider value={value}>
      {children}
    </CompositionSpaceContext.Provider>
  );
};

export function useCompositionSpace() {
  return useContext(CompositionSpaceContext);
}
