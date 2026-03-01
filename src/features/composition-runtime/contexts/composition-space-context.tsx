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

export function resolveCompositionScale(
  projectWidth: number,
  projectHeight: number,
  renderWidth: number,
  renderHeight: number
): Pick<CompositionSpace, 'scaleX' | 'scaleY' | 'scale'> {
  const scaleX = projectWidth > 0 ? renderWidth / projectWidth : 1;
  const scaleY = projectHeight > 0 ? renderHeight / projectHeight : 1;
  return {
    scaleX,
    scaleY,
    scale: Math.min(scaleX, scaleY),
  };
}

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
    const { scaleX, scaleY, scale } = resolveCompositionScale(
      safeProjectWidth,
      safeProjectHeight,
      renderWidth,
      renderHeight
    );
    return {
      projectWidth: safeProjectWidth,
      projectHeight: safeProjectHeight,
      renderWidth,
      renderHeight,
      scaleX,
      scaleY,
      scale,
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
