import { memo } from 'react';
import { cn } from '@/shared/ui/cn';

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
}

function labToRgb(l: number, a: number, b: number): [number, number, number] {
  // Inverse of sRGB → Lab conversion: Lab → XYZ → linear sRGB → gamma.
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;

  const xr = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
  const yr = l > kappa * epsilon ? ((l + 16) / 116) ** 3 : l / kappa;
  const zr = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;

  const refX = 0.95047;
  const refZ = 1.08883;
  const X = xr * refX;
  const Y = yr * 1.0;
  const Z = zr * refZ;

  // XYZ → linear sRGB
  let rLin =  3.2404542 * X + -1.5371385 * Y + -0.4985314 * Z;
  let gLin = -0.9692660 * X +  1.8760108 * Y +  0.0415560 * Z;
  let bLin =  0.0556434 * X + -0.2040259 * Y +  1.0572252 * Z;

  const compand = (v: number): number => {
    const clamped = Math.max(0, Math.min(1, v));
    return clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  };

  rLin = compand(rLin);
  gLin = compand(gLin);
  bLin = compand(bLin);

  return [
    Math.round(rLin * 255),
    Math.round(gLin * 255),
    Math.round(bLin * 255),
  ];
}

function swatchColor(swatch: Swatch): string {
  const [r, g, b] = labToRgb(swatch.l, swatch.a, swatch.b);
  return `rgb(${r}, ${g}, ${b})`;
}

export const ScenePaletteSwatches = memo(function ScenePaletteSwatches({
  palette,
  highlight,
  className,
}: ScenePaletteSwatchesProps) {
  if (!palette || palette.length === 0) return null;
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
        return (
          <span
            key={i}
            className={cn(
              'block h-3 rounded-sm border border-white/10',
              isHighlighted && 'ring-2 ring-primary',
            )}
            style={{
              width: `${width}px`,
              backgroundColor: swatchColor(swatch),
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
