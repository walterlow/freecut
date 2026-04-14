/**
 * WGSL blend mode functions for the compositor shader.
 * 25 blend modes matching the BlendMode TypeScript type.
 *
 * Each fn blendXxx(base: vec3f, layer: vec3f) -> vec3f
 * operates on linear RGB [0..1].
 */

export const BLEND_MODES_WGSL = /* wgsl */ `
// ─── HSL helpers (needed for component blend modes) ───

fn compositor_rgb2hsl(c: vec3f) -> vec3f {
  let mx = max(max(c.r, c.g), c.b);
  let mn = min(min(c.r, c.g), c.b);
  let l = (mx + mn) * 0.5;
  if (mx == mn) { return vec3f(0.0, 0.0, l); }
  let d = mx - mn;
  let s = select(d / (2.0 - mx - mn), d / (mx + mn), l > 0.5);
  var h: f32;
  if (mx == c.r) {
    h = (c.g - c.b) / d + select(0.0, 6.0, c.g < c.b);
  } else if (mx == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  h /= 6.0;
  return vec3f(h, s, l);
}

fn compositor_hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt = t;
  if (tt < 0.0) { tt += 1.0; }
  if (tt > 1.0) { tt -= 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn compositor_hsl2rgb(c: vec3f) -> vec3f {
  if (c.y == 0.0) { return vec3f(c.z); }
  let q = select(c.z + c.y - c.z * c.y, c.z * (1.0 + c.y), c.z < 0.5);
  let p = 2.0 * c.z - q;
  return vec3f(
    compositor_hue2rgb(p, q, c.x + 1.0 / 3.0),
    compositor_hue2rgb(p, q, c.x),
    compositor_hue2rgb(p, q, c.x - 1.0 / 3.0)
  );
}

fn compositor_lum(c: vec3f) -> f32 {
  return dot(c, vec3f(0.3, 0.59, 0.11));
}

fn compositor_setLum(c: vec3f, l: f32) -> vec3f {
  let d = l - compositor_lum(c);
  var r = c + vec3f(d);
  let mn = min(min(r.r, r.g), r.b);
  let mx = max(max(r.r, r.g), r.b);
  let ll = compositor_lum(r);
  if (mn < 0.0) {
    r = vec3f(ll) + (r - vec3f(ll)) * ll / (ll - mn);
  }
  if (mx > 1.0) {
    r = vec3f(ll) + (r - vec3f(ll)) * (1.0 - ll) / (mx - ll);
  }
  return r;
}

fn compositor_sat(c: vec3f) -> f32 {
  return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

// ─── Blend mode implementations ───

fn blendNormal(base: vec3f, layer: vec3f) -> vec3f { return layer; }

fn blendDarken(base: vec3f, layer: vec3f) -> vec3f { return min(base, layer); }
fn blendMultiply(base: vec3f, layer: vec3f) -> vec3f { return base * layer; }
fn blendColorBurn(base: vec3f, layer: vec3f) -> vec3f {
  return select(1.0 - min(vec3f(1.0), (1.0 - base) / max(layer, vec3f(0.001))), vec3f(0.0), layer == vec3f(0.0));
}
fn blendLinearBurn(base: vec3f, layer: vec3f) -> vec3f { return max(base + layer - 1.0, vec3f(0.0)); }

fn blendLighten(base: vec3f, layer: vec3f) -> vec3f { return max(base, layer); }
fn blendScreen(base: vec3f, layer: vec3f) -> vec3f { return 1.0 - (1.0 - base) * (1.0 - layer); }
fn blendColorDodge(base: vec3f, layer: vec3f) -> vec3f {
  return select(min(vec3f(1.0), base / max(1.0 - layer, vec3f(0.001))), vec3f(1.0), layer == vec3f(1.0));
}
fn blendLinearDodge(base: vec3f, layer: vec3f) -> vec3f { return min(base + layer, vec3f(1.0)); }

fn blendOverlay(base: vec3f, layer: vec3f) -> vec3f {
  return select(
    1.0 - 2.0 * (1.0 - base) * (1.0 - layer),
    2.0 * base * layer,
    base <= vec3f(0.5)
  );
}
fn blendSoftLight(base: vec3f, layer: vec3f) -> vec3f {
  return select(
    base + (2.0 * layer - 1.0) * (sqrt(base) - base),
    base - (1.0 - 2.0 * layer) * base * (1.0 - base),
    layer <= vec3f(0.5)
  );
}
fn blendHardLight(base: vec3f, layer: vec3f) -> vec3f {
  return select(
    1.0 - 2.0 * (1.0 - base) * (1.0 - layer),
    2.0 * base * layer,
    layer <= vec3f(0.5)
  );
}
fn blendVividLight(base: vec3f, layer: vec3f) -> vec3f {
  return select(
    blendColorDodge(base, 2.0 * (layer - 0.5)),
    blendColorBurn(base, 2.0 * layer),
    layer <= vec3f(0.5)
  );
}
fn blendLinearLight(base: vec3f, layer: vec3f) -> vec3f {
  return clamp(base + 2.0 * layer - 1.0, vec3f(0.0), vec3f(1.0));
}
fn blendPinLight(base: vec3f, layer: vec3f) -> vec3f {
  return select(
    max(base, 2.0 * (layer - 0.5)),
    min(base, 2.0 * layer),
    layer <= vec3f(0.5)
  );
}
fn blendHardMix(base: vec3f, layer: vec3f) -> vec3f {
  return select(vec3f(0.0), vec3f(1.0), base + layer >= vec3f(1.0));
}

fn blendDifference(base: vec3f, layer: vec3f) -> vec3f { return abs(base - layer); }
fn blendExclusion(base: vec3f, layer: vec3f) -> vec3f { return base + layer - 2.0 * base * layer; }
fn blendSubtract(base: vec3f, layer: vec3f) -> vec3f { return max(base - layer, vec3f(0.0)); }
fn blendDivide(base: vec3f, layer: vec3f) -> vec3f { return min(base / max(layer, vec3f(0.001)), vec3f(1.0)); }

fn blendHue(base: vec3f, layer: vec3f) -> vec3f {
  let bHsl = compositor_rgb2hsl(base);
  let lHsl = compositor_rgb2hsl(layer);
  return compositor_hsl2rgb(vec3f(lHsl.x, bHsl.y, bHsl.z));
}
fn blendSaturation(base: vec3f, layer: vec3f) -> vec3f {
  let bHsl = compositor_rgb2hsl(base);
  let lHsl = compositor_rgb2hsl(layer);
  return compositor_hsl2rgb(vec3f(bHsl.x, lHsl.y, bHsl.z));
}
fn blendColor(base: vec3f, layer: vec3f) -> vec3f {
  let lHsl = compositor_rgb2hsl(layer);
  let bL = compositor_lum(base);
  return compositor_setLum(compositor_hsl2rgb(vec3f(lHsl.x, lHsl.y, 0.5)), bL);
}
fn blendLuminosity(base: vec3f, layer: vec3f) -> vec3f {
  return compositor_setLum(base, compositor_lum(layer));
}

// ─── Dispatch by mode index ───

fn applyBlendMode(base: vec3f, layer: vec3f, mode: u32) -> vec3f {
  switch (mode) {
    case 0u:  { return blendNormal(base, layer); }
    case 1u:  { return blendNormal(base, layer); } // dissolve handled by caller
    case 2u:  { return blendDarken(base, layer); }
    case 3u:  { return blendMultiply(base, layer); }
    case 4u:  { return blendColorBurn(base, layer); }
    case 5u:  { return blendLinearBurn(base, layer); }
    case 6u:  { return blendLighten(base, layer); }
    case 7u:  { return blendScreen(base, layer); }
    case 8u:  { return blendColorDodge(base, layer); }
    case 9u:  { return blendLinearDodge(base, layer); }
    case 10u: { return blendOverlay(base, layer); }
    case 11u: { return blendSoftLight(base, layer); }
    case 12u: { return blendHardLight(base, layer); }
    case 13u: { return blendVividLight(base, layer); }
    case 14u: { return blendLinearLight(base, layer); }
    case 15u: { return blendPinLight(base, layer); }
    case 16u: { return blendHardMix(base, layer); }
    case 17u: { return blendDifference(base, layer); }
    case 18u: { return blendExclusion(base, layer); }
    case 19u: { return blendSubtract(base, layer); }
    case 20u: { return blendDivide(base, layer); }
    case 21u: { return blendHue(base, layer); }
    case 22u: { return blendSaturation(base, layer); }
    case 23u: { return blendColor(base, layer); }
    case 24u: { return blendLuminosity(base, layer); }
    default:  { return blendNormal(base, layer); }
  }
}
`;
