/**
 * WGSL compute shaders for GPU-accelerated optical flow analysis.
 *
 * Pipeline: grayscale → pyramid downsample → spatial gradients →
 *           temporal gradient → Lucas-Kanade → flow statistics → clear stats
 *
 * Analysis resolution: 160×90 (base), 3-level Gaussian pyramid.
 */

export const ANALYSIS_WIDTH = 160;
export const ANALYSIS_HEIGHT = 90;
export const PYRAMID_LEVELS = 3;

export const OPTICAL_FLOW_WGSL = /* wgsl */ `

// ─── Grayscale conversion (BT.601) ───

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn grayscaleMain(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(inputTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let color = textureLoad(inputTex, vec2i(gid.xy), 0);
  let lum = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
  textureStore(outputTex, vec2i(gid.xy), vec4f(lum, 0.0, 0.0, 0.0));
}

// ─── Gaussian pyramid 2× downsample ───

@group(0) @binding(0) var pyramidInput: texture_2d<f32>;
@group(0) @binding(1) var pyramidOutput: texture_storage_2d<r32float, write>;

const GAUSS_KERNEL = array<f32, 16>(
  0.0625, 0.125, 0.125, 0.0625,
  0.125,  0.25,  0.25,  0.125,
  0.125,  0.25,  0.25,  0.125,
  0.0625, 0.125, 0.125, 0.0625
);

@compute @workgroup_size(8, 8)
fn pyramidDownsampleMain(@builtin(global_invocation_id) gid: vec3u) {
  let outDims = textureDimensions(pyramidOutput);
  if (gid.x >= outDims.x || gid.y >= outDims.y) { return; }
  let inDims = textureDimensions(pyramidInput);
  let baseX = i32(gid.x) * 2;
  let baseY = i32(gid.y) * 2;
  var sum = 0.0;
  for (var dy = 0; dy < 4; dy++) {
    for (var dx = 0; dx < 4; dx++) {
      let sx = clamp(baseX + dx - 1, 0, i32(inDims.x) - 1);
      let sy = clamp(baseY + dy - 1, 0, i32(inDims.y) - 1);
      sum += textureLoad(pyramidInput, vec2i(sx, sy), 0).r * GAUSS_KERNEL[dy * 4 + dx];
    }
  }
  textureStore(pyramidOutput, vec2i(gid.xy), vec4f(sum, 0.0, 0.0, 0.0));
}

// ─── Spatial gradients (Scharr operator) ───

@group(0) @binding(0) var gradInput: texture_2d<f32>;
@group(0) @binding(1) var gradIx: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var gradIy: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn spatialGradientsMain(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(gradInput);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let w = i32(dims.x) - 1;
  let h = i32(dims.y) - 1;

  // Scharr kernels (more accurate than Sobel)
  let tl = textureLoad(gradInput, vec2i(clamp(x-1,0,w), clamp(y-1,0,h)), 0).r;
  let tc = textureLoad(gradInput, vec2i(x,                clamp(y-1,0,h)), 0).r;
  let tr = textureLoad(gradInput, vec2i(clamp(x+1,0,w), clamp(y-1,0,h)), 0).r;
  let ml = textureLoad(gradInput, vec2i(clamp(x-1,0,w), y),               0).r;
  let mr = textureLoad(gradInput, vec2i(clamp(x+1,0,w), y),               0).r;
  let bl = textureLoad(gradInput, vec2i(clamp(x-1,0,w), clamp(y+1,0,h)), 0).r;
  let bc = textureLoad(gradInput, vec2i(x,                clamp(y+1,0,h)), 0).r;
  let br = textureLoad(gradInput, vec2i(clamp(x+1,0,w), clamp(y+1,0,h)), 0).r;

  // Scharr X: [-3, 0, 3; -10, 0, 10; -3, 0, 3] / 32
  let ix = (-3.0*tl + 3.0*tr - 10.0*ml + 10.0*mr - 3.0*bl + 3.0*br) / 32.0;
  // Scharr Y: [-3, -10, -3; 0, 0, 0; 3, 10, 3] / 32
  let iy = (-3.0*tl - 10.0*tc - 3.0*tr + 3.0*bl + 10.0*bc + 3.0*br) / 32.0;

  textureStore(gradIx, vec2i(gid.xy), vec4f(ix, 0.0, 0.0, 0.0));
  textureStore(gradIy, vec2i(gid.xy), vec4f(iy, 0.0, 0.0, 0.0));
}

// ─── Temporal gradient (frame difference) ───

@group(0) @binding(0) var temporalCurrent: texture_2d<f32>;
@group(0) @binding(1) var temporalPrevious: texture_2d<f32>;
@group(0) @binding(2) var temporalIt: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn temporalGradientMain(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(temporalCurrent);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let curr = textureLoad(temporalCurrent, vec2i(gid.xy), 0).r;
  let prev = textureLoad(temporalPrevious, vec2i(gid.xy), 0).r;
  textureStore(temporalIt, vec2i(gid.xy), vec4f(curr - prev, 0.0, 0.0, 0.0));
}

// ─── Lucas-Kanade optical flow ───

@group(0) @binding(0) var lkIx: texture_2d<f32>;
@group(0) @binding(1) var lkIy: texture_2d<f32>;
@group(0) @binding(2) var lkIt: texture_2d<f32>;
@group(0) @binding(3) var lkFlow: texture_storage_2d<rg32float, write>;
@group(0) @binding(4) var lkPrevFlow: texture_2d<f32>;

struct LKParams {
  windowRadius: i32,
  minEigenvalue: f32,
  pyramidScale: f32,
  hasPrevFlow: u32,
};
@group(0) @binding(5) var<uniform> lkParams: LKParams;

@compute @workgroup_size(8, 8)
fn lucasKanadeMain(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(lkIx);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let pos = vec2i(gid.xy);
  let radius = lkParams.windowRadius;

  // Initialize from coarser level flow (if available)
  var initFlow = vec2f(0.0);
  if (lkParams.hasPrevFlow != 0u) {
    let prevDims = textureDimensions(lkPrevFlow);
    let prevUV = vec2f(f32(pos.x) / f32(dims.x) * f32(prevDims.x),
                       f32(pos.y) / f32(dims.y) * f32(prevDims.y));
    initFlow = textureLoad(lkPrevFlow, vec2i(prevUV), 0).rg * lkParams.pyramidScale;
  }

  // Accumulate structure tensor over window
  var sumIxIx = 0.0;
  var sumIyIy = 0.0;
  var sumIxIy = 0.0;
  var sumIxIt = 0.0;
  var sumIyIt = 0.0;

  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius; dx <= radius; dx++) {
      let sp = vec2i(
        clamp(pos.x + dx, 0, i32(dims.x) - 1),
        clamp(pos.y + dy, 0, i32(dims.y) - 1)
      );
      let ix = textureLoad(lkIx, sp, 0).r;
      let iy = textureLoad(lkIy, sp, 0).r;
      let it = textureLoad(lkIt, sp, 0).r;
      sumIxIx += ix * ix;
      sumIyIy += iy * iy;
      sumIxIy += ix * iy;
      sumIxIt += ix * it;
      sumIyIt += iy * it;
    }
  }

  // Solve via Cramer's rule with eigenvalue check
  let det = sumIxIx * sumIyIy - sumIxIy * sumIxIy;
  let trace = sumIxIx + sumIyIy;
  let eigenMin = (trace - sqrt(max(trace * trace - 4.0 * det, 0.0))) * 0.5;

  var flow = initFlow;
  if (eigenMin > lkParams.minEigenvalue && abs(det) > 0.0001) {
    let vx = -(sumIyIy * sumIxIt - sumIxIy * sumIyIt) / det;
    let vy = -(sumIxIx * sumIyIt - sumIxIy * sumIxIt) / det;
    flow = initFlow + vec2f(vx, vy);
  }

  textureStore(lkFlow, pos, vec4f(flow, 0.0, 0.0));
}

// ─── Flow statistics (atomic reduction) ───

struct FlowStats {
  sumMagnitude: atomic<u32>,
  sumVx: atomic<u32>,
  sumVy: atomic<u32>,
  pixelCount: atomic<u32>,
  dirBin0: atomic<u32>,
  dirBin1: atomic<u32>,
  dirBin2: atomic<u32>,
  dirBin3: atomic<u32>,
  dirBin4: atomic<u32>,
  dirBin5: atomic<u32>,
  dirBin6: atomic<u32>,
  dirBin7: atomic<u32>,
};

@group(0) @binding(0) var statFlow: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> stats: FlowStats;

struct StatsParams {
  magnitudeThreshold: f32,
};
@group(0) @binding(2) var<uniform> statsParams: StatsParams;

fn atomicAddDir(bin: u32, val: u32, stats_ptr: ptr<storage, FlowStats, read_write>) {
  switch (bin) {
    case 0u: { atomicAdd(&(*stats_ptr).dirBin0, val); }
    case 1u: { atomicAdd(&(*stats_ptr).dirBin1, val); }
    case 2u: { atomicAdd(&(*stats_ptr).dirBin2, val); }
    case 3u: { atomicAdd(&(*stats_ptr).dirBin3, val); }
    case 4u: { atomicAdd(&(*stats_ptr).dirBin4, val); }
    case 5u: { atomicAdd(&(*stats_ptr).dirBin5, val); }
    case 6u: { atomicAdd(&(*stats_ptr).dirBin6, val); }
    case 7u: { atomicAdd(&(*stats_ptr).dirBin7, val); }
    default: {}
  }
}

@compute @workgroup_size(8, 8)
fn flowStatisticsMain(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(statFlow);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let flow = textureLoad(statFlow, vec2i(gid.xy), 0).rg;
  let mag = length(flow);

  if (mag < statsParams.magnitudeThreshold) { return; }

  // Fixed-point scaling (×1000) for atomic integer ops on float values
  let scaledMag = u32(mag * 1000.0);
  let scaledVx = u32((flow.x + 100.0) * 1000.0); // offset to avoid negative
  let scaledVy = u32((flow.y + 100.0) * 1000.0);

  atomicAdd(&stats.sumMagnitude, scaledMag);
  atomicAdd(&stats.sumVx, scaledVx);
  atomicAdd(&stats.sumVy, scaledVy);
  atomicAdd(&stats.pixelCount, 1u);

  // Direction histogram: 8 bins of 45°
  let angle = atan2(flow.y, flow.x); // -PI..PI
  let normalizedAngle = (angle + 3.14159265) / 6.28318530; // 0..1
  let bin = min(u32(normalizedAngle * 8.0), 7u);
  atomicAddDir(bin, 1u, &stats);
}

// ─── Clear stats buffer ───

@group(0) @binding(0) var<storage, read_write> clearStats: FlowStats;

@compute @workgroup_size(1)
fn clearStatsMain() {
  atomicStore(&clearStats.sumMagnitude, 0u);
  atomicStore(&clearStats.sumVx, 0u);
  atomicStore(&clearStats.sumVy, 0u);
  atomicStore(&clearStats.pixelCount, 0u);
  atomicStore(&clearStats.dirBin0, 0u);
  atomicStore(&clearStats.dirBin1, 0u);
  atomicStore(&clearStats.dirBin2, 0u);
  atomicStore(&clearStats.dirBin3, 0u);
  atomicStore(&clearStats.dirBin4, 0u);
  atomicStore(&clearStats.dirBin5, 0u);
  atomicStore(&clearStats.dirBin6, 0u);
  atomicStore(&clearStats.dirBin7, 0u);
}
`;
