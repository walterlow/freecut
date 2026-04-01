import { useMemo, useCallback } from 'react';
import { useVideoConfig } from '../../hooks/use-player-compat';
import { interpolate, useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useGizmoStore, type ItemPropertiesPreview } from '@/features/composition-runtime/deps/stores';
import { useMaskEditorStore } from '@/features/composition-runtime/deps/stores';
import { useTimelineStore } from '@/features/composition-runtime/deps/stores';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransform, CanvasSettings } from '@/types/transform';
import {
  toTransformStyle,
} from '../../utils/transform-resolver';
import { getShapePath, rotatePath } from '../../utils/shape-path';
import { useItemKeyframesFromContext } from '../../contexts/keyframes-context';
import { useCompositionSpace } from '../../contexts/composition-space-context';
import type { MaskInfo } from '../item';
import type React from 'react';
import {
  applyTransformOverride,
  resolveItemTransformAtRelativeFrame,
} from '../../utils/frame-scene';
import { applyPreviewPathVerticesToShape } from '../../utils/preview-path-override';
import { expandTextTransformToFitContent } from '../../utils/text-layout';

/**
 * Consolidated visual state for an item.
 * Single source of truth for all rendering-related state.
 */
interface ItemVisualState {
  /** Resolved transform (handles: unified preview > gizmo preview > keyframes > base) */
  transform: ResolvedTransform;
  /** CSS style for positioning (from toTransformStyle) */
  transformStyle: React.CSSProperties;
  /** Combined fade opacity (from fadeIn/fadeOut) */
  fadeOpacity: number;
  /** Final opacity (transform.opacity * fadeOpacity) */
  finalOpacity: number;

  /** Combined CSS filter string (legacy — always empty, effects render via GPU) */
  cssFilter: string;
  /** Scanlines effect (legacy — always null, effects render via GPU) */
  scanlinesEffect: null;
  /** Halftone styles (legacy — always null, effects render via GPU) */
  halftoneStyles: null;
  /** Vignette style (legacy — always null, effects render via GPU) */
  vignetteStyle: null;

  /** Mask clip-path style (for CSS clip-path masks) */
  maskClipPath: string | null;
  /** Mask type (for SVG mask or clip-path branching) */
  maskType: 'clip' | 'alpha' | 'svg-mask' | null;
  /** Whether mask is inverted */
  maskInvert: boolean;
  /** Mask feather amount */
  maskFeather: number;
  /** SVG mask ID (for SVG mask reference) */
  svgMaskId: string | null;
  /** SVG mask paths with stroke info (for SVG mask definition) */
  svgMaskPaths: Array<{ path: string; strokeWidth: number }> | null;

  /** Properties preview for content components */
  propertiesPreview: ItemPropertiesPreview | undefined;
}

/**
 * Consolidated hook for all visual state of a timeline item.
 *
 * Replaces:
 * - TransformWrapper's 5+ selectors
 * - EffectWrapper's selectors
 * - MaskWrapper's selectors
 *
 * Uses granular selectors for each piece of state to avoid creating
 * new object references that would cause infinite loops.
 */
