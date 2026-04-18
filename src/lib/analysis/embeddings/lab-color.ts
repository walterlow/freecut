/**
 * sRGB → CIELAB conversion and Delta E perceptual distance.
 *
 * Color-by-query is notoriously hard for CLIP — CLIP was trained on
 * captions like `"a photo of a red firetruck"` where color is attached
 * to an object, so bare color queries drift to weak matches. Industry
 * CBIR systems (Imgix, TinEye, classic color histograms) use the
 * CIELAB color space with ∆E distance because Lab is approximately
 * perceptually uniform — equal ∆E steps correspond to equal visible
 * differences. This module provides that pipeline.
 *
 * Conversion constants come from the D65 reference illuminant, which
 * matches sRGB's standard viewing conditions. The ∆E 2000 formula is
 * the industry standard for perceptual distance; ∆E 76 is the
 * simpler Euclidean version used as a fast fallback.
 */

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

// D65 reference white in XYZ.
const REF_X = 0.95047;
const REF_Y = 1.0;
const REF_Z = 1.08883;

function sRgbCompand(v: number): number {
  // Inverse of the sRGB gamma companding — get back to linear light.
  const normalized = v / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function labFTransform(t: number): number {
  const epsilon = 216 / 24389; // 0.008856...
  const kappa = 24389 / 27;    // 903.3...
  return t > epsilon
    ? Math.cbrt(t)
    : (kappa * t + 16) / 116;
}

/**
 * Convert 0–255 sRGB values to CIELAB. Input assumed gamma-encoded
 * (as JPEGs are). Output `l` is in 0–100, `a`/`b` roughly in -128..127.
 */
export function rgbToLab(r: number, g: number, b: number): LabColor {
  const rLin = sRgbCompand(r);
  const gLin = sRgbCompand(g);
  const bLin = sRgbCompand(b);

  // sRGB → XYZ (D65)
  const x = rLin * 0.4124564 + gLin * 0.3575761 + bLin * 0.1804375;
  const y = rLin * 0.2126729 + gLin * 0.7151522 + bLin * 0.0721750;
  const z = rLin * 0.0193339 + gLin * 0.1191920 + bLin * 0.9503041;

  // XYZ → Lab
  const fx = labFTransform(x / REF_X);
  const fy = labFTransform(y / REF_Y);
  const fz = labFTransform(z / REF_Z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * Simple Euclidean distance in Lab (∆E 76). Cheap, approximate —
 * values below ~2 are visually indistinguishable, 2–10 is a subtle
 * change, 10+ is obviously different.
 */
export function deltaE76(a: LabColor, b: LabColor): number {
  const dL = a.l - b.l;
  const dA = a.a - b.a;
  const dB = a.b - b.b;
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

/**
 * CIEDE 2000 — industry-standard perceptual distance. Corrects for
 * known issues with ∆E 76 (hue non-linearity, blue/purple cluster
 * distortion). More expensive but still cheap enough to run per
 * palette entry per query on the hot path.
 *
 * Formula source: Sharma et al. (2005), "The CIEDE2000 Color-Difference
 * Formula: Implementation Notes, Supplementary Test Data, and
 * Mathematical Observations."
 */
export function deltaE2000(c1: LabColor, c2: LabColor): number {
  const { l: l1, a: a1, b: b1 } = c1;
  const { l: l2, a: a2, b: b2 } = c2;

  const avgL = (l1 + l2) / 2;
  const c1ab = Math.sqrt(a1 * a1 + b1 * b1);
  const c2ab = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (c1ab + c2ab) / 2;

  const g = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + g);
  const a2p = a2 * (1 + g);

  const c1p = Math.sqrt(a1p * a1p + b1 * b1);
  const c2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avgCp = (c1p + c2p) / 2;

  const h1p = Math.atan2(b1, a1p) >= 0
    ? Math.atan2(b1, a1p)
    : Math.atan2(b1, a1p) + 2 * Math.PI;
  const h2p = Math.atan2(b2, a2p) >= 0
    ? Math.atan2(b2, a2p)
    : Math.atan2(b2, a2p) + 2 * Math.PI;

  const dHp = (() => {
    if (c1p * c2p === 0) return 0;
    const diff = h2p - h1p;
    if (Math.abs(diff) <= Math.PI) return diff;
    return diff > Math.PI ? diff - 2 * Math.PI : diff + 2 * Math.PI;
  })();

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  const dHpFinal = 2 * Math.sqrt(c1p * c2p) * Math.sin(dHp / 2);

  const avgHp = (() => {
    if (c1p * c2p === 0) return h1p + h2p;
    if (Math.abs(h1p - h2p) <= Math.PI) return (h1p + h2p) / 2;
    return h1p + h2p < 2 * Math.PI
      ? (h1p + h2p + 2 * Math.PI) / 2
      : (h1p + h2p - 2 * Math.PI) / 2;
  })();

  const t = 1
    - 0.17 * Math.cos(avgHp - Math.PI / 6)
    + 0.24 * Math.cos(2 * avgHp)
    + 0.32 * Math.cos(3 * avgHp + Math.PI / 30)
    - 0.20 * Math.cos(4 * avgHp - (63 * Math.PI) / 180);

  const sl = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const sc = 1 + 0.045 * avgCp;
  const sh = 1 + 0.015 * avgCp * t;

  const dTheta = (30 * Math.PI / 180) * Math.exp(-Math.pow((avgHp * 180 / Math.PI - 275) / 25, 2));
  const rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const rt = -rc * Math.sin(2 * dTheta);

  return Math.sqrt(
    Math.pow(dLp / sl, 2)
    + Math.pow(dCp / sc, 2)
    + Math.pow(dHpFinal / sh, 2)
    + rt * (dCp / sc) * (dHpFinal / sh),
  );
}
