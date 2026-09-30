import type { GpuEffectDefinition } from '../types'
import { DEFAULT_PROJECTION_360_SETTINGS, type HorizonLockMode } from '@/types/projection360'

const PROJECTION_360_SHADER = /* wgsl */ `
struct Projection360Params {
  outputSize: vec2f,
  sourceSize: vec2f,
  fov: f32,
  distance: f32,
  distortion: f32,
  yaw: f32,
  pitch: f32,
  roll: f32,
  horizonLock: f32,
  horizonOffset: f32,
  enabled: f32,
  sourceMode: f32,
  dewarpMode: f32,
  _pad2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Projection360Params;

const HALF_PI: f32 = 1.5707963267948966;

@fragment
fn projection360Fragment(input: VertexOutput) -> @location(0) vec4f {
  var sampleUv = input.uv;
  var inBounds = true;

  if (params.enabled >= 0.5) {
    let aspect = params.outputSize.x / max(params.outputSize.y, 0.001);

    // Angles in radians
    let yawRad = params.yaw * (PI / 180.0);
    let pitchRad = params.pitch * (PI / 180.0);
    let rollRad = params.roll * (PI / 180.0);
    let horizonOffsetRad = params.horizonOffset * (PI / 180.0);

    // Horizon lock calculation
    var effectiveRoll = rollRad + horizonOffsetRad;
    if (params.horizonLock > 1.5) {
      // 360 Horizon Lock: Roll stabilized to horizon offset
      effectiveRoll = horizonOffsetRad;
    } else if (params.horizonLock > 0.5) {
      // 45 Horizon Lock: Dampen within +-45 deg (PI/4)
      let limit = PI * 0.25;
      let clamped = clamp(rollRad, -limit, limit);
      effectiveRoll = (rollRad - clamped) + horizonOffsetRad;
    }

    // ============================================================
    // MODE 0: Planar Lens Dewarp & FOV (UltraWide / Action Cam)
    // ============================================================
    if (params.sourceMode < 0.5) {
      let zoom = max(params.distance, 0.05);
      let xs = (input.uv.x - 0.5) / zoom;
      let ys = (input.uv.y - 0.5) / (zoom * aspect);

      // 1. Roll & Horizon Lock
      let cosR = cos(effectiveRoll);
      let sinR = sin(effectiveRoll);
      let r1x = xs * cosR - ys * sinR;
      let r1y = xs * sinR + ys * cosR;
      let r1z = 1.0;

      // 2. Pitch
      let cosP = cos(pitchRad);
      let sinP = sin(pitchRad);
      let r2x = r1x;
      let r2y = r1y * cosP - r1z * sinP;
      let r2z = r1y * sinP + r1z * cosP;

      // 3. Yaw
      let cosY = cos(yawRad);
      let sinY = sin(yawRad);
      let r3x = r2x * cosY + r2z * sinY;
      let r3y = r2y;
      let r3z = -r2x * sinY + r2z * cosY;

      let rz = max(r3z, 0.001);
      let xp = r3x / rz;
      let yp = r3y / rz;

      // Curvature & Optical Projection:
      // - Submode B (dewarpMode == 1.0): Linear, Narrow, 45° Lock, 360° Lock
      //   k = 0.0 -> scale = 1.0 -> 100% straight rectilinear lines, ZERO U-sagging, ZERO lateral bowing.
      // - Submode A (dewarpMode == 0.0): Fisheye / Angular action-cam optics
      //   UltraWide (fov >= 105.0): k = 0.42 -> genuine wide action-cam fisheye / gran angular de ojo de pez.
      //   Wide (fov < 105.0): k = 0.21 -> action-cam angular moderado.
      // - Modo Libre (dewarpMode >= 1.5): Continuous slider from 0% flat rectilinear to 100% fisheye.
      var k = 0.0;
      if (params.dewarpMode >= 1.5) {
        k = clamp(params.distortion, 0.0, 1.0) * 0.42;
      } else if (params.dewarpMode < 0.5) {
        if (params.fov >= 105.0) {
          k = 0.42;
        } else {
          k = 0.21;
        }
      } else {
        k = 0.0;
      }

      // Auto-fit framing scale to eliminate black borders in UltraWide and Wide,
      // ensuring full 100% frame coverage matching Insta360 Studio (fitScale = 1.0 for Linear / Narrow)
      let fitScale = 1.0 / (1.0 + k * 0.46);
      let fx = xp * fitScale;
      let fy = yp * fitScale;

      let r2 = fx * fx + (fy * aspect) * (fy * aspect);
      let scale = 1.0 + k * r2;

      let u = 0.5 + fx * scale;
      let v = 0.5 + fy * aspect * scale;

      inBounds = true;
      sampleUv = clamp(vec2f(u, v), vec2f(0.0001), vec2f(0.9999));
    } else {
      // ============================================================
      // MODE 1: Spherical 360 (Equirectangular Video)
      // For true 360° spherical footage (reframing onto camera plane)
      // ============================================================
      let screen = (input.uv - vec2f(0.5)) * vec2f(aspect, 1.0) * 2.0;

      let fovRad = params.fov * (PI / 180.0);
      let f = 1.0 / max(tan(fovRad * 0.5), 0.001) * max(params.distance, 0.1);

      var rx = screen.x / f;
      var ry = -screen.y / f;
      let rz = 1.0;

      if (params.distortion > 0.0) {
        let d = clamp(params.distortion, 0.0, 1.0);
        let r2 = rx * rx + ry * ry;
        let factor = 1.0 / (1.0 + d * r2 * 0.25);
        rx = rx * factor;
        ry = ry * factor;
      }

      let ray360 = normalize(vec3f(rx, ry, rz));

      let cosRoll = cos(effectiveRoll);
      let sinRoll = sin(effectiveRoll);
      let rZ = vec3f(
        ray360.x * cosRoll - ray360.y * sinRoll,
        ray360.x * sinRoll + ray360.y * cosRoll,
        ray360.z
      );

      let cosPitch = cos(pitchRad);
      let sinPitch = sin(pitchRad);
      let rX360 = vec3f(
        rZ.x,
        rZ.y * cosPitch - rZ.z * sinPitch,
        rZ.y * sinPitch + rZ.z * cosPitch
      );

      let cosYaw = cos(yawRad);
      let sinYaw = sin(yawRad);
      let rY360 = vec3f(
        rX360.x * cosYaw + rX360.z * sinYaw,
        rX360.y,
        -rX360.x * sinYaw + rX360.z * cosYaw
      );

      let w = normalize(rY360);

      let lon = atan2(w.x, w.z);
      let lat = asin(clamp(w.y, -1.0, 1.0));

      var u360 = (lon + PI) / TAU;
      u360 = fract(u360);
      let v360 = clamp((HALF_PI - lat) / PI, 0.0001, 0.9999);

      sampleUv = vec2f(u360, v360);
      inBounds = true;
    }
  }

  let color = textureSampleLevel(inputTex, texSampler, sampleUv, 0.0);
  return select(vec4f(0.0, 0.0, 0.0, 0.0), color, inBounds);
}
`

