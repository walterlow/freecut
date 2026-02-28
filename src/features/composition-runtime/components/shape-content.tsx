import React, { useCallback } from 'react';
import { Rect, Circle, Triangle, Ellipse, Star, Polygon, Heart } from '@/shared/graphics/shapes';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import type { ShapeItem } from '@/types/timeline';
import { useCompositionSpace } from '../contexts/composition-space-context';

/**
 * Shape content with live property preview support.
 * Renders Composition shapes (Rect, Circle, Triangle, Ellipse, Star, Polygon).
 * Reads preview values from gizmo store for real-time updates during editing.
 */
export const ShapeContent: React.FC<{ item: ShapeItem }> = ({ item }) => {
  const compositionSpace = useCompositionSpace();
  const renderScaleX = compositionSpace?.scaleX ?? 1;
  const renderScaleY = compositionSpace?.scaleY ?? 1;
  const renderScale = compositionSpace?.scale ?? 1;

  // Read transform preview from gizmo store for real-time scaling
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  // Read from unified preview system (includes transforms, properties, and effects)
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );

  // Use preview values if available, otherwise use item's stored values
  const shapePropsPreview = itemPreview?.properties;
  const fillColor = shapePropsPreview?.fillColor ?? item.fillColor ?? '#3b82f6';
  const strokeColor = shapePropsPreview?.strokeColor ?? item.strokeColor;
  const strokeWidth = (shapePropsPreview?.strokeWidth ?? item.strokeWidth ?? 0) * renderScale;
  const cornerRadius = (shapePropsPreview?.cornerRadius ?? item.cornerRadius ?? 0) * renderScale;
  const direction = shapePropsPreview?.direction ?? item.direction ?? 'up';
  const points = shapePropsPreview?.points ?? item.points ?? 5;
  const innerRadius = shapePropsPreview?.innerRadius ?? item.innerRadius ?? 0.5;
  const shapeType = shapePropsPreview?.shapeType ?? item.shapeType;

  // Get dimensions with preview support for real-time gizmo scaling
  // Priority: Unified preview (group/properties) > Single gizmo preview > Base transform
  let width = (item.transform?.width ?? 200) * renderScaleX;
  let height = (item.transform?.height ?? 200) * renderScaleY;

  const itemPreviewTransform = itemPreview?.transform;
  const isGizmoPreviewActive = activeGizmo?.itemId === item.id && previewTransform !== null;

  if (itemPreviewTransform) {
    width = (itemPreviewTransform.width ?? (width / renderScaleX)) * renderScaleX;
    height = (itemPreviewTransform.height ?? (height / renderScaleY)) * renderScaleY;
  } else if (isGizmoPreviewActive && previewTransform) {
    width = previewTransform.width * renderScaleX;
    height = previewTransform.height * renderScaleY;
  }

  // Common stroke props
  const strokeProps = strokeWidth > 0 && strokeColor ? {
    stroke: strokeColor,
    strokeWidth,
  } : {};

  // Check if aspect ratio is locked (for squish/squash behavior)
  // Read from preview transforms if available, otherwise from item
  let aspectLocked = item.transform?.aspectRatioLocked ?? true;
  if (itemPreviewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = itemPreviewTransform.aspectRatioLocked;
  } else if (isGizmoPreviewActive && previewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = previewTransform.aspectRatioLocked;
  }

  // Centering wrapper style for SVG shapes
  const centerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // For shapes that need to squish/squash when aspect is unlocked,
  // we render at base size and apply CSS scale transform
  const baseSize = Math.min(width, height);
  const scaleX = aspectLocked ? 1 : width / baseSize;
  const scaleY = aspectLocked ? 1 : height / baseSize;
  const needsScale = !aspectLocked && (scaleX !== 1 || scaleY !== 1);

  const scaleStyle: React.CSSProperties = needsScale ? {
    transform: `scale(${scaleX}, ${scaleY})`,
  } : {};

  // Render appropriate shape based on shapeType
  switch (shapeType) {
    case 'rectangle':
      // Rectangle fills the entire container (naturally supports non-proportional)
      return (
        <div style={centerStyle}>
          <Rect
            width={width}
            height={height}
            fill={fillColor}
            cornerRadius={cornerRadius}
            {...strokeProps}
          />
        </div>
      );

    case 'circle': {
      // Circle: squish/squash when aspect unlocked
      const radius = baseSize / 2;
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Circle
              radius={radius}
              fill={fillColor}
              {...strokeProps}
            />
          </div>
        </div>
      );
    }

    case 'triangle': {
      // Triangle: squish/squash when aspect unlocked
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Triangle
              length={baseSize}
              direction={direction}
              fill={fillColor}
              cornerRadius={cornerRadius}
              {...strokeProps}
            />
          </div>
        </div>
      );
    }

    case 'ellipse': {
      // Ellipse naturally supports non-proportional via rx/ry
      const rx = width / 2;
      const ry = height / 2;
      return (
        <div style={centerStyle}>
          <Ellipse
            rx={rx}
            ry={ry}
            fill={fillColor}
            {...strokeProps}
          />
        </div>
      );
    }

    case 'star': {
      // Star: squish/squash when aspect unlocked
      const outerRadius = baseSize / 2;
      const innerRadiusValue = outerRadius * innerRadius;
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Star
              points={points}
              outerRadius={outerRadius}
              innerRadius={innerRadiusValue}
              fill={fillColor}
              cornerRadius={cornerRadius}
              {...strokeProps}
            />
          </div>
        </div>
      );
    }

    case 'polygon': {
      // Polygon: squish/squash when aspect unlocked
      const radius = baseSize / 2;
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Polygon
              points={points}
              radius={radius}
              fill={fillColor}
              cornerRadius={cornerRadius}
              {...strokeProps}
            />
          </div>
        </div>
      );
    }

    case 'heart': {
      // Heart: use Composition's Heart component for consistency with mask path generation
      // Heart output width = 1.1 Ã— input height, so we scale input to fit within baseSize
      // Using height = baseSize / 1.1 ensures output width = baseSize (fits container)
      const heartHeight = baseSize / 1.1;
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Heart
              height={heartHeight}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
          </div>
        </div>
      );
    }

    default:
      // Fallback to simple colored div for unknown types
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: fillColor,
            borderRadius: cornerRadius,
          }}
        />
      );
  }
};

