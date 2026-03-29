import React, { useCallback } from 'react';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import type { TextItem } from '@/types/timeline';
import { loadFont, FONT_WEIGHT_MAP } from '../utils/fonts';
import { useCompositionSpace } from '../contexts/composition-space-context';

/**
 * Text content with live property preview support.
 * Reads preview values from gizmo store for real-time updates during slider/picker drag.
 */
export const TextContent: React.FC<{ item: TextItem }> = ({ item }) => {
  const compositionSpace = useCompositionSpace();
  const scaleX = compositionSpace?.scaleX ?? 1;
  const scaleY = compositionSpace?.scaleY ?? 1;
  const scale = compositionSpace?.scale ?? 1;

  // Read preview values from unified preview system
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );
  const preview = itemPreview?.properties;

  // Use preview values if available, otherwise use item's stored values
  const fontSize = (preview?.fontSize ?? item.fontSize ?? 60) * scale;
  const letterSpacing = (preview?.letterSpacing ?? item.letterSpacing ?? 0) * scaleX;
  const lineHeight = preview?.lineHeight ?? item.lineHeight ?? 1.2;
  const color = preview?.color ?? item.color;
  const backgroundColor = preview?.backgroundColor ?? item.backgroundColor;
  const hasTextShadowPreview = preview !== undefined && Object.prototype.hasOwnProperty.call(preview, 'textShadow');
  const hasStrokePreview = preview !== undefined && Object.prototype.hasOwnProperty.call(preview, 'stroke');
  const textShadow = hasTextShadowPreview
    ? preview.textShadow
    : item.textShadow;
  const stroke = hasStrokePreview
    ? preview.stroke
    : item.stroke;

  // Load the Google Font and get the CSS fontFamily value
  // loadFont() blocks rendering until the font is ready (works for both preview and server render)
  const fontName = item.fontFamily ?? 'Inter';
  const fontFamily = loadFont(fontName);

  // Get font weight from shared map
  const fontWeight = FONT_WEIGHT_MAP[item.fontWeight ?? 'normal'] ?? 400;

  // Map text align to flexbox justify-content (horizontal)
  const textAlignMap: Record<string, string> = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
  };
  const justifyContent = textAlignMap[item.textAlign ?? 'center'] ?? 'center';

  // Map vertical align to flexbox align-items
  const verticalAlignMap: Record<string, string> = {
    top: 'flex-start',
    middle: 'center',
    bottom: 'flex-end',
  };
  const alignItems = verticalAlignMap[item.verticalAlign ?? 'middle'] ?? 'center';

  const cssTextShadow = textShadow
    ? `${textShadow.offsetX * scaleX}px ${textShadow.offsetY * scaleY}px ${textShadow.blur * scale}px ${textShadow.color}`
    : undefined;

  const strokeWidth = stroke?.width ? `${stroke.width * scale * 2}px` : undefined;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems,
        justifyContent,
        padding: `${16 * scale}px`,
        backgroundColor,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          fontSize,
          // Use the fontFamily returned by loadFont (includes proper CSS value)
          fontFamily: fontFamily,
          fontWeight,
          fontStyle: item.fontStyle ?? 'normal',
          textDecoration: item.underline ? 'underline' : 'none',
          color,
          textAlign: item.textAlign ?? 'center',
          lineHeight,
          letterSpacing,
          textShadow: cssTextShadow,
          WebkitTextStrokeWidth: strokeWidth,
          WebkitTextStrokeColor: stroke?.color,
          // Best practice: use inline-block and pre-wrap to match measureText behavior
          display: 'inline-block',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          width: '100%',
        }}
      >
        {item.text}
      </div>
    </div>
  );
};
