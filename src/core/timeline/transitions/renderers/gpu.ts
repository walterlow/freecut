/**
 * GPU Transition Renderers
 *
 * Registers WebGPU-accelerated transitions into the transition registry.
 * Each GPU transition provides:
 * - calculateStyles: CSS approximation for DOM preview
 * - renderCanvas: Canvas 2D fallback for non-GPU environments
 * - gpuTransitionId: ID for GPU-accelerated rendering via TransitionPipeline
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition, WipeDirection } from '@/types/transition';

const ALL_TIMINGS = ['linear', 'spring', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothStep(edge0: number, edge1: number, x: number): number {
  const width = Math.max(edge1 - edge0, Number.EPSILON);
  const t = clamp01((x - edge0) / width);
  return t * t * (3 - (2 * t));
}

function getNumericProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
  fallback: number
): number {
  const value = properties?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function fadeOpacity(progress: number, isOutgoing: boolean): number {
  return isOutgoing
    ? Math.cos((progress * Math.PI) / 2)
    : Math.sin((progress * Math.PI) / 2);
}

function traceSparklePath(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  innerRadius: number,
  rotation: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const angle = rotation + ((Math.PI / 4) * i);
    const r = i % 2 === 0 ? radius : innerRadius;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

function fillSparkleShape(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  innerRadius: number,
  rotation: number,
  stretchX = 1,
  stretchY = 1
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(stretchX, stretchY);
  traceSparklePath(ctx, 0, 0, radius, innerRadius, 0);
  ctx.fill();
  ctx.restore();
}

function renderSparklesCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  canvas?: { width: number; height: number },
  properties?: Record<string, unknown>
): void {
  const p = clamp01(progress);
  const w = canvas?.width ?? leftCanvas.width;
  const h = canvas?.height ?? leftCanvas.height;
  const sparkleScale = Math.max(0.55, getNumericProperty(properties, 'sparkleScale', 1));
  const intensity = Math.max(0.35, getNumericProperty(properties, 'intensity', 1));
  const density = Math.max(0.5, getNumericProperty(properties, 'density', 1));
  const glow = Math.max(0, getNumericProperty(properties, 'glow', 1));
  const outgoingHold = 1 - smoothStep(0.74, 1, p);

  ctx.save();
  ctx.drawImage(rightCanvas, 0, 0, w, h);
  ctx.restore();

  const leftLayer = new OffscreenCanvas(w, h);
  const leftCtx = leftLayer.getContext('2d');
  if (!leftCtx) {
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0, w, h);
    ctx.restore();
    return;
  }

  leftCtx.clearRect(0, 0, w, h);
  leftCtx.save();
  leftCtx.drawImage(leftCanvas, 0, 0, w, h);
  leftCtx.restore();

  const sparkleCount = Math.round(24 + (density * 22));
  const glowBursts: Array<{ x: number; y: number; radius: number; alpha: number; veilRadius: number }> = [];

  for (let i = 0; i < sparkleCount; i += 1) {
    const seed = i + 1;
    const revealPoint = Math.min(
      0.94,
      0.04
        + (seededRandom(seed * 31.7) * 0.72)
        + (seededRandom(seed * 7.9) * 0.16)
    );
    const igniteDuration = 0.14 + (seededRandom(seed * 41.9) * 0.18);
    const igniteProgress = clamp01((p - revealPoint) / igniteDuration);
    const igniteIn = smoothStep(0, 0.16, igniteProgress);
    const igniteOut = 1 - smoothStep(0.3, 0.95, igniteProgress);
    const activation = igniteIn * igniteOut;
    const afterglow = smoothStep(0.06, 0.72, igniteProgress);
    if (activation <= 0.01 && afterglow <= 0.02) continue;

    const twinklePhase = (igniteProgress * (3.6 + (seededRandom(seed * 5.3) * 3.8))) + seededRandom(seed * 11.1);
    const twinkle = 0.35 + (0.65 * ((Math.sin(twinklePhase * Math.PI * 2) + 1) / 2));
    const alpha = Math.min(1, activation * twinkle * intensity);
    const breakupAlpha = Math.min(1, afterglow * (0.25 + (twinkle * 0.35)) * intensity);

    const baseX = seededRandom(seed * 13.1) * w;
    const baseY = seededRandom(seed * 17.9) * h;
    const sizeSeed = Math.pow(seededRandom(seed * 19.7), 0.55);
    const radius = (4 + (sizeSeed * 34)) * sparkleScale * (0.55 + (activation * 1.15));
    const angle = seededRandom(seed * 23.3) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const drift = (10 + (sizeSeed * 28)) * activation;
    const orbitRadius = (3 + (sizeSeed * 10)) * activation;
    const orbitAngle = angle + (igniteProgress * (2.4 + (seededRandom(seed * 29.1) * 4.5)) * Math.PI);
    const x = baseX + (dirX * drift) + (Math.cos(orbitAngle) * orbitRadius);
    const y = baseY + (dirY * drift) + (Math.sin(orbitAngle) * orbitRadius * 0.8);
    const rotation = angle + (igniteProgress * (2 + (sizeSeed * 3.5)) * Math.PI);

    leftCtx.save();
    leftCtx.globalCompositeOperation = 'destination-out';
    leftCtx.globalAlpha = alpha;
    leftCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    fillSparkleShape(leftCtx, x, y, radius, radius * 0.24, rotation);

    leftCtx.globalAlpha = alpha * 0.46;
    fillSparkleShape(
      leftCtx,
      x - (dirX * radius * 0.9),
      y - (dirY * radius * 0.9),
      radius * 0.78,
      radius * 0.14,
      rotation - 0.45,
      1.9,
      0.58
    );

    leftCtx.globalAlpha = alpha * 0.22;
    fillSparkleShape(
      leftCtx,
      x - (dirX * radius * 1.55),
      y - (dirY * radius * 1.55),
      radius * 0.52,
      radius * 0.12,
      rotation - 0.7,
      2.4,
      0.42
    );

    const dustCount = 3 + Math.round(sizeSeed * 2);
    leftCtx.globalAlpha = breakupAlpha * 0.08;
    for (let dustIndex = 0; dustIndex < dustCount; dustIndex += 1) {
      const dustSeed = (seed * 53.1) + (dustIndex * 7.3);
      const dustAngle = seededRandom(dustSeed) * Math.PI * 2;
      const dustDistance = radius
        * (1.3 + (seededRandom(dustSeed * 1.7) * 2.1))
        * (0.5 + afterglow);
      const dustRadius = radius
        * (0.14 + (seededRandom(dustSeed * 2.9) * 0.24))
        * (0.55 + afterglow);
      leftCtx.beginPath();
      leftCtx.arc(
        x + (Math.cos(dustAngle) * dustDistance),
        y + (Math.sin(dustAngle) * dustDistance * 0.85),
        dustRadius,
        0,
        Math.PI * 2
      );
      leftCtx.fill();
    }

    leftCtx.beginPath();
    leftCtx.arc(x, y, radius * 0.24, 0, Math.PI * 2);
    leftCtx.fill();
    leftCtx.restore();

    glowBursts.push({
      x,
      y,
      radius: radius * 2.6,
      alpha: Math.min(1, alpha + (breakupAlpha * 0.45)),
      veilRadius: radius * 5.4,
    });
  }

  if (glowBursts.length > 0 && glow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const burst of glowBursts) {
      const veil = ctx.createRadialGradient(
        burst.x,
        burst.y,
        0,
        burst.x,
        burst.y,
        burst.veilRadius
      );
      veil.addColorStop(0, `rgba(255, 245, 228, ${0.12 * burst.alpha * glow})`);
      veil.addColorStop(0.45, `rgba(255, 226, 184, ${0.06 * burst.alpha * glow})`);
      veil.addColorStop(1, 'rgba(255, 214, 165, 0)');
      ctx.fillStyle = veil;
      ctx.fillRect(
        burst.x - burst.veilRadius,
        burst.y - burst.veilRadius,
        burst.veilRadius * 2,
        burst.veilRadius * 2
      );
    }
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = outgoingHold;
  ctx.drawImage(leftLayer, 0, 0);
  ctx.restore();

  if (glowBursts.length === 0 || glow <= 0) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const burst of glowBursts) {
    const gradient = ctx.createRadialGradient(
      burst.x,
      burst.y,
      0,
      burst.x,
      burst.y,
      burst.radius
    );
    gradient.addColorStop(0, `rgba(255, 252, 240, ${0.38 * burst.alpha * glow})`);
    gradient.addColorStop(0.32, `rgba(255, 224, 170, ${0.26 * burst.alpha * glow})`);
    gradient.addColorStop(1, 'rgba(255, 210, 150, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(
      burst.x - burst.radius,
      burst.y - burst.radius,
      burst.radius * 2,
      burst.radius * 2
    );
  }
  ctx.restore();
}

// ============================================================================
// Dissolve
// ============================================================================

const dissolveRenderer: TransitionRenderer = {
  gpuTransitionId: 'dissolve',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: equal-power crossfade (GPU version uses noise pattern)
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: simple crossfade
    const p = clamp01(progress);
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const dissolveDef: TransitionDefinition = {
  id: 'dissolve',
  label: 'Dissolve',
  description: 'Noise-based organic dissolve between clips',
  category: 'basic',
  icon: 'Sparkles',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Sparkles
// ============================================================================

const sparklesRenderer: TransitionRenderer = {
  gpuTransitionId: 'sparkles',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress);
    const envelope = Math.sin(p * Math.PI);
    const phase = isOutgoing ? 0.2 : 1.05;
    const drift = 14 * envelope;
    const x = Math.sin((p * Math.PI * 2.2) + phase) * drift * 0.55;
    const y = Math.cos((p * Math.PI * 1.6) + phase) * drift * 0.28;
    const rotate = Math.sin((p * Math.PI * 1.8) + phase) * envelope * 1.6;
    const scale = isOutgoing
      ? 1 - (0.03 * p)
      : 1.03 - (0.03 * p);
    const opacity = isOutgoing
      ? 1 - smoothStep(0.2, 0.94, p)
      : smoothStep(0.06, 0.8, p);

    return {
      opacity,
      transform: envelope > 0.08
        ? `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scale})`
        : undefined,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas, properties) {
    renderSparklesCanvas(ctx, leftCanvas, rightCanvas, progress, canvas, properties);
  },
};

const sparklesDef: TransitionDefinition = {
  id: 'sparkles',
  label: 'Sparkles',
  description: 'Twinkling star bursts reveal the next clip',
  category: 'custom',
  icon: 'Sparkles',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 24,
  minDuration: 8,
  maxDuration: 72,
};

// ============================================================================
// Glitch
// ============================================================================

const glitchRenderer: TransitionRenderer = {
  gpuTransitionId: 'glitch',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: hard cut with deterministic jitter
    const p = clamp01(progress);
    const envelope = Math.sin(p * Math.PI);
    const offset = Math.sin(p * 47) * envelope * 5;
    const midpoint = 0.5;

    if (isOutgoing) {
      return {
        opacity: p < midpoint ? 1 : 0,
        transform: envelope > 0.2 ? `translateX(${offset}px)` : undefined,
      };
    }
    return {
      opacity: p >= midpoint ? 1 : 0,
      transform: envelope > 0.2 ? `translateX(${-offset}px)` : undefined,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: simple hard cut
    const p = clamp01(progress);
    if (p < 0.5) {
      ctx.drawImage(leftCanvas, 0, 0);
    } else {
      ctx.drawImage(rightCanvas, 0, 0);
    }
  },
};

const glitchDef: TransitionDefinition = {
  id: 'glitch',
  label: 'Glitch',
  description: 'Digital glitch with RGB split and block displacement',
  category: 'custom',
  icon: 'Zap',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 20,
  minDuration: 5,
  maxDuration: 60,
};

// ============================================================================
// Light Leak
// ============================================================================

const lightLeakRenderer: TransitionRenderer = {
  gpuTransitionId: 'lightLeak',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade (GPU version adds warm light sweep)
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    // Canvas 2D fallback: directional crossfade
    const p = clamp01(progress);
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;
    const dir = (direction as WipeDirection) || 'from-left';

    // Draw incoming
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0, w, h);
    ctx.restore();

    // Draw outgoing
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0, w, h);
    ctx.restore();

    // Add warm glow overlay
    const envelope = Math.sin(p * Math.PI);
    if (envelope > 0.1) {
      ctx.save();
      let gx: number, gy: number;
      switch (dir) {
        case 'from-left': gx = p * w; gy = h / 2; break;
        case 'from-right': gx = (1 - p) * w; gy = h / 2; break;
        case 'from-top': gx = w / 2; gy = p * h; break;
        case 'from-bottom': gx = w / 2; gy = (1 - p) * h; break;
        default: gx = p * w; gy = h / 2;
      }
      const radius = Math.max(w, h) * 0.4;
      const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
      gradient.addColorStop(0, `rgba(255, 230, 180, ${0.3 * envelope})`);
      gradient.addColorStop(1, 'rgba(255, 230, 180, 0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  },
};

const lightLeakDef: TransitionDefinition = {
  id: 'lightLeak',
  label: 'Light Leak',
  description: 'Warm light sweep revealing the next clip',
  category: 'light',
  icon: 'Sun',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
};

// ============================================================================
// Pixelate
// ============================================================================

const pixelateRenderer: TransitionRenderer = {
  gpuTransitionId: 'pixelate',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade (GPU version does mosaic pixelation)
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: hard cut at midpoint
    const p = clamp01(progress);
    if (p < 0.5) {
      ctx.drawImage(leftCanvas, 0, 0);
    } else {
      ctx.drawImage(rightCanvas, 0, 0);
    }
  },
};

const pixelateDef: TransitionDefinition = {
  id: 'pixelate',
  label: 'Pixelate',
  description: 'Mosaic pixelation dissolve between clips',
  category: 'custom',
  icon: 'Grid3x3',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 20,
  minDuration: 8,
  maxDuration: 60,
};

// ============================================================================
// Chromatic
// ============================================================================

const chromaticRenderer: TransitionRenderer = {
  gpuTransitionId: 'chromatic',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade with slight blur
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    // Canvas 2D fallback: directional crossfade
    const p = clamp01(progress);
    const w = canvas?.width ?? leftCanvas.width;
    const h = canvas?.height ?? leftCanvas.height;

    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0, w, h);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0, w, h);
    ctx.restore();
  },
};

const chromaticDef: TransitionDefinition = {
  id: 'chromatic',
  label: 'Chromatic',
  description: 'RGB channel split with directional sweep',
  category: 'chromatic',
  icon: 'Aperture',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 25,
  minDuration: 10,
  maxDuration: 60,
};

// ============================================================================
// Radial Blur
// ============================================================================

const radialBlurRenderer: TransitionRenderer = {
  gpuTransitionId: 'radialBlur',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade with slight scale
    const p = clamp01(progress);
    const envelope = Math.sin(p * Math.PI);
    const scale = 1 + envelope * 0.02;
    return {
      opacity: fadeOpacity(p, isOutgoing),
      transform: envelope > 0.1 ? `scale(${scale})` : undefined,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: crossfade
    const p = clamp01(progress);
    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, false);
    ctx.drawImage(rightCanvas, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fadeOpacity(p, true);
    ctx.drawImage(leftCanvas, 0, 0);
    ctx.restore();
  },
};

const radialBlurDef: TransitionDefinition = {
  id: 'radialBlur',
  label: 'Radial Blur',
  description: 'Zoom and spin blur transition',
  category: 'custom',
  icon: 'CircleDot',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 25,
  minDuration: 10,
  maxDuration: 60,
};

// ============================================================================
// Registration
// ============================================================================

export function registerGpuTransitions(registry: TransitionRegistry): void {
  registry.register('dissolve', dissolveDef, dissolveRenderer);
  registry.register('sparkles', sparklesDef, sparklesRenderer);
  registry.register('glitch', glitchDef, glitchRenderer);
  registry.register('lightLeak', lightLeakDef, lightLeakRenderer);
  registry.register('pixelate', pixelateDef, pixelateRenderer);
  registry.register('chromatic', chromaticDef, chromaticRenderer);
  registry.register('radialBlur', radialBlurDef, radialBlurRenderer);
}