export function useItemVisualState(
  item: TimelineItem & { _sequenceFrameOffset?: number },
  masks: MaskInfo[] = []
): ItemVisualState {
  const { width: renderWidth, height: renderHeight, fps } = useVideoConfig();
  const compositionSpace = useCompositionSpace();
  const projectWidth = compositionSpace?.projectWidth ?? renderWidth;
  const projectHeight = compositionSpace?.projectHeight ?? renderHeight;
  const scaleX = compositionSpace?.scaleX ?? 1;
  const scaleY = compositionSpace?.scaleY ?? 1;
  const uniformScale = compositionSpace?.scale ?? 1;
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const logicalCanvas: CanvasSettings = { width: projectWidth, height: projectHeight, fps };
  const renderCanvas: CanvasSettings = { width: renderWidth, height: renderHeight, fps };

  // Calculate frame relative to item start for keyframe interpolation.
  // When items share a Sequence (e.g., split clips via StableVideoSequence),
  // localFrame is relative to the shared Sequence's `from` (group.minFrom),
  // but keyframes are stored relative to item.from.
  // _sequenceFrameOffset = item.from - group.minFrom, so:
  // relativeFrame = frame - _sequenceFrameOffset = frame - (item.from - group.minFrom)
  const relativeFrame = frame - (item._sequenceFrameOffset ?? 0);

  // === GRANULAR SELECTORS ===
  // Using individual selectors to avoid creating new object references
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );

  // Get keyframes for this item
  // First try context (render mode with inputProps), then fall back to store (preview mode)
  const contextKeyframes = useItemKeyframesFromContext(item.id);
  const storeKeyframes = useTimelineStore(
    useCallback(
      (s) => s.keyframes.find((k) => k.itemId === item.id),
      [item.id]
    )
  );
  // Prefer context keyframes (render mode) over store keyframes (preview mode)
  const itemKeyframes = contextKeyframes ?? storeKeyframes;
  const maskIds = useMemo(() => new Set(masks.map((mask) => mask.shape.id)), [masks]);
  const previewMaskEditingItemId = useMaskEditorStore(
    useCallback((state) => {
      if (!state.editingItemId || !state.previewVertices || !maskIds.has(state.editingItemId)) {
        return null;
      }
      return state.editingItemId;
    }, [maskIds])
  );
  const previewMaskVertices = useMaskEditorStore(
    useCallback((state) => {
      if (!state.editingItemId || !state.previewVertices || !maskIds.has(state.editingItemId)) {
        return null;
      }
      return state.previewVertices;
    }, [maskIds])
  );

  // === TRANSFORM COMPUTATION ===
  const { transform, transformStyle, fadeOpacity, finalOpacity } = useMemo(() => {

    // Check if this item has an active single-item gizmo preview
    const isGizmoPreviewActive = activeGizmo?.itemId === item.id && previewTransform !== null;

    // Check if this item has an active unified preview transform
    const unifiedPreviewTransform = itemPreview?.transform;
    const isUnifiedPreviewActive = unifiedPreviewTransform !== undefined;

    // Check for item properties preview (fades)
    const propertiesPreview = itemPreview?.properties;

    const animatedResolved = resolveItemTransformAtRelativeFrame(item, {
      canvas: logicalCanvas,
      relativeFrame,
      keyframes: itemKeyframes,
    });

    // Priority: Unified preview (group/properties) > Single gizmo preview > Keyframe animation > Base
    let resolved = animatedResolved;
    if (isUnifiedPreviewActive && unifiedPreviewTransform) {
      resolved = applyTransformOverride(animatedResolved, unifiedPreviewTransform);
    } else if (isGizmoPreviewActive && previewTransform) {
      resolved = applyTransformOverride(animatedResolved, previewTransform);
    }

    if (item.type === 'text') {
      resolved = expandTextTransformToFitContent(item, resolved, propertiesPreview);
    }

    // Calculate fade opacity based on fadeIn/fadeOut (in seconds)
    const fadeInSeconds = propertiesPreview?.fadeIn ?? item.fadeIn ?? 0;
    const fadeOutSeconds = propertiesPreview?.fadeOut ?? item.fadeOut ?? 0;
    const fadeInFrames = Math.min(fadeInSeconds * fps, item.durationInFrames);
    const fadeOutFrames = Math.min(fadeOutSeconds * fps, item.durationInFrames);

    let computedFadeOpacity = 1;
    const hasFadeIn = fadeInFrames > 0;
    const hasFadeOut = fadeOutFrames > 0;

    if (hasFadeIn || hasFadeOut) {
      const fadeOutStart = item.durationInFrames - fadeOutFrames;

      if (hasFadeIn && hasFadeOut) {
        if (fadeInFrames >= fadeOutStart) {
          // Fades overlap - crossfade
          const midPoint = item.durationInFrames / 2;
          const peakOpacity = Math.min(1, midPoint / Math.max(fadeInFrames, 1));
          computedFadeOpacity = interpolate(
            relativeFrame,
            [0, midPoint, item.durationInFrames],
            [0, peakOpacity, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
        } else {
          // Normal case - distinct fade in/out regions
          computedFadeOpacity = interpolate(
            relativeFrame,
            [0, fadeInFrames, fadeOutStart, item.durationInFrames],
            [0, 1, 1, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
        }
      } else if (hasFadeIn) {
        computedFadeOpacity = interpolate(
          relativeFrame,
          [0, fadeInFrames],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      } else {
        computedFadeOpacity = interpolate(
          relativeFrame,
          [fadeOutStart, item.durationInFrames],
          [1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      }
    }

    // Combine transform opacity with fade opacity
    const computedFinalOpacity = resolved.opacity * computedFadeOpacity;

    // Get CSS style with combined opacity
    const scaledResolved: ResolvedTransform = {
      ...resolved,
      x: resolved.x * scaleX,
      y: resolved.y * scaleY,
      width: resolved.width * scaleX,
      height: resolved.height * scaleY,
      cornerRadius: resolved.cornerRadius * uniformScale,
      opacity: computedFinalOpacity,
    };
    const style = toTransformStyle(scaledResolved, renderCanvas);

    return {
      transform: resolved,
      transformStyle: style,
      fadeOpacity: computedFadeOpacity,
      finalOpacity: computedFinalOpacity,
    };
  }, [
    activeGizmo,
    previewTransform,
    itemPreview,
    item,
    logicalCanvas,
    renderCanvas,
    itemKeyframes,
    relativeFrame,
    fps,
    scaleX,
    scaleY,
    uniformScale,
  ]);

  // === EFFECTS COMPUTATION ===
  // Legacy CSS effects removed — all effects now render via GPU pipeline in client-render-engine
  const { cssFilter, scanlinesEffect, halftoneStyles, vignetteStyle } = useMemo(() => {
    return {
      cssFilter: '',
      scanlinesEffect: null,
      halftoneStyles: null,
      vignetteStyle: null,
    };
  }, []);

  // === MASK COMPUTATION ===
  const maskState = useMemo(() => {
    if (!masks || masks.length === 0) {
      return {
        maskClipPath: null,
        maskType: null as 'clip' | 'alpha' | 'svg-mask' | null,
        maskInvert: false,
        maskFeather: 0,
        svgMaskId: null,
        svgMaskPaths: null,
      };
    }

    // All masks use the first mask's type settings
    const firstMask = masks[0]!;
    const maskType = firstMask.shape.maskType ?? 'clip';
    // Feather only applies to alpha masks. Clip masks stay hard-edged even if
    // older item data still carries a persisted maskFeather value.
    const maskFeather = maskType === 'alpha'
      ? (firstMask.shape.maskFeather ?? 0) * uniformScale
      : 0;
    const maskInvert = firstMask.shape.maskInvert ?? false;
    const getPreviewPathVertices = (shapeId: string) => (
      previewMaskEditingItemId === shapeId
        ? (previewMaskVertices ?? undefined)
        : undefined
    );

    // Generate paths for all masks with rotation baked in
    const maskPathsWithStroke = masks.map(({ shape, transform: maskTransform }) => {
      // Check if this mask shape has an active single-item gizmo preview
      // Note: For group transforms, masks would need their own unified preview lookup
      // which would require a different hook structure. For now, only single gizmo works.
      const isGizmoPreviewActive = activeGizmo?.itemId === shape.id && previewTransform !== null;

      // Priority: Single gizmo preview > Base transform
      let resolvedMaskTransform = {
        x: maskTransform.x ?? 0,
        y: maskTransform.y ?? 0,
        width: maskTransform.width ?? projectWidth,
        height: maskTransform.height ?? projectHeight,
        rotation: maskTransform.rotation ?? 0,
        opacity: maskTransform.opacity ?? 1,
      };

      if (isGizmoPreviewActive && previewTransform) {
        resolvedMaskTransform = applyTransformOverride(
          resolvedMaskTransform as ResolvedTransform,
          previewTransform
        );
      }

      const scaledMaskTransform = {
        ...resolvedMaskTransform,
        x: resolvedMaskTransform.x * scaleX,
        y: resolvedMaskTransform.y * scaleY,
        width: resolvedMaskTransform.width * scaleX,
        height: resolvedMaskTransform.height * scaleY,
      };
      const effectiveShape = applyPreviewPathVerticesToShape(shape, getPreviewPathVertices);

      let path = getShapePath(effectiveShape, scaledMaskTransform, {
        canvasWidth: renderWidth,
        canvasHeight: renderHeight,
      });

      // Bake rotation into path coordinates for CSS clip-path compatibility
      if (resolvedMaskTransform.rotation !== 0) {
        const centerX = renderWidth / 2 + scaledMaskTransform.x;
        const centerY = renderHeight / 2 + scaledMaskTransform.y;
        path = rotatePath(path, resolvedMaskTransform.rotation, centerX, centerY);
      }

      // Include stroke width for SVG mask rendering
      const strokeWidth = (effectiveShape.strokeWidth ?? 0) * uniformScale;

      return { path, strokeWidth };
    });

    // Extract just the paths for combining
    const maskPaths = maskPathsWithStroke.map((m) => m.path);
    const combinedPath = maskPaths.join(' ');

    // Check if any mask has stroke (need SVG mask instead of clip-path)
    const hasStroke = maskPathsWithStroke.some((m) => m.strokeWidth > 0);

    // Determine rendering mode
    // Simple clip mode uses CSS clip-path directly (faster)
    // SVG mask needed for: inverted clip with stroke, alpha mask, feathering, or stroke
    if (maskType === 'clip' && !maskInvert && maskFeather === 0 && !hasStroke) {
      return {
        maskClipPath: `path('${combinedPath}')`,
        maskType: 'clip' as const,
        maskInvert: false,
        maskFeather: 0,
        svgMaskId: null,
        svgMaskPaths: null,
      };
    }

    // For inverted clip without stroke, use CSS clip-path with evenodd
    if (maskType === 'clip' && maskInvert && !hasStroke) {
      const invertedPath = `M 0 0 L ${renderWidth} 0 L ${renderWidth} ${renderHeight} L 0 ${renderHeight} Z ${combinedPath}`;
      return {
        maskClipPath: `path(evenodd, '${invertedPath}')`,
        maskType: 'clip' as const,
        maskInvert: true,
        maskFeather: 0,
        svgMaskId: null,
        svgMaskPaths: null,
      };
    }

    // Alpha mask, feathering, or stroke: need SVG mask
    const svgMaskId = `svg-mask-${masks.map((m) => m.shape.id).join('-')}`;

    return {
      maskClipPath: null,
      maskType: 'svg-mask' as const,
      maskInvert,
      maskFeather,
      svgMaskId,
      svgMaskPaths: maskPathsWithStroke,
    };
  }, [
    masks,
    activeGizmo,
    previewTransform,
    projectWidth,
    projectHeight,
    renderWidth,
    renderHeight,
    scaleX,
    scaleY,
    uniformScale,
    previewMaskEditingItemId,
    previewMaskVertices,
  ]);

  // Properties preview for content components
  const propertiesPreview = itemPreview?.properties;

  return {
    transform,
    transformStyle,
    fadeOpacity,
    finalOpacity,
    cssFilter,
    scanlinesEffect,
    halftoneStyles,
    vignetteStyle,
    ...maskState,
    propertiesPreview,
  };
}
