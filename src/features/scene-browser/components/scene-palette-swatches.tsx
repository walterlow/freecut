import { memo } from 'react';
import { cn } from '@/shared/ui/cn';
import { labToRgb } from '../utils/color-convert';

/**
 * Tiny row of color swatches showing the scene's dominant palette.
 * Comes straight from the Lab entries stored on `MediaCaption.palette`
 * — we convert back to sRGB for display so users can *see* the colors
 * that got indexed for matching, which makes "why did this match my
 * red query?" explainable at a glance.
 */

interface Swatch {
  l: number;
  a: number;
  b: number;
  weight: number;
}

interface ScenePaletteSwatchesProps {
  palette: readonly Swatch[] | undefined;
  /** When present, draws a ring around the matched swatch. */
  highlight?: string | null;
  className?: string;
  /**
   * Fires when a swatch is clicked. The caller is responsible for
   * resolving the swatch to a search action (e.g. nearest color family
   * → setQuery). When omitted, swatches render non-interactively.
   */
  onSwatchClick?: (swatch: Swatch) => void;
}

function swatchColor(swatch: Swatch): string {
  const [r, g, b] = labToRgb(swatch.l, swatch.a, swatch.b);
  return `rgb(${r}, ${g}, ${b})`;
}

export const ScenePaletteSwatches = memo(function ScenePaletteSwatches({
  palette,
  highlight,
  className,
  onSwatchClick,
}: ScenePaletteSwatchesProps) {
  if (!palette || palette.length === 0) return null;
  const interactive = !!onSwatchClick;
  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      title={`Dominant palette (${palette.length} ${palette.length === 1 ? 'color' : 'colors'})`}
    >
      {palette.map((swatch, i) => {
        // Width proportional to pixel coverage so a dominant color
        // visibly takes up more room — matches how the user would
        // describe the scene at a glance.
        const width = Math.max(6, Math.min(22, Math.round(swatch.weight * 40)));
        const isHighlighted = highlight
          && Boolean(palette[i])
          && paletteMatchesFamily(palette[i]!, highlight);
        const commonClass = cn(
          'block h-3 rounded-sm border border-white/10',
          isHighlighted && 'ring-2 ring-primary',
          interactive && 'cursor-pointer hover:ring-1 hover:ring-white/30',
        );
        const style = { width: `${width}px`, backgroundColor: swatchColor(swatch) };
        if (!interactive) {
          return <span key={i} className={commonClass} style={style} />;
        }
        return (
          <span
            key={i}
            role="button"
            tabIndex={-1}
            aria-label="Search by this color"
            title="Search by this color"
            className={commonClass}
            style={style}
            onClick={(e) => {
              e.stopPropagation();
              onSwatchClick(swatch);
            }}
          />
        );
      })}
    </div>
  );
});

// Rough hue-family test used only to draw the matched-swatch ring.
// Precise matching is the ranker's job via ∆E; here we just want
// "does this specific swatch look roughly red?" for the visual hint.
function paletteMatchesFamily(swatch: Swatch, family: string): boolean {
  const { l, a, b } = swatch;
  const chroma = Math.sqrt(a * a + b * b);
  if (family === 'black') return l < 25 && chroma < 20;
  if (family === 'white') return l > 80 && chroma < 15;
  if (family === 'gray') return chroma < 12 && l >= 25 && l <= 80;
  if (chroma < 10) return false;
  const hueDeg = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  switch (family) {
    case 'red':    return hueDeg < 20 || hueDeg >= 345;
    case 'orange': return hueDeg >= 20 && hueDeg < 50;
    case 'yellow': return hueDeg >= 50 && hueDeg < 80;
    case 'green':  return hueDeg >= 95 && hueDeg < 165;
    case 'teal':   return hueDeg >= 165 && hueDeg < 200;
    case 'blue':   return hueDeg >= 200 && hueDeg < 255;
    case 'purple': return hueDeg >= 255 && hueDeg < 300;
    case 'pink':   return hueDeg >= 300 && hueDeg < 345;
    case 'brown':  return (hueDeg >= 20 && hueDeg < 60) && l < 50;
    default:       return false;
  }
}
