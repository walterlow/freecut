/**
 * Inverse of sRGB → Lab conversion: Lab → XYZ → linear sRGB → gamma.
 * Used to render palette swatches back to their display colors.
 */
export function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200

  const epsilon = 216 / 24389
  const kappa = 24389 / 27

  const xr = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa
  const yr = l > kappa * epsilon ? ((l + 16) / 116) ** 3 : l / kappa
  const zr = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa

  const refX = 0.95047
  const refZ = 1.08883
  const X = xr * refX
  const Y = yr * 1.0
  const Z = zr * refZ

  // XYZ → linear sRGB
  let rLin = 3.2404542 * X + -1.5371385 * Y + -0.4985314 * Z
  let gLin = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z
  let bLin = 0.0556434 * X + -0.2040259 * Y + 1.0572252 * Z

  const compand = (v: number): number => {
    const clamped = Math.max(0, Math.min(1, v))
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
  }

  rLin = compand(rLin)
  gLin = compand(gLin)
  bLin = compand(bLin)

  return [Math.round(rLin * 255), Math.round(gLin * 255), Math.round(bLin * 255)]
}