function horizonLockToNumeric(mode: HorizonLockMode | string): number {
  if (mode === '360') return 2.0
  if (mode === '45') return 1.0
  return 0.0
}

export const projection360: GpuEffectDefinition = {
  id: 'gpu-projection-360',
  name: '360° & FOV Projection',
  category: 'distort',
  entryPoint: 'projection360Fragment',
  uniformSize: 64,
  shader: PROJECTION_360_SHADER,
  params: {
    enabled: {
      type: 'boolean',
      label: 'Enable 360° Projection',
      default: true,
      animatable: false,
    },
    sourceMode: {
      type: 'select',
      label: 'Source Projection',
      default: 'ultrawide',
      options: [
        { value: 'ultrawide', label: 'UltraWide / Action Cam' },
        { value: 'spherical_360', label: '360° Spherical (Equirectangular)' },
      ],
      animatable: false,
    },
    preset: {
      type: 'select',
      label: 'FOV Preset',
      default: 'linear',
      options: [
        { value: 'ultra-wide', label: 'UltraWide' },
        { value: 'wide', label: 'Wide' },
        { value: 'linear', label: 'Linear' },
        { value: 'narrow', label: 'Narrow' },
        { value: 'horizon-45', label: '45° Horizont' },
        { value: 'horizon-360', label: '360° Horizont' },
        { value: 'custom', label: 'Libre' },
      ],
      animatable: false,
    },
    fov: {
      type: 'number',
      label: 'Field of View',
      default: DEFAULT_PROJECTION_360_SETTINGS.fov,
      min: 30,
      max: 150,
      step: 1,
      animatable: true,
    },
    distance: {
      type: 'number',
      label: 'Distance / Zoom',
      default: DEFAULT_PROJECTION_360_SETTINGS.distance,
      min: 0.5,
      max: 3.0,
      step: 0.05,
      animatable: true,
    },
    distortion: {
      type: 'number',
      label: 'Curvature / Dewarp',
      default: DEFAULT_PROJECTION_360_SETTINGS.distortion,
      min: 0,
      max: 1,
      step: 0.02,
      animatable: true,
    },
    yaw: {
      type: 'number',
      label: 'Yaw (Pan)',
      default: DEFAULT_PROJECTION_360_SETTINGS.yaw,
      min: -180,
      max: 180,
      step: 0.5,
      animatable: true,
    },
    pitch: {
      type: 'number',
      label: 'Pitch (Tilt)',
      default: DEFAULT_PROJECTION_360_SETTINGS.pitch,
      min: -90,
      max: 90,
      step: 0.5,
      animatable: true,
    },
    roll: {
      type: 'number',
      label: 'Roll',
      default: DEFAULT_PROJECTION_360_SETTINGS.roll,
      min: -180,
      max: 180,
      step: 0.5,
      animatable: true,
    },
    horizonLock: {
      type: 'select',
      label: 'Horizon Lock',
      default: 'off',
      options: [
        { value: 'off', label: 'Off' },
        { value: '45', label: '45° Horizon Lock' },
        { value: '360', label: '360° Horizon Lock' },
      ],
      animatable: false,
    },
    horizonOffset: {
      type: 'number',
      label: 'Horizon Offset',
      default: DEFAULT_PROJECTION_360_SETTINGS.horizonOffset,
      min: -45,
      max: 45,
      step: 0.5,
      animatable: true,
    },
  },
  packUniforms: (p, width, height) => {
    const isEnabled = p.enabled !== false
    const sourceMode = p.sourceMode === 'spherical_360' ? 1.0 : 0.0
    const fov = Number(p.fov ?? DEFAULT_PROJECTION_360_SETTINGS.fov)
    const distance = Number(p.distance ?? DEFAULT_PROJECTION_360_SETTINGS.distance)
    const distortion = Number(p.distortion ?? DEFAULT_PROJECTION_360_SETTINGS.distortion)
    const yaw = Number(p.yaw ?? DEFAULT_PROJECTION_360_SETTINGS.yaw)
    const pitch = Number(p.pitch ?? DEFAULT_PROJECTION_360_SETTINGS.pitch)
    const roll = Number(p.roll ?? DEFAULT_PROJECTION_360_SETTINGS.roll)
    const horizonLock = horizonLockToNumeric(p.horizonLock as string)
    const horizonOffset = Number(p.horizonOffset ?? DEFAULT_PROJECTION_360_SETTINGS.horizonOffset)
    const preset = p.preset as string | undefined
    let isDewarpMode = 0.0
    if (preset === 'ultra-wide' || preset === 'wide') {
      isDewarpMode = 0.0
    } else if (
      preset === 'linear' ||
      preset === 'narrow' ||
      preset === 'horizon-45' ||
      preset === 'horizon-360'
    ) {
      isDewarpMode = 1.0
    } else if (preset === 'custom') {
      isDewarpMode = 2.0
    } else {
      isDewarpMode = 2.0
    }

    return new Float32Array([
      width,
      height,
      width,
      height,
      fov,
      distance,
      distortion,
      yaw,
      pitch,
      roll,
      horizonLock,
      horizonOffset,
      isEnabled ? 1.0 : 0.0,
      sourceMode,
      isDewarpMode,
      0.0,
    ])
  },
}
